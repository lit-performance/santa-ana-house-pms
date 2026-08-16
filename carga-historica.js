// carga-historica.js
//
// Módulo: Carga histórica de estadías. Pantalla para digitar, uno por
// uno, los huéspedes y estadías de días ANTERIORES a que el sistema
// entrara en uso real (por ejemplo, del 1 al 11 de agosto) — para que
// Huéspedes, Reservas e Indicadores queden completos desde el arranque
// del mes, no solo desde el día en que se empezó a usar el sistema.
//
// A propósito, esto NO es un atajo dentro de Recepción: un check-in
// normal siempre usa la fecha de HOY y además marca la habitación como
// "ocupada" en este momento — ninguna de las dos cosas sirve para cargar
// una estadía que ya pasó. Esta pantalla es su propio flujo, pensado
// solo para eso:
//   - Deja elegir CUALQUIER fecha de check-in y check-out (pasadas), sin
//     importar el estado actual de la habitación.
//   - NO toca el estado de la habitación — la estadía ya terminó, así
//     que la habitación sigue como esté ahora mismo.
//   - Cada estadía cargada aquí queda con la MISMA estructura que un
//     check-in real (reserva con estado 'check_out', su check-in en
//     recepcion_checkins, su ficha en huespedes, y su pago en
//     reservas_pagos con la fecha real del pago) — así se ve exactamente
//     igual en Huéspedes, Reservas e Indicadores que cualquier estadía
//     capturada por el sistema en vivo.
//   - Cada registro se marca por dentro con "[CARGA_HISTORICA]" al
//     inicio de sus comentarios — invisible para el resto del sistema,
//     pero permite que la tabla de abajo ("Estadías cargadas") sepa
//     cuáles mostrar y ofrecer un botón para eliminarlas si te
//     equivocas al digitar una.
//
// Nota de alcance: no incluye consumo de minibar. Si alguna estadía
// histórica sí tuvo consumo de minibar y quieres que quede reflejado,
// súmalo directo al "Monto cobrado" de esta pantalla con una nota en
// Observaciones — no hace falta registrar cada producto por separado
// para datos de meses ya cerrados.
//
// Solo propietario/administrador pueden ver y usar esta pantalla — es
// una herramienta de corrección/carga retroactiva, no de operación
// diaria (por eso no la puede usar recepcionista).
//
// CORRECCIÓN (ver 095): el módulo se había registrado con
// parentId: 'grupo-configuracion', que no existe — el id real del
// módulo principal de Configuración es 'configuracion' (ver
// config-habitaciones.js), igual que usan usuarios.js y la entrada
// "Documentos" de placeholders.js. Por el id equivocado, esta pantalla
// quedaba registrada pero huérfana: no aparecía ni como pestaña
// principal ni como subpestaña de nada. Ya corregido abajo.
//
// Oculto temporalmente (roles: []) desde 161 — ya se cargaron a mano los
// ingresos de agosto y no es una pantalla de uso diario. El código, los
// permisos internos (ROLES_PERMITIDOS/puedeUsar(), sin tocar) y los datos
// ya cargados siguen intactos; reactivar es solo devolverle su lista de
// roles al registerModule() de más abajo.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP, activarInputDinero, valorNumericoInput } from './currency.js';
import { formatFechaHora, toISODate } from './dates.js';
import { getUsuarioActual } from './auth.js';

const TIPOS_DOCUMENTO = ['Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'Tarjeta de identidad', 'PEP', 'Otro'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];
const MARCADOR = '[CARGA_HISTORICA]';

const ROLES_PERMITIDOS = ['propietario', 'administrador'];

function puedeUsar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_PERMITIDOS.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function nochesEntre(fechaInicioISO, fechaFinISO) {
  if (!fechaInicioISO || !fechaFinISO) return 0;
  const noches = Math.round((new Date(fechaFinISO) - new Date(fechaInicioISO)) / 86400000);
  return noches > 0 ? noches : 0;
}

async function render(container) {
  if (!puedeUsar()) {
    container.innerHTML = `
      <h2>Carga histórica de estadías</h2>
      <p class="mensaje-vacio">Tu rol no tiene permiso para usar esta pantalla.</p>
    `;
    return;
  }

  container.innerHTML = `
    <h2>Carga histórica de estadías</h2>
    <p style="color:var(--color-texto-suave); margin-bottom:1.25rem;">Para digitar, huésped por huésped, las estadías de días ANTERIORES a que empezaste a usar el sistema en vivo (por ejemplo, del 1 al 11 de agosto). Cada una queda igual de completa que un check-in normal — aparece en Huéspedes, Reservas e Indicadores con su fecha real, sin tocar el estado actual de la habitación.</p>
    <div id="form-historica-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="lista-historica-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  await Promise.all([cargarForm(container), cargarLista(container.querySelector('#lista-historica-wrap'))]);
}

async function cargarForm(container) {
  const elemento = container.querySelector('#form-historica-wrap');

  const [{ data: habitaciones }, { data: tarifas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
  ]);

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-morado">
      <h3 style="margin-top:0;">+ Cargar una estadía histórica</h3>
      <form id="form-carga-historica">
        <h4 style="margin-bottom:0.5rem;">Huésped</h4>
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required />
          </label>
          <label>Tipo de documento
            <select name="tipo_documento">
              ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required />
          </label>
          <label>Celular <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="celular" />
          </label>
        </div>

        <h4 style="margin:1.25rem 0 0.5rem;">Estadía</h4>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" required>
              <option value="">—</option>
              ${(habitaciones || []).map((h) => `<option value="${h.id}">${escaparHTML(h.numero)} — ${escaparHTML(h.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>Tarifa <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <select name="tarifa_id" id="select-tarifa-historica">
              <option value="">—</option>
              ${(tarifas || []).map((t) => `<option value="${t.id}">${t.codigo} / ${formatCOP(t.precio_temporada_baja)}</option>`).join('')}
            </select>
          </label>
          <label>Fecha de check-in
            <input type="date" name="fecha_checkin" id="input-fecha-checkin-historica" required />
          </label>
          <label>Fecha de check-out
            <input type="date" name="fecha_checkout" id="input-fecha-checkout-historica" required />
          </label>
        </div>
        <p class="mensaje-vacio" id="hint-noches-historica" style="margin-top:0.4rem; font-size:0.78rem;">Elige las dos fechas para calcular las noches.</p>

        <h4 style="margin:1.25rem 0 0.5rem;">Pago</h4>
        <div class="form-grid">
          <label>Monto cobrado
            <input type="text" name="monto_cobrado" id="input-monto-cobrado-historica" placeholder="$0" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago" required>
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Fecha del pago
            <input type="date" name="fecha_pago" id="input-fecha-pago-historica" required />
          </label>
        </div>
        <p class="mensaje-vacio" style="margin-top:0.4rem; font-size:0.78rem;">La "Fecha del pago" es la que decide en qué día aparece este ingreso en Registro diario e Indicadores — normalmente es el día del check-out.</p>

        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones <span style="text-transform:none; font-weight:400;">(opcional)</span>
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit; text-transform:none;"></textarea>
        </label>

        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="submit" class="btn btn-primario">+ Cargar esta estadía</button>
        </div>
      </form>
    </div>
  `;

  const inputCheckin = elemento.querySelector('#input-fecha-checkin-historica');
  const inputCheckout = elemento.querySelector('#input-fecha-checkout-historica');
  const inputFechaPago = elemento.querySelector('#input-fecha-pago-historica');
  const inputMonto = elemento.querySelector('#input-monto-cobrado-historica');
  const selectTarifa = elemento.querySelector('#select-tarifa-historica');
  const hintNoches = elemento.querySelector('#hint-noches-historica');

  activarInputDinero(inputMonto);

  function actualizarHintNoches() {
    const noches = nochesEntre(inputCheckin.value, inputCheckout.value);
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifa.value));
    if (!inputCheckin.value || !inputCheckout.value) {
      hintNoches.textContent = 'Elige las dos fechas para calcular las noches.';
    } else if (noches <= 0) {
      hintNoches.textContent = '⚠️ La fecha de check-out debe ser posterior a la de check-in.';
    } else {
      const estimado = tarifa ? noches * Number(tarifa.precio_temporada_baja) : null;
      hintNoches.textContent = `${noches} noche(s)${estimado !== null ? ` — estimado según tarifa: ${formatCOP(estimado)}` : ''}`;
    }
    // La fecha de pago sugerida sigue al check-out mientras la
    // recepcionista no la haya tocado a mano.
    if (inputCheckout.value && !inputFechaPago.dataset.editadoManual) {
      inputFechaPago.value = inputCheckout.value;
    }
  }

  inputCheckin.addEventListener('change', actualizarHintNoches);
  inputCheckout.addEventListener('change', actualizarHintNoches);
  selectTarifa.addEventListener('change', actualizarHintNoches);
  inputFechaPago.addEventListener('input', () => {
    inputFechaPago.dataset.editadoManual = '1';
  });

  elemento.querySelector('#form-carga-historica').addEventListener('submit', async (e) => {
    e.preventDefault();

    const form = new FormData(e.target);
    const fechaCheckin = form.get('fecha_checkin');
    const fechaCheckout = form.get('fecha_checkout');
    const noches = nochesEntre(fechaCheckin, fechaCheckout);

    if (noches <= 0) {
      mostrarToast('La fecha de check-out debe ser posterior a la de check-in.', 'error');
      return;
    }

    const hoyISO = toISODate(new Date());
    if (fechaCheckin > hoyISO || fechaCheckout > hoyISO) {
      const seguir = await mostrarConfirmacion({
        titulo: 'Fecha futura',
        contenidoHTML: 'Alguna de las fechas de esta estadía es posterior a hoy — esta pantalla es para cargar días YA PASADOS. ¿Confirmas que quieres continuar de todas formas?',
        textoConfirmar: 'Sí, continuar',
      });
      if (!seguir) return;
    }

    const habitacionId = Number(form.get('habitacion_id'));
    const tarifaId = form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null;
    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;
    const tipoDocumento = form.get('tipo_documento');
    const metodoPago = form.get('metodo_pago');
    const montoCobrado = valorNumericoInput(inputMonto);
    const fechaPago = form.get('fecha_pago') || fechaCheckout;
    const observaciones = form.get('observaciones').trim() || null;
    const usuario = getUsuarioActual();

    // --- 1) Reserva histórica, ya cerrada (estado check_out) ---
    const { data: reserva, error: errReserva } = await supabase
      .from('reservas')
      .insert({
        habitacion_id: habitacionId,
        huesped_nombre: nombre,
        huesped_documento: documento,
        huesped_telefono: celular,
        fecha_checkin: fechaCheckin,
        fecha_checkout: fechaCheckout,
        estado: 'check_out',
        tarifa_id: tarifaId,
        comentarios: `${MARCADOR} Estadía cargada retroactivamente por ${usuario?.nombre || 'un administrador'}.`,
      })
      .select('id')
      .single();

    if (errReserva) {
      mostrarToast(`Error creando la reserva histórica: ${errReserva.message}`, 'error');
      return;
    }

    // --- 2) Check-in histórico, con fecha de creación forzada al día real
    // de llegada (si no, aparecería registrado "hoy" en vez del día que
    // realmente entró el huésped). ---
    const { error: errCheckin } = await supabase.from('recepcion_checkins').insert({
      reserva_id: reserva.id,
      habitacion_id: habitacionId,
      nombre,
      tipo_documento: tipoDocumento,
      numero_documento: documento,
      celular,
      tarifa_id: tarifaId,
      cantidad_noches: noches,
      metodo_pago: metodoPago,
      observaciones: observaciones ? `${MARCADOR} ${observaciones}` : `${MARCADOR} Check-in cargado retroactivamente.`,
      consentimiento_habeas_data: true,
      creado_en: `${fechaCheckin}T15:00:00`,
      check_out_en: `${fechaCheckout}T12:00:00`,
    });

    if (errCheckin) {
      mostrarToast(`Reserva creada, pero hubo un error creando el check-in: ${errCheckin.message}`, 'error');
      return;
    }

    // --- 3) Pago histórico, con la fecha real en que se cobró ---
    if (montoCobrado > 0) {
      const { error: errPago } = await supabase.from('reservas_pagos').insert({
        reserva_id: reserva.id,
        monto: montoCobrado,
        metodo_pago: metodoPago,
        fecha: `${fechaPago}T12:00:00`,
        comentarios: `${MARCADOR} Pago cargado retroactivamente.`,
      });
      if (errPago) {
        mostrarToast(`Check-in creado, pero hubo un error registrando el pago: ${errPago.message}`, 'error');
        return;
      }
    }

    // --- 4) Ficha de huésped (histórico), igual que en un check-in real ---
    const { error: errHuesped } = await supabase.from('huespedes').upsert(
      {
        numero_documento: documento,
        tipo_documento: tipoDocumento,
        nombre,
        telefono: celular,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (errHuesped) {
      mostrarToast(`Estadía cargada, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
    }

    mostrarToast(`Estadía de ${nombre} cargada (${fechaCheckin} a ${fechaCheckout}).`, 'exito');

    // Deja habitación y tarifa listas para seguir cargando el siguiente
    // huésped rápido, sin tener que volver a llenar todo el formulario.
    e.target.reset();
    activarInputDinero(inputMonto);
    delete inputFechaPago.dataset.editadoManual;
    hintNoches.textContent = 'Elige las dos fechas para calcular las noches.';

    const wrapLista = document.querySelector('#lista-historica-wrap');
    if (wrapLista) await cargarLista(wrapLista);
  });
}

async function cargarLista(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const { data: reservas, error: errReservas } = await supabase
    .from('reservas')
    .select('id, habitacion_id, huesped_nombre, huesped_documento, fecha_checkin, fecha_checkout, habitaciones(numero, nombre)')
    .ilike('comentarios', `%${MARCADOR}%`)
    .order('fecha_checkin', { ascending: true });

  if (errReservas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando las estadías históricas: ${errReservas.message}</p>`;
    return;
  }

  const reservaIds = (reservas || []).map((r) => r.id);
  const { data: pagos, error: errPagos } = reservaIds.length
    ? await supabase.from('reservas_pagos').select('reserva_id, monto').in('reserva_id', reservaIds)
    : { data: [], error: null };

  if (errPagos) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando los pagos: ${errPagos.message}</p>`;
    return;
  }

  const cobradoPorReserva = new Map();
  (pagos || []).forEach((p) => {
    cobradoPorReserva.set(p.reserva_id, (cobradoPorReserva.get(p.reserva_id) || 0) + Number(p.monto));
  });

  const totalCobrado = Array.from(cobradoPorReserva.values()).reduce((sum, m) => sum + m, 0);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.75rem;">
        <h3 style="margin:0;">📋 Estadías cargadas como históricas (${(reservas || []).length})</h3>
        <strong style="font-size:1.05rem;">${formatCOP(totalCobrado)}</strong>
      </div>
      ${
        (reservas || []).length === 0
          ? '<p class="mensaje-vacio">Todavía no has cargado ninguna estadía histórica.</p>'
          : `
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead><tr><th>Huésped</th><th>Habitación</th><th>Check-in</th><th>Check-out</th><th>Cobrado</th><th></th></tr></thead>
            <tbody>
              ${reservas
                .map(
                  (r) => `<tr data-reserva-id="${r.id}">
                <td>${escaparHTML(r.huesped_nombre)}<div class="mensaje-vacio" style="font-size:0.75rem;">${escaparHTML(r.huesped_documento || '')}</div></td>
                <td>${r.habitaciones ? `${escaparHTML(r.habitaciones.numero)} — ${escaparHTML(r.habitaciones.nombre)}` : '—'}</td>
                <td>${r.fecha_checkin}</td>
                <td>${r.fecha_checkout}</td>
                <td>${formatCOP(cobradoPorReserva.get(r.id) || 0)}</td>
                <td><button type="button" class="btn-editar btn-eliminar-historica" data-reserva-id="${r.id}">🗑 Eliminar</button></td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
      <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">Solo se listan aquí las estadías cargadas desde esta pantalla — no las que entraron por Recepción en el día a día.</p>
    </div>
  `;

  elemento.querySelectorAll('.btn-eliminar-historica').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Eliminar estadía histórica',
        contenidoHTML: '¿Eliminar esta estadía cargada? Se borra la reserva, el check-in y el pago asociados. Esta acción no se puede deshacer.',
        textoConfirmar: 'Eliminar',
      });
      if (!ok) return;

      const reservaId = Number(btn.dataset.reservaId);

      await supabase.from('reservas_pagos').delete().eq('reserva_id', reservaId);
      await supabase.from('recepcion_checkins').delete().eq('reserva_id', reservaId);
      const { error } = await supabase.from('reservas').delete().eq('id', reservaId);

      if (error) {
        mostrarToast(`Error eliminando: ${error.message}`, 'error');
        return;
      }

      mostrarToast('Estadía histórica eliminada.', 'exito');
      await cargarLista(elemento);
    });
  });
}

registerModule({
  id: 'carga-historica',
  label: 'Carga histórica',
  icono: '🗓️',
  roles: [],
  parentId: 'configuracion',
  render,
});
