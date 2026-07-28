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

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { badgeEstadoReserva, opcionesEstadoReserva, badgeEstadoHabitacion } from './badges.js';
import { toISODate, addDays, formatFechaHora } from './dates.js';

const DIAS_VISIBLES = 14;
let rangoInicio = new Date();
rangoInicio.setHours(0, 0, 0, 0);

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
            <input type="number" name="monto_total" step="1000" value="${editando ? reserva.monto_total ?? '' : ''}" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Comentarios
          <textarea name="comentarios" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(reserva.comentarios || '') : ''}</textarea>
        </label>

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
        mostrarToast(`Error eliminando: ${error.message}`, 'error');
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
      monto_total: form.get('monto_total') ? Number(form.get('monto_total')) : null,
      comentarios: form.get('comentarios').trim() || null,
    };

    if (payload.fecha_checkout <= payload.fecha_checkin) {
      mostrarToast('La fecha de check-out debe ser posterior al check-in.', 'error');
      return;
    }

    const query = editando
      ? supabase.from('reservas').update(payload).eq('id', reserva.id)
      : supabase.from('reservas').insert(payload);

    const { error } = await query;
    if (error) {
      mostrarToast(`Error guardando: ${error.message}`, 'error');
      return;
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
        <input type="number" name="monto" step="1000" required />
      </label>
      <label>Método de pago
        <select name="metodo_pago">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Tarjeta">Tarjeta</option>
          <option value="Otro">Otro</option>
        </select>
      </label>
      <label>Comentario
        <input type="text" name="comentarios" placeholder="Opcional" />
      </label>
      <button type="submit" class="btn btn-secundario btn-chico">+ Agregar abono</button>
    </form>
  `;

  wrap.querySelector('#form-nuevo-pago').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const { error: errInsert } = await supabase.from('reservas_pagos').insert({
      reserva_id: reservaId,
      monto: Number(form.get('monto')),
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
