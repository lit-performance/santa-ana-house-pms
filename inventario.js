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
//
// Nota sobre "🔴 Pendientes de reponer en minibares": compara TODAS las
// habitaciones contra el catálogo completo de productos con cantidad
// estándar definida — no solo lo que ya tenga fila en
// inventario_habitacion, así una habitación que nunca se ha inventariado
// también aparece con su pendiente completo — y arma una sola tabla con
// habitación + producto + cuánto falta.
//
// Nota sobre "⬇ Excel" y "✅ Reponer todo" en Pendientes de reponer
// (nuevas): "⬇ Excel" exporta la tabla completa a un CSV (habitación,
// producto, actual, estándar, falta) para que quien va a hacer la
// reposición física la lleve impresa y no tenga que ir mirando la
// pantalla habitación por habitación. "✅ Reponer todo" hace el traslado
// bodega → habitación de TODOS los pendientes de la lista de una sola
// vez (después de confirmar cuántas unidades/habitaciones va a mover) —
// pensado para usarse DESPUÉS de hacer la reposición física real, para
// que el sistema quede al día con un solo clic en vez de una por una. Si
// a algún producto no le alcanza el stock de bodega, ese ítem se repone
// parcial (lo que haya disponible) y al final se avisa cuáles quedaron
// incompletos, sin interrumpir el resto del proceso con una ventana de
// confirmación por cada uno.
//
// Nota sobre "📤 Reposiciones de hoy": resumen del día de todo lo que
// salió de la bodega principal hacia los minibares de las habitaciones
// (inventario_movimientos con tipo 'reabastecimiento', filtrado a hoy),
// con un total por producto y el detalle de qué fue a cada habitación —
// para el cierre del día, sin tener que rebuscar en "Movimientos
// recientes" (que mezcla todos los tipos y solo trae los últimos 25).
//
// Nota sobre la cantidad editable en "Reponer" de Pendientes (ver 100):
// antes "Reponer ahora" siempre movía la cantidad "falta" COMPLETA — si a
// la bodega no le alcanzaba, preguntaba si continuar y, si decías que sí,
// igual restaba todo eso de bodega (podía dejarla en negativo). Ahora hay
// un campo de cantidad editable al lado del botón (parte de la cantidad
// que falta, precargada pero se puede bajar) y SIEMPRE se topa a lo que
// realmente haya en bodega — nunca deja bodega en negativo. Así puedes
// repartir a mano lo poco que quede de un producto (ej. media botella de
// aguardiente) entre varias habitaciones, dejando el resto pendiente y
// visible en esta misma tabla para cuando llegue más stock. No cambia
// "Reabastecer habitación" (la del formulario aparte), que sigue igual.
//
// Nota sobre "Inventario por habitación" (edición directa, ver 096):
// "Actual" ahora es editable directamente ahí para quien puede gestionar
// inventario — a diferencia de "Reabastecer habitación", que SIEMPRE
// mueve stock real de la bodega, esta edición SOLO corrige el número de
// la habitación (usa `ajustarInventarioHabitacion` con tipo
// 'ajuste_habitacion', que nunca toca inventario_bodega). Es lo que se
// usa para cargar el conteo físico real de cada minibar (por ejemplo,
// después de poner todo en 0 con un reinicio) sin que eso se descuente
// de la bodega principal, que ya está donde debe estar. Muestra TODOS
// los productos activos del catálogo (no solo los que ya tengan fila en
// inventario_habitacion), igual que "Pendientes de reponer".
//
// Nota sobre "tiene_minibar" (ver 109/111): las habitaciones marcadas
// como sin minibar (uso administrativo, arriendo mensual, etc.) no
// aparecen en "Pendientes de reponer", "Reabastecer habitación", el
// selector de "Inventario por habitación" ni el "Mapa de minibares" de
// abajo — se filtran siempre por `tiene_minibar = true`. Para reactivar
// el minibar de una habitación cuando corresponda, basta con marcar la
// casilla correspondiente en Configuración → Habitaciones.
//
// Nota sobre "🗺️ Mapa de minibares" (111): vista de cuadrícula — un
// producto por fila, una habitación por columna — inspirada en el Excel
// de conteo físico que se usaba en papel, pero con números reales en vez
// de solo ✓/X. Verde = completo, ámbar = a medias (muestra
// "actual/estándar"), rojo = no queda nada. Pensada para verse todo el
// panorama de un vistazo, sin tener que ir producto por producto o
// habitación por habitación; "Pendientes de reponer" (más abajo) sigue
// siendo la vista de trabajo para efectivamente reponer.
//
// Nota sobre "🧹 Vaciar minibar" (nuevo, 115): para habitaciones que se
// arriendan sin minibar (ej. tarifa libre / mensual, ver config-
// tarifas.js). Un solo botón que: (1) devuelve TODO el stock actual del
// minibar de esa habitación a la bodega (inventario_bodega suma, la
// habitación queda en 0 — cada movimiento queda registrado con tipo
// 'vaciado_a_bodega'), y (2) desactiva `tiene_minibar` en esa habitación
// automáticamente, para que deje de aparecer en Pendientes/Mapa hasta
// que alguien la reactive manualmente desde Configuración. Disponible
// aquí (Inventario → Inventario por habitación) y también en
// Configuración → Habitaciones, junto a la casilla "Tiene minibar" — es
// la misma función (`vaciarMinibarHabitacion`, exportada), usada desde
// los dos lugares.
//
// Nota (119): (1) el "Mapa de minibares" ahora fija también la fila de
// encabezado (números de habitación) al hacer scroll hacia abajo, no
// solo la columna de producto — así siempre se ve a qué habitación
// corresponde cada columna, sin importar qué tan abajo se haya
// scrolleado. (2) "Inventario por habitación" pasó a ser de SOLO
// LECTURA — se quitó la edición manual de "Actual" (el conteo ya se
// carga completo desde el mapa/Excel y no hacía falta corregirlo aquí a
// mano); el botón "🧹 Vaciar minibar" se mantiene igual.
//
// Nota (124): "Bodega — existencias y proveedor" pasó a ser de solo
// lectura por defecto, con un botón "✏️ Editar" explícito por fila (en
// vez de mostrar siempre inputs editables con Guardar) — así el número
// que se ve es siempre exactamente lo que está guardado, sin la duda de
// si un cambio quedó persistido o no. Se agregó también la columna
// "Actualizado" (fecha/hora del último guardado real de esa fila) como
// evidencia visual de que el dato es real. Ver 125_verificar_
// inventario_bodega.sql para confirmar por SQL lo mismo.
//
// Nota (128): la edición inline de Bodega (fila que se abría ancha con
// varios inputs) se reemplazó por una tarjeta emergente. La tabla ahora
// solo muestra 5 columnas (Producto, Precio de venta, Cantidad en
// stock, Estado, Ver) — "👁️ Ver" abre `abrirModalDetalleBodega` con
// TODO el detalle (incluye precio de venta, que viene de
// minibar_productos, no de inventario_bodega) y, si el usuario puede
// gestionar inventario, un botón "✏️ Editar" adentro de la misma
// tarjeta para corregir precio costo/proveedor/cantidad/mínimo.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora, toISODate } from './dates.js';
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

function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

async function render(container) {
  container.innerHTML = `
    <h2>Inventario</h2>
    <div id="inv-mapa-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando mapa de minibares…</p>
    </div>
    <div id="inv-pendientes-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Calculando pendientes de reponer…</p>
    </div>
    <div id="inv-bodega-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="inv-compra-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="inv-reabastecer-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="inv-reposiciones-hoy-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="inv-habitacion-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="inv-movimientos-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([
    cargarMapaMinibares(container.querySelector('#inv-mapa-wrap')),
    cargarPendientesReponer(container.querySelector('#inv-pendientes-wrap')),
    cargarInventarioBodega(container.querySelector('#inv-bodega-wrap')),
    cargarSeccionCompra(container.querySelector('#inv-compra-wrap')),
    cargarSeccionReabastecer(container.querySelector('#inv-reabastecer-wrap')),
    cargarReposicionesHoy(container.querySelector('#inv-reposiciones-hoy-wrap')),
    cargarInventarioHabitacion(container.querySelector('#inv-habitacion-wrap')),
    cargarMovimientos(container.querySelector('#inv-movimientos-wrap')),
  ]);
}

// =========================================================
// Mapa de minibares — cuadrícula producto × habitación (ver nota al
// inicio del archivo, 111). Solo lectura; para reponer, usar la tabla
// "Pendientes de reponer" o "Inventario por habitación" de más abajo.
// =========================================================
async function cargarMapaMinibares(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando mapa de minibares…</p>';

  const [{ data: habitaciones, error: errHab }, { data: productos, error: errProd }, { data: filas, error: errFilas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero'),
    supabase.from('minibar_productos').select('id, nombre, categoria, cantidad_estandar').eq('activo', true).gt('cantidad_estandar', 0).order('categoria').order('nombre'),
    supabase.from('inventario_habitacion').select('habitacion_id, producto_id, cantidad_actual'),
  ]);

  if (errHab || errProd || errFilas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el mapa de minibares: ${(errHab || errProd || errFilas).message}</p>`;
    return;
  }

  const actualPorClave = new Map((filas || []).map((f) => [`${f.habitacion_id}_${f.producto_id}`, f.cantidad_actual]));

  const ESTILO_COMPLETO = 'background:#e6f4ea; color:#1e7e34;';
  const ESTILO_PARCIAL = 'background:#fff4d6; color:#8a5a00;';
  const ESTILO_FALTA = 'background:var(--color-alerta-fondo, #fdecea); color:var(--color-rojo-oscuro, #c0392b);';
  const ESTILO_CELDA_BASE = 'text-align:center; min-width:52px; font-weight:700; padding:0.4rem 0.3rem;';
  const ESTILO_COL_PRODUCTO = 'position:sticky; left:0; background:var(--color-fondo-tarjeta, #fff); text-align:left; min-width:200px; z-index:1;';
  // Fila de encabezado (números de habitación) fija al scrollear hacia
  // abajo, para que siempre se vea a qué habitación corresponde cada
  // columna (ver nota 119 al inicio del archivo).
  const ESTILO_TH_FILA_FIJA = 'position:sticky; top:0; background:#f5f6f8; z-index:2;';
  const ESTILO_TH_ESQUINA = 'position:sticky; left:0; top:0; background:#f5f6f8; text-align:left; min-width:200px; z-index:3;';

  function celda(habitacionId, producto) {
    const actual = Number(actualPorClave.get(`${habitacionId}_${producto.id}`) ?? 0);
    const estandar = Number(producto.cantidad_estandar);
    let estilo = ESTILO_COMPLETO;
    if (actual <= 0) {
      estilo = ESTILO_FALTA;
    } else if (actual < estandar) {
      estilo = ESTILO_PARCIAL;
    }
    return `<td style="${ESTILO_CELDA_BASE}${estilo}" title="${escaparHTML(producto.nombre)}: ${actual} de ${estandar}">${actual}</td>`;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem; flex-wrap:wrap;">
        <h3 style="margin:0;">🗺️ Mapa de minibares</h3>
        <div style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; font-size:0.85rem;">
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#e6f4ea;border:1px solid #1e7e34;margin-right:4px;vertical-align:middle;"></span>Completo</span>
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fff4d6;border:1px solid #8a5a00;margin-right:4px;vertical-align:middle;"></span>Reponer</span>
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:var(--color-alerta-fondo, #fdecea);border:1px solid var(--color-rojo-oscuro, #c0392b);margin-right:4px;vertical-align:middle;"></span>Falta todo</span>
        </div>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">De un vistazo: qué hay y qué falta en cada minibar. El número en cada celda es la cantidad actual; "Estándar" es la referencia con la que se compara (no incluye habitaciones sin minibar). Para reponer, usa "Pendientes de reponer" más abajo.</p>
      <div class="tabla-scroll" style="max-height:520px; overflow:auto;">
        <table class="tabla-simple" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="${ESTILO_TH_ESQUINA}">Producto</th>
              <th style="${ESTILO_TH_FILA_FIJA} text-align:center; min-width:70px;">Estándar</th>
              ${(habitaciones || []).map((h) => `<th style="${ESTILO_TH_FILA_FIJA} text-align:center; min-width:52px;">${escaparHTML(h.numero)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${
              (productos || []).length === 0 || (habitaciones || []).length === 0
                ? `<tr><td colspan="${(habitaciones || []).length + 2}" class="mensaje-vacio">Sin datos suficientes para mostrar el mapa.</td></tr>`
                : (productos || [])
                    .map(
                      (p) => `<tr>
                <td style="${ESTILO_COL_PRODUCTO}">${escaparHTML(p.nombre)} <span class="mensaje-vacio">(${escaparHTML(p.categoria)})</span></td>
                <td style="text-align:center; font-weight:700;">${p.cantidad_estandar}</td>
                ${(habitaciones || []).map((h) => celda(h.id, p)).join('')}
              </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =========================================================
// Bodega (ver nota 128 al inicio del archivo): tabla reducida a 5
// columnas (Producto, Precio de venta, Cantidad en stock, Estado, Ver)
// — el detalle completo y la edición viven en una tarjeta emergente que
// abre el botón "👁️ Ver" (ver `abrirModalDetalleBodega`), en vez de
// filas editables inline (que quedaban demasiado anchas/incómodas).
// =========================================================
async function cargarInventarioBodega(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeGestionar();

  const [{ data: inventario, error: errInv }, { data: proveedores, error: errProv }] = await Promise.all([
    supabase
      .from('inventario_bodega')
      .select('*, minibar_productos(nombre, categoria, precio)')
      .order('minibar_productos(categoria)')
      .order('minibar_productos(nombre)'),
    supabase.from('proveedores').select('id, nombre_comercial').eq('activo', true).order('nombre_comercial'),
  ]);

  if (errInv || errProv) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando inventario de bodega: ${(errInv || errProv).message}</p>`;
    return;
  }

  const porId = new Map((inventario || []).map((f) => [f.id, f]));

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Bodega — existencias y proveedor</h3>
      <p class="texto-ayuda">Dale "👁️ Ver" a un producto para ver el detalle completo (costo, proveedor, mínimo, última actualización) y editarlo ahí. Producto en rojo = existencia por debajo del mínimo definido (recompra sugerida).</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Precio de venta</th>
              <th>Cantidad en stock</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              (inventario || [])
                .map((f) => {
                  const bajoMinimo = f.cantidad_minima > 0 && f.cantidad_actual <= f.cantidad_minima;
                  return `
              <tr data-id="${f.id}" style="${bajoMinimo ? 'background:var(--color-alerta-fondo, #fdecea);' : ''}">
                <td>${escaparHTML(f.minibar_productos?.nombre || '—')} <span class="mensaje-vacio">(${escaparHTML(f.minibar_productos?.categoria || '—')})</span></td>
                <td>${formatCOP(f.minibar_productos?.precio || 0)}</td>
                <td>${f.cantidad_actual}</td>
                <td>${bajoMinimo ? '⚠️ Reponer' : '✅'}</td>
                <td><button type="button" class="btn-editar btn-ver-bodega">👁️ Ver</button></td>
              </tr>
            `;
                })
                .join('') || `<tr><td colspan="5" class="mensaje-vacio">Sin productos en inventario.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Un solo listener delegado, asignado con `onclick` (no
  // addEventListener) para que cada recarga de esta tarjeta REEMPLACE
  // el listener anterior en vez de acumularlo.
  elemento.onclick = (e) => {
    const btnVer = e.target.closest('.btn-ver-bodega');
    if (btnVer) {
      const fila = btnVer.closest('tr');
      const f = porId.get(Number(fila.dataset.id));
      if (f) abrirModalDetalleBodega(f, proveedores, elemento, permitido);
    }
  };
}

// Tarjeta emergente de detalle de un producto de bodega: muestra toda
// la información (precio de venta, costo, proveedor, cantidad, mínimo,
// última actualización, estado). Si el usuario puede gestionar
// inventario, tiene un botón "✏️ Editar" que cambia la misma tarjeta a
// modo edición (precio costo, proveedor, cantidad, mínimo) sin volver a
// la tabla — al guardar, cierra y recarga la tarjeta de Bodega.
function abrirModalDetalleBodega(f, proveedores, elemento, permitido) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  function pintarVista() {
    const bajoMinimo = f.cantidad_minima > 0 && f.cantidad_actual <= f.cantidad_minima;
    const proveedorNombre = (proveedores || []).find((p) => p.id === f.proveedor_id)?.nombre_comercial || '—';
    overlay.innerHTML = `
      <div class="modal-caja">
        <h3>${escaparHTML(f.minibar_productos?.nombre || '—')}</h3>
        <p class="mensaje-vacio" style="margin-top:-0.5rem;">${escaparHTML(f.minibar_productos?.categoria || '—')}</p>
        <div class="modal-contenido" style="display:grid; grid-template-columns:1fr 1fr; gap:0.9rem 1.5rem;">
          <div><span class="texto-ayuda">Precio de venta</span><br /><strong>${formatCOP(f.minibar_productos?.precio || 0)}</strong></div>
          <div><span class="texto-ayuda">Precio costo</span><br /><strong>${formatCOP(f.precio_costo || 0)}</strong></div>
          <div><span class="texto-ayuda">Cantidad en bodega</span><br /><strong>${f.cantidad_actual}</strong></div>
          <div><span class="texto-ayuda">Cantidad mínima</span><br /><strong>${f.cantidad_minima}</strong></div>
          <div><span class="texto-ayuda">Proveedor</span><br /><strong>${escaparHTML(proveedorNombre)}</strong></div>
          <div><span class="texto-ayuda">Estado</span><br /><strong>${bajoMinimo ? '⚠️ Reponer' : '✅ OK'}</strong></div>
          <div style="grid-column:1 / -1;"><span class="texto-ayuda">Última actualización</span><br />${f.actualizado_en ? formatFechaHora(f.actualizado_en) : '—'}</div>
        </div>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cerrar-detalle-bodega">Cerrar</button>
          ${permitido ? '<button type="button" class="btn btn-primario" id="btn-editar-detalle-bodega">✏️ Editar</button>' : ''}
        </div>
      </div>
    `;
    overlay.querySelector('#btn-cerrar-detalle-bodega').addEventListener('click', () => overlay.remove());
    const btnEditar = overlay.querySelector('#btn-editar-detalle-bodega');
    if (btnEditar) btnEditar.addEventListener('click', pintarEdicion);
  }

  function pintarEdicion() {
    overlay.innerHTML = `
      <div class="modal-caja">
        <h3>Editar — ${escaparHTML(f.minibar_productos?.nombre || '—')}</h3>
        <form id="form-editar-bodega">
          <div class="form-grid">
            <label>Precio costo
              <input type="number" name="precio_costo" min="0" value="${f.precio_costo ?? ''}" />
            </label>
            <label>Proveedor
              <select name="proveedor_id">
                <option value="">— Sin asignar —</option>
                ${(proveedores || [])
                  .map((p) => `<option value="${p.id}" ${f.proveedor_id === p.id ? 'selected' : ''}>${escaparHTML(p.nombre_comercial)}</option>`)
                  .join('')}
              </select>
            </label>
            <label>Cantidad en bodega
              <input type="number" name="cantidad_actual" min="0" value="${f.cantidad_actual}" required />
            </label>
            <label>Cantidad mínima
              <input type="number" name="cantidad_minima" min="0" value="${f.cantidad_minima}" required />
            </label>
          </div>
          <div class="modal-acciones" style="margin-top:1.25rem;">
            <button type="button" class="btn btn-secundario" id="btn-cancelar-edicion-bodega">Cancelar</button>
            <button type="submit" class="btn btn-primario">Guardar</button>
          </div>
        </form>
      </div>
    `;
    overlay.querySelector('#btn-cancelar-edicion-bodega').addEventListener('click', pintarVista);
    overlay.querySelector('#form-editar-bodega').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const payload = {
        precio_costo: form.get('precio_costo') ? Number(form.get('precio_costo')) : null,
        proveedor_id: form.get('proveedor_id') ? Number(form.get('proveedor_id')) : null,
        cantidad_actual: Number(form.get('cantidad_actual')) || 0,
        cantidad_minima: Number(form.get('cantidad_minima')) || 0,
        actualizado_en: new Date().toISOString(),
      };
      const { error } = await supabase.from('inventario_bodega').update(payload).eq('id', f.id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Inventario de bodega actualizado.', 'exito');
      overlay.remove();
      await cargarInventarioBodega(elemento);
    });
  }

  pintarVista();
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
// Ejecuta un traslado bodega → habitación (descuenta bodega, suma stock
// de la habitación, deja registro en inventario_movimientos). Se usa
// desde el formulario "Reabastecer habitación" de abajo y también desde
// el botón "Reponer ahora" de "Pendientes de reponer" — así ambos
// caminos comparten exactamente la misma validación de stock de bodega.
// Devuelve true si el traslado se hizo, false si el usuario canceló.
// =========================================================
async function ejecutarReabastecimiento(habitacionId, productoId, cantidad) {
  const usuario = getUsuarioActual();

  const { data: filaBodega, error: errBodega } = await supabase
    .from('inventario_bodega')
    .select('id, cantidad_actual')
    .eq('producto_id', productoId)
    .maybeSingle();
  if (errBodega) {
    mostrarToast(`Error: ${errBodega.message}`, 'error');
    return false;
  }

  const stockBodega = filaBodega?.cantidad_actual || 0;
  if (stockBodega < cantidad) {
    const seguir = await mostrarConfirmacion({
      titulo: 'Stock insuficiente en bodega',
      contenidoHTML: `En bodega solo hay ${stockBodega} unidad(es) registradas de este producto. ¿Continuar de todas formas?`,
      textoConfirmar: 'Continuar',
    });
    if (!seguir) return false;
  }

  if (filaBodega) {
    await supabase
      .from('inventario_bodega')
      .update({ cantidad_actual: stockBodega - cantidad, actualizado_en: new Date().toISOString() })
      .eq('id', filaBodega.id);
  }

  await ajustarInventarioHabitacion(habitacionId, productoId, cantidad, usuario?.id || null, 'reabastecimiento');

  mostrarToast('Habitación reabastecida.', 'exito');
  return true;
}

// Traslado bodega → habitación SIN preguntar por confirmación cuando el
// stock no alcanza — en vez de eso, traslada lo que haya disponible (o
// nada, si no hay) y deja que quien llamó a esta función decida cómo
// avisar. Se usa desde "Reponer todo" para no interrumpir con una
// ventana de confirmación por cada producto pendiente.
async function trasladarSinConfirmar(habitacionId, productoId, cantidadDeseada) {
  const usuario = getUsuarioActual();

  const { data: filaBodega, error } = await supabase
    .from('inventario_bodega')
    .select('id, cantidad_actual')
    .eq('producto_id', productoId)
    .maybeSingle();
  if (error) return { trasladado: 0 };

  const stockBodega = filaBodega?.cantidad_actual || 0;
  const aTrasladar = Math.min(cantidadDeseada, stockBodega);
  if (aTrasladar <= 0) return { trasladado: 0 };

  if (filaBodega) {
    await supabase
      .from('inventario_bodega')
      .update({ cantidad_actual: stockBodega - aTrasladar, actualizado_en: new Date().toISOString() })
      .eq('id', filaBodega.id);
  }

  await ajustarInventarioHabitacion(habitacionId, productoId, aTrasladar, usuario?.id || null, 'reabastecimiento');

  return { trasladado: aTrasladar };
}

// Repone una cantidad ELEGIDA (no necesariamente toda la que falta) de
// bodega a una habitación, SIEMPRE topada a lo que realmente haya en
// bodega — nunca pregunta para dejarla en negativo, nunca la deja en
// negativo. Si la bodega no alcanza para lo pedido, avisa exactamente
// cuánto quedó pendiente. Usada solo por "Reponer" en la tabla de
// Pendientes (ver nota al inicio del archivo, 100).
async function reponerCantidadParcial(habitacionId, productoId, cantidadDeseada) {
  const usuario = getUsuarioActual();

  const { data: filaBodega, error } = await supabase
    .from('inventario_bodega')
    .select('id, cantidad_actual')
    .eq('producto_id', productoId)
    .maybeSingle();
  if (error) {
    mostrarToast(`Error: ${error.message}`, 'error');
    return { trasladado: 0 };
  }

  const stockBodega = filaBodega?.cantidad_actual || 0;
  const aTrasladar = Math.min(cantidadDeseada, stockBodega);

  if (aTrasladar <= 0) {
    mostrarToast('No hay stock disponible en bodega para este producto — queda pendiente.', 'error');
    return { trasladado: 0 };
  }

  await supabase
    .from('inventario_bodega')
    .update({ cantidad_actual: stockBodega - aTrasladar, actualizado_en: new Date().toISOString() })
    .eq('id', filaBodega.id);

  await ajustarInventarioHabitacion(habitacionId, productoId, aTrasladar, usuario?.id || null, 'reabastecimiento');

  if (aTrasladar < cantidadDeseada) {
    mostrarToast(`Se repusieron ${aTrasladar} de ${cantidadDeseada} pedidas — quedan ${cantidadDeseada - aTrasladar} pendiente(s) por falta de stock en bodega.`, 'error');
  } else {
    mostrarToast(`Repuesto: ${aTrasladar} unidad(es).`, 'exito');
  }

  return { trasladado: aTrasladar };
}

// =========================================================
// Vacía el minibar de una habitación: devuelve TODO su stock actual a la
// bodega (suma inventario_bodega, deja la habitación en 0, registra cada
// movimiento con tipo 'vaciado_a_bodega') y desactiva `tiene_minibar` en
// esa habitación. Pensada para habitaciones que se arriendan sin minibar
// (ver nota al inicio del archivo, 115). Exportada porque también se usa
// desde config-habitaciones.js.
// =========================================================
export async function vaciarMinibarHabitacion(habitacionId, usuarioId) {
  const { data: filas, error } = await supabase
    .from('inventario_habitacion')
    .select('id, producto_id, cantidad_actual')
    .eq('habitacion_id', habitacionId)
    .gt('cantidad_actual', 0);

  if (error) {
    return { error, unidades: 0, productos: 0 };
  }

  let totalUnidades = 0;
  let totalProductos = 0;

  for (const fila of filas || []) {
    const cantidad = Number(fila.cantidad_actual);
    if (cantidad <= 0) continue;
    totalUnidades += cantidad;
    totalProductos += 1;

    const { data: filaBodega } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', fila.producto_id)
      .maybeSingle();

    if (filaBodega) {
      await supabase
        .from('inventario_bodega')
        .update({ cantidad_actual: filaBodega.cantidad_actual + cantidad, actualizado_en: new Date().toISOString() })
        .eq('id', filaBodega.id);
    } else {
      await supabase.from('inventario_bodega').insert({
        producto_id: fila.producto_id,
        cantidad_actual: cantidad,
        cantidad_minima: 0,
      });
    }

    await supabase.from('inventario_habitacion').update({ cantidad_actual: 0, actualizado_en: new Date().toISOString() }).eq('id', fila.id);

    await supabase.from('inventario_movimientos').insert({
      tipo: 'vaciado_a_bodega',
      producto_id: fila.producto_id,
      habitacion_id: habitacionId,
      cantidad,
      registrado_por: usuarioId,
    });
  }

  await supabase.from('habitaciones').update({ tiene_minibar: false }).eq('id', habitacionId);

  return { error: null, unidades: totalUnidades, productos: totalProductos };
}

// Refresca todas las secciones que dependen del stock (mapa, bodega,
// pendientes de reponer, inventario por habitación, reposiciones de hoy
// y el log de movimientos) después de cualquier traslado bodega → habitación.
async function refrescarTrasReabastecer() {
  const wrapMapa = document.querySelector('#inv-mapa-wrap');
  if (wrapMapa) await cargarMapaMinibares(wrapMapa);
  const wrapPendientes = document.querySelector('#inv-pendientes-wrap');
  if (wrapPendientes) await cargarPendientesReponer(wrapPendientes);
  const wrapBodega = document.querySelector('#inv-bodega-wrap');
  if (wrapBodega) await cargarInventarioBodega(wrapBodega);
  const wrapHab = document.querySelector('#inv-habitacion-wrap');
  if (wrapHab) await cargarInventarioHabitacion(wrapHab);
  const wrapReposicionesHoy = document.querySelector('#inv-reposiciones-hoy-wrap');
  if (wrapReposicionesHoy) await cargarReposicionesHoy(wrapReposicionesHoy);
  const wrapMov = document.querySelector('#inv-movimientos-wrap');
  if (wrapMov) await cargarMovimientos(wrapMov);
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
    supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero'),
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

    const ok = await ejecutarReabastecimiento(habitacionId, productoId, cantidad);
    if (!ok) return;

    e.target.reset();
    await refrescarTrasReabastecer();
  });
}

// Ajusta (suma o resta) el stock de un producto en una habitación y deja
// registro en inventario_movimientos. delta positivo = entra, negativo = sale.
// A propósito NUNCA toca inventario_bodega — quien la llama decide si
// además debe moverse stock de bodega (ver ejecutarReabastecimiento /
// trasladarSinConfirmar más arriba) o no (ver el editor de "Actual" en
// cargarInventarioHabitacion, que la usa sola para corregir el conteo de
// la habitación sin afectar la bodega).
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
// Pendientes de reponer — vista consolidada de TODAS las habitaciones
// con minibar (ver nota al inicio del archivo), con exportar a Excel y
// "Reponer todo".
// =========================================================
async function cargarPendientesReponer(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Calculando pendientes de reponer…</p>';
  const permitido = puedeGestionar();

  const [{ data: habitaciones, error: errHab }, { data: productos, error: errProd }, { data: filas, error: errFilas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero'),
    supabase.from('minibar_productos').select('id, nombre, categoria, cantidad_estandar').eq('activo', true).gt('cantidad_estandar', 0),
    supabase.from('inventario_habitacion').select('habitacion_id, producto_id, cantidad_actual'),
  ]);

  if (errHab || errProd || errFilas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error calculando pendientes de reponer: ${(errHab || errProd || errFilas).message}</p>`;
    return;
  }

  const actualPorClave = new Map((filas || []).map((f) => [`${f.habitacion_id}_${f.producto_id}`, f.cantidad_actual]));

  const pendientes = [];
  (habitaciones || []).forEach((h) => {
    (productos || []).forEach((p) => {
      const actual = Number(actualPorClave.get(`${h.id}_${p.id}`) ?? 0);
      const estandar = Number(p.cantidad_estandar);
      const falta = estandar - actual;
      if (falta > 0) {
        pendientes.push({
          habitacionId: h.id,
          habitacionLabel: `${h.numero} — ${h.nombre}`,
          productoId: p.id,
          productoNombre: p.nombre,
          categoria: p.categoria,
          actual,
          estandar,
          falta,
        });
      }
    });
  });

  pendientes.sort((a, b) => b.falta - a.falta || a.habitacionLabel.localeCompare(b.habitacionLabel));

  const totalUnidadesFaltantes = pendientes.reduce((sum, x) => sum + x.falta, 0);
  const habitacionesConFaltantes = new Set(pendientes.map((x) => x.habitacionId)).size;

  elemento.innerHTML = `
    <div class="tarjeta" style="${pendientes.length > 0 ? 'border:1.5px solid #f0a8a0; background:var(--color-alerta-fondo, #fdecea);' : ''}">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem; flex-wrap:wrap;">
        <h3 style="margin:0;">🔴 Pendientes de reponer en minibares</h3>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          ${pendientes.length > 0 ? `<span class="stat-card-valor" style="font-size:1.3rem; color:var(--color-rojo-oscuro);">${totalUnidadesFaltantes} unidad(es)</span>` : ''}
          ${pendientes.length > 0 ? '<button type="button" id="btn-exportar-pendientes" class="btn btn-secundario btn-chico">⬇ Excel</button>' : ''}
          ${permitido && pendientes.length > 0 ? '<button type="button" id="btn-reponer-todo" class="btn btn-primario btn-chico">✅ Reponer todo</button>' : ''}
        </div>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">Compara el stock actual de cada habitación contra su cantidad estándar de minibar — incluye habitaciones que todavía no se han inventariado. ${pendientes.length > 0 ? `Afecta a ${habitacionesConFaltantes} habitación(es).` : ''}</p>
      ${
        pendientes.length === 0
          ? '<p class="mensaje-vacio">✅ Todas las habitaciones están completas según su estándar de minibar.</p>'
          : `
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead>
              <tr>
                <th>Habitación</th>
                <th>Producto</th>
                <th>Actual</th>
                <th>Estándar</th>
                <th>Falta</th>
                ${permitido ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${pendientes
                .map(
                  (x) => `<tr data-habitacion-id="${x.habitacionId}" data-producto-id="${x.productoId}" data-falta="${x.falta}">
                <td>${escaparHTML(x.habitacionLabel)}</td>
                <td>${escaparHTML(x.productoNombre)} <span class="mensaje-vacio">(${escaparHTML(x.categoria)})</span></td>
                <td>${x.actual}</td>
                <td>${x.estandar}</td>
                <td style="font-weight:700; color:var(--color-rojo-oscuro);">${x.falta}</td>
                ${
                  permitido
                    ? `<td style="white-space:nowrap;">
                        <input type="number" class="input-cantidad-reponer" min="1" value="${x.falta}" style="width:55px; margin-right:0.4rem;" title="Cantidad a reponer (puedes bajarla si no hay suficiente en bodega)" />
                        <button type="button" class="btn-editar btn-reponer-ahora">Reponer</button>
                      </td>`
                    : ''
                }
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  const btnExportar = elemento.querySelector('#btn-exportar-pendientes');
  if (btnExportar) {
    btnExportar.addEventListener('click', () => {
      descargarCSV(`pendientes_reponer_${toISODate(new Date())}.csv`, [
        ['Pendientes de reponer en minibares — Santa Ana House 21'],
        ['Generado', formatFechaHora(new Date().toISOString())],
        ['Total unidades faltantes', totalUnidadesFaltantes],
        ['Habitaciones afectadas', habitacionesConFaltantes],
        [],
        ['Habitación', 'Producto', 'Categoría', 'Actual', 'Estándar', 'Falta'],
        ...pendientes.map((x) => [x.habitacionLabel, x.productoNombre, x.categoria, x.actual, x.estandar, x.falta]),
      ]);
    });
  }

  if (!permitido) return;

  elemento.querySelectorAll('.btn-reponer-ahora').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const habitacionId = Number(fila.dataset.habitacionId);
      const productoId = Number(fila.dataset.productoId);
      const inputCantidad = fila.querySelector('.input-cantidad-reponer');
      const cantidad = Math.max(1, Number(inputCantidad.value) || 0);
      btn.disabled = true;
      await reponerCantidadParcial(habitacionId, productoId, cantidad);
      await refrescarTrasReabastecer();
    });
  });

  const btnReponerTodo = elemento.querySelector('#btn-reponer-todo');
  if (btnReponerTodo) {
    btnReponerTodo.addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Reponer todo',
        contenidoHTML: `Vas a trasladar de bodega a habitación <strong>${totalUnidadesFaltantes} unidad(es)</strong> repartidas en <strong>${habitacionesConFaltantes} habitación(es)</strong>, cubriendo todos los pendientes de la lista. Usa esto después de haber hecho la reposición física — ¿confirmas que ya se hizo y quieres actualizar el sistema?`,
        textoConfirmar: 'Sí, reponer todo',
      });
      if (!ok) return;

      btnReponerTodo.disabled = true;
      btnReponerTodo.textContent = 'Reponiendo…';

      let totalTrasladado = 0;
      const incompletos = [];

      for (const item of pendientes) {
        const resultado = await trasladarSinConfirmar(item.habitacionId, item.productoId, item.falta);
        totalTrasladado += resultado.trasladado;
        if (resultado.trasladado < item.falta) {
          incompletos.push(`${item.productoNombre} (${item.habitacionLabel}): faltó ${item.falta - resultado.trasladado}`);
        }
      }

      if (incompletos.length > 0) {
        mostrarToast(
          `Se repusieron ${totalTrasladado} unidad(es). Sin stock suficiente en bodega para: ${incompletos.slice(0, 5).join('; ')}${incompletos.length > 5 ? '…' : ''}`,
          'error'
        );
      } else {
        mostrarToast(`Reposición completa: ${totalTrasladado} unidad(es) trasladadas a los minibares.`, 'exito');
      }

      await refrescarTrasReabastecer();
    });
  }
}

// =========================================================
// Reposiciones de hoy — resumen rápido para el cierre del día (ver nota
// al inicio del archivo).
// =========================================================
async function cargarReposicionesHoy(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString();
  const inicioManana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1).toISOString();

  const { data: movimientos, error } = await supabase
    .from('inventario_movimientos')
    .select('*, minibar_productos(nombre, categoria), habitaciones(numero, nombre)')
    .eq('tipo', 'reabastecimiento')
    .gte('creado_en', inicioHoy)
    .lt('creado_en', inicioManana)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando las reposiciones de hoy: ${error.message}</p>`;
    return;
  }

  const filas = movimientos || [];
  const totalUnidades = filas.reduce((sum, m) => sum + Number(m.cantidad), 0);

  const porProducto = new Map();
  filas.forEach((m) => {
    const nombre = m.minibar_productos?.nombre || 'Producto';
    porProducto.set(nombre, (porProducto.get(nombre) || 0) + Number(m.cantidad));
  });
  const resumenProductos = Array.from(porProducto.entries()).sort((a, b) => b[1] - a[1]);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem;">
        <h3 style="margin:0;">📤 Reposiciones de hoy (bodega → habitaciones)</h3>
        <span class="stat-card-valor" style="font-size:1.3rem; color:var(--color-verde-oscuro);">${totalUnidades} unidad(es)</span>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">Todo lo que salió hoy de la bodega principal para reponer los minibares — para el cierre del día, sin tener que rebuscar en "Movimientos recientes".</p>
      ${
        filas.length === 0
          ? '<p class="mensaje-vacio">Todavía no se ha reabastecido ninguna habitación hoy.</p>'
          : `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.75rem; margin-bottom:1rem;">
          ${resumenProductos
            .map(
              ([nombre, cantidad]) => `
            <div class="stat-card">
              <div class="stat-card-label">${escaparHTML(nombre)}</div>
              <div class="stat-card-valor" style="font-size:1.4rem;">${cantidad}</div>
            </div>
          `
            )
            .join('')}
        </div>
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead><tr><th>Hora</th><th>Habitación</th><th>Producto</th><th>Cantidad</th></tr></thead>
            <tbody>
              ${filas
                .map(
                  (m) => `<tr>
                <td>${formatFechaHora(m.creado_en)}</td>
                <td>${m.habitaciones ? `${escaparHTML(m.habitaciones.numero)} — ${escaparHTML(m.habitaciones.nombre)}` : '—'}</td>
                <td>${escaparHTML(m.minibar_productos?.nombre || '—')}</td>
                <td style="font-weight:700;">${m.cantidad}</td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;
}

// =========================================================
// Inventario por habitación (ver nota 119 al inicio del archivo):
// consulta de SOLO LECTURA — la edición manual de "Actual" se quitó
// porque el conteo ya se carga completo desde el mapa/Excel y ya no
// hace falta corregirlo aquí a mano. Solo muestra habitaciones con
// minibar habilitado (ver 109/111). Incluye el botón "🧹 Vaciar
// minibar" (ver nota 115 al inicio del archivo), que sigue funcionando
// igual.
// =========================================================
async function cargarInventarioHabitacion(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const { data: habitaciones, error: errHab } = await supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero');
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

    // A propósito trae TODO el catálogo activo (no solo lo que ya tenga
    // fila en inventario_habitacion) para poder cargar el conteo real de
    // un producto que esta habitación nunca había tenido inventariado.
    const [{ data: productos, error: errProd }, { data: filas, error: errFilas }] = await Promise.all([
      supabase.from('minibar_productos').select('id, nombre, categoria, cantidad_estandar').eq('activo', true).order('categoria').order('nombre'),
      supabase.from('inventario_habitacion').select('producto_id, cantidad_actual').eq('habitacion_id', habitacionId),
    ]);

    if (errProd || errFilas) {
      detalle.innerHTML = `<p class="mensaje-vacio">Error: ${(errProd || errFilas).message}</p>`;
      return;
    }

    const actualPorProducto = new Map((filas || []).map((f) => [f.producto_id, f.cantidad_actual]));
    const permitidoGestionar = puedeGestionar();

    detalle.innerHTML = `
      ${
        permitidoGestionar
          ? `<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; margin-bottom:0.5rem;">
              <p class="mensaje-vacio" style="margin:0; max-width:640px;">Consulta de solo lectura — el conteo se actualiza automáticamente con cada consumo, reposición o carga de inventario.</p>
              <button type="button" id="btn-vaciar-minibar" class="btn btn-secundario btn-chico" style="white-space:nowrap;">🧹 Vaciar minibar</button>
            </div>`
          : ''
      }
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
              (productos || [])
                .map((p) => {
                  const actual = Number(actualPorProducto.get(p.id) ?? 0);
                  const estandar = Number(p.cantidad_estandar ?? 0);
                  const falta = actual < estandar;
                  return `<tr>
                    <td>${escaparHTML(p.categoria)}</td>
                    <td>${escaparHTML(p.nombre)}</td>
                    <td>${actual}</td>
                    <td>${estandar}</td>
                    <td>${falta ? '⚠️ Reponer' : '✅'}</td>
                  </tr>`;
                })
                .join('') || `<tr><td colspan="5" class="mensaje-vacio">Sin productos activos en el catálogo.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    if (!permitidoGestionar) return;

    const btnVaciar = detalle.querySelector('#btn-vaciar-minibar');
    if (btnVaciar) {
      btnVaciar.addEventListener('click', async () => {
        const habLabel = select.options[select.selectedIndex]?.textContent || '';
        const ok = await mostrarConfirmacion({
          titulo: 'Vaciar minibar',
          contenidoHTML: `Vas a devolver <strong>todo</strong> el stock actual del minibar de <strong>${escaparHTML(habLabel)}</strong> a la bodega, dejarla en 0 y desactivar su minibar (deja de aparecer en Pendientes/Mapa hasta que se reactive en Configuración). Úsalo cuando la habitación se arriende sin minibar. ¿Confirmas?`,
          textoConfirmar: 'Sí, vaciar',
        });
        if (!ok) return;

        btnVaciar.disabled = true;
        const usuario = getUsuarioActual();
        const resultado = await vaciarMinibarHabitacion(habitacionId, usuario?.id || null);
        if (resultado.error) {
          mostrarToast(`Error: ${resultado.error.message}`, 'error');
          btnVaciar.disabled = false;
          return;
        }

        mostrarToast(
          resultado.unidades > 0
            ? `Minibar vaciado: ${resultado.unidades} unidad(es) de ${resultado.productos} producto(s) devueltas a bodega. Minibar desactivado.`
            : 'La habitación ya no tenía existencias — minibar desactivado.',
          'exito'
        );

        // Recarga toda la sección (no solo el detalle) para que el
        // selector deje de listar esta habitación, ya que quedó sin
        // minibar.
        await cargarInventarioHabitacion(elemento);
        const wrapMapa = document.querySelector('#inv-mapa-wrap');
        if (wrapMapa) await cargarMapaMinibares(wrapMapa);
        const wrapPendientes = document.querySelector('#inv-pendientes-wrap');
        if (wrapPendientes) await cargarPendientesReponer(wrapPendientes);
        const wrapBodega = document.querySelector('#inv-bodega-wrap');
        if (wrapBodega) await cargarInventarioBodega(wrapBodega);
        const wrapMov = document.querySelector('#inv-movimientos-wrap');
        if (wrapMov) await cargarMovimientos(wrapMov);
      });
    }
  }

  if (habitaciones && habitaciones.length > 0) {
    await pintarDetalle(habitaciones[0].id);
    select.addEventListener('change', () => pintarDetalle(Number(select.value)));
  } else {
    detalle.innerHTML = '<p class="mensaje-vacio">No hay habitaciones con minibar habilitado.</p>';
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
    vaciado_a_bodega: 'Vaciado a bodega',
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
