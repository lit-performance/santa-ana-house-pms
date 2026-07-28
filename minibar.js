// minibar.js
//
// Módulo: Minibar. Catálogo de productos (nombre, categoría, precio,
// cantidad estándar por habitación, ubicación en la repisa/nevera — para
// que housekeeping sepa qué reponer) y registro de consumo por habitación
// actualmente en uso.
//
// El consumo registrado NO modifica reservas.monto_total — se suma aparte
// en cuentas.js (montoMinibar) para que la tarifa de la habitación y los
// extras de minibar queden separados pero se cobren juntos al liquidar en
// Recepción al hacer check-out. Una vez liquidado (ver recepcion.js), ese
// pago cae en reservas_pagos igual que cualquier abono, así que también
// aparece automático en Caja e Indicadores.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { calcularHabitacionesEnUso } from './cuentas.js';

const ROLES_REGISTRAN_CONSUMO = ['propietario', 'administrador', 'recepcionista'];
const ROLES_EDITAN_CATALOGO = ['propietario', 'administrador'];

function puedeRegistrarConsumo() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_REGISTRAN_CONSUMO.includes(usuario.rol);
}

function puedeEditarCatalogo() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_EDITAN_CATALOGO.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Minibar</h2>
    <div id="minibar-consumo-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="minibar-catalogo-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([
    cargarSeccionConsumo(container.querySelector('#minibar-consumo-wrap'), container),
    cargarCatalogo(container.querySelector('#minibar-catalogo-wrap')),
  ]);
}

async function cargarSeccionConsumo(elemento, container) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeRegistrarConsumo();

  let habitacionesEnUso = [];
  try {
    habitacionesEnUso = await calcularHabitacionesEnUso();
  } catch (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones: ${error.message}</p>`;
    return;
  }

  const { data: productos, error: errProd } = await supabase
    .from('minibar_productos')
    .select('*')
    .eq('activo', true)
    .order('categoria')
    .order('nombre');

  const reservaIds = habitacionesEnUso.map((h) => h.reservaId).filter((id) => id !== null);
  const { data: consumos, error: errCons } = reservaIds.length
    ? await supabase
        .from('minibar_consumos')
        .select('*, minibar_productos(nombre)')
        .in('reserva_id', reservaIds)
        .order('creado_en', { ascending: false })
    : { data: [], error: null };

  if (errProd || errCons) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando minibar: ${(errProd || errCons).message}</p>`;
    return;
  }

  const categorias = [...new Set((productos || []).map((p) => p.categoria))];

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Registrar consumo</h3>
      ${
        habitacionesEnUso.length === 0
          ? '<p class="mensaje-vacio">No hay habitaciones ocupadas ahora mismo.</p>'
          : !permitido
          ? '<p class="mensaje-vacio">Tu rol no tiene permiso para registrar consumo.</p>'
          : `
        <form id="form-consumo" class="form-grid">
          <label>Habitación
            <select name="checkin_id" required>
              ${habitacionesEnUso
                .map((h) => `<option value="${h.checkinId}">${h.habitacionLabel} — ${escaparHTML(h.huespedNombre)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Producto
            <select name="producto_id" required>
              ${categorias
                .map(
                  (cat) => `
                <optgroup label="${escaparHTML(cat)}">
                  ${(productos || [])
                    .filter((p) => p.categoria === cat)
                    .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)} — ${formatCOP(p.precio)}</option>`)
                    .join('')}
                </optgroup>
              `
                )
                .join('')}
            </select>
          </label>
          <label>Cantidad
            <input type="number" name="cantidad" min="1" value="1" required />
          </label>
          <button type="submit" class="btn btn-primario">+ Agregar consumo</button>
        </form>
      `
      }
    </div>

    <div class="tarjeta">
      <h3>Consumos de habitaciones en uso</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Habitación</th>
              <th>Producto</th>
              <th>Cant.</th>
              <th>Precio unit.</th>
              <th>Monto</th>
              <th>Hora</th>
              ${permitido ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (consumos || [])
                .map((c) => {
                  const hab = habitacionesEnUso.find((h) => h.reservaId === c.reserva_id);
                  return `<tr data-id="${c.id}">
                    <td>${hab ? hab.habitacionLabel : '—'}</td>
                    <td>${c.minibar_productos ? escaparHTML(c.minibar_productos.nombre) : '—'}</td>
                    <td>${c.cantidad}</td>
                    <td>${formatCOP(c.precio_unitario)}</td>
                    <td>${formatCOP(c.monto)}</td>
                    <td>${formatFechaHora(c.creado_en)}</td>
                    ${permitido ? `<td><button type="button" class="btn-editar btn-eliminar-consumo" data-id="${c.id}">Eliminar</button></td>` : ''}
                  </tr>`;
                })
                .join('') ||
              `<tr><td colspan="${permitido ? 7 : 6}" class="mensaje-vacio">Sin consumos registrados todavía.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (permitido && habitacionesEnUso.length > 0) {
    elemento.querySelector('#form-consumo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const checkinId = Number(formData.get('checkin_id'));
      const productoId = Number(formData.get('producto_id'));
      const cantidad = Number(formData.get('cantidad'));

      const hab = habitacionesEnUso.find((h) => h.checkinId === checkinId);
      const producto = (productos || []).find((p) => p.id === productoId);
      if (!hab || !producto) return;

      if (!hab.reservaId) {
        mostrarToast('Este check-in no tiene una reserva vinculada; no se puede cargar el consumo.', 'error');
        return;
      }

      const usuario = getUsuarioActual();
      const { error } = await supabase.from('minibar_consumos').insert({
        reserva_id: hab.reservaId,
        habitacion_id: hab.habitacionId,
        producto_id: productoId,
        cantidad,
        precio_unitario: producto.precio,
        monto: producto.precio * cantidad,
        registrado_por: usuario.id,
      });

      if (error) {
        mostrarToast(`Error registrando consumo: ${error.message}`, 'error');
        return;
      }

      mostrarToast('Consumo registrado.', 'exito');
      await cargarSeccionConsumo(elemento, container);
    });

    elemento.querySelectorAll('.btn-eliminar-consumo').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await mostrarConfirmacion({
          titulo: 'Eliminar consumo',
          contenidoHTML: '¿Eliminar este consumo de minibar? Esta acción no se puede deshacer.',
          textoConfirmar: 'Eliminar',
        });
        if (!ok) return;
        const { error } = await supabase.from('minibar_consumos').delete().eq('id', Number(btn.dataset.id));
        if (error) {
          mostrarToast(`Error eliminando: ${error.message}`, 'error');
          return;
        }
        mostrarToast('Consumo eliminado.', 'exito');
        await cargarSeccionConsumo(elemento, container);
      });
    });
  }
}

async function cargarCatalogo(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeEditarCatalogo();

  const { data: productos, error } = await supabase.from('minibar_productos').select('*').order('categoria').order('nombre');
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando catálogo: ${error.message}</p>`;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Catálogo de productos</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Producto</th>
              <th>Precio</th>
              <th>Cant. estándar</th>
              <th>Ubicación</th>
              <th>Activo</th>
              ${permitido ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (productos || [])
                .map(
                  (p) => `
              <tr data-id="${p.id}">
                <td>${escaparHTML(p.categoria)}</td>
                <td>${escaparHTML(p.nombre)}</td>
                <td>${permitido ? `<input type="number" class="input-producto" data-campo="precio" value="${p.precio}" style="width:100px" />` : formatCOP(p.precio)}</td>
                <td>${permitido ? `<input type="number" class="input-producto" data-campo="cantidad_estandar" value="${p.cantidad_estandar ?? ''}" style="width:70px" />` : p.cantidad_estandar ?? '—'}</td>
                <td>${permitido ? `<input type="text" class="input-producto" data-campo="ubicacion" value="${escaparHTML(p.ubicacion || '')}" style="width:170px" />` : escaparHTML(p.ubicacion || '—')}</td>
                <td>${p.activo ? '✅' : '🚫'}</td>
                ${permitido ? `<td><button type="button" class="btn-editar btn-guardar-producto">Guardar</button></td>` : ''}
              </tr>
            `
                )
                .join('') ||
              `<tr><td colspan="${permitido ? 7 : 6}" class="mensaje-vacio">Sin productos en el catálogo.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${
        permitido
          ? `
        <h3 style="margin-top:1.5rem;">+ Nuevo producto</h3>
        <form id="form-nuevo-producto" class="form-grid">
          <label>Categoría
            <input type="text" name="categoria" required placeholder="Ej: Bebidas" />
          </label>
          <label>Nombre
            <input type="text" name="nombre" required />
          </label>
          <label>Precio
            <input type="number" name="precio" step="1000" min="0" required />
          </label>
          <label>Cant. estándar
            <input type="number" name="cantidad_estandar" min="0" placeholder="Opcional" />
          </label>
          <label>Ubicación
            <input type="text" name="ubicacion" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-secundario btn-chico">+ Agregar producto</button>
        </form>
      `
          : ''
      }
    </div>
  `;

  if (permitido) {
    elemento.querySelectorAll('.btn-guardar-producto').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const fila = e.target.closest('tr');
        const id = Number(fila.dataset.id);
        const payload = {};
        fila.querySelectorAll('.input-producto').forEach((input) => {
          const campo = input.dataset.campo;
          payload[campo] =
            campo === 'precio' || campo === 'cantidad_estandar'
              ? input.value
                ? Number(input.value)
                : null
              : input.value.trim() || null;
        });
        const { error } = await supabase.from('minibar_productos').update(payload).eq('id', id);
        if (error) {
          mostrarToast(`Error: ${error.message}`, 'error');
          return;
        }
        mostrarToast('Producto actualizado.', 'exito');
      });
    });

    elemento.querySelector('#form-nuevo-producto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const { error } = await supabase.from('minibar_productos').insert({
        categoria: form.get('categoria').trim(),
        nombre: form.get('nombre').trim(),
        precio: Number(form.get('precio')),
        cantidad_estandar: form.get('cantidad_estandar') ? Number(form.get('cantidad_estandar')) : null,
        ubicacion: form.get('ubicacion').trim() || null,
      });
      if (error) {
        mostrarToast(`Error creando producto: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Producto agregado.', 'exito');
      await cargarCatalogo(elemento);
    });
  }
}

registerModule({
  id: 'minibar',
  label: 'Minibar',
  icono: '🥤',
  roles: ['propietario', 'administrador', 'recepcionista', 'bodega'],
  parentId: 'grupo-inventario',
  render,
});
