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
//
// Cada consumo también descuenta el stock físico del minibar de esa
// habitación en inventario_habitacion (ver inventario.js). Si se elimina un
// consumo por error, el descuento se revierte. Esto es un registro
// complementario para saber qué reponer — si falla no bloquea el cobro.
//
// Nota (148): "Registrar consumo" ya NO es un formulario siempre visible
// en la pantalla (con un producto y cantidad quedando precargados por
// defecto, lo que exponía a un envío accidental). Ahora es un botón que
// abre la tarjeta emergente compartida de consumo-minibar.js — el mismo
// flujo de 2 pasos (líneas de producto sin nada preseleccionado → resumen
// de confirmación → guardar) que usa también Recepción en "➕ Consumo".
// El listado de abajo ("Consumos de habitaciones en uso") ahora agrupa
// cada venta (una o varias líneas juntas) y permite editarla o
// eliminarla completa — ver `cargarListaVentasMinibar` en
// consumo-minibar.js.
//
// Nota (148): en "Catálogo de productos", el formulario "+ Nuevo
// producto" se movió ARRIBA de la tabla (antes quedaba debajo, había que
// scrollear toda la lista para llegar a él).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatCOP } from './currency.js';
import { getUsuarioActual } from './auth.js';
import { calcularHabitacionesEnUso } from './cuentas.js';
import { abrirModalRegistrarConsumo, cargarListaVentasMinibar } from './consumo-minibar.js';

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

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0;">
        <h3 style="margin:0;">🥤 Registrar consumo</h3>
        ${permitido && habitacionesEnUso.length > 0 ? '<button type="button" id="btn-registrar-consumo" class="btn btn-primario btn-chico">+ Registrar consumo</button>' : ''}
      </div>
      ${
        habitacionesEnUso.length === 0
          ? '<p class="mensaje-vacio">No hay habitaciones ocupadas ahora mismo.</p>'
          : !permitido
          ? '<p class="mensaje-vacio">Tu rol no tiene permiso para registrar consumo.</p>'
          : '<p class="mensaje-vacio">Elige la habitación y uno o varios productos — se te pedirá confirmar el resumen antes de guardar.</p>'
      }
    </div>
    <div id="minibar-ventas-wrap"></div>
  `;

  if (permitido && habitacionesEnUso.length > 0) {
    elemento.querySelector('#btn-registrar-consumo').addEventListener('click', () => {
      abrirModalRegistrarConsumo({
        habitacionesEnUso,
        onGuardado: () => cargarSeccionConsumo(elemento, container),
      });
    });
  }

  await cargarListaVentasMinibar(elemento.querySelector('#minibar-ventas-wrap'), { habitacionesEnUso, permitido });
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
      ${
        permitido
          ? `
        <form id="form-nuevo-producto" class="form-grid" style="margin-bottom:1.25rem;">
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
