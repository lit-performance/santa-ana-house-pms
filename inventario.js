// inventario.js
//
// Módulo: Inventario. Dos ubicaciones de stock de minibar:
//  - Bodega: existencias de reserva para reabastecer habitaciones (con precio
//    de costo, proveedor y cantidad mínima para activar recompra).
//  - Habitación: stock físico actual del minibar de cada habitación. Se
//    descuenta automáticamente cuando se registra un consumo en el módulo
//    Minibar, y se repone aquí con la acción "Reabastecer habitación"
//    (que a su vez descuenta la bodega).
//
// Toda entrada/salida de stock queda registrada en inventario_movimientos
// para trazabilidad.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora } from './dates.js';
import { getUsuarioActual } from './auth.js';

const ROLES_GESTIONAN = ['propietario', 'administrador', 'bodega'];

function puedeGestionar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_GESTIONAN.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Inventario</h2>
    <div id="inv-bodega-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="inv-compra-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="inv-reabastecer-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="inv-habitacion-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="inv-movimientos-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([
    cargarInventarioBodega(container.querySelector('#inv-bodega-wrap')),
    cargarSeccionCompra(container.querySelector('#inv-compra-wrap')),
    cargarSeccionReabastecer(container.querySelector('#inv-reabastecer-wrap')),
    cargarInventarioHabitacion(container.querySelector('#inv-habitacion-wrap')),
    cargarMovimientos(container.querySelector('#inv-movimientos-wrap')),
  ]);
}

// =========================================================
// Bodega
// =========================================================
async function cargarInventarioBodega(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeGestionar();

  const [{ data: inventario, error: errInv }, { data: proveedores, error: errProv }] = await Promise.all([
    supabase
      .from('inventario_bodega')
      .select('*, minibar_productos(nombre, categoria)')
      .order('minibar_productos(categoria)')
      .order('minibar_productos(nombre)'),
    supabase.from('proveedores').select('id, nombre_comercial').eq('activo', true).order('nombre_comercial'),
  ]);

  if (errInv || errProv) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando inventario de bodega: ${(errInv || errProv).message}</p>`;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Bodega — existencias y proveedor</h3>
      <p class="texto-ayuda">Producto en rojo = existencia por debajo del mínimo definido (recompra sugerida).</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Producto</th>
              <th>Precio costo</th>
              <th>Proveedor</th>
              <th>En bodega</th>
              <th>Mínimo</th>
              <th>Estado</th>
              ${permitido ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (inventario || [])
                .map((f) => {
                  const bajoMinimo = f.cantidad_minima > 0 && f.cantidad_actual <= f.cantidad_minima;
                  return `
              <tr data-id="${f.id}" style="${bajoMinimo ? 'background:var(--color-alerta-fondo, #fdecea);' : ''}">
                <td>${escaparHTML(f.minibar_productos?.categoria || '—')}</td>
                <td>${escaparHTML(f.minibar_productos?.nombre || '—')}</td>
                <td>${permitido ? `<input type="number" class="input-bodega" data-campo="precio_costo" value="${f.precio_costo ?? ''}" style="width:100px" />` : formatCOP(f.precio_costo || 0)}</td>
                <td>${
                  permitido
                    ? `<select class="input-bodega" data-campo="proveedor_id" style="width:150px">
                        <option value="">— Sin asignar —</option>
                        ${(proveedores || [])
                          .map((p) => `<option value="${p.id}" ${f.proveedor_id === p.id ? 'selected' : ''}>${escaparHTML(p.nombre_comercial)}</option>`)
                          .join('')}
                      </select>`
                    : escaparHTML((proveedores || []).find((p) => p.id === f.proveedor_id)?.nombre_comercial || '—')
                }</td>
                <td>${permitido ? `<input type="number" class="input-bodega" data-campo="cantidad_actual" value="${f.cantidad_actual}" style="width:70px" />` : f.cantidad_actual}</td>
                <td>${permitido ? `<input type="number" class="input-bodega" data-campo="cantidad_minima" value="${f.cantidad_minima}" style="width:70px" />` : f.cantidad_minima}</td>
                <td>${bajoMinimo ? '⚠️ Reponer' : '✅'}</td>
                ${permitido ? `<td><button type="button" class="btn-editar btn-guardar-bodega">Guardar</button></td>` : ''}
              </tr>
            `;
                })
                .join('') ||
              `<tr><td colspan="${permitido ? 8 : 7}" class="mensaje-vacio">Sin productos en inventario.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!permitido) return;

  elemento.querySelectorAll('.btn-guardar-bodega').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = { actualizado_en: new Date().toISOString() };
      fila.querySelectorAll('.input-bodega').forEach((input) => {
        const campo = input.dataset.campo;
        if (campo === 'proveedor_id') {
          payload[campo] = input.value ? Number(input.value) : null;
        } else if (campo === 'precio_costo') {
          payload[campo] = input.value ? Number(input.value) : null;
        } else {
          payload[campo] = Number(input.value) || 0;
        }
      });
      const { error } = await supabase.from('inventario_bodega').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Inventario de bodega actualizado.', 'exito');
      await cargarInventarioBodega(elemento);
    });
  });
}

// =========================================================
// Registrar compra (entrada a bodega)
// =========================================================
async function cargarSeccionCompra(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '';
    return;
  }

  const [{ data: productos }, { data: proveedores }] = await Promise.all([
    supabase.from('minibar_productos').select('id, nombre, categoria').order('categoria').order('nombre'),
    supabase.from('proveedores').select('id, nombre_comercial').eq('activo', true).order('nombre_comercial'),
  ]);

  const categorias = [...new Set((productos || []).map((p) => p.categoria))];

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Registrar compra (entrada a bodega)</h3>
      <form id="form-compra" class="form-grid">
        <label>Producto
          <select name="producto_id" required>
            ${categorias
              .map(
                (cat) => `
              <optgroup label="${escaparHTML(cat)}">
                ${(productos || [])
                  .filter((p) => p.categoria === cat)
                  .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)}</option>`)
                  .join('')}
              </optgroup>
            `
              )
              .join('')}
          </select>
        </label>
        <label>Cantidad que ingresa
          <input type="number" name="cantidad" min="1" value="1" required />
        </label>
        <label>Precio de costo (opcional, actualiza el costo)
          <input type="number" name="precio_costo" min="0" placeholder="Dejar vacío para no cambiarlo" />
        </label>
        <label>Proveedor (opcional)
          <select name="proveedor_id">
            <option value="">— Sin asignar —</option>
            ${(proveedores || []).map((p) => `<option value="${p.id}">${escaparHTML(p.nombre_comercial)}</option>`).join('')}
          </select>
        </label>
        <label>Notas
          <input type="text" name="notas" placeholder="Opcional" />
        </label>
        <button type="submit" class="btn btn-primario">+ Registrar entrada</button>
      </form>
    </div>
  `;

  elemento.querySelector('#form-compra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const productoId = Number(form.get('producto_id'));
    const cantidad = Number(form.get('cantidad'));
    const precioCosto = form.get('precio_costo') ? Number(form.get('precio_costo')) : null;
    const proveedorId = form.get('proveedor_id') ? Number(form.get('proveedor_id')) : null;
    const usuario = getUsuarioActual();

    const { data: fila, error: errFila } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', productoId)
      .maybeSingle();
    if (errFila) {
      mostrarToast(`Error: ${errFila.message}`, 'error');
      return;
    }

    const payloadUpdate = { cantidad_actual: (fila?.cantidad_actual || 0) + cantidad, actualizado_en: new Date().toISOString() };
    if (precioCosto !== null) payloadUpdate.precio_costo = precioCosto;
    if (proveedorId !== null) payloadUpdate.proveedor_id = proveedorId;

    const { error: errUpdate } = fila
      ? await supabase.from('inventario_bodega').update(payloadUpdate).eq('id', fila.id)
      : await supabase.from('inventario_bodega').insert({
          producto_id: productoId,
          cantidad_actual: cantidad,
          cantidad_minima: 0,
          precio_costo: precioCosto,
          proveedor_id: proveedorId,
        });
    if (errUpdate) {
      mostrarToast(`Error: ${errUpdate.message}`, 'error');
      return;
    }

    await supabase.from('inventario_movimientos').insert({
      tipo: 'compra_bodega',
      producto_id: productoId,
      cantidad,
      precio_costo: precioCosto,
      notas: form.get('notas').trim() || null,
      registrado_por: usuario?.id || null,
    });

    mostrarToast('Entrada registrada en bodega.', 'exito');
    e.target.reset();
    document.dispatchEvent(new CustomEvent('inventario:actualizado'));
    const wrapBodega = document.querySelector('#inv-bodega-wrap');
    if (wrapBodega) await cargarInventarioBodega(wrapBodega);
    const wrapMov = document.querySelector('#inv-movimientos-wrap');
    if (wrapMov) await cargarMovimientos(wrapMov);
  });
}

// =========================================================
// Reabastecer habitación (bodega → habitación)
// =========================================================
async function cargarSeccionReabastecer(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '';
    return;
  }

  const [{ data: habitaciones }, { data: productos }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').order('numero'),
    supabase.from('minibar_productos').select('id, nombre, categoria').order('categoria').order('nombre'),
  ]);

  const categorias = [...new Set((productos || []).map((p) => p.categoria))];

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Reabastecer habitación (bodega → habitación)</h3>
      <form id="form-reabastecer" class="form-grid">
        <label>Habitación
          <select name="habitacion_id" required>
            ${(habitaciones || []).map((h) => `<option value="${h.id}">${escaparHTML(h.numero)} — ${escaparHTML(h.nombre)}</option>`).join('')}
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
                  .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)}</option>`)
                  .join('')}
              </optgroup>
            `
              )
              .join('')}
          </select>
        </label>
        <label>Cantidad a trasladar
          <input type="number" name="cantidad" min="1" value="1" required />
        </label>
        <button type="submit" class="btn btn-secundario btn-chico">Reabastecer</button>
      </form>
    </div>
  `;

  elemento.querySelector('#form-reabastecer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const habitacionId = Number(form.get('habitacion_id'));
    const productoId = Number(form.get('producto_id'));
    const cantidad = Number(form.get('cantidad'));
    const usuario = getUsuarioActual();

    const { data: filaBodega, error: errBodega } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', productoId)
      .maybeSingle();
    if (errBodega) {
      mostrarToast(`Error: ${errBodega.message}`, 'error');
      return;
    }

    const stockBodega = filaBodega?.cantidad_actual || 0;
    if (stockBodega < cantidad) {
      const seguir = await mostrarConfirmacion({
        titulo: 'Stock insuficiente en bodega',
        contenidoHTML: `En bodega solo hay ${stockBodega} unidad(es) registradas de este producto. ¿Continuar de todas formas?`,
        textoConfirmar: 'Continuar',
      });
      if (!seguir) return;
    }

    if (filaBodega) {
      await supabase
        .from('inventario_bodega')
        .update({ cantidad_actual: stockBodega - cantidad, actualizado_en: new Date().toISOString() })
        .eq('id', filaBodega.id);
    }

    await ajustarInventarioHabitacion(habitacionId, productoId, cantidad, usuario?.id || null, 'reabastecimiento');

    mostrarToast('Habitación reabastecida.', 'exito');
    e.target.reset();
    const wrapBodega = document.querySelector('#inv-bodega-wrap');
    if (wrapBodega) await cargarInventarioBodega(wrapBodega);
    const wrapHab = document.querySelector('#inv-habitacion-wrap');
    if (wrapHab) await cargarInventarioHabitacion(wrapHab);
    const wrapMov = document.querySelector('#inv-movimientos-wrap');
    if (wrapMov) await cargarMovimientos(wrapMov);
  });
}

// Ajusta (suma o resta) el stock de un producto en una habitación y deja
// registro en inventario_movimientos. delta positivo = entra, negativo = sale.
export async function ajustarInventarioHabitacion(habitacionId, productoId, delta, usuarioId, tipoMovimiento) {
  const { data: fila } = await supabase
    .from('inventario_habitacion')
    .select('id, cantidad_actual')
    .eq('habitacion_id', habitacionId)
    .eq('producto_id', productoId)
    .maybeSingle();

  if (fila) {
    await supabase
      .from('inventario_habitacion')
      .update({ cantidad_actual: fila.cantidad_actual + delta, actualizado_en: new Date().toISOString() })
      .eq('id', fila.id);
  } else {
    await supabase.from('inventario_habitacion').insert({
      habitacion_id: habitacionId,
      producto_id: productoId,
      cantidad_actual: delta,
    });
  }

  await supabase.from('inventario_movimientos').insert({
    tipo: tipoMovimiento,
    producto_id: productoId,
    habitacion_id: habitacionId,
    cantidad: Math.abs(delta),
    registrado_por: usuarioId,
  });
}

// =========================================================
// Inventario por habitación
// =========================================================
async function cargarInventarioHabitacion(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const { data: habitaciones, error: errHab } = await supabase.from('habitaciones').select('id, numero, nombre').order('numero');
  if (errHab) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones: ${errHab.message}</p>`;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Inventario por habitación</h3>
      <label>Selecciona una habitación
        <select id="select-hab-inventario" style="max-width:280px">
          ${(habitaciones || []).map((h) => `<option value="${h.id}">${escaparHTML(h.numero)} — ${escaparHTML(h.nombre)}</option>`).join('')}
        </select>
      </label>
      <div id="detalle-hab-inventario" style="margin-top:1rem;">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
    </div>
  `;

  const select = elemento.querySelector('#select-hab-inventario');
  const detalle = elemento.querySelector('#detalle-hab-inventario');

  async function pintarDetalle(habitacionId) {
    detalle.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
    const { data: filas, error } = await supabase
      .from('inventario_habitacion')
      .select('*, minibar_productos(nombre, categoria, cantidad_estandar)')
      .eq('habitacion_id', habitacionId)
      .order('minibar_productos(categoria)')
      .order('minibar_productos(nombre)');
    if (error) {
      detalle.innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
      return;
    }

    detalle.innerHTML = `
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Producto</th>
              <th>Actual</th>
              <th>Estándar</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${
              (filas || [])
                .map((f) => {
                  const estandar = f.minibar_productos?.cantidad_estandar ?? 0;
                  const falta = f.cantidad_actual < estandar;
                  return `<tr>
                    <td>${escaparHTML(f.minibar_productos?.categoria || '—')}</td>
                    <td>${escaparHTML(f.minibar_productos?.nombre || '—')}</td>
                    <td>${f.cantidad_actual}</td>
                    <td>${estandar}</td>
                    <td>${falta ? '⚠️ Reponer' : '✅'}</td>
                  </tr>`;
                })
                .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin inventario cargado para esta habitación.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  }

  if (habitaciones && habitaciones.length > 0) {
    await pintarDetalle(habitaciones[0].id);
    select.addEventListener('change', () => pintarDetalle(Number(select.value)));
  } else {
    detalle.innerHTML = '<p class="mensaje-vacio">No hay habitaciones registradas.</p>';
  }
}

// =========================================================
// Movimientos recientes
// =========================================================
async function cargarMovimientos(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const { data: movimientos, error } = await supabase
    .from('inventario_movimientos')
    .select('*, minibar_productos(nombre), habitaciones(numero)')
    .order('creado_en', { ascending: false })
    .limit(25);

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando movimientos: ${error.message}</p>`;
    return;
  }

  const etiquetasTipo = {
    compra_bodega: 'Compra a bodega',
    reabastecimiento: 'Reabastecimiento',
    consumo: 'Consumo',
    ajuste_bodega: 'Ajuste bodega',
    ajuste_habitacion: 'Ajuste habitación',
  };

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Movimientos recientes</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Habitación</th>
              <th>Cantidad</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${
              (movimientos || [])
                .map(
                  (m) => `<tr>
                <td>${etiquetasTipo[m.tipo] || m.tipo}</td>
                <td>${escaparHTML(m.minibar_productos?.nombre || '—')}</td>
                <td>${m.habitaciones ? escaparHTML(m.habitaciones.numero) : '—'}</td>
                <td>${m.cantidad}</td>
                <td>${formatFechaHora(m.creado_en)}</td>
              </tr>`
                )
                .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin movimientos registrados todavía.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

registerModule({
  id: 'inventario',
  label: 'Inventario',
  icono: '📦',
  roles: ['propietario', 'administrador', 'bodega'],
  parentId: 'grupo-inventario',
  render,
});
