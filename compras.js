// compras.js
//
// Módulo: Compras. Órdenes de compra formales a proveedores, con líneas de
// producto y seguimiento de estado (solicitado → en camino → recibido).
// Al marcar una orden como "recibido", este módulo suma automáticamente las
// cantidades a inventario_bodega (mismo mecanismo que la "Registrar compra"
// rápida de Inventario) y actualiza el precio de costo — así no toca
// registrar la entrada dos veces.
//
// Nota (136): este archivo YA NO se registra como pestaña propia — sus dos
// secciones (`cargarFormNuevaOrden` y `cargarListaOrdenes`, ahora
// exportadas) se muestran como dos mini-tarjetas más dentro del tablero de
// Inventario ("📝 Nueva orden de compra" y "📦 Órdenes de compra"), junto a
// "Registrar compra" y el resto — Compras solo tenía 2 secciones y ya
// vivía en el mismo grupo de menú que Inventario, así que tenerlas
// separadas en dos pestañas distintas era más navegación de la necesaria
// para algo tan relacionado. Este archivo se deja tal cual por dentro
// (la lógica de crear/recibir/cancelar órdenes no cambió en nada) — solo
// se quitó el registro como módulo independiente.

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

const ETIQUETAS_ESTADO = {
  solicitado: '🟡 Solicitado',
  en_camino: '🔵 En camino',
  recibido: '🟢 Recibido',
  cancelado: '⚪ Cancelado',
};

// =========================================================
// Nueva orden de compra
// =========================================================
export async function cargarFormNuevaOrden(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '';
    return;
  }

  const [{ data: proveedores }, { data: productos }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre_comercial').eq('activo', true).order('nombre_comercial'),
    supabase.from('minibar_productos').select('id, nombre, categoria').order('categoria').order('nombre'),
  ]);

  const categorias = [...new Set((productos || []).map((p) => p.categoria))];

  function opcionesProducto() {
    return categorias
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
      .join('');
  }

  function filaItem() {
    const fila = document.createElement('div');
    fila.className = 'form-grid fila-item-compra';
    fila.style.cssText = 'grid-template-columns:2fr 1fr 1fr auto; align-items:end; margin-bottom:0.5rem;';
    fila.innerHTML = `
      <label>Producto
        <select class="item-producto" required>${opcionesProducto()}</select>
      </label>
      <label>Cantidad
        <input type="number" class="item-cantidad" min="1" value="1" required />
      </label>
      <label>Precio costo unit.
        <input type="number" class="item-precio" min="0" step="100" value="0" required />
      </label>
      <button type="button" class="btn-editar btn-quitar-item">Quitar</button>
    `;
    fila.querySelector('.btn-quitar-item').addEventListener('click', () => fila.remove());
    return fila;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>+ Nueva orden de compra</h3>
      <form id="form-nueva-orden">
        <div class="form-grid">
          <label>Proveedor
            <select name="proveedor_id" required>
              <option value="">—</option>
              ${(proveedores || []).map((p) => `<option value="${p.id}">${escaparHTML(p.nombre_comercial)}</option>`).join('')}
            </select>
          </label>
          <label>Fecha del pedido
            <input type="date" name="fecha_pedido" value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <label>Notas
            <input type="text" name="notas" placeholder="Opcional" />
          </label>
        </div>
        <p style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-texto-suave); margin:1rem 0 0.4rem;">Productos a pedir</p>
        <div id="items-orden-wrap"></div>
        <button type="button" id="btn-agregar-item" class="btn btn-secundario btn-chico">+ Agregar producto</button>
        <div class="modal-acciones" style="margin-top:1rem;">
          <button type="submit" class="btn btn-primario">Crear orden</button>
        </div>
      </form>
    </div>
  `;

  const wrapItems = elemento.querySelector('#items-orden-wrap');
  wrapItems.appendChild(filaItem());
  elemento.querySelector('#btn-agregar-item').addEventListener('click', () => {
    wrapItems.appendChild(filaItem());
  });

  elemento.querySelector('#form-nueva-orden').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const proveedorId = form.get('proveedor_id') ? Number(form.get('proveedor_id')) : null;

    const filas = [...wrapItems.querySelectorAll('.fila-item-compra')];
    if (filas.length === 0) {
      mostrarToast('Agrega al menos un producto a la orden.', 'error');
      return;
    }

    const items = filas.map((fila) => ({
      producto_id: Number(fila.querySelector('.item-producto').value),
      cantidad: Number(fila.querySelector('.item-cantidad').value),
      precio_costo_unitario: Number(fila.querySelector('.item-precio').value),
    }));

    const usuario = getUsuarioActual();
    const { data: orden, error: errOrden } = await supabase
      .from('ordenes_compra')
      .insert({
        proveedor_id: proveedorId,
        fecha_pedido: form.get('fecha_pedido') || new Date().toISOString().slice(0, 10),
        notas: form.get('notas').trim() || null,
        creado_por: usuario?.id || null,
      })
      .select('id')
      .single();

    if (errOrden) {
      mostrarToast(`Error creando la orden: ${errOrden.message}`, 'error');
      return;
    }

    const { error: errItems } = await supabase
      .from('ordenes_compra_items')
      .insert(items.map((it) => ({ ...it, orden_id: orden.id })));

    if (errItems) {
      mostrarToast(`Orden creada, pero hubo un error agregando los productos: ${errItems.message}`, 'error');
      return;
    }

    mostrarToast('Orden de compra creada.', 'exito');
    e.target.reset();
    wrapItems.innerHTML = '';
    wrapItems.appendChild(filaItem());
    const wrapLista = document.querySelector('#inv-ordenes-wrap');
    if (wrapLista) await cargarListaOrdenes(wrapLista);
  });
}

// =========================================================
// Lista de órdenes
// =========================================================
export async function cargarListaOrdenes(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeGestionar();

  const { data: ordenes, error: errOrdenes } = await supabase
    .from('ordenes_compra')
    .select('*, proveedores(nombre_comercial)')
    .order('creado_en', { ascending: false });

  if (errOrdenes) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando órdenes: ${errOrdenes.message}</p>`;
    return;
  }

  const ordenIds = (ordenes || []).map((o) => o.id);
  const { data: items, error: errItems } = ordenIds.length
    ? await supabase.from('ordenes_compra_items').select('*, minibar_productos(nombre)').in('orden_id', ordenIds)
    : { data: [], error: null };

  if (errItems) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando los productos de las órdenes: ${errItems.message}</p>`;
    return;
  }

  const itemsPorOrden = new Map();
  (items || []).forEach((it) => {
    if (!itemsPorOrden.has(it.orden_id)) itemsPorOrden.set(it.orden_id, []);
    itemsPorOrden.get(it.orden_id).push(it);
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Órdenes de compra</h3>
      ${
        (ordenes || []).length === 0
          ? '<p class="mensaje-vacio">Sin órdenes registradas todavía.</p>'
          : ordenes
              .map((o) => {
                const itemsOrden = itemsPorOrden.get(o.id) || [];
                const total = itemsOrden.reduce((acc, it) => acc + it.cantidad * it.precio_costo_unitario, 0);
                return `
              <div class="tarjeta" style="margin-bottom:0.75rem; box-shadow:none; border:1px solid var(--color-borde);">
                <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; align-items:center;">
                  <div>
                    <strong>Orden #${o.id}</strong> — ${escaparHTML(o.proveedores?.nombre_comercial || 'Sin proveedor')}
                    <div class="mensaje-vacio" style="margin:0.15rem 0 0;">Pedida: ${o.fecha_pedido}${o.fecha_recibido ? ` · Recibida: ${formatFechaHora(o.fecha_recibido)}` : ''}</div>
                  </div>
                  <div style="text-align:right;">
                    <div>${ETIQUETAS_ESTADO[o.estado] || o.estado}</div>
                    <div style="font-weight:700;">${formatCOP(total)}</div>
                  </div>
                </div>
                <div class="tabla-scroll" style="margin-top:0.6rem;">
                  <table class="tabla-simple">
                    <thead><tr><th>Producto</th><th>Cant.</th><th>Costo unit.</th><th>Subtotal</th></tr></thead>
                    <tbody>
                      ${itemsOrden
                        .map(
                          (it) => `<tr>
                        <td>${escaparHTML(it.minibar_productos?.nombre || '—')}</td>
                        <td>${it.cantidad}</td>
                        <td>${formatCOP(it.precio_costo_unitario)}</td>
                        <td>${formatCOP(it.cantidad * it.precio_costo_unitario)}</td>
                      </tr>`
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>
                ${o.notas ? `<p class="mensaje-vacio" style="margin-top:0.5rem;">Nota: ${escaparHTML(o.notas)}</p>` : ''}
                ${
                  permitido && (o.estado === 'solicitado' || o.estado === 'en_camino')
                    ? `<div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.75rem;">
                        ${o.estado === 'solicitado' ? `<button type="button" class="btn-editar btn-en-camino" data-orden-id="${o.id}">Marcar en camino</button>` : ''}
                        <button type="button" class="btn-editar btn-recibido" data-orden-id="${o.id}">Marcar recibido</button>
                        <button type="button" class="btn-editar btn-cancelar-orden" data-orden-id="${o.id}">Cancelar orden</button>
                      </div>`
                    : ''
                }
              </div>
            `;
              })
              .join('')
      }
    </div>
  `;

  if (!permitido) return;

  elemento.querySelectorAll('.btn-en-camino').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { error } = await supabase.from('ordenes_compra').update({ estado: 'en_camino' }).eq('id', Number(btn.dataset.ordenId));
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Orden marcada como en camino.', 'exito');
      await cargarListaOrdenes(elemento);
    });
  });

  elemento.querySelectorAll('.btn-cancelar-orden').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Cancelar orden',
        contenidoHTML: '¿Cancelar esta orden de compra? No se sumará nada a bodega.',
        textoConfirmar: 'Cancelar orden',
      });
      if (!ok) return;
      const { error } = await supabase.from('ordenes_compra').update({ estado: 'cancelado' }).eq('id', Number(btn.dataset.ordenId));
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Orden cancelada.', 'exito');
      await cargarListaOrdenes(elemento);
    });
  });

  elemento.querySelectorAll('.btn-recibido').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ordenId = Number(btn.dataset.ordenId);
      const ok = await mostrarConfirmacion({
        titulo: 'Marcar como recibido',
        contenidoHTML: 'Esto suma las cantidades de esta orden a las existencias de bodega y actualiza el precio de costo de cada producto. ¿Continuar?',
        textoConfirmar: 'Sí, ya llegó',
      });
      if (!ok) return;

      const itemsOrden = itemsPorOrden.get(ordenId) || [];
      const usuario = getUsuarioActual();

      for (const it of itemsOrden) {
        const { data: filaBodega } = await supabase
          .from('inventario_bodega')
          .select('id, cantidad_actual')
          .eq('producto_id', it.producto_id)
          .maybeSingle();

        if (filaBodega) {
          await supabase
            .from('inventario_bodega')
            .update({
              cantidad_actual: filaBodega.cantidad_actual + it.cantidad,
              precio_costo: it.precio_costo_unitario,
              actualizado_en: new Date().toISOString(),
            })
            .eq('id', filaBodega.id);
        } else {
          await supabase.from('inventario_bodega').insert({
            producto_id: it.producto_id,
            cantidad_actual: it.cantidad,
            cantidad_minima: 0,
            precio_costo: it.precio_costo_unitario,
          });
        }

        await supabase.from('inventario_movimientos').insert({
          tipo: 'compra_bodega',
          producto_id: it.producto_id,
          cantidad: it.cantidad,
          precio_costo: it.precio_costo_unitario,
          notas: `Recibido de orden de compra #${ordenId}.`,
          registrado_por: usuario?.id || null,
        });
      }

      const { error: errOrden } = await supabase
        .from('ordenes_compra')
        .update({ estado: 'recibido', fecha_recibido: new Date().toISOString() })
        .eq('id', ordenId);

      if (errOrden) {
        mostrarToast(`Bodega actualizada, pero no se pudo marcar la orden como recibida: ${errOrden.message}`, 'error');
        return;
      }

      mostrarToast('Orden recibida. Bodega actualizada.', 'exito');
      await cargarListaOrdenes(elemento);
    });
  });
}
