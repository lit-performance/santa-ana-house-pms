// housekeeping.js
//
// Módulo 6: Housekeeping. Lista de todas las habitaciones con su estado
// actual y un botón para registrar un cambio (limpieza terminada, pasa a
// inspección, mantenimiento, etc.), más un historial de los últimos
// cambios hechos por el equipo.
//
// El cambio de estado real sigue pasando por la misma función
// cambiar_estado_habitacion() que ya usan Recepción y Reservas — este
// módulo además deja un registro en housekeeping_tareas (quién, cuándo,
// de qué estado a cuál, observaciones y foto opcional).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatFechaHora } from './dates.js';
import { badgeEstadoHabitacion, opcionesEstadoHabitacion } from './badges.js';
import { getUsuarioActual } from './auth.js';

async function render(container) {
  container.innerHTML = `
    <h2>Housekeeping</h2>
    <div id="habitaciones-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div class="tarjeta" style="margin-top:1.5rem;">
      <h3>Historial reciente</h3>
      <div id="historial-wrap"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;

  await cargarHabitaciones(container);
  await cargarHistorial(container);
}

async function cargarHabitaciones(container) {
  const wrap = container.querySelector('#habitaciones-wrap');
  const { data: habitaciones, error } = await supabase
    .from('habitaciones')
    .select('id, numero, nombre, estado')
    .order('numero');

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones: ${error.message}</p>`;
    return;
  }

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Habitación</th>
          <th>Estado actual</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${(habitaciones || [])
          .map(
            (h) => `
          <tr data-id="${h.id}">
            <td>${h.numero} — ${escaparHTML(h.nombre)}</td>
            <td>${badgeEstadoHabitacion(h.estado)}</td>
            <td><button type="button" class="btn-editar btn-cambiar-estado" data-id="${h.id}" data-numero="${escaparHTML(h.numero)}" data-nombre="${escaparHTML(h.nombre)}" data-estado="${h.estado}">Cambiar estado</button></td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-cambiar-estado').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalCambioEstado(container, btn.dataset));
  });
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function abrirModalCambioEstado(container, dataset) {
  const { id, numero, nombre, estado } = dataset;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>${numero} — ${nombre}</h3>
      <form id="form-cambio-estado" class="modal-contenido">
        <div class="form-grid">
          <label>Nuevo estado
            <select name="estado_nuevo" required>
              ${opcionesEstadoHabitacion()
                .map((o) => `<option value="${o.valor}" ${o.valor === estado ? 'selected' : ''}>${o.label}</option>`)
                .join('')}
            </select>
          </label>
          <label>Foto (URL, opcional)
            <input type="url" name="foto_url" placeholder="https://..." />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-cambio">Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-cambio').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-cambio-estado').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const estadoNuevo = form.get('estado_nuevo');
    const usuario = getUsuarioActual();
    const ahora = new Date().toISOString();

    const { error: errTarea } = await supabase.from('housekeeping_tareas').insert({
      habitacion_id: Number(id),
      estado_anterior: estado,
      estado_nuevo: estadoNuevo,
      realizado_por: usuario?.id || null,
      hora_inicio: ahora,
      hora_fin: ahora,
      observaciones: form.get('observaciones').trim() || null,
      foto_url: form.get('foto_url').trim() || null,
    });
    if (errTarea) {
      mostrarToast(`Error guardando la tarea: ${errTarea.message}`, 'error');
      return;
    }

    const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
      p_habitacion_id: Number(id),
      p_estado: estadoNuevo,
    });
    if (errEstado) {
      mostrarToast(`Tarea guardada, pero no se pudo actualizar el estado de la habitación: ${errEstado.message}`, 'error');
    } else {
      mostrarToast('Estado actualizado.', 'exito');
    }

    overlay.remove();
    await cargarHabitaciones(container);
    await cargarHistorial(container);
  });
}

async function cargarHistorial(container) {
  const wrap = container.querySelector('#historial-wrap');
  const { data: tareas, error } = await supabase
    .from('housekeeping_tareas')
    .select('*, habitaciones(numero, nombre), usuarios(nombre)')
    .order('creado_en', { ascending: false })
    .limit(20);

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando historial: ${error.message}</p>`;
    return;
  }

  if (!tareas || tareas.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">Sin cambios registrados todavía.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Habitación</th>
          <th>Cambio</th>
          <th>Hecho por</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
        ${tareas
          .map(
            (t) => `
          <tr>
            <td>${formatFechaHora(t.creado_en)}</td>
            <td>${t.habitaciones ? `${t.habitaciones.numero} — ${t.habitaciones.nombre}` : '—'}</td>
            <td>${badgeEstadoHabitacion(t.estado_anterior)} → ${badgeEstadoHabitacion(t.estado_nuevo)}</td>
            <td>${t.usuarios ? escaparHTML(t.usuarios.nombre) : '—'}</td>
            <td>${t.observaciones ? escaparHTML(t.observaciones) : '—'}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

registerModule({
  id: 'housekeeping',
  label: 'Housekeeping',
  icono: '🧹',
  roles: ['propietario', 'administrador', 'housekeeping'],
  render,
});
