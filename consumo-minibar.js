// consumo-minibar.js
//
// Módulo compartido (147): registrar consumo de minibar para una
// habitación en uso — MISMA tarjeta emergente y misma lógica sin importar
// si se abre desde Minibar → "🥤 Registrar consumo" (elige la habitación
// dentro del modal, entre todas las que están en uso) o desde Recepción →
// "➕ Consumo" en la tabla de habitaciones en uso (la habitación ya viene
// fija, no se pregunta).
//
// Antes cada pantalla tenía su propio formulario: Minibar armaba una
// lista de productos completa pero guardaba cada línea de una sin
// confirmar nada, y Recepción abría un formulario de una sola línea con
// el PRIMER producto del catálogo y cantidad=1 ya precargados — un envío
// accidental (o sin fijarse) podía registrar un consumo que no era. Ahora
// es un flujo de 2 pasos, igual en ambos lugares:
//   1. Se arma la lista de productos SIN nada preseleccionado (hay que
//      elegir producto y escribir cantidad a propósito en cada línea).
//   2. Antes de guardar, se muestra un resumen (habitación, huésped,
//      productos, total) para confirmar — "← Volver a editar" regresa al
//      formulario sin perder lo ya digitado.
//
// Cada consumo registrado (una o varias líneas a la vez) queda agrupado
// con un `grupo_venta` (UUID) para poder editarlo o eliminarlo COMPLETO
// más adelante — `cargarListaVentasMinibar` pinta ese listado con botones
// "✏️ Editar" / "🗑 Eliminar", revirtiendo siempre el descuento que se
// había hecho en su momento al inventario de la habitación antes de
// aplicar el cambio. Requiere la columna `grupo_venta` en
// minibar_consumos — ver sql/146_grupo_compra_y_grupo_venta.sql.
//
// Las líneas registradas ANTES de este cambio (grupo_venta = NULL) se
// siguen viendo en el listado (cada una como su propio grupo de 1) y se
// pueden eliminar, pero no editar como grupo (no hay forma de saber
// cuáles iban juntas en la venta original).
//
// Nota (200 / auditoría H12): se sigue permitiendo que un consumo deje
// el minibar de la habitación en negativo (puede ser real — faltó
// reponer a tiempo), pero ya no en silencio: antes de abrir el resumen
// de confirmación se revisa el stock actual de la habitación contra lo
// que se va a consumir, y si algún producto quedaría en negativo se
// avisa cuál y en cuánto, dejando cancelar si en realidad fue un error
// de digitación. Además, "Alertas de inventario" (inventario.js) ahora
// también detecta minibares de habitaciones ACTIVAS que ya quedaron en
// negativo (antes solo miraba bodega y habitaciones desactivadas).

import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { ajustarInventarioHabitacion } from './inventario.js';

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function generarGrupoVenta() {
  return (crypto.randomUUID && crypto.randomUUID()) || `venta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// =========================================================
// Paso 1: formulario de líneas (producto + cantidad), sin nada
// preseleccionado. Si `habitacionesEnUso` viene con datos, el modal
// incluye el selector de habitación (uso desde Minibar); si no, se
// asume que la habitación ya viene fija (uso desde Recepción) y solo se
// muestra como texto de contexto.
// =========================================================
function abrirModalLineasConsumo({ titulo, habitacionesEnUso, habitacionSeleccionadaId, habitacionLabel, huespedNombre, productos, categorias, lineasIniciales, textoBoton, onContinuar }) {
  const necesitaSelector = Array.isArray(habitacionesEnUso);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>${titulo}</h3>
      ${
        necesitaSelector
          ? `<label>Habitación
              <select id="select-habitacion-consumo" required>
                <option value="" disabled ${habitacionSeleccionadaId ? '' : 'selected'}>— Selecciona —</option>
                ${habitacionesEnUso
                  .map((h) => `<option value="${h.checkinId}" ${habitacionSeleccionadaId === h.checkinId ? 'selected' : ''}>${escaparHTML(h.habitacionLabel)} — ${escaparHTML(h.huespedNombre)}</option>`)
                  .join('')}
              </select>
            </label>`
          : `<p class="mensaje-vacio" style="margin-top:-0.5rem;">${escaparHTML(habitacionLabel)}${huespedNombre ? ` — ${escaparHTML(huespedNombre)}` : ''}</p>`
      }
      <p style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-texto-suave); margin:1rem 0 0.4rem;">Productos</p>
      <div id="lineas-consumo-wrap"></div>
      <button type="button" id="btn-agregar-linea-consumo" class="btn btn-secundario btn-chico">+ Agregar producto</button>
      <div class="modal-acciones" style="justify-content:space-between; margin-top:1.25rem; align-items:center;">
        <strong id="total-consumo-vista">${formatCOP(0)}</strong>
        <div style="display:flex; gap:0.5rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-lineas-consumo">Cancelar</button>
          <button type="button" class="btn btn-primario" id="btn-continuar-lineas-consumo">${textoBoton}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const wrap = overlay.querySelector('#lineas-consumo-wrap');
  const totalEl = overlay.querySelector('#total-consumo-vista');

  function actualizarTotal() {
    let total = 0;
    wrap.querySelectorAll('.fila-linea-consumo').forEach((fila) => {
      const productoId = Number(fila.querySelector('.select-producto-consumo').value);
      const cantidad = Number(fila.querySelector('.input-cantidad-consumo').value) || 0;
      const producto = productos.find((p) => p.id === productoId);
      if (producto) total += producto.precio * cantidad;
    });
    totalEl.textContent = formatCOP(total);
  }

  function crearFila(lineaInicial) {
    const fila = document.createElement('div');
    fila.className = 'form-grid fila-linea-consumo';
    fila.style.cssText = 'grid-template-columns:2fr 1fr auto; align-items:end; margin-bottom:0.6rem;';
    fila.innerHTML = `
      <label>Producto
        <select class="select-producto-consumo" required>
          <option value="" disabled ${lineaInicial ? '' : 'selected'}>— Selecciona —</option>
          ${categorias
            .map(
              (cat) => `
            <optgroup label="${escaparHTML(cat)}">
              ${productos
                .filter((p) => p.categoria === cat)
                .map((p) => `<option value="${p.id}" ${lineaInicial?.producto_id === p.id ? 'selected' : ''}>${escaparHTML(p.nombre)} — ${formatCOP(p.precio)}</option>`)
                .join('')}
            </optgroup>
          `
            )
            .join('')}
        </select>
      </label>
      <label>Cantidad
        <input type="number" class="input-cantidad-consumo" min="1" placeholder="Ej: 2" value="${lineaInicial ? lineaInicial.cantidad : ''}" required />
      </label>
      <button type="button" class="btn-editar btn-quitar-linea-consumo">Quitar</button>
    `;
    fila.querySelector('.select-producto-consumo').addEventListener('change', actualizarTotal);
    fila.querySelector('.input-cantidad-consumo').addEventListener('input', actualizarTotal);
    fila.querySelector('.btn-quitar-linea-consumo').addEventListener('click', () => {
      if (wrap.querySelectorAll('.fila-linea-consumo').length <= 1) {
        mostrarToast('Debe quedar al menos un producto en el consumo.', 'error');
        return;
      }
      fila.remove();
      actualizarTotal();
    });
    return fila;
  }

  (lineasIniciales && lineasIniciales.length > 0 ? lineasIniciales : [null]).forEach((li) => wrap.appendChild(crearFila(li)));
  actualizarTotal();

  overlay.querySelector('#btn-agregar-linea-consumo').addEventListener('click', () => {
    wrap.appendChild(crearFila(null));
    actualizarTotal();
  });

  overlay.querySelector('#btn-cancelar-lineas-consumo').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#btn-continuar-lineas-consumo').addEventListener('click', () => {
    let habSeleccionada = null;
    if (necesitaSelector) {
      const checkinId = Number(overlay.querySelector('#select-habitacion-consumo').value);
      habSeleccionada = habitacionesEnUso.find((h) => h.checkinId === checkinId);
      if (!habSeleccionada) {
        mostrarToast('Selecciona una habitación.', 'error');
        return;
      }
      if (!habSeleccionada.reservaId) {
        mostrarToast('Esta habitación no tiene una reserva vinculada; no se puede registrar consumo.', 'error');
        return;
      }
    }

    const filas = [...wrap.querySelectorAll('.fila-linea-consumo')];
    const lineas = [];
    for (const fila of filas) {
      const productoId = Number(fila.querySelector('.select-producto-consumo').value);
      const cantidad = Number(fila.querySelector('.input-cantidad-consumo').value);
      if (!productoId) {
        mostrarToast('Falta elegir un producto en una de las líneas.', 'error');
        return;
      }
      if (!cantidad || cantidad <= 0) {
        mostrarToast('Falta una cantidad válida en una de las líneas.', 'error');
        return;
      }
      lineas.push({ productoId, cantidad, producto: productos.find((p) => p.id === productoId) });
    }

    overlay.remove();
    onContinuar(lineas, habSeleccionada);
  });
}

// =========================================================
// Paso 2: resumen de confirmación antes de guardar de verdad.
// =========================================================
function abrirModalResumenConsumo({ habitacionLabel, huespedNombre, lineas, textoConfirmar, onVolver, onConfirmar }) {
  const total = lineas.reduce((sum, l) => sum + l.producto.precio * l.cantidad, 0);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>Confirmar consumo</h3>
      <p class="mensaje-vacio" style="margin-top:-0.5rem;">${escaparHTML(habitacionLabel)}${huespedNombre ? ` — ${escaparHTML(huespedNombre)}` : ''}</p>
      <div class="modal-contenido">
        <table class="tabla-simple">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${lineas.map((l) => `<tr><td>${escaparHTML(l.producto.nombre)}</td><td>${l.cantidad}</td><td class="monto">${formatCOP(l.producto.precio * l.cantidad)}</td></tr>`).join('')}
          </tbody>
        </table>
        <p style="text-align:right; font-size:1.15rem; font-weight:700; margin-top:0.5rem;">Total: ${formatCOP(total)}</p>
      </div>
      <div class="modal-acciones">
        <button type="button" class="btn btn-secundario" id="btn-volver-resumen-consumo">← Volver a editar</button>
        <button type="button" class="btn btn-primario" id="btn-confirmar-resumen-consumo">${textoConfirmar}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-volver-resumen-consumo').addEventListener('click', () => {
    overlay.remove();
    onVolver();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#btn-confirmar-resumen-consumo').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirmar-resumen-consumo');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    await onConfirmar();
    overlay.remove();
  });
}

async function guardarConsumoNuevo({ habitacionId, reservaId, lineas }) {
  const usuario = getUsuarioActual();
  const grupoVenta = generarGrupoVenta();

  for (const linea of lineas) {
    await supabase.from('minibar_consumos').insert({
      reserva_id: reservaId,
      habitacion_id: habitacionId,
      producto_id: linea.productoId,
      cantidad: linea.cantidad,
      precio_unitario: linea.producto.precio,
      monto: linea.producto.precio * linea.cantidad,
      registrado_por: usuario?.id || null,
      grupo_venta: grupoVenta,
    });
    try {
      await ajustarInventarioHabitacion(habitacionId, linea.productoId, -linea.cantidad, usuario?.id || null, 'consumo');
    } catch (errInv) {
      // No bloquea el registro del consumo — igual que antes, es un
      // registro complementario para saber qué reponer.
    }
  }
}

/**
 * Abre el flujo completo de "Registrar consumo" (líneas → resumen →
 * guardar). Dos formas de usarla:
 *  - Con `habitacionesEnUso` (arreglo): el modal pregunta la habitación
 *    (uso desde Minibar → "🥤 Registrar consumo").
 *  - Con `habitacionId` + `reservaId` fijos (sin `habitacionesEnUso`): la
 *    habitación ya viene decidida, no se pregunta (uso desde Recepción →
 *    "➕ Consumo" en una fila puntual).
 * `onGuardado()` se llama después de guardar con éxito.
 */
export function abrirModalRegistrarConsumo(opciones) {
  const { habitacionesEnUso, onGuardado } = opciones;
  const { habitacionId, reservaId, habitacionLabel, huespedNombre } = opciones;

  if (!habitacionesEnUso && !reservaId) {
    mostrarToast('Esta habitación no tiene una reserva vinculada; no se puede registrar consumo.', 'error');
    return;
  }
  if (habitacionesEnUso && habitacionesEnUso.length === 0) {
    mostrarToast('No hay habitaciones ocupadas ahora mismo.', 'error');
    return;
  }

  cargarProductosYAbrir();

  async function cargarProductosYAbrir() {
    const { data: productos, error } = await supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre');
    if (error) {
      mostrarToast(`Error cargando productos: ${error.message}`, 'error');
      return;
    }
    const categorias = [...new Set((productos || []).map((p) => p.categoria))];
    abrirFormulario([], habitacionId);

    function abrirFormulario(lineasPrevias, habitacionSeleccionadaId) {
      abrirModalLineasConsumo({
        titulo: '🥤 Registrar consumo',
        habitacionesEnUso,
        habitacionSeleccionadaId,
        habitacionLabel,
        huespedNombre,
        productos: productos || [],
        categorias,
        lineasIniciales: lineasPrevias.map((l) => ({ producto_id: l.productoId, cantidad: l.cantidad })),
        textoBoton: 'Continuar',
        onContinuar: async (lineas, habSeleccionada) => {
          const habFinal = habitacionesEnUso
            ? { habitacionId: habSeleccionada.habitacionId, reservaId: habSeleccionada.reservaId, habitacionLabel: habSeleccionada.habitacionLabel, huespedNombre: habSeleccionada.huespedNombre }
            : { habitacionId, reservaId, habitacionLabel, huespedNombre };

          // (200 / auditoría H12) Se permite quedar en negativo (puede
          // ser un consumo real sin que alguien haya repuesto todavía),
          // pero ya no en silencio: se avisa ANTES de guardar cuáles
          // productos quedarían en negativo y en cuánto, para poder
          // cancelar si en realidad es un error de digitación.
          const { data: stockActual } = await supabase
            .from('inventario_habitacion')
            .select('producto_id, cantidad_actual')
            .eq('habitacion_id', habFinal.habitacionId);
          const stockPorProducto = new Map((stockActual || []).map((s) => [s.producto_id, Number(s.cantidad_actual)]));
          const quedaranNegativos = lineas
            .map((l) => ({ nombre: l.producto.nombre, resultado: (stockPorProducto.get(l.productoId) || 0) - l.cantidad }))
            .filter((r) => r.resultado < 0);
          if (quedaranNegativos.length > 0) {
            const ok = await mostrarConfirmacion({
              titulo: 'Esto dejará el minibar en negativo',
              contenidoHTML: `Después de este consumo, ${habFinal.habitacionLabel} quedaría así: <ul style="margin:0.5rem 0 0; padding-left:1.2rem;">${quedaranNegativos
                .map((r) => `<li>${escaparHTML(r.nombre)}: ${r.resultado}</li>`)
                .join('')}</ul> Puede ser normal si falta reponer — pero si fue un error de digitación, mejor revisar la cantidad. ¿Continuar de todas formas?`,
              textoConfirmar: 'Sí, continuar',
            });
            if (!ok) return;
          }

          abrirModalResumenConsumo({
            habitacionLabel: habFinal.habitacionLabel,
            huespedNombre: habFinal.huespedNombre,
            lineas,
            textoConfirmar: '✅ Confirmar consumo',
            onVolver: () => abrirFormulario(lineas, habFinal.habitacionId),
            onConfirmar: async () => {
              await guardarConsumoNuevo({ habitacionId: habFinal.habitacionId, reservaId: habFinal.reservaId, lineas });
              mostrarToast(`Consumo registrado — ${habFinal.habitacionLabel}: ${lineas.length} producto(s).`, 'exito');
              await onGuardado();
            },
          });
        },
      });
    }
  }
}

// =========================================================
// Edición y eliminación de una venta ya registrada (grupo_venta) — mismo
// flujo de líneas → resumen para editar, con reversión del inventario
// antes de aplicar los cambios nuevos.
// =========================================================
async function guardarEdicionVenta(grupo, lineasNuevas) {
  const usuario = getUsuarioActual();

  // 1) Revertir el efecto de las líneas ANTERIORES sobre el inventario de
  // la habitación (les devuelve lo que en su momento se descontó).
  for (const fila of grupo.filas) {
    try {
      await ajustarInventarioHabitacion(fila.habitacion_id, fila.producto_id, fila.cantidad, usuario?.id || null, 'ajuste_habitacion');
    } catch (errInv) {
      // continúa igual — si algo queda inconsistente, sigue siendo
      // corregible a mano desde Bodega/Mapa de minibares.
    }
  }

  // 2) Borrar las filas anteriores de este grupo.
  const idsAnteriores = grupo.filas.map((f) => f.id);
  await supabase.from('minibar_consumos').delete().in('id', idsAnteriores);

  // 3) Insertar las líneas NUEVAS con el mismo grupo_venta (o uno nuevo si
  // el grupo original era una fila suelta de antes de este cambio, sin
  // grupo_venta todavía).
  const grupoVenta = grupo.grupoVenta || generarGrupoVenta();
  const habitacionId = grupo.filas[0].habitacion_id;
  const reservaId = grupo.filas[0].reserva_id;

  for (const linea of lineasNuevas) {
    await supabase.from('minibar_consumos').insert({
      reserva_id: reservaId,
      habitacion_id: habitacionId,
      producto_id: linea.productoId,
      cantidad: linea.cantidad,
      precio_unitario: linea.producto.precio,
      monto: linea.producto.precio * linea.cantidad,
      registrado_por: usuario?.id || null,
      grupo_venta: grupoVenta,
    });
    try {
      await ajustarInventarioHabitacion(habitacionId, linea.productoId, -linea.cantidad, usuario?.id || null, 'consumo');
    } catch (errInv) {
      // no bloquea
    }
  }
}

async function abrirModalEditarVenta(grupo, hab, onListo) {
  const { data: productos, error } = await supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre');
  if (error) {
    mostrarToast(`Error cargando productos: ${error.message}`, 'error');
    return;
  }
  const categorias = [...new Set((productos || []).map((p) => p.categoria))];
  const habitacionLabel = hab ? hab.habitacionLabel : '—';
  const huespedNombre = hab ? hab.huespedNombre : '';

  abrirFormulario(
    grupo.filas.map((f) => ({
      productoId: f.producto_id,
      cantidad: f.cantidad,
      producto: (productos || []).find((p) => p.id === f.producto_id) || { id: f.producto_id, nombre: f.minibar_productos?.nombre || '—', precio: f.precio_unitario },
    }))
  );

  function abrirFormulario(lineasPrevias) {
    abrirModalLineasConsumo({
      titulo: '✏️ Editar consumo',
      habitacionLabel,
      huespedNombre,
      productos: productos || [],
      categorias,
      lineasIniciales: lineasPrevias.map((l) => ({ producto_id: l.productoId, cantidad: l.cantidad })),
      textoBoton: 'Continuar',
      onContinuar: (lineas) => {
        abrirModalResumenConsumo({
          habitacionLabel,
          huespedNombre,
          lineas,
          textoConfirmar: '✅ Guardar cambios',
          onVolver: () => abrirFormulario(lineas),
          onConfirmar: async () => {
            await guardarEdicionVenta(grupo, lineas);
            mostrarToast('Consumo actualizado.', 'exito');
            await onListo();
          },
        });
      },
    });
  }
}

async function eliminarVentaMinibar(grupo, onListo) {
  const ok = await mostrarConfirmacion({
    titulo: 'Eliminar consumo',
    contenidoHTML: `¿Eliminar este consumo (${grupo.filas.length} producto${grupo.filas.length === 1 ? '' : 's'})? Se revertirá el descuento hecho al inventario de la habitación. Esta acción no se puede deshacer.`,
    textoConfirmar: 'Eliminar',
  });
  if (!ok) return;

  const usuario = getUsuarioActual();
  const ids = grupo.filas.map((f) => f.id);
  const { error } = await supabase.from('minibar_consumos').delete().in('id', ids);
  if (error) {
    mostrarToast(`Error eliminando: ${error.message}`, 'error');
    return;
  }

  for (const fila of grupo.filas) {
    try {
      await ajustarInventarioHabitacion(fila.habitacion_id, fila.producto_id, fila.cantidad, usuario?.id || null, 'ajuste_habitacion');
    } catch (errInv) {
      mostrarToast('Consumo eliminado, pero no se pudo revertir el inventario de alguna línea.', 'error');
    }
  }

  mostrarToast('Consumo eliminado.', 'exito');
  await onListo();
}

/**
 * Tarjeta con el listado de consumos de TODAS las habitaciones en uso,
 * agrupados por venta (grupo_venta) — cada fila de la tabla es una venta
 * completa (uno o varios productos), con "✏️ Editar" / "🗑 Eliminar".
 * Usada desde minibar.js.
 */
export async function cargarListaVentasMinibar(elemento, { habitacionesEnUso, permitido }) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const reservaIds = habitacionesEnUso.map((h) => h.reservaId).filter((id) => id !== null);
  const { data: consumos, error } = reservaIds.length
    ? await supabase
        .from('minibar_consumos')
        .select('*, minibar_productos(nombre)')
        .in('reserva_id', reservaIds)
        .order('creado_en', { ascending: false })
    : { data: [], error: null };

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando consumos: ${error.message}</p>`;
    return;
  }

  // Agrupa por grupo_venta; las filas sueltas (sin grupo_venta, de antes
  // de este cambio) quedan cada una como su propio grupo de 1 — se ven y
  // se pueden eliminar igual, pero no editar como grupo.
  const grupos = [];
  const porClave = new Map();
  (consumos || []).forEach((c) => {
    const clave = c.grupo_venta || `suelto-${c.id}`;
    if (!porClave.has(clave)) {
      const grupo = { clave, grupoVenta: c.grupo_venta, filas: [] };
      porClave.set(clave, grupo);
      grupos.push(grupo);
    }
    porClave.get(clave).filas.push(c);
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>🥤 Consumos de habitaciones en uso</h3>
      ${
        grupos.length === 0
          ? '<p class="mensaje-vacio">Sin consumos registrados todavía.</p>'
          : `
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead>
              <tr>
                <th>Habitación</th>
                <th>Productos</th>
                <th>Total</th>
                <th>Hora</th>
                ${permitido ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${grupos
                .map((g) => {
                  const hab = habitacionesEnUso.find((h) => h.reservaId === g.filas[0].reserva_id);
                  const total = g.filas.reduce((sum, f) => sum + Number(f.monto), 0);
                  const resumenProductos = g.filas.map((f) => `${f.minibar_productos ? f.minibar_productos.nombre : '—'} ×${f.cantidad}`).join(', ');
                  return `
                <tr data-clave="${g.clave}">
                  <td>${hab ? hab.habitacionLabel : '—'}</td>
                  <td>${escaparHTML(resumenProductos)}</td>
                  <td class="monto">${formatCOP(total)}</td>
                  <td>${formatFechaHora(g.filas[0].creado_en)}</td>
                  ${
                    permitido
                      ? `<td style="white-space:nowrap;">
                          ${g.grupoVenta ? `<button type="button" class="btn-editar btn-editar-venta-minibar" data-clave="${g.clave}">✏️ Editar</button>` : ''}
                          <button type="button" class="btn-editar btn-eliminar-venta-minibar" data-clave="${g.clave}">🗑 Eliminar</button>
                        </td>`
                      : ''
                  }
                </tr>
              `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  if (permitido) {
    elemento.querySelectorAll('.btn-eliminar-venta-minibar').forEach((btn) => {
      btn.addEventListener('click', () => {
        const grupo = grupos.find((g) => g.clave === btn.dataset.clave);
        if (grupo) eliminarVentaMinibar(grupo, () => cargarListaVentasMinibar(elemento, { habitacionesEnUso, permitido }));
      });
    });
    elemento.querySelectorAll('.btn-editar-venta-minibar').forEach((btn) => {
      btn.addEventListener('click', () => {
        const grupo = grupos.find((g) => g.clave === btn.dataset.clave);
        if (!grupo) return;
        const hab = habitacionesEnUso.find((h) => h.reservaId === grupo.filas[0].reserva_id);
        abrirModalEditarVenta(grupo, hab, () => cargarListaVentasMinibar(elemento, { habitacionesEnUso, permitido }));
      });
    });
  }
}
