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
// Nota sobre "tiene_minibar" (ver 109/111): las habitaciones marcadas
// como sin minibar (uso administrativo, arriendo mensual, etc.) no
// aparecen en "Pendientes de reponer", "Reabastecer habitación" ni el
// "Mapa de minibares" de abajo — se filtran siempre por
// `tiene_minibar = true`. Para reactivar el minibar de una habitación
// cuando corresponda, basta con marcar la casilla correspondiente en
// Configuración → Habitaciones.
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
// Nota sobre "🧹 Vaciar minibar" (115, ver también 133): para
// habitaciones que se arriendan sin minibar (ej. tarifa libre / mensual,
// ver config-tarifas.js). Devuelve TODO el stock actual del minibar de
// esa habitación a la bodega (inventario_bodega suma, la habitación
// queda en 0 — cada movimiento queda registrado con tipo
// 'vaciado_a_bodega') y desactiva `tiene_minibar` en esa habitación
// automáticamente. La función (`vaciarMinibarHabitacion`, exportada)
// vive en este archivo porque también la usa config-habitaciones.js —
// pero el ÚNICO botón para usarla está en Configuración → Habitaciones
// (junto a la casilla "Tiene minibar", donde el contexto deja claro qué
// hace). Antes también había un botón igual en Inventario → "Inventario
// por habitación"; se quitó en 133 por duplicado (ver nota 133).
//
// Nota (119): (1) el "Mapa de minibares" ahora fija también la fila de
// encabezado (números de habitación) al hacer scroll hacia abajo, no
// solo la columna de producto — así siempre se ve a qué habitación
// corresponde cada columna, sin importar qué tan abajo se haya
// scrolleado. (2) "Inventario por habitación" (quitado en 133, ver nota
// más abajo) pasó en su momento a ser de solo lectura.
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
//
// Nota (129): tres cambios más.
//  1. "Bodega" tiene botón "⬇ Excel" (mismo patrón que Pendientes de
//     reponer).
//  2. "Registrar compra" ya NO trae un producto ni una cantidad
//     preseleccionados (antes el navegador dejaba marcado el primer
//     producto de la lista y cantidad=1 por defecto, así que un envío
//     accidental del formulario registraba una compra real sin querer)
//     — ahora hay que elegir producto y escribir cantidad a propósito.
//     También se puede dar de alta un producto nuevo sin salir del
//     formulario (opción "➕ Es un producto nuevo"). Para comprar VARIOS
//     productos a la vez, el formulario ahora indica que se use el
//     módulo Compras (orden de compra con varios ítems).
//  3. "Movimientos recientes" tiene un botón "🗑" SOLO en las entradas
//     de tipo "Compra a bodega", para poder deshacer una que se haya
//     registrado por error — pide confirmación y, al eliminar, también
//     resta esa cantidad de la bodega (nunca la deja negativa). Los
//     demás tipos de movimiento no tienen este botón todavía (revertir
//     un reabastecimiento o un consumo es más delicado, toca más de una
//     tabla o afecta a una habitación específica).
//
// Nota (130): dos ajustes más.
//  1. Los CSV que se descargan ("⬇ Excel", en Bodega y en Pendientes de
//     reponer) ahora separan columnas con punto y coma (;) en vez de
//     coma — con la configuración regional en español de Excel en
//     Colombia, la coma es el separador decimal, así que un CSV
//     separado por comas se abría todo en una sola celda por fila.
//  2. "Producto nuevo" en Registrar compra ya no aparece como campos
//     sueltos dentro del mismo formulario — ahora abre una tarjeta
//     emergente aparte (`abrirModalProductoNuevo`) para crear el
//     producto; al crearlo, el formulario de compra sigue normal con
//     ese producto ya seleccionado.
//
// Nota (131): la pestaña de Inventario pasó de tarjetas siempre abiertas
// y apiladas (mucho scroll para llegar a las últimas) a un tablero de
// mini-tarjetas: cada sección ahora es un resumen corto (título + el
// dato más relevante) con un botón "👁️ Ver" que abre esa misma sección
// — completa, con toda su funcionalidad de siempre intacta — dentro de
// una tarjeta emergente. Ninguna sección cambió por dentro.
//
// Nota (132): cinco ajustes sobre lo que se pidió al revisar la 131.
//  1. Las tarjetas emergentes eran angostas en algunas secciones —
//     ahora TODAS las emergentes de sección son igual de anchas (hasta
//     1100px / 95% del ancho de pantalla).
//  2. "Mapa de minibares" tiene botón "⬇ Excel": exporta habitación ×
//     producto con cantidad actual, estándar, precio de venta, precio
//     de costo y proveedor (los dos últimos vienen de Bodega, ya que el
//     costo/proveedor se maneja a nivel de producto, no por habitación).
//  3. Tarjeta nueva "📊 Stock total (bodega + minibares)": suma, por
//     producto, lo que hay en bodega más lo que hay repartido en todos
//     los minibares — con precio de venta, precio de costo, proveedor y
//     el valor total a cada precio. Tiene su propio "⬇ Excel".
//  4. "Bodega" y "Mapa de minibares" muestran 3 mini-tarjetas fijas
//     arriba (Cantidad de productos, Valor a precio de costo, Valor a
//     precio de venta). En Bodega, además, la tabla ordena primero los
//     productos por debajo del mínimo.
//  5. "Reabastecer habitación" ya no deja elegir cualquier combinación:
//     solo aparecen habitaciones con algo pendiente, el selector de
//     producto se llena según la habitación elegida mostrando SOLO lo
//     que le falta, y la cantidad viene precargada con lo que falta y
//     no se puede subir más de eso.
//
// Nota (133): se QUITÓ la tarjeta "Inventario por habitación". Su tabla
// de solo lectura (producto/actual/estándar/estado de UNA habitación a
// la vez) mostraba exactamente la misma información que ya se ve en
// "Mapa de minibares" (que además la muestra de TODAS las habitaciones
// a la vez, no una por una) — era redundante. Su único botón propio,
// "🧹 Vaciar minibar", YA existía también en Configuración →
// Habitaciones (junto a la casilla "Tiene minibar", con más contexto de
// lo que hace) — se dejó solo ahí para no tener el mismo botón delicado
// repetido en dos lugares distintos. La función `vaciarMinibarHabitacion`
// sigue viviendo aquí (exportada) porque config-habitaciones.js la usa.
//
// Nota (136): se integraron las dos secciones de Compras ("+ Nueva orden
// de compra" y "Órdenes de compra") como dos mini-tarjetas más del
// tablero — "📝 Nueva orden de compra" y "📦 Órdenes de compra". Compras
// solo tenía esas 2 secciones y ya vivía en el mismo grupo de menú que
// Inventario, así que separarlas en una pestaña aparte era más
// navegación de la necesaria. compras.js ya no se registra como módulo
// propio (ver nota ahí); este archivo solo importa sus dos funciones.
//
// Nota (139): las 3 mini-tarjetas de compras (Registrar compra, Nueva
// orden de compra, Órdenes de compra) se consolidaron en UNA sola:
// "🛒 Compras" — con dos pestañas internas ("Entrada rápida" / "Nueva
// orden formal", solo una visible a la vez) y, siempre debajo, el
// listado de órdenes (lo que sigue naturalmente después de crear una).
// Esta tarjeta ahora vive bajo su propio subtítulo "Compras" en el
// tablero, separada visualmente de las tarjetas operativas de
// Inventario (Mapa, Pendientes, Bodega, etc.) — ver `cargarSeccionCompras`.
//
// Nota (140): dentro de "🛒 Compras" las 3 zonas (Entrada rápida, Nueva
// orden formal, Órdenes registradas) ya no se ven todas iguales/planas
// — cada una tiene su propio color de acento (azul = entrada rápida,
// morado = orden formal, verde azulado = órdenes registradas) en forma
// de tarjeta-botón grande con borde y sombra del mismo color, y el
// contenido activo se muestra dentro de un recuadro con ese mismo color
// (franja de color a la izquierda + fondo tenue) — para identificar de
// un vistazo en qué zona se está, en vez de un solo bloque de texto
// corrido.
import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora, toISODate } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { cargarFormNuevaOrden, cargarListaOrdenes } from './compras.js';

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

// Separador ";" (no ",") — con la configuración regional en español que
// usa Excel en Colombia, la coma es el separador decimal, así que un
// CSV separado por comas lo abre TODO en una sola celda por fila. Con
// punto y coma sí separa columna por columna correctamente.
function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
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
    <div id="inv-resumen-wrap">
      <p class="mensaje-vacio">Cargando resumen…</p>
    </div>
  `;
  await cargarResumenInventario(container.querySelector('#inv-resumen-wrap'));
}

// =========================================================
// Tablero de resumen (ver nota 131/132/133 al inicio del archivo):
// mini-tarjeta por sección con el dato más relevante y un botón "👁️ Ver"
// que abre esa sección completa — reutilizando exactamente las mismas
// funciones cargarXxx de siempre — dentro de una tarjeta emergente ancha
// (ver nota 132.1). Los cálculos de resumen son consultas livianas,
// separadas de la carga completa.
// =========================================================

async function calcularResumenMapa() {
  const [{ count: habitaciones }, { count: productos }] = await Promise.all([
    supabase.from('habitaciones').select('id', { count: 'exact', head: true }).eq('tiene_minibar', true),
    supabase.from('minibar_productos').select('id', { count: 'exact', head: true }).eq('activo', true).gt('cantidad_estandar', 0),
  ]);
  return { habitaciones: habitaciones || 0, productos: productos || 0 };
}

async function calcularResumenPendientes() {
  const [{ data: habitaciones }, { data: productos }, { data: filas }] = await Promise.all([
    supabase.from('habitaciones').select('id').eq('tiene_minibar', true),
    supabase.from('minibar_productos').select('id, cantidad_estandar').eq('activo', true).gt('cantidad_estandar', 0),
    supabase.from('inventario_habitacion').select('habitacion_id, producto_id, cantidad_actual'),
  ]);
  const actualPorClave = new Map((filas || []).map((f) => [`${f.habitacion_id}_${f.producto_id}`, f.cantidad_actual]));
  let totalUnidades = 0;
  const habitacionesConFaltantes = new Set();
  (habitaciones || []).forEach((h) => {
    (productos || []).forEach((p) => {
      const actual = Number(actualPorClave.get(`${h.id}_${p.id}`) ?? 0);
      const falta = Number(p.cantidad_estandar) - actual;
      if (falta > 0) {
        totalUnidades += falta;
        habitacionesConFaltantes.add(h.id);
      }
    });
  });
  return { totalUnidades, habitaciones: habitacionesConFaltantes.size };
}

async function calcularResumenBodega() {
  const { data } = await supabase.from('inventario_bodega').select('cantidad_actual, cantidad_minima');
  const total = (data || []).length;
  const bajoMinimo = (data || []).filter((f) => f.cantidad_minima > 0 && f.cantidad_actual <= f.cantidad_minima).length;
  return { total, bajoMinimo };
}

async function calcularResumenStockTotal() {
  const [{ data: bodega }, { data: habitacionRows }] = await Promise.all([
    supabase.from('inventario_bodega').select('cantidad_actual'),
    supabase.from('inventario_habitacion').select('cantidad_actual'),
  ]);
  const enBodega = (bodega || []).reduce((sum, f) => sum + Number(f.cantidad_actual || 0), 0);
  const enMinibares = (habitacionRows || []).reduce((sum, f) => sum + Number(f.cantidad_actual || 0), 0);
  return { total: enBodega + enMinibares };
}

async function calcularResumenReposicionesHoy() {
  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString();
  const inicioManana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1).toISOString();
  const { data } = await supabase
    .from('inventario_movimientos')
    .select('cantidad')
    .eq('tipo', 'reabastecimiento')
    .gte('creado_en', inicioHoy)
    .lt('creado_en', inicioManana);
  const total = (data || []).reduce((sum, m) => sum + Number(m.cantidad), 0);
  return { total };
}

async function calcularResumenOrdenes() {
  const { data } = await supabase.from('ordenes_compra').select('id').in('estado', ['solicitado', 'en_camino']);
  return { pendientes: (data || []).length };
}

// Cada sección conserva su wrapId de siempre (#inv-mapa-wrap,
// #inv-bodega-wrap, etc.) — así, al abrirse dentro de la tarjeta
// emergente, todo el código existente que refresca esa sección o a sus
// vecinas buscando ese mismo id (por ejemplo `refrescarTrasReabastecer`)
// sigue funcionando exactamente igual, sin tener que tocarlo. Todas las
// emergentes usan el mismo ancho generoso (ver nota 132.1).
const SECCIONES_INVENTARIO = {
  mapa: { wrapId: 'inv-mapa-wrap', cargar: cargarMapaMinibares },
  pendientes: { wrapId: 'inv-pendientes-wrap', cargar: cargarPendientesReponer },
  bodega: { wrapId: 'inv-bodega-wrap', cargar: cargarInventarioBodega },
  'stock-total': { wrapId: 'inv-stock-total-wrap', cargar: cargarStockTotal },
  compras: { wrapId: 'inv-compras-wrap', cargar: cargarSeccionCompras },
  reabastecer: { wrapId: 'inv-reabastecer-wrap', cargar: cargarSeccionReabastecer },
  'reposiciones-hoy': { wrapId: 'inv-reposiciones-hoy-wrap', cargar: cargarReposicionesHoy },
  movimientos: { wrapId: 'inv-movimientos-wrap', cargar: cargarMovimientos },
};

function abrirModalSeccion(id, elementoResumen) {
  const config = SECCIONES_INVENTARIO[id];
  if (!config) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha" style="max-width:1100px; width:95vw; max-height:88vh; overflow:auto;">
      <div style="display:flex; justify-content:flex-end; margin-bottom:0.5rem;">
        <button type="button" class="btn btn-secundario btn-chico" id="btn-cerrar-modal-seccion">✕ Cerrar</button>
      </div>
      <div id="${config.wrapId}"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
    cargarResumenInventario(elementoResumen);
  }

  overlay.querySelector('#btn-cerrar-modal-seccion').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });

  config.cargar(overlay.querySelector(`#${config.wrapId}`));
}

async function cargarResumenInventario(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando resumen…</p>';
  const permitido = puedeGestionar();

  const [resumenMapa, resumenPendientes, resumenBodega, resumenStockTotal, resumenOrdenes, resumenReposicionesHoy] = await Promise.all([
    calcularResumenMapa(),
    calcularResumenPendientes(),
    calcularResumenBodega(),
    calcularResumenStockTotal(),
    calcularResumenOrdenes(),
    calcularResumenReposicionesHoy(),
  ]);

  const tarjetas = [
    {
      id: 'mapa',
      icono: '🗺️',
      titulo: 'Mapa de minibares',
      resumen: `${resumenMapa.habitaciones} habitación(es) · ${resumenMapa.productos} producto(s)`,
    },
    {
      id: 'pendientes',
      icono: '🔴',
      titulo: 'Pendientes de reponer',
      resumen:
        resumenPendientes.totalUnidades > 0
          ? `${resumenPendientes.totalUnidades} unidad(es) en ${resumenPendientes.habitaciones} habitación(es)`
          : '✅ Todo al día',
      alerta: resumenPendientes.totalUnidades > 0,
    },
    {
      id: 'bodega',
      icono: '📦',
      titulo: 'Bodega — existencias y proveedor',
      resumen:
        resumenBodega.bajoMinimo > 0
          ? `${resumenBodega.total} producto(s) · ${resumenBodega.bajoMinimo} bajo el mínimo`
          : `${resumenBodega.total} producto(s) · ✅ ninguno bajo mínimo`,
      alerta: resumenBodega.bajoMinimo > 0,
    },
    {
      id: 'stock-total',
      icono: '📊',
      titulo: 'Stock total (bodega + minibares)',
      resumen: `${resumenStockTotal.total} unidad(es) en total`,
    },
    permitido ? { id: 'reabastecer', icono: '🔁', titulo: 'Reabastecer habitación', resumen: 'Traslada stock de bodega a una habitación' } : null,
    {
      id: 'reposiciones-hoy',
      icono: '📤',
      titulo: 'Reposiciones de hoy',
      resumen: `${resumenReposicionesHoy.total} unidad(es) repuestas hoy`,
    },
    {
      id: 'movimientos',
      icono: '📋',
      titulo: 'Movimientos recientes',
      resumen: 'Historial de compras, reposiciones, consumos y ajustes',
    },
  ].filter(Boolean);

  // "Compras" queda como grupo aparte, bajo su propio subtítulo — ver
  // nota 139: antes eran 3 mini-tarjetas sueltas mezcladas con las
  // operativas de Inventario, ahora es 1 sola.
  const tarjetasCompras = [
    permitido
      ? {
          id: 'compras',
          icono: '🛒',
          titulo: 'Compras',
          resumen: resumenOrdenes.pendientes > 0 ? `${resumenOrdenes.pendientes} orden(es) en camino o solicitadas` : '✅ Sin órdenes pendientes',
        }
      : null,
  ].filter(Boolean);

  function pintarGrid(lista) {
    return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:1rem;">
      ${lista
        .map(
          (t) => `
        <div class="tarjeta" style="${t.alerta ? 'border:1.5px solid #f0a8a0; background:var(--color-alerta-fondo, #fdecea);' : ''}">
          <h3 style="margin-top:0;">${t.icono} ${t.titulo}</h3>
          <p class="mensaje-vacio" style="margin-bottom:1rem;">${t.resumen}</p>
          <button type="button" class="btn btn-secundario btn-chico btn-ver-seccion" data-id="${t.id}">👁️ Ver</button>
        </div>
      `
        )
        .join('')}
    </div>
  `;
  }

  elemento.innerHTML = `
    ${pintarGrid(tarjetas)}
    ${tarjetasCompras.length > 0 ? `<h3 style="margin:1.5rem 0 0.75rem;">Compras</h3>${pintarGrid(tarjetasCompras)}` : ''}
  `;

  elemento.querySelectorAll('.btn-ver-seccion').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalSeccion(btn.dataset.id, elemento));
  });
}

// =========================================================
// Mapa de minibares — cuadrícula producto × habitación (ver nota al
// inicio del archivo, 111). Solo lectura; para reponer, usar la tabla
// "Pendientes de reponer" de más abajo. Nota 132: además de la
// cuadrícula, trae precio de costo y proveedor (desde Bodega, ya que
// ese dato vive a nivel de producto, no por habitación) para las 3
// mini-tarjetas de valor y para el botón "⬇ Excel".
// =========================================================
async function cargarMapaMinibares(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando mapa de minibares…</p>';

  const [
    { data: habitaciones, error: errHab },
    { data: productos, error: errProd },
    { data: filas, error: errFilas },
    { data: bodega, error: errBodega },
    { data: proveedores, error: errProv },
  ] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero'),
    supabase.from('minibar_productos').select('id, nombre, categoria, cantidad_estandar, precio').eq('activo', true).gt('cantidad_estandar', 0).order('categoria').order('nombre'),
    supabase.from('inventario_habitacion').select('habitacion_id, producto_id, cantidad_actual'),
    supabase.from('inventario_bodega').select('producto_id, precio_costo, proveedor_id'),
    supabase.from('proveedores').select('id, nombre_comercial'),
  ]);

  if (errHab || errProd || errFilas || errBodega || errProv) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el mapa de minibares: ${(errHab || errProd || errFilas || errBodega || errProv).message}</p>`;
    return;
  }

  const actualPorClave = new Map((filas || []).map((f) => [`${f.habitacion_id}_${f.producto_id}`, f.cantidad_actual]));
  const bodegaPorProducto = new Map((bodega || []).map((b) => [b.producto_id, b]));

  let valorCostoTotal = 0;
  let valorVentaTotal = 0;
  (productos || []).forEach((p) => {
    const costo = Number(bodegaPorProducto.get(p.id)?.precio_costo || 0);
    const venta = Number(p.precio || 0);
    (habitaciones || []).forEach((h) => {
      const actual = Number(actualPorClave.get(`${h.id}_${p.id}`) ?? 0);
      valorCostoTotal += actual * costo;
      valorVentaTotal += actual * venta;
    });
  });

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
          <button type="button" id="btn-exportar-mapa" class="btn btn-secundario btn-chico">⬇ Excel</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin:0.5rem 0 1rem;">
        <div class="stat-card"><div class="stat-card-label">Cantidad de productos</div><div class="stat-card-valor">${(productos || []).length}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de costo</div><div class="stat-card-valor">${formatCOP(valorCostoTotal)}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de venta</div><div class="stat-card-valor">${formatCOP(valorVentaTotal)}</div></div>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">De un vistazo: qué hay y qué falta en cada minibar (no incluye habitaciones sin minibar). El número en cada celda es la cantidad actual; "Estándar" es la referencia con la que se compara. Para reponer, abre la tarjeta "Pendientes de reponer" desde el tablero de Inventario. Para desactivar el minibar de una habitación (arriendo sin minibar) y devolver su stock a bodega, usa Configuración → Habitaciones → "🧹 Vaciar minibar y desactivar".</p>
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

  elemento.querySelector('#btn-exportar-mapa').addEventListener('click', () => {
    const filasExport = [];
    (productos || []).forEach((p) => {
      const infoBodega = bodegaPorProducto.get(p.id);
      const costo = infoBodega?.precio_costo || 0;
      const proveedorNombre = (proveedores || []).find((pr) => pr.id === infoBodega?.proveedor_id)?.nombre_comercial || '—';
      (habitaciones || []).forEach((h) => {
        const actual = Number(actualPorClave.get(`${h.id}_${p.id}`) ?? 0);
        filasExport.push([p.categoria, p.nombre, h.numero, actual, p.cantidad_estandar, p.precio || 0, costo, proveedorNombre]);
      });
    });
    descargarCSV(`mapa_minibares_${toISODate(new Date())}.csv`, [
      ['Mapa de minibares — stock, precios y proveedor — Santa Ana House 21'],
      ['Generado', formatFechaHora(new Date().toISOString())],
      ['Valor total a precio de costo', valorCostoTotal],
      ['Valor total a precio de venta', valorVentaTotal],
      [],
      ['Categoría', 'Producto', 'Habitación', 'Cantidad en minibar', 'Estándar', 'Precio de venta', 'Precio de costo', 'Proveedor'],
      ...filasExport,
    ]);
  });
}

// =========================================================
// Bodega (ver nota 128 al inicio del archivo): tabla reducida a 5
// columnas (Producto, Precio de venta, Cantidad en stock, Estado, Ver)
// — el detalle completo y la edición viven en una tarjeta emergente que
// abre el botón "👁️ Ver" (ver `abrirModalDetalleBodega`), en vez de
// filas editables inline (que quedaban demasiado anchas/incómodas).
// Nota 132: se agregaron 3 mini-tarjetas fijas arriba (cantidad de
// productos, valor a precio de costo, valor a precio de venta) y la
// tabla ahora ordena primero los productos por debajo del mínimo, para
// no tener que bajar a buscarlos.
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

  const cantidadProductos = (inventario || []).length;
  const valorCostoTotal = (inventario || []).reduce((sum, f) => sum + Number(f.cantidad_actual || 0) * Number(f.precio_costo || 0), 0);
  const valorVentaTotal = (inventario || []).reduce((sum, f) => sum + Number(f.cantidad_actual || 0) * Number(f.minibar_productos?.precio || 0), 0);

  // Pendientes de reponer (bajo mínimo) primero, luego orden alfabético
  // dentro de cada grupo — antes quedaba el orden crudo de la consulta
  // (categoría/nombre) sin distinguir los que sí necesitan atención.
  const inventarioOrdenado = [...(inventario || [])].sort((a, b) => {
    const aBajo = a.cantidad_minima > 0 && a.cantidad_actual <= a.cantidad_minima;
    const bBajo = b.cantidad_minima > 0 && b.cantidad_actual <= b.cantidad_minima;
    if (aBajo !== bBajo) return aBajo ? -1 : 1;
    const catCompare = (a.minibar_productos?.categoria || '').localeCompare(b.minibar_productos?.categoria || '');
    if (catCompare !== 0) return catCompare;
    return (a.minibar_productos?.nombre || '').localeCompare(b.minibar_productos?.nombre || '');
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem;">
        <h3 style="margin:0;">Bodega — existencias y proveedor</h3>
        <button type="button" id="btn-exportar-bodega" class="btn btn-secundario btn-chico">⬇ Excel</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin-bottom:0.75rem;">
        <div class="stat-card"><div class="stat-card-label">Cantidad de productos</div><div class="stat-card-valor">${cantidadProductos}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de costo</div><div class="stat-card-valor">${formatCOP(valorCostoTotal)}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de venta</div><div class="stat-card-valor">${formatCOP(valorVentaTotal)}</div></div>
      </div>
      <p class="texto-ayuda">Los productos que necesitan reponerse aparecen primero. Dale "👁️ Ver" a un producto para ver el detalle completo (costo, proveedor, mínimo, última actualización) y editarlo ahí.</p>
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
              inventarioOrdenado
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

  elemento.querySelector('#btn-exportar-bodega').addEventListener('click', () => {
    descargarCSV(`bodega_existencias_${toISODate(new Date())}.csv`, [
      ['Bodega — existencias y proveedor — Santa Ana House 21'],
      ['Generado', formatFechaHora(new Date().toISOString())],
      ['Cantidad de productos', cantidadProductos],
      ['Valor total a precio de costo', valorCostoTotal],
      ['Valor total a precio de venta', valorVentaTotal],
      [],
      ['Categoría', 'Producto', 'Precio de venta', 'Precio costo', 'Proveedor', 'En bodega', 'Mínimo', 'Actualizado'],
      ...inventarioOrdenado.map((f) => [
        f.minibar_productos?.categoria || '—',
        f.minibar_productos?.nombre || '—',
        f.minibar_productos?.precio || 0,
        f.precio_costo || 0,
        (proveedores || []).find((p) => p.id === f.proveedor_id)?.nombre_comercial || '—',
        f.cantidad_actual,
        f.cantidad_minima,
        f.actualizado_en ? formatFechaHora(f.actualizado_en) : '—',
      ]),
    ]);
  });

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
// Stock total (132): consolida bodega + minibares por producto — para
// ver de un vistazo TODO lo que hay de cada producto sin importar dónde
// está físicamente, con su valor a precio de costo y de venta.
// =========================================================
async function cargarStockTotal(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const [{ data: productos, error: errProd }, { data: bodega, error: errBodega }, { data: habitacionRows, error: errHab }, { data: proveedores, error: errProv }] = await Promise.all([
    supabase.from('minibar_productos').select('id, nombre, categoria, precio').eq('activo', true).order('categoria').order('nombre'),
    supabase.from('inventario_bodega').select('producto_id, cantidad_actual, precio_costo, proveedor_id'),
    supabase.from('inventario_habitacion').select('producto_id, cantidad_actual'),
    supabase.from('proveedores').select('id, nombre_comercial'),
  ]);

  if (errProd || errBodega || errHab || errProv) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el stock total: ${(errProd || errBodega || errHab || errProv).message}</p>`;
    return;
  }

  const bodegaPorProducto = new Map((bodega || []).map((b) => [b.producto_id, b]));
  const enMinibaresPorProducto = new Map();
  (habitacionRows || []).forEach((f) => {
    enMinibaresPorProducto.set(f.producto_id, (enMinibaresPorProducto.get(f.producto_id) || 0) + Number(f.cantidad_actual || 0));
  });

  const filas = (productos || []).map((p) => {
    const infoBodega = bodegaPorProducto.get(p.id);
    const enBodega = Number(infoBodega?.cantidad_actual || 0);
    const enMinibares = Number(enMinibaresPorProducto.get(p.id) || 0);
    const total = enBodega + enMinibares;
    const precioVenta = Number(p.precio || 0);
    const precioCosto = Number(infoBodega?.precio_costo || 0);
    const proveedorNombre = (proveedores || []).find((pr) => pr.id === infoBodega?.proveedor_id)?.nombre_comercial || '—';
    return {
      categoria: p.categoria,
      nombre: p.nombre,
      enBodega,
      enMinibares,
      total,
      precioVenta,
      precioCosto,
      proveedorNombre,
      valorCosto: total * precioCosto,
      valorVenta: total * precioVenta,
    };
  });

  const totalUnidades = filas.reduce((sum, f) => sum + f.total, 0);
  const valorCostoTotal = filas.reduce((sum, f) => sum + f.valorCosto, 0);
  const valorVentaTotal = filas.reduce((sum, f) => sum + f.valorVenta, 0);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem;">
        <h3 style="margin:0;">📊 Stock total (bodega + minibares)</h3>
        <button type="button" id="btn-exportar-stock-total" class="btn btn-secundario btn-chico">⬇ Excel</button>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">Suma lo que hay en bodega más lo que hay repartido en todos los minibares, producto por producto, con su valor a precio de costo y de venta.</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:0.75rem; margin-bottom:1rem;">
        <div class="stat-card"><div class="stat-card-label">Unidades totales</div><div class="stat-card-valor">${totalUnidades}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de costo</div><div class="stat-card-valor">${formatCOP(valorCostoTotal)}</div></div>
        <div class="stat-card"><div class="stat-card-label">Valor a precio de venta</div><div class="stat-card-valor">${formatCOP(valorVentaTotal)}</div></div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Producto</th>
              <th>En bodega</th>
              <th>En minibares</th>
              <th>Total</th>
              <th>Precio venta</th>
              <th>Precio costo</th>
              <th>Proveedor</th>
            </tr>
          </thead>
          <tbody>
            ${
              filas
                .map(
                  (f) => `<tr>
                <td>${escaparHTML(f.nombre)} <span class="mensaje-vacio">(${escaparHTML(f.categoria)})</span></td>
                <td>${f.enBodega}</td>
                <td>${f.enMinibares}</td>
                <td style="font-weight:700;">${f.total}</td>
                <td>${formatCOP(f.precioVenta)}</td>
                <td>${formatCOP(f.precioCosto)}</td>
                <td>${escaparHTML(f.proveedorNombre)}</td>
              </tr>`
                )
                .join('') || `<tr><td colspan="7" class="mensaje-vacio">Sin productos activos.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-stock-total').addEventListener('click', () => {
    descargarCSV(`stock_total_${toISODate(new Date())}.csv`, [
      ['Stock total (bodega + minibares) — Santa Ana House 21'],
      ['Generado', formatFechaHora(new Date().toISOString())],
      ['Unidades totales', totalUnidades],
      ['Valor total a precio de costo', valorCostoTotal],
      ['Valor total a precio de venta', valorVentaTotal],
      [],
      ['Categoría', 'Producto', 'En bodega', 'En minibares', 'Total', 'Precio de venta', 'Precio de costo', 'Proveedor'],
      ...filas.map((f) => [f.categoria, f.nombre, f.enBodega, f.enMinibares, f.total, f.precioVenta, f.precioCosto, f.proveedorNombre]),
    ]);
  });
}

// Tarjeta emergente para dar de alta un producto nuevo desde "Registrar
// compra", sin mezclar los campos en la misma hoja del formulario (ver
// nota 130 al inicio del archivo). Al crear el producto, llama a
// onCreado(nuevoProducto); si cancela, llama a onCancelar().
function abrirModalProductoNuevo(categorias, { onCreado, onCancelar }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>➕ Producto nuevo</h3>
      <form id="form-producto-nuevo" class="modal-contenido">
        <div class="form-grid">
          <label>Nombre del producto
            <input type="text" name="nombre" required placeholder="Ej: Papas Margarita" />
          </label>
          <label>Categoría
            <input type="text" name="categoria" required list="lista-categorias-producto-nuevo" placeholder="Ej: Snacks" />
            <datalist id="lista-categorias-producto-nuevo">${categorias.map((c) => `<option value="${escaparHTML(c)}"></option>`).join('')}</datalist>
          </label>
        </div>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-producto-nuevo">Cancelar</button>
          <button type="submit" class="btn btn-primario">Crear producto</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  function cerrar(cancelando) {
    overlay.remove();
    if (cancelando && onCancelar) onCancelar();
  }

  overlay.querySelector('#btn-cancelar-producto-nuevo').addEventListener('click', () => cerrar(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar(true);
  });

  overlay.querySelector('#form-producto-nuevo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nombre = form.get('nombre').trim();
    const categoria = form.get('categoria').trim();
    if (!nombre || !categoria) {
      mostrarToast('Escribe el nombre y la categoría del producto nuevo.', 'error');
      return;
    }

    const { data: nuevoProducto, error } = await supabase
      .from('minibar_productos')
      .insert({ nombre, categoria, precio: 0, activo: true })
      .select('id, nombre')
      .single();
    if (error) {
      mostrarToast(`Error creando el producto: ${error.message}`, 'error');
      return;
    }

    mostrarToast(`Producto "${nombre}" creado.`, 'exito');
    overlay.remove();
    onCreado(nuevoProducto);
  });
}

// =========================================================
// Registrar compra (entrada a bodega) — ver nota 129/130 al inicio del
// archivo: sin producto ni cantidad preseleccionados (para que un envío
// accidental no registre una entrada real por error), y con la opción
// de dar de alta un producto nuevo en una tarjeta emergente aparte, sin
// mezclarlo con el resto del formulario. Pensada para UNA entrada
// rápida a la vez; para comprar VARIOS productos de un tirón usa la
// pestaña "Nueva orden formal" de la tarjeta "🛒 Compras" (ver nota 139
// y `cargarSeccionCompras` más abajo).
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
      <p class="texto-ayuda">Para UN producto a la vez.</p>
      <form id="form-compra" class="form-grid">
        <label>Producto
          <select name="producto_id" id="select-producto-compra" required>
            <option value="" disabled selected>— Selecciona un producto —</option>
            <option value="__nuevo__">➕ Es un producto nuevo (no está en el catálogo)</option>
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
          <input type="number" name="cantidad" min="1" placeholder="Ej: 10" required />
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
  `;

  const selectProducto = elemento.querySelector('#select-producto-compra');
  selectProducto.addEventListener('change', () => {
    if (selectProducto.value !== '__nuevo__') return;
    abrirModalProductoNuevo(categorias, {
      onCreado: (nuevoProducto) => {
        const nuevaOpcion = document.createElement('option');
        nuevaOpcion.value = String(nuevoProducto.id);
        nuevaOpcion.textContent = `${nuevoProducto.nombre} (recién creado)`;
        selectProducto.insertBefore(nuevaOpcion, selectProducto.querySelector('option[value="__nuevo__"]'));
        selectProducto.value = String(nuevoProducto.id);
      },
      onCancelar: () => {
        selectProducto.value = '';
      },
    });
  });

  elemento.querySelector('#form-compra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const usuario = getUsuarioActual();
    const productoId = Number(form.get('producto_id'));

    if (!productoId || form.get('producto_id') === '__nuevo__') {
      mostrarToast('Selecciona un producto (si es nuevo, complétalo en la ventana emergente primero).', 'error');
      return;
    }

    const cantidad = Number(form.get('cantidad'));
    const precioCosto = form.get('precio_costo') ? Number(form.get('precio_costo')) : null;
    const proveedorId = form.get('proveedor_id') ? Number(form.get('proveedor_id')) : null;

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
    await cargarSeccionCompra(elemento);
  });
}

// =========================================================
// Compras (139): una sola tarjeta que agrupa lo que antes eran 3
// mini-tarjetas sueltas — "Entrada rápida" (1 producto,
// `cargarSeccionCompra`) y "Nueva orden formal" (varios productos +
// proveedor, `cargarFormNuevaOrden` de compras.js) comparten esta
// tarjeta como dos pestañas internas (solo una visible a la vez);
// debajo, siempre visible, el listado de "Órdenes de compra"
// (`cargarListaOrdenes` de compras.js) — es lo que sigue naturalmente
// después de crear una orden formal.
// =========================================================
// Colores de acento por zona (ver nota 140): cada una se identifica por
// su propio color en vez de que todo se vea plano/igual — no se
// reutilizan los colores que ya tienen significado en el resto del
// módulo (verde=completo, ámbar=reponer, rojo=alerta en Mapa/Pendientes).
const ACENTO_COMPRA_RAPIDA = { borde: '#1c5fa8', fondo: '#e7f1fd', texto: '#154a86' };
const ACENTO_COMPRA_ORDEN = { borde: '#7443ad', fondo: '#f2ecfc', texto: '#5f3690' };
const ACENTO_COMPRA_LISTA = { borde: '#2f7a78', fondo: '#eaf5f4', texto: '#25605e' };

function estiloTarjetaAcento(acento, activa) {
  return `text-align:left; cursor:pointer; border-radius:10px; padding:0.85rem 1rem; border:2px solid ${acento.borde}; background:${activa ? acento.fondo : '#fff'}; box-shadow:${activa ? `0 3px 10px ${acento.borde}40` : '0 1px 3px rgba(0,0,0,0.06)'}; transition:box-shadow 0.15s, background 0.15s;`;
}

function estiloContenidoAcento(acento) {
  return `border-left:5px solid ${acento.borde}; background:${acento.fondo}; border-radius:0 8px 8px 0; padding:1rem; box-shadow:0 1px 5px ${acento.borde}26;`;
}

async function cargarSeccionCompras(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '<p class="mensaje-vacio">No tienes permiso para gestionar compras.</p>';
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3 style="margin-top:0;">🛒 Compras</h3>
      <p class="mensaje-vacio" style="margin-top:-0.3rem;">Elige cómo vas a registrar la entrada — cada opción queda marcada con su color para identificarla fácil.</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:0.75rem; margin:0.75rem 0 1rem;">
        <button type="button" class="btn-tab-compra" data-tab="rapida" style="${estiloTarjetaAcento(ACENTO_COMPRA_RAPIDA, true)}">
          <strong style="color:${ACENTO_COMPRA_RAPIDA.texto};">⚡ Entrada rápida</strong>
          <div class="mensaje-vacio" style="margin-top:0.2rem;">Un producto, directo a bodega</div>
        </button>
        <button type="button" class="btn-tab-compra" data-tab="orden" style="${estiloTarjetaAcento(ACENTO_COMPRA_ORDEN, false)}">
          <strong style="color:${ACENTO_COMPRA_ORDEN.texto};">📝 Orden formal</strong>
          <div class="mensaje-vacio" style="margin-top:0.2rem;">Varios productos + proveedor</div>
        </button>
      </div>
      <div id="compras-form-wrap" style="margin-bottom:1.5rem;"></div>
      <h4 style="display:flex; align-items:center; gap:0.5rem; margin:1.5rem 0 0.6rem;">
        <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:${ACENTO_COMPRA_LISTA.borde};"></span>
        📦 Órdenes registradas
      </h4>
      <div id="compras-lista-wrap" style="${estiloContenidoAcento(ACENTO_COMPRA_LISTA)}"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;

  const wrapForm = elemento.querySelector('#compras-form-wrap');
  const wrapLista = elemento.querySelector('#compras-lista-wrap');
  const botonesTab = elemento.querySelectorAll('.btn-tab-compra');

  function activarTab(tab) {
    const acento = tab === 'rapida' ? ACENTO_COMPRA_RAPIDA : ACENTO_COMPRA_ORDEN;
    botonesTab.forEach((b) => {
      const activo = b.dataset.tab === tab;
      const suAcento = b.dataset.tab === 'rapida' ? ACENTO_COMPRA_RAPIDA : ACENTO_COMPRA_ORDEN;
      b.setAttribute('style', estiloTarjetaAcento(suAcento, activo));
    });
    wrapForm.setAttribute('style', `margin-bottom:1.5rem; ${estiloContenidoAcento(acento)}`);
    if (tab === 'rapida') cargarSeccionCompra(wrapForm);
    else cargarFormNuevaOrden(wrapForm);
  }

  botonesTab.forEach((b) => b.addEventListener('click', () => activarTab(b.dataset.tab)));
  activarTab('rapida');

  await cargarListaOrdenes(wrapLista);
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
// (ver nota al inicio del archivo). Exportada porque la usa
// config-habitaciones.js — es el ÚNICO lugar con botón para esta acción
// desde 133 (ver nota 133 al inicio del archivo).
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
// pendientes de reponer, reposiciones de hoy y el log de movimientos)
// después de cualquier traslado bodega → habitación.
async function refrescarTrasReabastecer() {
  const wrapMapa = document.querySelector('#inv-mapa-wrap');
  if (wrapMapa) await cargarMapaMinibares(wrapMapa);
  const wrapPendientes = document.querySelector('#inv-pendientes-wrap');
  if (wrapPendientes) await cargarPendientesReponer(wrapPendientes);
  const wrapBodega = document.querySelector('#inv-bodega-wrap');
  if (wrapBodega) await cargarInventarioBodega(wrapBodega);
  const wrapReposicionesHoy = document.querySelector('#inv-reposiciones-hoy-wrap');
  if (wrapReposicionesHoy) await cargarReposicionesHoy(wrapReposicionesHoy);
  const wrapMov = document.querySelector('#inv-movimientos-wrap');
  if (wrapMov) await cargarMovimientos(wrapMov);
}

// =========================================================
// Reabastecer habitación (bodega → habitación) — ver nota 132.5 al
// inicio del archivo: el formulario ya no deja elegir cualquier
// combinación. Solo aparecen habitaciones con algo pendiente, el
// selector de producto se llena SOLO con lo que le falta a la
// habitación elegida, y la cantidad viene precargada con lo que falta y
// no se puede subir más de eso.
// =========================================================
async function cargarSeccionReabastecer(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '';
    return;
  }

  const [{ data: habitacionesTodas }, { data: productos }, { data: filas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').eq('tiene_minibar', true).order('numero'),
    supabase.from('minibar_productos').select('id, nombre, categoria, cantidad_estandar').eq('activo', true).gt('cantidad_estandar', 0).order('categoria').order('nombre'),
    supabase.from('inventario_habitacion').select('habitacion_id, producto_id, cantidad_actual'),
  ]);

  const actualPorClave = new Map((filas || []).map((f) => [`${f.habitacion_id}_${f.producto_id}`, f.cantidad_actual]));

  const pendientesPorHabitacion = new Map();
  (habitacionesTodas || []).forEach((h) => {
    const pendientes = [];
    (productos || []).forEach((p) => {
      const actual = Number(actualPorClave.get(`${h.id}_${p.id}`) ?? 0);
      const falta = Number(p.cantidad_estandar) - actual;
      if (falta > 0) pendientes.push({ productoId: p.id, nombre: p.nombre, categoria: p.categoria, falta });
    });
    if (pendientes.length > 0) pendientesPorHabitacion.set(h.id, pendientes);
  });

  const habitaciones = (habitacionesTodas || []).filter((h) => pendientesPorHabitacion.has(h.id));

  if (habitaciones.length === 0) {
    elemento.innerHTML = `
      <div class="tarjeta">
        <h3>Reabastecer habitación (bodega → habitación)</h3>
        <p class="mensaje-vacio">✅ Ninguna habitación tiene pendientes ahora mismo — no hay nada que reabastecer. Puedes ver el detalle en "Pendientes de reponer".</p>
      </div>
    `;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Reabastecer habitación (bodega → habitación)</h3>
      <p class="texto-ayuda">Solo aparecen habitaciones y productos con algo pendiente, y la cantidad no puede pasar de lo que falta según el estándar — así no se puede reponer de más ni a una habitación que ya está completa.</p>
      <form id="form-reabastecer" class="form-grid">
        <label>Habitación
          <select name="habitacion_id" id="select-hab-reabastecer" required>
            ${habitaciones
              .map((h) => `<option value="${h.id}">${escaparHTML(h.numero)} — ${escaparHTML(h.nombre)} (${pendientesPorHabitacion.get(h.id).length} pendiente(s))</option>`)
              .join('')}
          </select>
        </label>
        <label>Producto
          <select name="producto_id" id="select-prod-reabastecer" required></select>
        </label>
        <label>Cantidad a trasladar
          <input type="number" name="cantidad" id="input-cantidad-reabastecer" min="1" value="1" required />
        </label>
        <button type="submit" class="btn btn-secundario btn-chico">Reabastecer</button>
      </form>
    </div>
  `;

  const selectHab = elemento.querySelector('#select-hab-reabastecer');
  const selectProd = elemento.querySelector('#select-prod-reabastecer');
  const inputCantidad = elemento.querySelector('#input-cantidad-reabastecer');

  function pintarProductos(habitacionId) {
    const pendientes = pendientesPorHabitacion.get(habitacionId) || [];
    selectProd.innerHTML = pendientes
      .map((p) => `<option value="${p.productoId}" data-falta="${p.falta}">${escaparHTML(p.nombre)} — faltan ${p.falta} (${escaparHTML(p.categoria)})</option>`)
      .join('');
    ajustarCantidadMax();
  }

  function ajustarCantidadMax() {
    const opcion = selectProd.selectedOptions[0];
    const falta = opcion ? Number(opcion.dataset.falta) : 1;
    inputCantidad.max = falta;
    inputCantidad.value = falta;
  }

  pintarProductos(Number(selectHab.value));
  selectHab.addEventListener('change', () => pintarProductos(Number(selectHab.value)));
  selectProd.addEventListener('change', ajustarCantidadMax);

  elemento.querySelector('#form-reabastecer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const habitacionId = Number(form.get('habitacion_id'));
    const productoId = Number(form.get('producto_id'));
    const opcion = selectProd.selectedOptions[0];
    const falta = opcion ? Number(opcion.dataset.falta) : Infinity;
    const cantidad = Math.min(Math.max(1, Number(form.get('cantidad')) || 0), falta);

    const ok = await ejecutarReabastecimiento(habitacionId, productoId, cantidad);
    if (!ok) return;

    await refrescarTrasReabastecer();
    await cargarSeccionReabastecer(elemento);
  });
}

// Ajusta (suma o resta) el stock de un producto en una habitación y deja
// registro en inventario_movimientos. delta positivo = entra, negativo = sale.
// A propósito NUNCA toca inventario_bodega — quien la llama decide si
// además debe moverse stock de bodega (ver ejecutarReabastecimiento /
// trasladarSinConfirmar más arriba) o no.
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
// Movimientos recientes (ver nota 129 al inicio del archivo): las
// entradas de tipo "Compra a bodega" tienen un botón "🗑" para
// eliminarlas si se registraron por error — a diferencia de solo
// borrar el registro del historial, esto TAMBIÉN resta de bodega la
// cantidad que esa compra había sumado (con tope en 0, nunca negativo),
// para que el stock quede consistente. Los demás tipos de movimiento no
// tienen esta opción todavía (son más delicados de revertir: tocan dos
// tablas a la vez o afectan a una habitación específica).
// =========================================================
async function cargarMovimientos(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeGestionar();

  const { data: movimientos, error } = await supabase
    .from('inventario_movimientos')
    .select('*, minibar_productos(nombre), habitaciones(numero)')
    .order('creado_en', { ascending: false })
    .limit(25);

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando movimientos: ${error.message}</p>`;
    return;
  }

  const porId = new Map((movimientos || []).map((m) => [m.id, m]));

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
              ${permitido ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (movimientos || [])
                .map(
                  (m) => `<tr data-id="${m.id}">
                <td>${etiquetasTipo[m.tipo] || m.tipo}</td>
                <td>${escaparHTML(m.minibar_productos?.nombre || '—')}</td>
                <td>${m.habitaciones ? escaparHTML(m.habitaciones.numero) : '—'}</td>
                <td>${m.cantidad}</td>
                <td>${formatFechaHora(m.creado_en)}</td>
                ${permitido ? `<td>${m.tipo === 'compra_bodega' ? '<button type="button" class="btn-editar btn-eliminar-compra">🗑</button>' : ''}</td>` : ''}
              </tr>`
                )
                .join('') || `<tr><td colspan="${permitido ? 6 : 5}" class="mensaje-vacio">Sin movimientos registrados todavía.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!permitido) return;

  elemento.onclick = async (e) => {
    const btn = e.target.closest('.btn-eliminar-compra');
    if (!btn) return;
    const fila = btn.closest('tr');
    const m = porId.get(Number(fila.dataset.id));
    if (!m) return;

    const ok = await mostrarConfirmacion({
      titulo: 'Eliminar entrada de compra',
      contenidoHTML: `Vas a eliminar la compra de <strong>${m.cantidad} unidad(es)</strong> de <strong>${escaparHTML(m.minibar_productos?.nombre || 'este producto')}</strong> registrada el ${formatFechaHora(m.creado_en)}. Esto también resta esa cantidad de la bodega (sin dejarla negativa). ¿Confirmas?`,
      textoConfirmar: 'Sí, eliminar',
    });
    if (!ok) return;

    btn.disabled = true;

    const { data: filaBodega, error: errBodega } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', m.producto_id)
      .maybeSingle();
    if (errBodega) {
      mostrarToast(`Error: ${errBodega.message}`, 'error');
      btn.disabled = false;
      return;
    }
    if (filaBodega) {
      const nuevaCantidad = Math.max(0, Number(filaBodega.cantidad_actual) - Number(m.cantidad));
      await supabase.from('inventario_bodega').update({ cantidad_actual: nuevaCantidad, actualizado_en: new Date().toISOString() }).eq('id', filaBodega.id);
    }

    const { error: errDelete } = await supabase.from('inventario_movimientos').delete().eq('id', m.id);
    if (errDelete) {
      mostrarToast(`Error eliminando el movimiento: ${errDelete.message}`, 'error');
      btn.disabled = false;
      return;
    }

    mostrarToast('Entrada de compra eliminada y bodega corregida.', 'exito');
    await cargarMovimientos(elemento);
    const wrapBodega = document.querySelector('#inv-bodega-wrap');
    if (wrapBodega) await cargarInventarioBodega(wrapBodega);
    const wrapMapa = document.querySelector('#inv-mapa-wrap');
    if (wrapMapa) await cargarMapaMinibares(wrapMapa);
    const wrapPendientes = document.querySelector('#inv-pendientes-wrap');
    if (wrapPendientes) await cargarPendientesReponer(wrapPendientes);
  };
}

registerModule({
  id: 'inventario',
  label: 'Inventario',
  icono: '📦',
  roles: ['propietario', 'administrador', 'bodega'],
  parentId: 'grupo-inventario',
  render,
});
