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
// Nota sobre "tiene_minibar" (ver 109/111): las habitaciones 301 y 303
// son de uso administrativo y no tienen minibar — "Pendientes de
// reponer", "Reabastecer habitación", el selector de "Inventario por
// habitación" y el nuevo "Mapa de minibares" de abajo YA NO las
// incluyen, filtrando siempre por `tiene_minibar = true`. Si en el
// futuro se habilita el minibar en alguna de esas habitaciones, basta
// con marcar la casilla correspondiente en Configuración → Habitaciones.
//
// Nota sobre "🗺️ Mapa de minibares" (nuevo, 111): vista de cuadrícula —
// un producto por fila, una habitación por columna — inspirada en el
// Excel de conteo físico que se usaba en papel, pero con números reales
// en vez de solo ✓/X. Verde = completo, ámbar = a medias (muestra
// "actual/estándar"), rojo = no queda nada. Pensada para verse todo el
// panorama de un vistazo, sin tener que ir producto por producto o
// habitación por habitación; "Pendientes de reponer" (más abajo) sigue
// siendo la vista de trabajo para efectivamente reponer.

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

  function celda(habitacionId, producto) {
    const actual = Number(actualPorClave.get(`${habitacionId}_${producto.id}`) ?? 0);
    const estandar = Number(producto.cantidad_estandar);
    let estilo = ESTILO_COMPLETO;
    let texto = '✓';
    if (actual <= 0) {
      estilo = ESTILO_FALTA;
      texto = '✗';
    } else if (actual < estandar) {
      estilo = ESTILO_PARCIAL;
      texto = `${actual}/${estandar}`;
    }
    return `<td style="${ESTILO_CELDA_BASE}${estilo}" title="${escaparHTML(producto.nombre)}: ${actual} de ${estandar}">${texto}</td>`;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem; flex-wrap:wrap;">
        <h3 style="margin:0;">🗺️ Mapa de minibares</h3>
        <div style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; font-size:0.85rem;">
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#e6f4ea;border:1px solid #1e7e34;margin-right:4px;vertical-align:middle;"></span>Completo</span>
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fff4d6;border:1px solid #8a5a00;margin-right:4px;vertical-align:middle;"></span>A medias</span>
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:var(--color-alerta-fondo, #fdecea);border:1px solid var(--color-rojo-oscuro, #c0392b);margin-right:4px;vertical-align:middle;"></span>Falta todo</span>
        </div>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">De un vistazo: qué hay y qué falta en cada minibar, comparado contra el estándar (no incluye 301/303, sin minibar). Para reponer, usa "Pendientes de reponer" más abajo.</p>
      <div class="tabla-scroll" style="max-height:520px; overflow:auto;">
        <table class="tabla-simple" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="${ESTILO_COL_PRODUCTO} z-index:2;">Producto</th>
              ${(habitaciones || []).map((h) => `<th style="text-align:center; min-width:52px;">${escaparHTML(h.numero)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${
              (productos || []).length === 0 || (habitaciones || []).length === 0
                ? `<tr><td colspan="${(habitaciones || []).length + 1}" class="mensaje-vacio">Sin datos suficientes para mostrar el mapa.</td></tr>`
                : (productos || [])
                    .map(
                      (p) => `<tr>
                <td style="${ESTILO_COL_PRODUCTO}">${escaparHTML(p.nombre)} <span class="mensaje-vacio">(${escaparHTML(p.categoria)})</span></td>
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
// Inventario por habitación (ver 096: "Actual" es editable directo,
// sin tocar bodega — ver nota al inicio del archivo). Solo muestra
// habitaciones con minibar habilitado (ver 109/111).
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
    const permitidoEditar = puedeGestionar();

    detalle.innerHTML = `
      ${
        permitidoEditar
          ? '<p class="mensaje-vacio" style="margin-top:-0.4rem; margin-bottom:0.75rem;">Edita "Actual" y dale Guardar para dejar el conteo físico real de esta habitación — esto <strong>no saca nada de bodega</strong>, solo corrige el número de la habitación. Para trasladar stock real de bodega a la habitación, usa "Reabastecer habitación" o "Pendientes de reponer" más arriba.</p>'
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
              ${permitidoEditar ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (productos || [])
                .map((p) => {
                  const actual = Number(actualPorProducto.get(p.id) ?? 0);
                  const estandar = Number(p.cantidad_estandar ?? 0);
                  const falta = actual < estandar;
                  return `<tr data-producto-id="${p.id}" data-actual="${actual}">
                    <td>${escaparHTML(p.categoria)}</td>
                    <td>${escaparHTML(p.nombre)}</td>
                    <td>${permitidoEditar ? `<input type="number" class="input-actual-habitacion" min="0" value="${actual}" style="width:70px" />` : actual}</td>
                    <td>${estandar}</td>
                    <td>${falta ? '⚠️ Reponer' : '✅'}</td>
                    ${permitidoEditar ? `<td><button type="button" class="btn-editar btn-guardar-conteo-habitacion">Guardar</button></td>` : ''}
                  </tr>`;
                })
                .join('') || `<tr><td colspan="${permitidoEditar ? 6 : 5}" class="mensaje-vacio">Sin productos activos en el catálogo.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    if (!permitidoEditar) return;

    detalle.querySelectorAll('.btn-guardar-conteo-habitacion').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const fila = e.target.closest('tr');
        const productoId = Number(fila.dataset.productoId);
        const actualAnterior = Number(fila.dataset.actual);
        const input = fila.querySelector('.input-actual-habitacion');
        const nuevoValor = Math.max(0, Number(input.value) || 0);
        const delta = nuevoValor - actualAnterior;

        if (delta === 0) {
          mostrarToast('Ese producto ya tenía esa cantidad.', 'exito');
          return;
        }

        const usuario = getUsuarioActual();
        btn.disabled = true;
        try {
          // 'ajuste_habitacion': el mismo tipo que usa minibar.js al
          // revertir un consumo eliminado — SOLO toca
          // inventario_habitacion, nunca inventario_bodega.
          await ajustarInventarioHabitacion(habitacionId, productoId, delta, usuario?.id || null, 'ajuste_habitacion');
        } catch (errAjuste) {
          mostrarToast(`Error guardando el conteo: ${errAjuste.message}`, 'error');
          btn.disabled = false;
          return;
        }

        mostrarToast('Conteo de la habitación actualizado (no se tocó la bodega).', 'exito');
        await pintarDetalle(habitacionId);

        const wrapMapa = document.querySelector('#inv-mapa-wrap');
        if (wrapMapa) await cargarMapaMinibares(wrapMapa);
        const wrapPendientes = document.querySelector('#inv-pendientes-wrap');
        if (wrapPendientes) await cargarPendientesReponer(wrapPendientes);
        const wrapMov = document.querySelector('#inv-movimientos-wrap');
        if (wrapMov) await cargarMovimientos(wrapMov);
      });
    });
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
