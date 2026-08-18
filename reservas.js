// reservas.js
//
// Módulo 3: Reservas. Calendario horizontal (habitaciones x fechas), con
// reserva rápida al hacer clic en una celda vacía, y edición completa
// (fechas, cambio de habitación, estado, abonos/pagos, comentarios) al
// hacer clic en una reserva existente.
//
// Nota de alcance: se implementó clic-para-crear/editar en vez de
// arrastrar-y-soltar (drag & drop) — cumple la misma función ("cambio de
// habitación", "modificar fechas") sin la complejidad de un motor de drag
// and drop hecho a mano. Puede añadirse más adelante si hace falta.
//
// Nota importante sobre el estado de la habitación (Housekeeping /
// Configuración) frente al calendario:
// - 'mantenimiento', 'bloqueada', 'fuera_servicio' son estados indefinidos
//   (duran hasta que alguien los revierta): bloquean TODAS las fechas
//   visibles, no solo hoy.
// - 'ocupada', 'limpieza', 'inspeccion' son estados de hoy (deberían
//   resolverse el mismo día): solo bloquean la columna de HOY. Las fechas
//   futuras siguen disponibles para reservar, porque para entonces la
//   habitación ya debería estar libre.
// - Si ya existe una reserva para esa fecha, esa reserva manda (se ve el
//   nombre del huésped) — el estado de la habitación solo se usa
//   cuando no hay ninguna reserva cubriendo la celda.
//
// Nota sobre el monto total: se calcula automático como noches × precio de
// temporada baja de la tarifa elegida, cada vez que cambian las fechas o la
// tarifa en el formulario. Si el usuario edita el campo "Monto total" a
// mano, el cálculo automático se detiene para esa apertura del modal (para
// no pisar un valor que alguien ajustó a propósito, ej. un descuento). El
// campo se muestra formateado con "$" y punto de miles (ver currency.js);
// el valor real que se guarda se lee siempre con `valorNumericoInput`.
//
// Nota sobre el chequeo de cruce de fechas: antes de crear o editar una
// reserva se verifica que ninguna otra reserva activa (reservada,
// confirmada, check_in, hospedado) de la MISMA habitación se cruce con
// las fechas elegidas. Esto es lo que evita, por ejemplo, hacer una
// "Reserva rápida" para hoy sobre una habitación que ya está ocupada —
// el estado de la habitación (ocupada/limpieza/etc) por sí solo no
// alcanzaba a detectar eso, porque solo bloqueaba el desplegable en
// ciertos casos, no validaba las fechas reales contra otras reservas.
//
// Nota sobre métodos de pago (abonos): la lista completa vive en
// METODOS_PAGO — Efectivo, Nequi, Daviplata, QR, Transferencia Bancaria,
// Datáfono, Llave. Caja consolida cada uno como si fuera una cuenta
// aparte (ver caja.js), así que agregar/quitar un método aquí también
// cambia lo que se ve ahí.
//
// Nota sobre "¿Hubo abono al crear la reserva?": además del monto, ahora
// se elige el TIPO de pago inicial — "Abono parcial" (se cobra lo que se
// escriba) o "Pago total" (se cobra automático el Monto total completo de
// la reserva, sin tener que copiar el número a mano). Cambiar a "Pago
// total" rellena el campo de abono con el monto total actual; si después
// se sigue ajustando el monto total, el abono no se vuelve a recalcular
// solo — hay que volver a elegir "Pago total" o escribir el número a mano.
//
// Nota sobre "Eliminar" una reserva: solo se puede borrar de verdad una
// reserva que NO tenga abonos (reservas_pagos) ni check-in
// (recepcion_checkins) vinculados — la base de datos lo bloquea a
// propósito (error 23503, choque de llave foránea) para no perder
// historial de pagos ni datos del huésped. Si la reserva ya tiene algo de
// eso, lo correcto es cambiar su Estado a "Cancelada" en vez de
// eliminarla; el formulario ya lo explica si el borrado falla por esto.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP, activarInputDinero, valorNumericoInput } from './currency.js';
import { badgeEstadoReserva, opcionesEstadoReserva, badgeEstadoHabitacion } from './badges.js';
import { toISODate, addDays, formatFechaHora } from './dates.js';

const DIAS_VISIBLES = 14;
let rangoInicio = new Date();
rangoInicio.setHours(0, 0, 0, 0);

const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];

// Estados de reserva que "ocupan" la habitación para efectos de detectar
// cruces de fechas. 'cancelada' y 'no_show' se excluyen a propósito: una
// reserva cancelada no debe seguir bloqueando esas fechas para otra
// reserva nueva.
const ESTADOS_RESERVA_ACTIVOS = ['reservada', 'confirmada', 'check_in', 'hospedado'];

const CLASE_CELDA = {
  reservada: 'celda-estado-reservada',
  confirmada: 'celda-estado-confirmada',
  check_in: 'celda-estado-check_in',
  hospedado: 'celda-estado-hospedado',
  check_out: 'celda-estado-check_out',
  cancelada: 'celda-estado-cancelada',
  no_show: 'celda-estado-no_show',
};

// Bloquean todas las fechas visibles del calendario, no solo hoy.
const ESTADOS_BLOQUEO_INDEFINIDO = ['mantenimiento', 'bloqueada', 'fuera_servicio'];

// Solo bloquean la columna de hoy (se espera que se resuelvan el mismo día).
const ESTADOS_BLOQUEO_HOY = ['ocupada', 'limpieza', 'inspeccion'];

const ETIQUETA_ESTADO_HABITACION = {
  ocupada: '🔴 Ocupada',
  limpieza: '🧹 Limpieza',
  inspeccion: '🔍 Inspección',
  mantenimiento: '🔧 Mantenim.',
  bloqueada: '🚫 Bloqueada',
  fuera_servicio: '⛔ Fuera serv.',
};

async function render(container) {
  container.innerHTML = `
    <h2>Reservas</h2>
    <div class="calendario-reservas-nav">
      <div class="calendario-reservas-nav-botones">
        <button type="button" id="btn-rango-anterior" class="btn btn-secundario btn-chico">← 14 días</button>
        <button type="button" id="btn-rango-hoy" class="btn btn-secundario btn-chico">Hoy</button>
        <button type="button" id="btn-rango-siguiente" class="btn btn-secundario btn-chico">14 días →</button>
      </div>
      <button type="button" id="btn-reserva-rapida" class="btn btn-primario">+ Reserva rápida</button>
    </div>
    <div id="calendario-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-rango-anterior').addEventListener('click', () => {
    rangoInicio = addDays(rangoInicio, -DIAS_VISIBLES);
    cargarCalendario(container);
  });
  container.querySelector('#btn-rango-siguiente').addEventListener('click', () => {
    rangoInicio = addDays(rangoInicio, DIAS_VISIBLES);
    cargarCalendario(container);
  });
  container.querySelector('#btn-rango-hoy').addEventListener('click', () => {
    rangoInicio = new Date();
    rangoInicio.setHours(0, 0, 0, 0);
    cargarCalendario(container);
  });
  container.querySelector('#btn-reserva-rapida').addEventListener('click', () => abrirModalReserva(container, null));

  await cargarCalendario(container);
}

async function cargarCalendario(container) {
  const wrap = container.querySelector('#calendario-wrap');
  const hoyISO = toISODate(new Date());
  const fechas = Array.from({ length: DIAS_VISIBLES }, (_, i) => addDays(rangoInicio, i));
  const rangoFinISO = toISODate(addDays(rangoInicio, DIAS_VISIBLES));
  const rangoInicioISO = toISODate(rangoInicio);

  const [{ data: habitaciones, error: errHab }, { data: reservas, error: errRes }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase
      .from('reservas')
      .select('*')
      .lte('fecha_checkin', rangoFinISO)
      .gt('fecha_checkout', rangoInicioISO),
  ]);

  if (errHab || errRes) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando calendario: ${(errHab || errRes).message}</p>`;
    return;
  }

  const encabezados = fechas
    .map((f) => {
      const iso = toISODate(f);
      const esHoy = iso === hoyISO;
      const label = f.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' });
      return `<th class="${esHoy ? 'celda-columna-hoy' : ''}">${label}</th>`;
    })
    .join('');

  const filas = (habitaciones || [])
    .map((h) => {
      const bloqueoIndefinido = ESTADOS_BLOQUEO_INDEFINIDO.includes(h.estado);
      const bloqueoHoy = ESTADOS_BLOQUEO_HOY.includes(h.estado);
      const celdas = fechas
        .map((f) => {
          const iso = toISODate(f);
          const esHoy = iso === hoyISO;
          const reserva = (reservas || []).find(
            (r) => r.habitacion_id === h.id && iso >= r.fecha_checkin && iso < r.fecha_checkout
          );
          if (reserva) {
            const clase = CLASE_CELDA[reserva.estado] || '';
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-reserva-ocupada ${clase}" data-reserva-id="${reserva.id}">${escaparHTML(reserva.huesped_nombre)}</div></td>`;
          }
          if (bloqueoIndefinido || (esHoy && bloqueoHoy)) {
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-habitacion-bloqueada ${h.estado}" title="Habitación en estado: ${h.estado}">${ETIQUETA_ESTADO_HABITACION[h.estado]}</div></td>`;
          }
          return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-reserva-vacia" data-habitacion-id="${h.id}" data-fecha="${iso}">+</div></td>`;
        })
        .join('');
      return `<tr><td class="celda-habitacion">${h.numero} — ${h.nombre}${h.estado !== 'disponible' ? ` ${badgeEstadoHabitacion(h.estado)}` : ''}</td>${celdas}</tr>`;
    })
    .join('');

  wrap.innerHTML = `
    <table class="tabla-calendario-reservas">
      <thead><tr><th>Habitación</th>${encabezados}</tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;

  wrap.querySelectorAll('.celda-reserva-ocupada').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = Number(el.dataset.reservaId);
      const { data: reserva, error } = await supabase.from('reservas').select('*').eq('id', id).single();
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      abrirModalReserva(container, reserva);
    });
  });

  wrap.querySelectorAll('.celda-reserva-vacia').forEach((el) => {
    el.addEventListener('click', () => {
      abrirModalReserva(container, null, {
        habitacion_id: Number(el.dataset.habitacionId),
        fecha_checkin: el.dataset.fecha,
      });
    });
  });
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// Número de noches entre dos fechas 'YYYY-MM-DD'. Ambas se interpretan en
// UTC (comportamiento estándar al pasarle a `new Date()` un string sin hora),
// así que la resta en milisegundos no se ve afectada por horario de verano.
// --- Autocompletar datos si el huésped ya estuvo hospedado antes ---
// Mismo patrón que en recepcion.js: primero se busca en recepcion_checkins
// (el registro más completo/reciente), y si no hay nada ahí, en la ficha
// básica de huespedes. Solo aplica al CREAR una reserva rápida — al
// editar una reserva existente ya se está viendo la info de esa reserva.
async function buscarHuespedPorDocumento(documento) {
  if (!documento) return null;

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .eq('numero_documento', documento)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase.from('huespedes').select('*').eq('numero_documento', documento).maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

async function buscarHuespedPorNombre(nombre) {
  if (!nombre || nombre.trim().length < 3) return null;
  const valor = nombre.trim();

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .ilike('nombre', valor)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase
    .from('huespedes')
    .select('*')
    .ilike('nombre', valor)
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

function calcularNoches(checkinISO, checkoutISO) {
  if (!checkinISO || !checkoutISO) return 0;
  const ms = new Date(checkoutISO) - new Date(checkinISO);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

async function abrirModalReserva(container, reserva, prellenado) {
  const editando = Boolean(reserva);
  const [{ data: habitaciones }, { data: tarifas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
  ]);

  const checkinDefault = editando ? reserva.fecha_checkin : prellenado?.fecha_checkin || toISODate(new Date());
  const checkoutDefault = editando ? reserva.fecha_checkout : toISODate(addDays(checkinDefault, 1));
  const habitacionDefault = editando ? reserva.habitacion_id : prellenado?.habitacion_id || '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>${editando ? `Reserva de ${escaparHTML(reserva.huesped_nombre)}` : 'Reserva rápida'}</h3>
      <form id="form-reserva" class="modal-contenido">
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" required>
              <option value="">—</option>
              ${(habitaciones || [])
                .map((h) => {
                  const bloqueada = ESTADOS_BLOQUEO_INDEFINIDO.includes(h.estado);
                  // El desplegable solo deshabilita habitaciones con
                  // bloqueo INDEFINIDO (mantenimiento/bloqueada/fuera de
                  // servicio). 'ocupada'/'limpieza'/'inspeccion' no
                  // deshabilitan aquí porque esta reserva puede ser para
                  // una fecha futura, cuando la habitación ya esté libre.
                  const deshabilitar = bloqueada && !editando;
                  return `<option value="${h.id}" ${Number(habitacionDefault) === h.id ? 'selected' : ''} ${deshabilitar ? 'disabled' : ''}>${h.numero} — ${h.nombre}${bloqueada ? ` (${ETIQUETA_ESTADO_HABITACION[h.estado]})` : ''}</option>`;
                })
                .join('')}
            </select>
          </label>
          <label>Nombre del huésped
            <input type="text" name="huesped_nombre" required value="${editando ? escaparHTML(reserva.huesped_nombre) : ''}" />
          </label>
          <label>Teléfono
            <input type="text" name="huesped_telefono" value="${editando ? escaparHTML(reserva.huesped_telefono || '') : ''}" />
          </label>
          <label>Documento
            <input type="text" name="huesped_documento" value="${editando ? escaparHTML(reserva.huesped_documento || '') : ''}" />
          </label>
          <label>Check-in
            <input type="date" name="fecha_checkin" required value="${checkinDefault}" />
          </label>
          <label>Check-out
            <input type="date" name="fecha_checkout" required value="${checkoutDefault}" />
          </label>
          <label>Estado
            <select name="estado">
              ${opcionesEstadoReserva()
                .map((o) => `<option value="${o.valor}" ${editando && reserva.estado === o.valor ? 'selected' : ''}>${o.label}</option>`)
                .join('')}
            </select>
          </label>
          <label>Tarifa
            <select name="tarifa_id">
              <option value="">—</option>
              ${(tarifas || [])
                .map((t) => `<option value="${t.id}" ${editando && reserva.tarifa_id === t.id ? 'selected' : ''}>${t.codigo} — ${formatCOP(t.precio_temporada_baja)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Monto total
            <input type="text" name="monto_total" id="input-monto-total-reserva" placeholder="$0" value="${editando && reserva.monto_total ? reserva.monto_total : ''}" />
          </label>
        </div>
        <p id="monto-auto-hint" class="mensaje-vacio" style="font-size:0.78rem; margin-top:0.3rem;">El monto total se calcula solo (noches × tarifa) al elegir tarifa y fechas. Si lo editas a mano, dejamos de tocarlo.</p>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Comentarios
          <textarea name="comentarios" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(reserva.comentarios || '') : ''}</textarea>
        </label>

        ${
          !editando
            ? `
          <div class="tarjeta" style="margin-top:1rem; background:var(--color-fondo-suave, #f8f9fb);">
            <h3 style="margin-top:0;">¿Hubo abono al crear la reserva?</h3>
            <div class="form-grid">
              <label>Tipo de pago
                <select name="tipo_pago_inicial" id="select-tipo-pago-inicial">
                  <option value="parcial">Abono parcial</option>
                  <option value="total">Pago total (deja saldada la reserva)</option>
                </select>
              </label>
              <label>${'Abono inicial (opcional)'}
                <input type="text" name="abono_inicial" id="input-abono-inicial" placeholder="$0" />
              </label>
              <label>Método de pago
                <select name="metodo_pago_abono">
                  <option value="">— Elige a qué cuenta va el abono —</option>
                  ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
                </select>
              </label>
            </div>
            <p class="mensaje-vacio" style="margin-top:0.3rem; font-size:0.78rem;">Déjalo en blanco o en 0 si la reserva queda sin abono por ahora — se puede agregar después reabriendo la reserva. Con "Pago total" el abono se llena solo con el Monto total de arriba.</p>
          </div>
        `
            : ''
        }

        ${editando ? '<div id="pagos-wrap" style="margin-top:1.25rem;"><p class="mensaje-vacio">Cargando abonos…</p></div>' : ''}

        <div class="modal-acciones" style="margin-top:1.25rem;">
          ${editando ? '<button type="button" class="btn btn-peligro" id="btn-eliminar-reserva" style="margin-right:auto;">Eliminar</button>' : ''}
          <button type="button" class="btn btn-secundario" id="btn-cancelar-reserva">Cerrar</button>
          <button type="submit" class="btn btn-primario">${editando ? 'Guardar cambios' : 'Crear reserva'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // --- Cálculo automático del monto total (noches × tarifa) ---
  const selectTarifa = overlay.querySelector('select[name="tarifa_id"]');
  const inputCheckin = overlay.querySelector('input[name="fecha_checkin"]');
  const inputCheckout = overlay.querySelector('input[name="fecha_checkout"]');
  const inputMonto = overlay.querySelector('#input-monto-total-reserva');

  // Campo de dinero con formato "$" y punto de miles en vivo.
  activarInputDinero(inputMonto);

  let montoEditadoManualmente = false;
  inputMonto.addEventListener('input', () => {
    montoEditadoManualmente = true;
  });

  function recalcularMontoAutomatico() {
    if (montoEditadoManualmente) return;
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifa.value));
    const noches = calcularNoches(inputCheckin.value, inputCheckout.value);
    if (!tarifa || noches <= 0) return;
    inputMonto.value = noches * Number(tarifa.precio_temporada_baja);
    activarInputDinero(inputMonto);
  }

  selectTarifa.addEventListener('change', recalcularMontoAutomatico);
  inputCheckin.addEventListener('change', recalcularMontoAutomatico);
  inputCheckout.addEventListener('change', recalcularMontoAutomatico);

  // Si al abrir el modal ya hay tarifa Y fechas (ej. reabriendo una reserva
  // existente sin monto guardado), calculamos una vez de entrada.
  if (!editando || !reserva.monto_total) {
    recalcularMontoAutomatico();
  }

  // --- ¿Hubo abono al crear la reserva? — abono parcial vs pago total ---
  if (!editando) {
    const inputAbono = overlay.querySelector('#input-abono-inicial');
    const selectTipoPagoInicial = overlay.querySelector('#select-tipo-pago-inicial');
    activarInputDinero(inputAbono);

    selectTipoPagoInicial.addEventListener('change', () => {
      if (selectTipoPagoInicial.value === 'total') {
        inputAbono.value = valorNumericoInput(inputMonto) || '';
        activarInputDinero(inputAbono);
      }
    });
  }

  // --- Autocompletar si el huésped ya estuvo hospedado antes (solo al
  // crear una reserva rápida) ---
  if (!editando) {
    const inputNombreHuesped = overlay.querySelector('input[name="huesped_nombre"]');
    const inputDocumentoHuesped = overlay.querySelector('input[name="huesped_documento"]');
    const inputTelefonoHuesped = overlay.querySelector('input[name="huesped_telefono"]');

    function precargarDatosHuesped(resultado) {
      if (!resultado) return;
      const d = resultado.datos;
      if (d.nombre) inputNombreHuesped.value = d.nombre;
      if (d.numero_documento) inputDocumentoHuesped.value = d.numero_documento;
      const telefono = d.celular || d.telefono;
      if (telefono) inputTelefonoHuesped.value = telefono;
      mostrarToast(`Encontramos a ${d.nombre} en el sistema — se autocompletaron sus datos.`, 'exito');
    }

    inputDocumentoHuesped.addEventListener('blur', async () => {
      const valor = inputDocumentoHuesped.value.trim();
      if (!valor) return;
      const resultado = await buscarHuespedPorDocumento(valor);
      precargarDatosHuesped(resultado);
    });

    inputNombreHuesped.addEventListener('blur', async () => {
      if (inputDocumentoHuesped.value.trim()) return;
      const valor = inputNombreHuesped.value.trim();
      if (!valor) return;
      const resultado = await buscarHuespedPorNombre(valor);
      precargarDatosHuesped(resultado);
    });
  }

  overlay.querySelector('#btn-cancelar-reserva').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  if (editando) {
    cargarPagos(overlay, reserva.id);
    overlay.querySelector('#btn-eliminar-reserva').addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Eliminar reserva',
        contenidoHTML: `¿Eliminar la reserva de <strong>${escaparHTML(reserva.huesped_nombre)}</strong>? Esta acción no se puede deshacer.`,
        textoConfirmar: 'Eliminar',
      });
      if (!ok) return;
      const { error } = await supabase.from('reservas').delete().eq('id', reserva.id);
      if (error) {
        // Código 23503 = choque de llave foránea: esta reserva ya tiene
        // abonos (reservas_pagos) y/o un check-in (recepcion_checkins)
        // vinculados. La base de datos protege ese historial a propósito
        // (no se puede borrar la reserva y dejar esos registros
        // huérfanos). En ese caso, lo correcto es cambiar el campo Estado
        // arriba a "Cancelada" en vez de eliminar.
        if (error.code === '23503') {
          mostrarToast(
            'No se puede eliminar: esta reserva ya tiene abonos y/o un check-in registrado. Usa el campo "Estado" y cámbiala a "Cancelada" en vez de eliminarla.',
            'error'
          );
        } else {
          mostrarToast(`Error eliminando: ${error.message}`, 'error');
        }
        return;
      }
      mostrarToast('Reserva eliminada.', 'exito');
      overlay.remove();
      await cargarCalendario(container);
    });
  }

  overlay.querySelector('#form-reserva').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      habitacion_id: Number(form.get('habitacion_id')),
      huesped_nombre: form.get('huesped_nombre').trim(),
      huesped_telefono: form.get('huesped_telefono').trim() || null,
      huesped_documento: form.get('huesped_documento').trim() || null,
      fecha_checkin: form.get('fecha_checkin'),
      fecha_checkout: form.get('fecha_checkout'),
      estado: form.get('estado'),
      tarifa_id: form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null,
      monto_total: valorNumericoInput(inputMonto) || null,
      comentarios: form.get('comentarios').trim() || null,
    };

    if (payload.fecha_checkout <= payload.fecha_checkin) {
      mostrarToast('La fecha de check-out debe ser posterior al check-in.', 'error');
      return;
    }

    // Si va a haber abono inicial, se valida el método de pago ANTES de
    // crear nada — así nunca queda una reserva ya guardada con el abono
    // bloqueado por falta de método (mismo candado que ya tiene el pago
    // de liquidación al check-out en recepcion.js). Solo aplica al crear
    // (!editando), que es cuando existe este bloque de abono inicial.
    if (!editando) {
      const tipoPagoInicialValidar = form.get('tipo_pago_inicial');
      const abonoInicialValidar =
        tipoPagoInicialValidar === 'total' ? valorNumericoInput(inputMonto) || 0 : valorNumericoInput(overlay.querySelector('#input-abono-inicial'));
      if (abonoInicialValidar > 0 && !form.get('metodo_pago_abono')) {
        mostrarToast('Elige a qué cuenta va el abono inicial antes de crear la reserva.', 'error');
        return;
      }
    }

    // --- Verificación de disponibilidad: el estado de la habitación
    // (ocupada/limpieza/etc) por sí solo no alcanza para detectar un
    // cruce, porque una reserva puede ser para cualquier rango de fechas
    // futuras. Lo que realmente importa es si OTRA reserva activa de esa
    // MISMA habitación se cruza con las fechas elegidas — incluye el caso
    // de "Reserva rápida" para hoy sobre una habitación ya ocupada, que
    // siempre tiene una reserva 'hospedado' cubriendo el día de hoy. ---
    let consultaCruce = supabase
      .from('reservas')
      .select('id, huesped_nombre, fecha_checkin, fecha_checkout')
      .eq('habitacion_id', payload.habitacion_id)
      .in('estado', ESTADOS_RESERVA_ACTIVOS)
      .lt('fecha_checkin', payload.fecha_checkout)
      .gt('fecha_checkout', payload.fecha_checkin);

    if (editando) {
      consultaCruce = consultaCruce.neq('id', reserva.id);
    }

    const { data: cruces, error: errCruce } = await consultaCruce;
    if (errCruce) {
      mostrarToast(`No se pudo verificar disponibilidad: ${errCruce.message}`, 'error');
      return;
    }
    if (cruces && cruces.length > 0) {
      const conflicto = cruces[0];
      mostrarToast(
        `Esa habitación ya tiene una reserva de ${conflicto.huesped_nombre} del ${conflicto.fecha_checkin} al ${conflicto.fecha_checkout}. Elige otra habitación o cambia las fechas.`,
        'error'
      );
      return;
    }

    const query = editando
      ? supabase.from('reservas').update(payload).eq('id', reserva.id).select('id').single()
      : supabase.from('reservas').insert(payload).select('id').single();

    const { data: reservaGuardada, error } = await query;
    if (error) {
      mostrarToast(`Error guardando: ${error.message}`, 'error');
      return;
    }

    // --- Abono inicial (solo aplica al crear, ver el bloque "¿Hubo abono
    // al crear la reserva?" arriba) — se registra en reservas_pagos, la
    // misma tabla que ya lee Caja/Indicadores automático, igual que el
    // pago al check-in. Si el tipo de pago es "total", se fuerza el
    // abono a ser exactamente el monto total (sin importar lo que haya
    // quedado escrito en el campo), para que la reserva quede saldada de
    // verdad y no por lo que alguien haya alcanzado a escribir a mano. ---
    if (!editando) {
      const inputAbono = overlay.querySelector('#input-abono-inicial');
      const tipoPagoInicial = form.get('tipo_pago_inicial');
      const abonoInicial = tipoPagoInicial === 'total' ? payload.monto_total || 0 : valorNumericoInput(inputAbono);
      if (abonoInicial > 0) {
        const { error: errAbono } = await supabase.from('reservas_pagos').insert({
          reserva_id: reservaGuardada.id,
          monto: abonoInicial,
          metodo_pago: form.get('metodo_pago_abono'),
          comentarios: tipoPagoInicial === 'total' ? 'Pago total registrado al crear la reserva.' : 'Abono registrado al crear la reserva.',
        });
        if (errAbono) {
          mostrarToast(`Reserva creada, pero no se pudo registrar el abono: ${errAbono.message}`, 'error');
        }
      }
    }

    // --- Ficha de huésped (histórico) ---
    // Si la reserva trae número de documento, también alimenta `huespedes`
    // (contacto, no preferencias/alergias/observaciones) para que el
    // módulo Huéspedes muestre a quienes tienen reserva, no solo a quienes
    // ya hicieron check-in. Ver el mismo patrón en recepcion.js.
    if (payload.huesped_documento) {
      const { error: errHuesped } = await supabase.from('huespedes').upsert(
        {
          numero_documento: payload.huesped_documento,
          nombre: payload.huesped_nombre,
          telefono: payload.huesped_telefono,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: 'numero_documento' }
      );
      if (errHuesped) {
        mostrarToast(`Reserva guardada, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
      }
    }

    mostrarToast(editando ? 'Reserva actualizada.' : 'Reserva creada.', 'exito');
    overlay.remove();
    await cargarCalendario(container);
  });
}

async function cargarPagos(overlay, reservaId) {
  const wrap = overlay.querySelector('#pagos-wrap');
  const { data: pagos, error } = await supabase
    .from('reservas_pagos')
    .select('*')
    .eq('reserva_id', reservaId)
    .order('fecha', { ascending: false });

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando abonos: ${error.message}</p>`;
    return;
  }

  const totalAbonado = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);

  wrap.innerHTML = `
    <h3>Abonos / Pagos — Total abonado: ${formatCOP(totalAbonado)}</h3>
    <table class="tabla-simple tabla-pagos-reserva">
      <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
      <tbody>
        ${(pagos || [])
          .map((p) => `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${p.metodo_pago || '—'}</td><td>${p.comentarios || '—'}</td></tr>`)
          .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin abonos registrados.</td></tr>'}
      </tbody>
    </table>
    <form id="form-nuevo-pago" class="form-grid" style="margin-top:0.75rem;">
      <label>Monto
        <input type="text" name="monto" id="input-monto-nuevo-pago" placeholder="$0" required />
      </label>
      <label>Método de pago
        <select name="metodo_pago" required>
          <option value="">— Elige a qué cuenta va —</option>
          ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
        </select>
      </label>
      <label>Comentario
        <input type="text" name="comentarios" placeholder="Opcional" />
      </label>
      <button type="submit" class="btn btn-secundario btn-chico">+ Agregar abono</button>
    </form>
  `;

  activarInputDinero(wrap.querySelector('#input-monto-nuevo-pago'));

  wrap.querySelector('#form-nuevo-pago').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const montoNuevoPago = valorNumericoInput(wrap.querySelector('#input-monto-nuevo-pago'));
    const { error: errInsert } = await supabase.from('reservas_pagos').insert({
      reserva_id: reservaId,
      monto: montoNuevoPago,
      metodo_pago: form.get('metodo_pago'),
      comentarios: form.get('comentarios').trim() || null,
    });
    if (errInsert) {
      mostrarToast(`Error: ${errInsert.message}`, 'error');
      return;
    }
    mostrarToast('Abono registrado.', 'exito');
    await cargarPagos(overlay, reservaId);
  });
}

registerModule({
  id: 'reservas',
  label: 'Reservas',
  icono: '📅',
  roles: ['propietario', 'administrador', 'recepcionista', 'auditor'],
  render,
});
