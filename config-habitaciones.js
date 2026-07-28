// config-habitaciones.js
//
// Vista principal de Configuración: listado de habitaciones del hotel, con
// alta/edición desde un modal. Las subpestañas "Tipos de habitación" y
// "Tarifas" viven en config-tipos.js y config-tarifas.js (prefijo "config-"
// para que, al quedar todos los archivos sueltos en la raíz del repo, sea
// obvio qué módulo agrupa a cuáles).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatCOP } from './currency.js';
import { badgeEstadoHabitacion, opcionesEstadoHabitacion } from './badges.js';

async function render(container) {
  container.innerHTML = `
    <h2>Habitaciones</h2>
    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-bottom:1rem;">
      <button id="btn-nueva-habitacion" class="btn btn-primario">+ Nueva habitación</button>
    </div>
    <div id="tabla-habitaciones-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nueva-habitacion').addEventListener('click', () => abrirModalHabitacion(null));

  await cargarTabla(container);
}

async function cargarTabla(container) {
  const wrap = container.querySelector('#tabla-habitaciones-wrap');

  const [{ data: habitaciones, error }, { data: tipos }, { data: tarifas }] = await Promise.all([
    supabase.from('habitaciones').select('*').order('numero'),
    supabase.from('tipos_habitacion').select('*'),
    supabase.from('tarifas').select('*'),
  ]);

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones: ${error.message}</p>`;
    return;
  }

  if (!habitaciones || habitaciones.length === 0) {
    wrap.innerHTML = `<p class="mensaje-vacio">No hay habitaciones registradas todavía.</p>`;
    return;
  }

  const tipoPorId = Object.fromEntries((tipos || []).map((t) => [t.id, t.nombre]));
  const tarifaPorId = Object.fromEntries((tarifas || []).map((t) => [t.id, t]));

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Número</th>
          <th>Nombre</th>
          <th>Tipo</th>
          <th>Piso</th>
          <th>Capacidad</th>
          <th>Tarifa</th>
          <th>Precio base</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${habitaciones
          .map((h) => {
            const tarifa = tarifaPorId[h.tarifa_id];
            return `
              <tr data-id="${h.id}">
                <td>${h.numero}</td>
                <td>${h.nombre}</td>
                <td>${tipoPorId[h.tipo_id] || '—'}</td>
                <td>${h.piso ?? '—'}</td>
                <td>${h.capacidad}</td>
                <td>${tarifa ? tarifa.codigo : '—'}</td>
                <td>${tarifa ? formatCOP(tarifa.precio_temporada_baja) : '—'}</td>
                <td>${badgeEstadoHabitacion(h.estado)}</td>
                <td><button type="button" class="btn-editar btn-editar-habitacion">Editar</button></td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-editar-habitacion').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = Number(e.target.closest('tr').dataset.id);
      const habitacion = habitaciones.find((h) => h.id === id);
      abrirModalHabitacion(habitacion);
    });
  });
}

async function abrirModalHabitacion(habitacion) {
  const editando = Boolean(habitacion);
  const { data: tipos } = await supabase.from('tipos_habitacion').select('*').order('nombre');
  const { data: tarifas } = await supabase.from('tarifas').select('*').order('codigo');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>${editando ? `Editar habitación ${habitacion.numero}` : 'Nueva habitación'}</h3>
      <form id="form-habitacion" class="modal-contenido">
        <div class="form-grid">
          <label>Número
            <input type="text" name="numero" required value="${editando ? habitacion.numero : ''}" ${editando ? 'readonly' : ''} />
          </label>
          <label>Nombre
            <input type="text" name="nombre" required value="${editando ? habitacion.nombre : ''}" />
          </label>
          <label>Piso
            <input type="number" name="piso" value="${editando ? habitacion.piso ?? '' : ''}" />
          </label>
          <label>Capacidad
            <input type="number" name="capacidad" min="1" required value="${editando ? habitacion.capacidad : 2}" />
          </label>
          <label>Tipo
            <select name="tipo_id">
              <option value="">—</option>
              ${(tipos || [])
                .map((t) => `<option value="${t.id}" ${editando && habitacion.tipo_id === t.id ? 'selected' : ''}>${t.nombre}</option>`)
                .join('')}
            </select>
          </label>
          <label>Tarifa
            <select name="tarifa_id">
              <option value="">—</option>
              ${(tarifas || [])
                .map((t) => `<option value="${t.id}" ${editando && habitacion.tarifa_id === t.id ? 'selected' : ''}>${t.codigo} — ${formatCOP(t.precio_temporada_baja)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Estado
            <select name="estado">
              ${opcionesEstadoHabitacion()
                .map((o) => `<option value="${o.valor}" ${editando && habitacion.estado === o.valor ? 'selected' : ''}>${o.label}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-habitacion">Cancelar</button>
          <button type="submit" class="btn btn-primario">${editando ? 'Guardar cambios' : 'Crear habitación'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-habitacion').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-habitacion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      numero: form.get('numero').trim(),
      nombre: form.get('nombre').trim(),
      piso: form.get('piso') ? Number(form.get('piso')) : null,
      capacidad: Number(form.get('capacidad')),
      tipo_id: form.get('tipo_id') ? Number(form.get('tipo_id')) : null,
      tarifa_id: form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null,
      estado: form.get('estado'),
    };

    const query = editando
      ? supabase.from('habitaciones').update(payload).eq('id', habitacion.id)
      : supabase.from('habitaciones').insert(payload);

    const { error } = await query;
    if (error) {
      mostrarToast(`Error guardando: ${error.message}`, 'error');
      return;
    }
    mostrarToast(editando ? 'Habitación actualizada.' : 'Habitación creada.', 'exito');
    overlay.remove();
    const container = document.getElementById('main-content');
    await cargarTabla(container);
  });
}

registerModule({
  id: 'configuracion',
  label: 'Configuración',
  icono: '⚙',
  roles: ['propietario', 'administrador'],
  render,
});
