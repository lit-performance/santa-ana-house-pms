// recepcion.js
//
// Módulo 4: Recepción. Vista principal: huéspedes actualmente hospedados,
// con acción de Check-out. "+ Nuevo Check-in" abre un formulario completo
// (reemplaza el contenido del contenedor, no un modal — son demasiados
// campos para un modal chico) con todos los datos que pide el Módulo 4,
// firma digital (canvas) y consentimiento Habeas Data.
//
// Nota de alcance: "Fotografía del documento" queda como un campo de URL
// (para pegar un link si ya la subieron a otro lado) — la carga de
// archivos requiere configurar Supabase Storage, pendiente para una
// ronda futura.
//
// Nota importante: TODO check-in (venga de una reserva o sea walk-in)
// queda vinculado a una fila en `reservas` con estado 'hospedado', y
// además guarda/actualiza la ficha del huésped en `huespedes` (por
// numero_documento). Esto es lo que hace que el calendario de Reservas,
// las tarjetas de Inicio y el módulo Huéspedes reflejen la ocupación e
// historial real sin importar por dónde entró el huésped.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatFechaHora, toISODate, addDays } from './dates.js';

const TIPOS_DOCUMENTO = ['Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'Tarjeta de identidad', 'PEP', 'Otro'];
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];

async function render(container) {
  await vistaLista(container);
}

async function vistaLista(container) {
  container.innerHTML = `
    <h2>Recepción</h2>
    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-bottom:1rem;">
      <button id="btn-nuevo-checkin" class="btn btn-primario">+ Nuevo Check-in</button>
    </div>
    <div id="checkins-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nuevo-checkin').addEventListener('click', () => vistaFormulario(container));

  await cargarCheckinsActivos(container);
}

async function cargarCheckinsActivos(container) {
  const wrap = container.querySelector('#checkins-wrap');
  const { data: checkins, error } = await supabase
    .from('recepcion_checkins')
    .select('*, habitaciones(numero, nombre)')
    .is('check_out_en', null)
    .order('hora_ingreso', { ascending: false });

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando huéspedes: ${error.message}</p>`;
    return;
  }

  if (!checkins || checkins.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">No hay huéspedes hospedados actualmente.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Habitación</th>
          <th>Huésped</th>
          <th>Documento</th>
          <th>Hora ingreso</th>
          <th>Noches</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${checkins
          .map(
            (c) => `
          <tr data-id="${c.id}">
            <td>${c.habitaciones ? `${c.habitaciones.numero} — ${c.habitaciones.nombre}` : '—'}</td>
            <td>${escaparHTML(c.nombre)}</td>
            <td>${c.tipo_documento || '—'} ${c.numero_documento || ''}</td>
            <td>${formatFechaHora(c.hora_ingreso)}</td>
            <td>${c.cantidad_noches ?? '—'}</td>
            <td><button type="button" class="btn-editar btn-checkout" data-id="${c.id}" data-habitacion="${c.habitacion_id}" data-reserva="${c.reserva_id ?? ''}">Check-out</button></td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-checkout').forEach((btn) => {
    btn.addEventListener('click', () => hacerCheckout(container, btn.dataset));
  });
}

async function hacerCheckout(container, dataset) {
  const id = Number(dataset.id);
  const habitacionId = Number(dataset.habitacion);
  const reservaId = dataset.reserva ? Number(dataset.reserva) : null;

  const { error: errCheckin } = await supabase
    .from('recepcion_checkins')
    .update({ check_out_en: new Date().toISOString() })
    .eq('id', id);

  if (errCheckin) {
    mostrarToast(`Error en check-out: ${errCheckin.message}`, 'error');
    return;
  }

  const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
    p_habitacion_id: habitacionId,
    p_estado: 'limpieza',
  });
  if (errEstado) {
    mostrarToast(`Check-out guardado, pero no se pudo actualizar el estado de la habitación: ${errEstado.message}`, 'error');
  }

  if (reservaId) {
    await supabase.from('reservas').update({ estado: 'check_out' }).eq('id', reservaId);
  }

  mostrarToast('Check-out registrado. La habitación quedó en limpieza.', 'exito');
  await cargarCheckinsActivos(container);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function vistaFormulario(container) {
  const [{ data: habitaciones }, { data: tarifas }, { data: reservas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
    supabase
      .from('reservas')
      .select('id, habitacion_id, huesped_nombre, huesped_telefono, huesped_documento, fecha_checkin, fecha_checkout, tarifa_id, estado')
      .in('estado', ['reservada', 'confirmada'])
      .order('fecha_checkin'),
  ]);

  container.innerHTML = `
    <h2>Nuevo Check-in</h2>
    <form id="form-checkin">
      <div class="tarjeta">
        <h3>Vincular a una reserva (opcional)</h3>
        <div class="form-grid">
          <label>Reserva
            <select id="select-reserva">
              <option value="">— Walk-in / sin reserva —</option>
              ${(reservas || [])
                .map((r) => `<option value="${r.id}">${escaparHTML(r.huesped_nombre)} — ${r.fecha_checkin} a ${r.fecha_checkout}</option>`)
                .join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="tarjeta">
        <h3>Datos del huésped</h3>
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
          <label>Nacionalidad
            <input type="text" name="nacionalidad" />
          </label>
          <label>Fecha de nacimiento
            <input type="date" name="fecha_nacimiento" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" />
          </label>
          <label>Departamento
            <input type="text" name="departamento" />
          </label>
          <label>País
            <input type="text" name="pais" value="Colombia" />
          </label>
          <label>Correo
            <input type="email" name="correo" />
          </label>
          <label>Celular
            <input type="text" name="celular" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" />
          </label>
          <label>Placa del vehículo
            <input type="text" name="placa_vehiculo" />
          </label>
          <label>Foto del documento (URL, opcional)
            <input type="url" name="foto_documento_url" placeholder="https://..." />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Acompañantes (nombres, uno por línea)
          <textarea name="acompanantes" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
      </div>

      <div class="tarjeta">
        <h3>Estadía</h3>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" id="select-habitacion" required>
              <option value="">—</option>
              ${(habitaciones || []).map((h) => `<option value="${h.id}">${h.numero} — ${h.nombre}</option>`).join('')}
            </select>
          </label>
          <label>Tarifa
            <select name="tarifa_id" id="select-tarifa">
              <option value="">—</option>
              ${(tarifas || []).map((t) => `<option value="${t.id}">${t.codigo}</option>`).join('')}
            </select>
          </label>
          <label>Cantidad de noches
            <input type="number" name="cantidad_noches" id="input-noches" min="1" value="1" />
          </label>
          <label>Método de pago
            <select name="metodo_pago">
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Depósito
            <input type="number" name="deposito" step="1000" />
          </label>
        </div>
      </div>

      <div class="tarjeta">
        <h3>Firma digital</h3>
        <canvas id="canvas-firma" width="500" height="150" style="border:1px solid var(--color-borde); border-radius:6px; width:100%; max-width:500px; touch-action:none; cursor:crosshair;"></canvas>
        <div class="acciones-tarjeta">
          <button type="button" id="btn-limpiar-firma" class="btn btn-secundario btn-chico">Limpiar firma</button>
        </div>
        <label style="display:flex; align-items:center; gap:0.5rem; margin-top:0.75rem; font-size:0.9rem;">
          <input type="checkbox" name="consentimiento_habeas_data" id="check-habeas" required style="width:auto;" />
          El huésped autoriza el tratamiento de sus datos personales conforme a la Ley 1581 de 2012 (Habeas Data).
        </label>
      </div>

      <div class="modal-acciones" style="margin-top:1rem;">
        <button type="button" id="btn-cancelar-checkin" class="btn btn-secundario">Cancelar</button>
        <button type="submit" class="btn btn-primario">Registrar Check-in</button>
      </div>
    </form>
  `;

  // --- Firma digital (canvas) ---
  const canvas = container.querySelector('#canvas-firma');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';
  let dibujando = false;

  function posicionRelativa(evento) {
    const rect = canvas.getBoundingClientRect();
    const punto = evento.touches ? evento.touches[0] : evento;
    return {
      x: ((punto.clientX - rect.left) / rect.width) * canvas.width,
      y: ((punto.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function empezarTrazo(e) {
    dibujando = true;
    const p = posicionRelativa(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  }
  function trazar(e) {
    if (!dibujando) return;
    const p = posicionRelativa(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  }
  function terminarTrazo() {
    dibujando = false;
  }

  canvas.addEventListener('mousedown', empezarTrazo);
  canvas.addEventListener('mousemove', trazar);
  window.addEventListener('mouseup', terminarTrazo);
  canvas.addEventListener('touchstart', empezarTrazo);
  canvas.addEventListener('touchmove', trazar);
  canvas.addEventListener('touchend', terminarTrazo);

  container.querySelector('#btn-limpiar-firma').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // --- Vincular reserva: precarga campos ---
  container.querySelector('#select-reserva').addEventListener('change', (e) => {
    const reservaId = e.target.value;
    if (!reservaId) return;
    const reserva = (reservas || []).find((r) => String(r.id) === reservaId);
    if (!reserva) return;

    container.querySelector('input[name="nombre"]').value = reserva.huesped_nombre || '';
    container.querySelector('input[name="numero_documento"]').value = reserva.huesped_documento || '';
    container.querySelector('input[name="celular"]').value = reserva.huesped_telefono || '';
    container.querySelector('#select-habitacion').value = reserva.habitacion_id;
    if (reserva.tarifa_id) container.querySelector('#select-tarifa').value = reserva.tarifa_id;

    const noches = Math.round((new Date(reserva.fecha_checkout) - new Date(reserva.fecha_checkin)) / 86400000);
    container.querySelector('#input-noches').value = noches > 0 ? noches : '';
  });

  container.querySelector('#btn-cancelar-checkin').addEventListener('click', () => vistaLista(container));

  container.querySelector('#form-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!container.querySelector('#check-habeas').checked) {
      mostrarToast('Debes marcar el consentimiento de Habeas Data para continuar.', 'error');
      return;
    }

    const form = new FormData(e.target);
    const reservaIdSeleccionada = container.querySelector('#select-reserva').value || null;
    const hayFirma = ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v !== 0);

    const habitacionId = Number(form.get('habitacion_id'));
    const tarifaId = form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null;
    const cantidadNoches = form.get('cantidad_noches') ? Number(form.get('cantidad_noches')) : 1;
    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;

    // --- Vincular o crear la reserva asociada ---
    let reservaIdFinal = null;

    if (reservaIdSeleccionada) {
      reservaIdFinal = Number(reservaIdSeleccionada);
      const { error: errReservaUpd } = await supabase
        .from('reservas')
        .update({ estado: 'hospedado' })
        .eq('id', reservaIdFinal);
      if (errReservaUpd) {
        mostrarToast(`No se pudo actualizar la reserva vinculada: ${errReservaUpd.message}`, 'error');
      }
    } else {
      const hoyISO = toISODate(new Date());
      const { data: nuevaReserva, error: errReservaNueva } = await supabase
        .from('reservas')
        .insert({
          habitacion_id: habitacionId,
          huesped_nombre: nombre,
          huesped_telefono: celular,
          huesped_documento: documento,
          fecha_checkin: hoyISO,
          fecha_checkout: toISODate(addDays(hoyISO, cantidadNoches > 0 ? cantidadNoches : 1)),
          estado: 'hospedado',
          tarifa_id: tarifaId,
          comentarios: 'Creada automáticamente desde Recepción (walk-in).',
        })
        .select('id')
        .single();

      if (errReservaNueva) {
        mostrarToast(`Check-in continuará, pero no se pudo crear la reserva asociada: ${errReservaNueva.message}`, 'error');
      } else {
        reservaIdFinal = nuevaReserva.id;
      }
    }

    // --- Ficha de huésped (histórico) ---
    // Guarda o actualiza los datos de contacto en `huespedes` (por
    // numero_documento) sin pisar preferencias/alergias/observaciones si
    // ya existían — eso se edita solo desde el módulo Huéspedes.
    const { error: errHuesped } = await supabase.from('huespedes').upsert(
      {
        numero_documento: documento,
        tipo_documento: form.get('tipo_documento'),
        nombre,
        telefono: celular,
        correo: form.get('correo').trim() || null,
        empresa: form.get('empresa').trim() || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (errHuesped) {
      mostrarToast(`Check-in guardado, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
    }

    const payload = {
      reserva_id: reservaIdFinal,
      habitacion_id: habitacionId,
      nombre,
      tipo_documento: form.get('tipo_documento'),
      numero_documento: documento,
      nacionalidad: form.get('nacionalidad').trim() || null,
      fecha_nacimiento: form.get('fecha_nacimiento') || null,
      direccion: form.get('direccion').trim() || null,
      ciudad: form.get('ciudad').trim() || null,
      departamento: form.get('departamento').trim() || null,
      pais: form.get('pais').trim() || null,
      correo: form.get('correo').trim() || null,
      celular,
      empresa: form.get('empresa').trim() || null,
      placa_vehiculo: form.get('placa_vehiculo').trim() || null,
      acompanantes: form.get('acompanantes').trim() || null,
      foto_documento_url: form.get('foto_documento_url').trim() || null,
      firma_digital: hayFirma ? canvas.toDataURL('image/png') : null,
      consentimiento_habeas_data: true,
      observaciones: form.get('observaciones').trim() || null,
      tarifa_id: tarifaId,
      cantidad_noches: cantidadNoches,
      metodo_pago: form.get('metodo_pago'),
      deposito: form.get('deposito') ? Number(form.get('deposito')) : null,
    };

    const { error: errInsert } = await supabase.from('recepcion_checkins').insert(payload);
    if (errInsert) {
      mostrarToast(`Error registrando check-in: ${errInsert.message}`, 'error');
      return;
    }

    const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
      p_habitacion_id: habitacionId,
      p_estado: 'ocupada',
    });
    if (errEstado) {
      mostrarToast(`Check-in guardado, pero no se pudo marcar la habitación como ocupada: ${errEstado.message}`, 'error');
    }

    mostrarToast('Check-in registrado.', 'exito');
    await vistaLista(container);
  });
}

registerModule({
  id: 'recepcion',
  label: 'Recepción',
  icono: '🛎',
  roles: ['propietario', 'administrador', 'recepcionista'],
  render,
});
