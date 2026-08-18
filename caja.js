// caja.js
//
// Módulo: "Registro diario" (antes "Registro diario de ventas" — se
// acortó el nombre visible; el id interno y el nombre del archivo se
// quedan igual para no romper nada).
//
// REDISEÑO IMPORTANTE — ya NO hay apertura/cierre manual de caja ni
// conteo de efectivo por denominación. El hotel lo atiende una sola
// persona, así que el "cambio de turno" (entrega de caja de un
// recepcionista a otro) no aplica — pedir contar billete por billete cada
// vez era innecesariamente complejo para ese caso de uso.
//
// En su lugar, TODO en esta pantalla está organizado por DÍA CALENDARIO
// (hoy, ayer, antier…), no por turno: apenas cambia la fecha (a
// medianoche), "hoy" pasa a ser el día siguiente solo, porque cada
// consulta filtra por fecha — no hace falta que nadie presione un botón
// de "cerrar" para que el día quede liquidado. El dinero recibido y
// pagado de cada día queda siempre disponible completo en "Historial por
// día" (más abajo), se haya abierto la app ese día o no. Puede haber
// huéspedes hospedados en ese momento sin ningún problema: lo que se
// liquida por día es el DINERO que entró y salió, no la ocupación de las
// habitaciones (eso lo sigue mostrando "Huéspedes alojados", en vivo).
//
// Por dentro, cada movimiento (venta de mostrador, movimiento manual,
// gasto) SIGUE guardándose ligado a un `caja_turnos` (turno_id), por
// compatibilidad con los datos históricos y porque así lo exige la base
// de datos — pero eso ahora lo administra el sistema solo, de forma
// invisible (ver `obtenerOCrearTurnoDeHoy` más abajo): si ya hay un turno
// abierto de HOY lo reutiliza, si el que estaba abierto quedó de un día
// anterior lo cierra solo (sin pedir contar efectivo) y abre uno nuevo, y
// si no hay ninguno simplemente crea uno. Nadie tiene que pensar en
// "turnos" nunca más.
//
// Los abonos de reservas (reservas_pagos, ya registrados desde Reservas y
// Recepción, incluyendo los pagos de liquidación al check-out) NO se
// duplican aquí — este módulo los LEE directamente de esa tabla y los
// muestra como "ingresos automáticos". caja_movimientos solo guarda lo que
// no nace de una reserva (gastos operativos, propinas, ingresos varios).
//
// Medios de pago: cada método (Efectivo, Nequi, Daviplata, QR,
// Transferencia Bancaria, Datáfono, Llave — ver METODOS_PAGO) se consolida
// como si fuera una cuenta aparte.
//
//   - "Desglose por medio de pago — hoy" es del día calendario de hoy.
//   - "Saldos por cuenta" (siempre visible) es de TODO el tiempo: el saldo
//     acumulado histórico de cada medio, sumando reservas_pagos +
//     caja_movimientos + caja_transferencias — ver `calcularSaldosPorCuenta`.
//     Sigue incluyendo el ajuste de los cierres reales que ya existían
//     antes de este rediseño (los últimos conteos físicos de efectivo
//     quedan como base para siempre, aunque ya no se vuelva a contar).
//
// Transferencias entre cuentas (caja_transferencias): mueven saldo de una
// cuenta a otra sin que cuente como ingreso/egreso real del negocio (por
// eso no viven en caja_movimientos).
//
// Nota (163): REDISEÑO DE PANTALLA — se reemplazó el diseño fijo de dos
// columnas (con las 9 tarjetas siempre expandidas de una vez) por el
// mismo patrón de "resumen en cuadrícula + Ver" que ya usa la pantalla
// principal de Inventario (ver inventario.js, `cargarResumenInventario` /
// `abrirModalSeccion`, nota 132.1): cada una de las 9 tarjetas
// (Huéspedes alojados, Ventas por mostrador, Gastos y compras,
// Movimientos manuales, Ingresos por reservas, Desglose por medio de
// pago, Saldos por cuenta, Consumo de minibar, Historial por día) ahora
// se ve como una mini-tarjeta compacta (ícono + título + una línea de
// resumen) en una cuadrícula, con un botón "👁️ Ver" que abre esa tarjeta
// COMPLETA (el mismo formulario/tabla de siempre, sin recortar nada) en
// una ventana emergente ancha (modal-caja-ancha, 1100px). Al cerrar esa
// ventana, la cuadrícula de resumen se recalcula sola para que los
// números queden al día. El panel "📊 Hoy" de arriba (los 3 indicadores
// grandes de venta/egresos/neto) se queda igual, fuera de la cuadrícula
// — es puro resumen, no tiene nada que "Ver" por dentro.
//
// Consecuencia técnica importante: como las 9 tarjetas ahora viven DENTRO
// de una ventana emergente (appendChild a document.body, fuera del árbol
// de `container`), las funciones que antes hacían
// `container.querySelector('#xxx-wrap')` para refrescarse a sí mismas
// después de guardar algo (abrirModalMovimiento, abrirModalTransferencia)
// ya NO pueden encontrar ese elemento por ese camino — se les pasa ahora
// el elemento directo (el mismo `elemento` que ya tenían en su clausura)
// en vez de volver a buscarlo. `refrescarTrasMovimiento` sigue usando
// `container.querySelector` porque `#resumen-dia-wrap` y
// `#resumen-secciones-wrap` SÍ siguen siendo parte fija de `container`,
// no de la ventana emergente.
//
// Nota (162, dentro de las tarjetas): "Huéspedes alojados", "Ventas por
// mostrador", "Gastos y compras" y "Movimientos manuales" ya traían sus
// tablas reducidas a solo 2-3 columnas clave + su propio botón "👁️ Ver"
// por FILA (no confundir con el "Ver" de la tarjeta completa, 163) que
// abre el resto de los datos de esa fila en una tarjeta emergente más
// chica — ver `abrirModalVerDetalle`. Con el modal ancho de 163 esto ya
// no es indispensable para evitar el scroll lateral (el modal es de
// 1100px, le sobra ancho), pero se dejó igual: no estorba y evita tener
// que volver a decidir cuántas columnas mostrar si el modal se angosta
// en pantallas chicas.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP, activarInputDinero, valorNumericoInput } from './currency.js';
import { formatFechaHora, toISODate, addDays } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { calcularHabitacionesEnUso } from './cuentas.js';

const ROLES_OPERAN_CAJA = ['propietario', 'administrador', 'recepcionista'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];

// Categorías que vienen de Gastos (gastos.js) y de Compras recibidas
// (compras.js) — se usan para separar esos egresos "reales" del día de la
// tarjeta de Movimientos manuales (que es solo para propinas, ajustes
// puntuales o cargue retroactivo). Ver `cargarGastosHoy` más abajo.
const CATEGORIAS_GASTOS = ['Agua', 'Luz', 'Gas', 'Internet', 'Aseo', 'Mantenimiento', 'Insumos', 'Nómina', 'Otro'];
const CATEGORIA_COMPRAS = 'Compras';

function puedeOperar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_OPERAN_CAJA.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// =========================================================
// Turno automático — invisible para quien usa el sistema (ver nota de
// cabecera). Se llama justo antes de insertar cualquier venta de
// mostrador / movimiento manual / gasto (ver también gastos.js y
// compras.js, que la importan de aquí).
// =========================================================
export async function obtenerOCrearTurnoDeHoy() {
  const hoyISO = toISODate(new Date());
  const usuario = getUsuarioActual();

  const { data: turnoAbierto, error } = await supabase
    .from('caja_turnos')
    .select('id, abierto_en')
    .eq('estado', 'abierta')
    .order('abierto_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (turnoAbierto) {
    if (toISODate(new Date(turnoAbierto.abierto_en)) === hoyISO) {
      return turnoAbierto;
    }
    // Quedó abierto de un día anterior (nadie usó el sistema hasta
    // después de medianoche) — se cierra solo, sin pedir conteo físico.
    await supabase
      .from('caja_turnos')
      .update({
        estado: 'cerrada',
        cerrado_en: new Date().toISOString(),
        cerrado_por: usuario?.id || null,
        observaciones_cierre: 'Cierre automático de día (Registro diario) — sin conteo físico, ya no aplica.',
      })
      .eq('id', turnoAbierto.id);
  }

  // Continuidad: la base del turno nuevo retoma el último efectivo
  // realmente contado (si alguna vez se contó) para que "Saldos por
  // cuenta" no se descuadre — ver cálculo en calcularSaldosPorCuenta.
  const { data: ultimoCerrado } = await supabase
    .from('caja_turnos')
    .select('saldo_contado')
    .eq('estado', 'cerrada')
    .order('cerrado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseContinuidad = ultimoCerrado && ultimoCerrado.saldo_contado !== null ? Number(ultimoCerrado.saldo_contado) : 0;

  const { data: turnoNuevo, error: errNuevo } = await supabase
    .from('caja_turnos')
    .insert({
      saldo_inicial: baseContinuidad,
      abierto_por: usuario?.id || null,
      observaciones_apertura: 'Apertura automática de día (Registro diario).',
    })
    .select('id, abierto_en')
    .single();

  if (errNuevo) throw errNuevo;
  return turnoNuevo;
}

// Suma ingresos/egresos por método de pago, combinando reservas_pagos
// (siempre ingreso), ventas_mostrador (siempre ingreso) y caja_movimientos
// (ingreso o egreso). Devuelve un objeto { [metodo]: { ingresos, egresos } }
// con TODOS los métodos de METODOS_PAGO presentes (aunque estén en cero).
function calcularDesglosePorMetodo(pagos, movimientos, ventasMostrador) {
  const desglose = {};
  METODOS_PAGO.forEach((m) => {
    desglose[m] = { ingresos: 0, egresos: 0 };
  });

  const bucket = (metodo) => {
    if (!desglose[metodo]) desglose[metodo] = { ingresos: 0, egresos: 0 };
    return desglose[metodo];
  };

  (pagos || []).forEach((p) => {
    bucket(p.metodo_pago || 'Efectivo').ingresos += Number(p.monto);
  });

  (ventasMostrador || []).forEach((v) => {
    bucket(v.metodo_pago || 'Efectivo').ingresos += Number(v.monto);
  });

  (movimientos || []).forEach((m) => {
    const b = bucket(m.metodo_pago || 'Efectivo');
    if (m.tipo === 'ingreso') b.ingresos += Number(m.monto);
    else b.egresos += Number(m.monto);
  });

  return desglose;
}

// --- Saldos por cuenta: acumulado de TODO el tiempo — reservas_pagos +
// caja_movimientos + caja_transferencias. ---
export async function calcularSaldosPorCuenta() {
  const [
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: transferencias, error: errTrans },
    { data: ventasMostrador, error: errVentas },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('monto, metodo_pago'),
    supabase.from('caja_movimientos').select('monto, metodo_pago, tipo'),
    supabase.from('caja_transferencias').select('monto, cuenta_origen, cuenta_destino'),
    supabase.from('ventas_mostrador').select('monto, metodo_pago'),
  ]);

  if (errPagos) throw errPagos;
  if (errMov) throw errMov;
  if (errTrans) throw errTrans;
  if (errVentas) throw errVentas;

  const saldos = {};
  METODOS_PAGO.forEach((m) => {
    saldos[m] = 0;
  });
  const bucket = (m) => {
    if (!(m in saldos)) saldos[m] = 0;
    return m;
  };

  (pagos || []).forEach((p) => {
    const m = bucket(p.metodo_pago || 'Efectivo');
    saldos[m] += Number(p.monto);
  });

  (ventasMostrador || []).forEach((v) => {
    const m = bucket(v.metodo_pago || 'Efectivo');
    saldos[m] += Number(v.monto);
  });

  (movimientos || []).forEach((mv) => {
    const m = bucket(mv.metodo_pago || 'Efectivo');
    saldos[m] += mv.tipo === 'ingreso' ? Number(mv.monto) : -Number(mv.monto);
  });

  (transferencias || []).forEach((t) => {
    const origen = bucket(t.cuenta_origen);
    const destino = bucket(t.cuenta_destino);
    saldos[origen] -= Number(t.monto);
    saldos[destino] += Number(t.monto);
  });

  // --- Ajuste por bases iniciales de los turnos (ver nota de cabecera) ---
  // Cada turno nuevo retoma como base lo que quedó contado en el cierre
  // anterior (continuidad) — ese dinero ya está explicado por los
  // ingresos/egresos ya sumados arriba, así que no se vuelve a sumar. Pero
  // la base del PRIMER turno de la historia (no hay cierre anterior que la
  // explique) es efectivo físico que ya existía ANTES de que el sistema
  // empezara a llevar la cuenta, y cualquier diferencia real detectada en
  // los cierres manuales de antes de este rediseño tampoco está explicada
  // por el ledger. Ambos casos se detectan comparando cada base con el
  // saldo_contado del cierre inmediatamente anterior.
  const { data: turnos, error: errTurnos } = await supabase
    .from('caja_turnos')
    .select('saldo_inicial, saldo_contado, estado, abierto_en')
    .order('abierto_en', { ascending: true });
  if (errTurnos) throw errTurnos;

  let saldoContadoAnterior = null;
  (turnos || []).forEach((t) => {
    const base = Number(t.saldo_inicial || 0);
    saldos['Efectivo'] += saldoContadoAnterior === null ? base : base - saldoContadoAnterior;
    if (t.estado === 'cerrada') saldoContadoAnterior = t.saldo_contado !== null ? Number(t.saldo_contado) : saldoContadoAnterior;
  });

  return saldos;
}

// =========================================================
// Exportables genéricos (Excel/PDF): CSV con BOM (Excel lo abre con doble
// clic) y vista de impresión del navegador para "Guardar como PDF".
// =========================================================
function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map((fila) => fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
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

function abrirVistaImpresion(titulo, subtitulo, cuerpoHTML) {
  const ventana = window.open('', '_blank');
  if (!ventana) {
    mostrarToast('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e inténtalo de nuevo.', 'error');
    return;
  }
  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>${escaparHTML(titulo)}</title>
      <style>
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; padding: 2rem; color: #222; }
        h1 { font-size: 1.3rem; margin-bottom: 0.1rem; }
        h2 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
        .sub { color: #666; margin-top: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.3rem; }
        th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
        th { background: #f4f4f6; }
        @media print { body { padding: 0.5rem; } }
      </style>
    </head>
    <body>
      <h1>${escaparHTML(titulo)}</h1>
      <p class="sub">${escaparHTML(subtitulo)}</p>
      ${cuerpoHTML}
    </body>
    </html>
  `);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

function filaTablaSimple(cols) {
  return `<tr>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

// =========================================================
// Ver detalle de una FILA (162) — mismo patrón que "👁️ Ver" en Bodega
// (inventario.js, ver 107): tarjeta emergente de solo lectura con los
// campos que ya no caben en la tabla reducida de cada tarjeta. `campos`
// es un arreglo de { label, valor, anchoCompleto? }.
// =========================================================
function abrirModalVerDetalle(titulo, subtitulo, campos) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>${titulo}</h3>
      ${subtitulo ? `<p class="mensaje-vacio" style="margin-top:-0.5rem;">${subtitulo}</p>` : ''}
      <div class="modal-contenido" style="display:grid; grid-template-columns:1fr 1fr; gap:0.9rem 1.5rem;">
        ${campos
          .map(
            (c) => `
          <div style="${c.anchoCompleto ? 'grid-column:1 / -1;' : ''}">
            <span class="mensaje-vacio">${c.label}</span><br />
            <strong>${c.valor}</strong>
          </div>
        `
          )
          .join('')}
      </div>
      <div class="modal-acciones" style="margin-top:1.25rem;">
        <button type="button" class="btn btn-secundario" id="btn-cerrar-ver-detalle">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-cerrar-ver-detalle').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// =========================================================
// Resumen en cuadrícula de las 9 tarjetas (163) — mismo patrón que la
// pantalla principal de Inventario (ver `cargarResumenInventario` /
// `abrirModalSeccion` en inventario.js). Cada `calcularResumenXxx` es una
// consulta liviana (solo lo necesario para la una línea de resumen); el
// contenido completo de cada tarjeta (formulario + tabla) solo se carga
// cuando se abre su "👁️ Ver".
// =========================================================
async function calcularResumenHabitacionesUso() {
  try {
    const items = await calcularHabitacionesEnUso();
    return { ocupadas: items.length, conSaldo: items.filter((i) => i.saldoPendiente > 0).length, error: false };
  } catch {
    return { ocupadas: 0, conSaldo: 0, error: true };
  }
}

async function calcularResumenVentasMostrador() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const { data } = await supabase.from('ventas_mostrador').select('monto').gte('creado_en', hoyISO).lt('creado_en', mananaISO);
  return { total: (data || []).reduce((s, v) => s + Number(v.monto), 0), cantidad: (data || []).length };
}

async function calcularResumenGastos() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const { data } = await supabase.from('caja_movimientos').select('monto, categoria').eq('tipo', 'egreso').gte('creado_en', hoyISO).lt('creado_en', mananaISO);
  const categoriasReales = new Set([...CATEGORIAS_GASTOS, CATEGORIA_COMPRAS]);
  const gastos = (data || []).filter((m) => categoriasReales.has(m.categoria));
  return { total: gastos.reduce((s, g) => s + Number(g.monto), 0), cantidad: gastos.length };
}

async function calcularResumenMovimientosManuales() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const { data } = await supabase.from('caja_movimientos').select('categoria').gte('creado_en', hoyISO).lt('creado_en', mananaISO);
  const categoriasReales = new Set([...CATEGORIAS_GASTOS, CATEGORIA_COMPRAS]);
  const movimientos = (data || []).filter((m) => !categoriasReales.has(m.categoria));
  return { cantidad: movimientos.length };
}

async function calcularResumenIngresosReservas() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const { data } = await supabase.from('reservas_pagos').select('monto').gte('fecha', hoyISO).lt('fecha', mananaISO);
  return { total: (data || []).reduce((s, p) => s + Number(p.monto), 0), cantidad: (data || []).length };
}

async function calcularResumenDesgloseHoy() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const [{ data: pagos }, { data: movimientos }, { data: ventasMostrador }] = await Promise.all([
    supabase.from('reservas_pagos').select('monto, metodo_pago').gte('fecha', hoyISO).lt('fecha', mananaISO),
    supabase.from('caja_movimientos').select('monto, metodo_pago, tipo').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
    supabase.from('ventas_mostrador').select('monto, metodo_pago').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
  ]);
  const desglose = calcularDesglosePorMetodo(pagos, movimientos, ventasMostrador);
  return {
    totalIngresos: Object.values(desglose).reduce((s, m) => s + m.ingresos, 0),
    totalEgresos: Object.values(desglose).reduce((s, m) => s + m.egresos, 0),
  };
}

async function calcularResumenSaldos() {
  const saldos = await calcularSaldosPorCuenta();
  return { total: METODOS_PAGO.reduce((s, m) => s + (saldos[m] || 0), 0) };
}

async function calcularResumenMinibarHoy() {
  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));
  const { data } = await supabase.from('minibar_consumos').select('cantidad, monto').gte('creado_en', hoyISO).lt('creado_en', mananaISO);
  return {
    total: (data || []).reduce((s, c) => s + Number(c.monto), 0),
    items: (data || []).reduce((s, c) => s + Number(c.cantidad), 0),
  };
}

// Config de las 9 secciones: id → { wrapId, cargar(elemento) }. Se arma
// como función (no como objeto suelto) porque `cargar` necesita la
// clausura de `container` para las secciones cuyas funciones originales
// piden `(container, elemento)` — ver nota de cabecera (163).
function seccionesCaja(container) {
  return {
    'habitaciones-uso': { wrapId: 'habitaciones-uso-wrap', cargar: (el) => cargarHabitacionesEnUso(el) },
    'ventas-mostrador': { wrapId: 'ventas-mostrador-wrap', cargar: (el) => cargarVentasMostradorHoy(container, el) },
    'gastos-hoy': { wrapId: 'gastos-hoy-wrap', cargar: (el) => cargarGastosHoy(el) },
    'movimientos-manuales': { wrapId: 'movimientos-manuales-wrap', cargar: (el) => cargarMovimientosManualesHoy(container, el) },
    'ingresos-reservas': { wrapId: 'ingresos-reservas-wrap', cargar: (el) => cargarIngresosReservasHoy(el) },
    'desglose-hoy': { wrapId: 'desglose-hoy-wrap', cargar: (el) => cargarDesgloseHoy(el) },
    'saldos-cuenta': { wrapId: 'saldos-cuenta-wrap', cargar: (el) => cargarSaldosPorCuenta(container, el) },
    'minibar-hoy': { wrapId: 'minibar-hoy-wrap', cargar: (el) => cargarTarjetaMinibarHoy(el) },
    'historial-dia': { wrapId: 'historial-dia-wrap', cargar: (el) => cargarHistorialPorDia(container, el) },
  };
}

function abrirModalSeccionCaja(container, id, elementoResumen) {
  const config = seccionesCaja(container)[id];
  if (!config) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha" style="max-width:1100px; width:95vw; max-height:88vh; overflow:auto;">
      <div style="display:flex; justify-content:flex-end; margin-bottom:0.5rem;">
        <button type="button" class="btn btn-secundario btn-chico" id="btn-cerrar-modal-seccion-caja">✕ Cerrar</button>
      </div>
      <div id="${config.wrapId}"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
    cargarResumenSecciones(container, elementoResumen);
  }

  overlay.querySelector('#btn-cerrar-modal-seccion-caja').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });

  config.cargar(overlay.querySelector(`#${config.wrapId}`));
}

async function cargarResumenSecciones(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const [resumenHab, resumenVentas, resumenGastos, resumenMov, resumenIngresos, resumenDesglose, resumenSaldos, resumenMinibar] = await Promise.all([
    calcularResumenHabitacionesUso(),
    calcularResumenVentasMostrador(),
    calcularResumenGastos(),
    calcularResumenMovimientosManuales(),
    calcularResumenIngresosReservas(),
    calcularResumenDesgloseHoy(),
    calcularResumenSaldos(),
    calcularResumenMinibarHoy(),
  ]);

  const tarjetas = [
    {
      id: 'habitaciones-uso',
      icono: '🧳',
      titulo: 'Huéspedes alojados',
      resumen: resumenHab.error
        ? 'Error cargando'
        : `${resumenHab.ocupadas} habitación(es) ocupada(s)${resumenHab.conSaldo > 0 ? ` · ${resumenHab.conSaldo} con saldo pendiente` : ''}`,
      alerta: resumenHab.conSaldo > 0,
      acento: 'azul',
    },
    {
      id: 'ventas-mostrador',
      icono: '🛒',
      titulo: 'Ventas por mostrador — hoy',
      resumen: resumenVentas.cantidad > 0 ? `${formatCOP(resumenVentas.total)} en ${resumenVentas.cantidad} venta(s)` : 'Sin ventas de mostrador hoy',
      acento: 'verde',
    },
    {
      id: 'gastos-hoy',
      icono: '💸',
      titulo: 'Gastos y compras — hoy',
      resumen: resumenGastos.cantidad > 0 ? `${formatCOP(resumenGastos.total)} en ${resumenGastos.cantidad} registro(s)` : 'Sin gastos ni compras registradas hoy',
      acento: 'rojo',
    },
    {
      id: 'movimientos-manuales',
      icono: '➕➖',
      titulo: 'Movimientos manuales — hoy',
      resumen: resumenMov.cantidad > 0 ? `${resumenMov.cantidad} movimiento(s) hoy` : 'Sin movimientos manuales hoy',
      acento: 'naranja',
    },
    {
      id: 'ingresos-reservas',
      icono: '🧾',
      titulo: 'Ingresos por reservas — hoy',
      resumen: resumenIngresos.cantidad > 0 ? `${formatCOP(resumenIngresos.total)} en ${resumenIngresos.cantidad} pago(s)` : 'Sin pagos de reservas hoy',
      acento: 'verde',
    },
    {
      id: 'desglose-hoy',
      icono: '💱',
      titulo: 'Desglose por medio de pago — hoy',
      resumen: `Ingresos ${formatCOP(resumenDesglose.totalIngresos)} · Egresos ${formatCOP(resumenDesglose.totalEgresos)}`,
      acento: 'azul',
    },
    {
      id: 'saldos-cuenta',
      icono: '💼',
      titulo: 'Saldos por cuenta',
      resumen: `Total acumulado: ${formatCOP(resumenSaldos.total)}`,
      acento: 'morado',
    },
    {
      id: 'minibar-hoy',
      icono: '🥤',
      titulo: 'Consumo de minibar — hoy',
      resumen: resumenMinibar.items > 0 ? `${formatCOP(resumenMinibar.total)} en ${resumenMinibar.items} producto(s)` : 'Sin consumo de minibar hoy',
      acento: 'naranja',
    },
    {
      id: 'historial-dia',
      icono: '📅',
      titulo: 'Historial por día',
      resumen: 'Últimos 10 días — con exportar a Excel/PDF',
      acento: 'morado',
    },
  ];

  elemento.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:1rem;">
      ${tarjetas
        .map(
          (t) => `
        <div class="tarjeta tarjeta-acento tarjeta-acento-${t.alerta ? 'rojo' : t.acento}">
          <h3 style="margin-top:0;">${t.icono} ${t.titulo}</h3>
          <p class="mensaje-vacio" style="margin-bottom:1rem;">${t.resumen}</p>
          <button type="button" class="btn btn-secundario btn-chico btn-ver-seccion-caja" data-id="${t.id}">👁️ Ver</button>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-seccion-caja').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalSeccionCaja(container, btn.dataset.id, elemento));
  });
}

// =========================================================
async function render(container) {
  container.innerHTML = `
    <h2>Registro diario</h2>
    <div id="resumen-dia-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="resumen-secciones-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  await Promise.all([
    cargarResumenDelDia(container.querySelector('#resumen-dia-wrap')),
    cargarResumenSecciones(container, container.querySelector('#resumen-secciones-wrap')),
  ]);
}

// Refresca las tarjetas cuya cifra cambia después de registrar una venta
// de mostrador o un movimiento manual — `#resumen-dia-wrap` y
// `#resumen-secciones-wrap` siguen siendo parte fija de `container` (no
// viven dentro de una ventana emergente), así que sí se pueden encontrar
// por este camino.
async function refrescarTrasMovimiento(container) {
  const wrapResumen = container.querySelector('#resumen-dia-wrap');
  if (wrapResumen) await cargarResumenDelDia(wrapResumen);
  const wrapSecciones = container.querySelector('#resumen-secciones-wrap');
  if (wrapSecciones) await cargarResumenSecciones(container, wrapSecciones);
}

// =========================================================
// Resumen del día — lo primero que se ve, arriba de la cuadrícula.
// =========================================================
async function cargarResumenDelDia(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando el resumen del día…</p>';

  const hoy = new Date();
  const hoyISO = toISODate(hoy);
  const mananaISO = toISODate(addDays(hoy, 1));

  const [{ data: pagosHoy, error: errPagos }, { data: movimientosHoy, error: errMov }, { data: ventasHoy, error: errVentas }] = await Promise.all([
    supabase.from('reservas_pagos').select('monto').gte('fecha', hoyISO).lt('fecha', mananaISO),
    supabase.from('caja_movimientos').select('monto, tipo').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
    supabase.from('ventas_mostrador').select('monto').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
  ]);

  const error = errPagos || errMov || errVentas;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el resumen del día: ${error.message}</p>`;
    return;
  }

  const ventasReservasHoy = (pagosHoy || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ventasManualesHoy = (movimientosHoy || []).filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const ventasMostradorHoy = (ventasHoy || []).reduce((sum, v) => sum + Number(v.monto), 0);
  const egresosHoy = (movimientosHoy || []).filter((m) => m.tipo === 'egreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const totalVentasHoy = ventasReservasHoy + ventasManualesHoy + ventasMostradorHoy;
  const netoHoy = totalVentasHoy - egresosHoy;

  const fechaBonita = hoy.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const fechaCapitalizada = fechaBonita.charAt(0).toUpperCase() + fechaBonita.slice(1);

  elemento.innerHTML = `
    <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.6rem; align-items:center;">
      <h2 style="margin:0;">📊 Hoy — ${fechaCapitalizada}</h2>
      <button type="button" id="btn-refrescar-resumen-dia" class="btn btn-secundario btn-chico">🔄 Actualizar</button>
    </div>
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">💵 Ventas de hoy</div>
        <div class="stat-card-valor">${formatCOP(totalVentasHoy)}</div>
        <div class="stat-card-subtitulo">Estadías: ${formatCOP(ventasReservasHoy)} · Mostrador: ${formatCOP(ventasMostradorHoy)} · Otras: ${formatCOP(ventasManualesHoy)}</div>
      </div>
      <div class="stat-card stat-card-rojo">
        <div class="stat-card-label">↘️ Egresos de hoy</div>
        <div class="stat-card-valor">${formatCOP(egresosHoy)}</div>
        <div class="stat-card-subtitulo">Gastos y salidas manuales registradas hoy</div>
      </div>
      <div class="stat-card ${netoHoy >= 0 ? 'stat-card-azul' : 'stat-card-naranja'}">
        <div class="stat-card-label">⚖️ Neto del día</div>
        <div class="stat-card-valor">${formatCOP(netoHoy)}</div>
        <div class="stat-card-subtitulo">Ventas menos egresos de hoy</div>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-refrescar-resumen-dia').addEventListener('click', () => cargarResumenDelDia(elemento));
}

// =========================================================
// Huéspedes alojados — lo más operativo y urgente: quién debe qué.
//
// Nota (162): tabla reducida de 6 a 3 columnas (Habitación, Huésped,
// Saldo pendiente) + botón "👁️ Ver" que abre el detalle completo
// (Ingreso, Monto total, Abonado) en una tarjeta emergente — ver
// `abrirModalVerDetalle`.
// =========================================================
async function cargarHabitacionesEnUso(elemento) {
  if (!elemento) return;
  elemento.innerHTML = `<p class="mensaje-vacio">Cargando habitaciones en uso…</p>`;

  let items = [];
  try {
    items = await calcularHabitacionesEnUso();
  } catch (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones en uso: ${error.message}</p>`;
    return;
  }

  const conSaldo = items.filter((i) => i.saldoPendiente > 0).length;

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-azul">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.75rem;">
        <h3 style="margin:0;">🧳 Huéspedes alojados ${items.length ? `(${items.length})` : ''}</h3>
        <button type="button" id="btn-refrescar-habitaciones-uso" class="btn btn-secundario btn-chico">🔄 Actualizar</button>
      </div>
      ${
        conSaldo > 0
          ? `<p class="mensaje-vacio" style="color:var(--color-rojo-oscuro); font-weight:600;">${conSaldo} habitación(es) con saldo pendiente por liquidar.</p>`
          : ''
      }
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Habitación</th><th>Huésped</th><th>Saldo pendiente</th><th></th></tr></thead>
          <tbody>
            ${
              items
                .map(
                  (i, idx) => `<tr>
                    <td>${escaparHTML(i.habitacionLabel)}</td>
                    <td>${escaparHTML(i.huespedNombre)}</td>
                    <td style="color:${i.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">
                      ${formatCOP(i.saldoPendiente)}
                      ${i.excedente > 0 ? `<div style="font-size:0.72rem; font-weight:700; color:#6a3fb5;">↑ excedente ${formatCOP(i.excedente)}</div>` : ''}
                    </td>
                    <td><button type="button" class="btn-editar btn-ver-habitacion-uso" data-idx="${idx}">👁️ Ver</button></td>
                  </tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">No hay habitaciones ocupadas ahora mismo.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.75rem;">El saldo se liquida desde Recepción al hacer check-out.</p>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-habitacion-uso').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = items[Number(btn.dataset.idx)];
      abrirModalVerDetalle(`${escaparHTML(i.habitacionLabel)} — ${escaparHTML(i.huespedNombre)}`, 'Huésped alojado ahora mismo', [
        { label: 'Ingreso', valor: formatFechaHora(i.horaIngreso) },
        {
          label: 'Saldo pendiente',
          valor: `<span style="color:${i.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'};">${formatCOP(i.saldoPendiente)}</span>`,
        },
        { label: 'Monto total', valor: formatCOP(i.montoTotal) },
        { label: 'Abonado', valor: formatCOP(i.totalAbonado) },
        ...(i.excedente > 0 ? [{ label: 'Excedente (pagó de más)', valor: `<span style="color:#6a3fb5; font-weight:700;">${formatCOP(i.excedente)}</span>` }] : []),
      ]);
    });
  });

  elemento.querySelector('#btn-refrescar-habitaciones-uso').addEventListener('click', () => cargarHabitacionesEnUso(elemento));
}

// =========================================================
// Ventas por mostrador — hoy. Productos de bodega vendidos directo en
// Recepción a un cliente que no se hospeda. Ya no depende de que haya
// "caja abierta": siempre se puede registrar, el turno del día se
// resuelve solo por dentro (obtenerOCrearTurnoDeHoy).
//
// Nota (162): tabla reducida de 6 a 3 columnas (Hora, Producto, Monto) +
// botón "👁️ Ver" con Cantidad, Método y Cliente en el detalle.
// =========================================================
async function cargarVentasMostradorHoy(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeOperar();

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const [{ data: bodega, error: errBodega }, { data: productos, error: errProductos }, { data: ventasHoy, error: errVentas }] = await Promise.all([
    supabase.from('inventario_bodega').select('producto_id, cantidad_actual'),
    supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre'),
    supabase
      .from('ventas_mostrador')
      .select('*, minibar_productos(nombre)')
      .gte('creado_en', hoyISO)
      .lt('creado_en', mananaISO)
      .order('creado_en', { ascending: false }),
  ]);

  if (errBodega || errProductos || errVentas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando ventas de mostrador: ${(errBodega || errProductos || errVentas).message}</p>`;
    return;
  }

  const stockPorProducto = new Map((bodega || []).map((b) => [b.producto_id, b.cantidad_actual]));
  const categorias = [...new Set((productos || []).map((p) => p.categoria))];
  const totalVentas = (ventasHoy || []).reduce((sum, v) => sum + Number(v.monto), 0);

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-verde">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">🛒 Ventas por mostrador — hoy</h3>
        <strong style="font-size:1.1rem;">${formatCOP(totalVentas)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.75rem;">Para un cliente que compra algo del inventario sin hospedarse — no queda ligado a ninguna habitación ni huésped, solo descuenta bodega y suma a la venta del día.</p>
      ${
        permitido
          ? `
        <form id="form-venta-mostrador" class="form-grid">
          <label>Producto
            <select name="producto_id" required>
              ${categorias
                .map(
                  (cat) => `
                <optgroup label="${escaparHTML(cat)}">
                  ${(productos || [])
                    .filter((p) => p.categoria === cat)
                    .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)} — ${formatCOP(p.precio)} (${stockPorProducto.get(p.id) || 0} en bodega)</option>`)
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
          <label>Método de pago
            <select name="metodo_pago" required>
              <option value="">— Elige a qué cuenta va —</option>
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Cliente <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="cliente_nombre" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-secundario btn-chico">+ Registrar venta</button>
        </form>
      `
          : ''
      }
      <div class="tabla-scroll" style="margin-top:0.75rem;">
        <table class="tabla-simple">
          <thead><tr><th>Hora</th><th>Producto</th><th>Monto</th><th></th></tr></thead>
          <tbody>
            ${
              (ventasHoy || [])
                .map(
                  (v, idx) =>
                    `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${formatCOP(v.monto)}</td><td><button type="button" class="btn-editar btn-ver-venta-mostrador" data-idx="${idx}">👁️ Ver</button></td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin ventas de mostrador hoy.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-venta-mostrador').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (ventasHoy || [])[Number(btn.dataset.idx)];
      abrirModalVerDetalle(v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : 'Venta de mostrador', formatFechaHora(v.creado_en), [
        { label: 'Cantidad', valor: v.cantidad },
        { label: 'Monto', valor: formatCOP(v.monto) },
        { label: 'Método de pago', valor: escaparHTML(v.metodo_pago || '—') },
        { label: 'Cliente', valor: escaparHTML(v.cliente_nombre || '—') },
      ]);
    });
  });

  if (!permitido) return;

  elemento.querySelector('#form-venta-mostrador').addEventListener('submit', async (e) => {
    e.preventDefault();

    const form = new FormData(e.target);
    const productoId = Number(form.get('producto_id'));
    const cantidad = Number(form.get('cantidad'));
    const producto = (productos || []).find((p) => p.id === productoId);
    if (!producto) return;

    const stockDisponible = stockPorProducto.get(productoId) || 0;
    if (cantidad > stockDisponible) {
      const seguir = await mostrarConfirmacion({
        titulo: 'Stock insuficiente en bodega',
        contenidoHTML: `En bodega solo hay ${stockDisponible} unidad(es) registradas de ${escaparHTML(producto.nombre)}. ¿Continuar de todas formas?`,
        textoConfirmar: 'Continuar',
      });
      if (!seguir) return;
    }

    let turno;
    try {
      turno = await obtenerOCrearTurnoDeHoy();
    } catch (errTurno) {
      mostrarToast(`No se pudo registrar la venta: ${errTurno.message}`, 'error');
      return;
    }

    const monto = producto.precio * cantidad;
    const usuario = getUsuarioActual();

    const { error: errVenta } = await supabase.from('ventas_mostrador').insert({
      turno_id: turno.id,
      producto_id: productoId,
      cantidad,
      precio_unitario: producto.precio,
      monto,
      metodo_pago: form.get('metodo_pago'),
      cliente_nombre: form.get('cliente_nombre').trim() || null,
      registrado_por: usuario?.id || null,
    });

    if (errVenta) {
      mostrarToast(`Error registrando la venta: ${errVenta.message}`, 'error');
      return;
    }

    const { data: filaBodega } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', productoId)
      .maybeSingle();

    if (filaBodega) {
      await supabase
        .from('inventario_bodega')
        .update({ cantidad_actual: filaBodega.cantidad_actual - cantidad, actualizado_en: new Date().toISOString() })
        .eq('id', filaBodega.id);
    }

    await supabase.from('inventario_movimientos').insert({
      tipo: 'venta_mostrador',
      producto_id: productoId,
      cantidad,
      notas: 'Venta directa por mostrador.',
      registrado_por: usuario?.id || null,
    });

    mostrarToast('Venta registrada.', 'exito');
    document.dispatchEvent(new CustomEvent('inventario:actualizado'));
    await cargarVentasMostradorHoy(container, elemento);
    await refrescarTrasMovimiento(container);
  });
}

// =========================================================
// Gastos y compras — hoy. Egresos REALES del día: lo pagado desde Gastos
// (agua, luz, gas, insumos, etc. — ver gastos.js) y las compras a
// proveedores ya recibidas (ver compras.js). Ambos módulos guardan sus
// egresos como un caja_movimientos más, así que esta tarjeta simplemente
// los filtra por categoría y los muestra juntos.
//
// Nota (162): tabla reducida de 5 a 3 columnas (Hora, Categoría, Monto) +
// botón "👁️ Ver" con Método y Detalle.
// =========================================================
async function cargarGastosHoy(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const { data: movimientos, error } = await supabase
    .from('caja_movimientos')
    .select('*')
    .eq('tipo', 'egreso')
    .gte('creado_en', hoyISO)
    .lt('creado_en', mananaISO)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando gastos: ${error.message}</p>`;
    return;
  }

  const categoriasReales = new Set([...CATEGORIAS_GASTOS, CATEGORIA_COMPRAS]);
  const gastos = (movimientos || []).filter((m) => categoriasReales.has(m.categoria));
  const total = gastos.reduce((sum, g) => sum + Number(g.monto), 0);

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-rojo">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">💸 Gastos y compras — hoy</h3>
        <strong>${formatCOP(total)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.5rem;">Pagos operativos de hoy (agua, luz, gas, insumos… — módulo Gastos) y compras a proveedores ya recibidas (módulo Compras).</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Hora</th><th>Categoría</th><th>Monto</th><th></th></tr></thead>
          <tbody>
            ${
              gastos
                .map(
                  (g, idx) =>
                    `<tr><td>${formatFechaHora(g.creado_en)}</td><td>${escaparHTML(g.categoria || '—')}</td><td>${formatCOP(g.monto)}</td><td><button type="button" class="btn-editar btn-ver-gasto" data-idx="${idx}">👁️ Ver</button></td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin gastos ni compras registradas hoy.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-gasto').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = gastos[Number(btn.dataset.idx)];
      abrirModalVerDetalle(escaparHTML(g.categoria || 'Gasto'), formatFechaHora(g.creado_en), [
        { label: 'Monto', valor: formatCOP(g.monto) },
        { label: 'Método de pago', valor: escaparHTML(g.metodo_pago || '—') },
        { label: 'Detalle', valor: escaparHTML(g.descripcion || '—'), anchoCompleto: true },
      ]);
    });
  });
}

// =========================================================
// Movimientos manuales — hoy. Ingresos o egresos que NO son venta de
// mostrador, gasto operativo (ver arriba) ni compra recibida — ej.
// propinas, ajustes puntuales, o cargue retroactivo de un día anterior
// con "Fecha y hora". Se excluyen aquí los de Gastos/Compras para no
// mostrarlos duplicados en las dos tarjetas.
//
// Nota (162): tabla reducida de 6 a 3 columnas (Hora, Tipo, Monto) +
// botón "👁️ Ver" con Categoría, Método y Descripción.
// =========================================================
async function cargarMovimientosManualesHoy(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeOperar();

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const { data: movimientosCrudos, error } = await supabase
    .from('caja_movimientos')
    .select('*')
    .gte('creado_en', hoyISO)
    .lt('creado_en', mananaISO)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando movimientos: ${error.message}</p>`;
    return;
  }

  const categoriasReales = new Set([...CATEGORIAS_GASTOS, CATEGORIA_COMPRAS]);
  const movimientos = (movimientosCrudos || []).filter((m) => !categoriasReales.has(m.categoria));

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-naranja">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">➕➖ Movimientos manuales — hoy</h3>
        ${permitido ? '<button type="button" id="btn-nuevo-movimiento" class="btn btn-secundario btn-chico">+ Movimiento</button>' : ''}
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.5rem;">Ingresos o egresos que no son venta de mostrador, gasto operativo (ver arriba) ni compra recibida — ej. propinas, ajustes puntuales.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Hora</th><th>Tipo</th><th>Monto</th><th></th></tr></thead>
          <tbody>
            ${
              movimientos
                .map(
                  (m, idx) =>
                    `<tr><td>${formatFechaHora(m.creado_en)}</td><td>${m.tipo === 'ingreso' ? '⬆️ Ingreso' : '⬇️ Egreso'}</td><td>${formatCOP(m.monto)}</td><td><button type="button" class="btn-editar btn-ver-movimiento" data-idx="${idx}">👁️ Ver</button></td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin movimientos manuales hoy.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-movimiento').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = movimientos[Number(btn.dataset.idx)];
      abrirModalVerDetalle(
        escaparHTML(m.categoria || (m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso')),
        `${m.tipo === 'ingreso' ? '⬆️ Ingreso' : '⬇️ Egreso'} · ${formatFechaHora(m.creado_en)}`,
        [
          { label: 'Monto', valor: formatCOP(m.monto) },
          { label: 'Método de pago', valor: escaparHTML(m.metodo_pago || '—') },
          { label: 'Descripción', valor: escaparHTML(m.descripcion || '—'), anchoCompleto: true },
        ]
      );
    });
  });

  if (!permitido) return;

  elemento.querySelector('#btn-nuevo-movimiento').addEventListener('click', () => abrirModalMovimiento(container, elemento));
}

async function abrirModalMovimiento(container, elementoSeccion) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>Nuevo movimiento</h3>
      <form id="form-movimiento" class="modal-contenido">
        <div class="form-grid">
          <label>Tipo
            <select name="tipo" required>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </label>
          <label>Categoría
            <input type="text" name="categoria" placeholder="Ej: Propina, Ajuste de caja, Descuadre" />
          </label>
          <p class="mensaje-vacio" style="grid-column:1/-1; margin:-0.5rem 0 0; font-size:0.72rem;">Evita usar aquí nombres de categorías de Gastos (Agua, Luz, Gas…) o "Compras" — esos se registran desde esos módulos para que aparezcan en su propia tarjeta.</p>
          <label>Monto
            <input type="text" name="monto" id="input-monto-movimiento" placeholder="$0" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago" required>
              <option value="">— Elige a qué cuenta va —</option>
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Fecha y hora <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional — para cargue retroactivo)</span>
            <input type="datetime-local" name="fecha_manual" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Descripción
          <textarea name="descripcion" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
        <p class="mensaje-vacio" style="margin-top:0.5rem; font-size:0.78rem;">Deja "Fecha y hora" vacío para usar el momento actual. Solo cámbialo para cargar a mano un movimiento de un día anterior.</p>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-movimiento">Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const inputMontoMovimiento = overlay.querySelector('#input-monto-movimiento');
  activarInputDinero(inputMontoMovimiento);

  overlay.querySelector('#btn-cancelar-movimiento').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-movimiento').addEventListener('submit', async (e) => {
    e.preventDefault();

    const montoValor = valorNumericoInput(inputMontoMovimiento);
    if (montoValor <= 0) {
      mostrarToast('Ingresa un monto válido.', 'error');
      return;
    }

    let turno;
    try {
      turno = await obtenerOCrearTurnoDeHoy();
    } catch (errTurno) {
      mostrarToast(`Error: ${errTurno.message}`, 'error');
      return;
    }

    const form = new FormData(e.target);
    const usuario = getUsuarioActual();
    const fechaManual = form.get('fecha_manual');
    const payload = {
      turno_id: turno.id,
      tipo: form.get('tipo'),
      categoria: form.get('categoria').trim() || null,
      monto: montoValor,
      metodo_pago: form.get('metodo_pago'),
      descripcion: form.get('descripcion').trim() || null,
      registrado_por: usuario.id,
    };
    if (fechaManual) payload.creado_en = new Date(fechaManual).toISOString();

    const { error } = await supabase.from('caja_movimientos').insert(payload);
    if (error) {
      mostrarToast(`Error: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Movimiento registrado.', 'exito');
    overlay.remove();

    if (elementoSeccion) await cargarMovimientosManualesHoy(container, elementoSeccion);
    await refrescarTrasMovimiento(container);
  });
}

// =========================================================
// Ingresos por reservas — hoy (automáticos).
// =========================================================
async function cargarIngresosReservasHoy(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const { data: pagos, error } = await supabase
    .from('reservas_pagos')
    .select('*')
    .gte('fecha', hoyISO)
    .lt('fecha', mananaISO)
    .order('fecha', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando ingresos por reservas: ${error.message}</p>`;
    return;
  }

  const total = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-verde">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">🧾 Ingresos por reservas — hoy</h3>
        <strong style="font-size:1.1rem;">${formatCOP(total)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.5rem;">Automáticos — abonos y pagos de check-in/check-out ya registrados hoy desde Reservas y Recepción.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Hora</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
          <tbody>
            ${
              (pagos || [])
                .map(
                  (p) =>
                    `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${escaparHTML(p.metodo_pago || '—')}</td><td>${escaparHTML(p.comentarios || '—')}</td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin pagos de reservas hoy.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =========================================================
// Desglose por medio de pago — hoy.
// =========================================================
async function cargarDesgloseHoy(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }, { data: ventasMostrador, error: errVentas }] = await Promise.all([
    supabase.from('reservas_pagos').select('monto, metodo_pago').gte('fecha', hoyISO).lt('fecha', mananaISO),
    supabase.from('caja_movimientos').select('monto, metodo_pago, tipo').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
    supabase.from('ventas_mostrador').select('monto, metodo_pago').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
  ]);

  if (errPagos || errMov || errVentas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el desglose: ${(errPagos || errMov || errVentas).message}</p>`;
    return;
  }

  const desglose = calcularDesglosePorMetodo(pagos, movimientos, ventasMostrador);
  const metodosPresentes = Array.from(new Set([...METODOS_PAGO, ...Object.keys(desglose)]));
  const totalIngresos = Object.values(desglose).reduce((sum, m) => sum + m.ingresos, 0);
  const totalEgresos = Object.values(desglose).reduce((sum, m) => sum + m.egresos, 0);

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-azul">
      <h3>💱 Desglose por medio de pago — hoy</h3>
      <table class="tabla-simple">
        <thead><tr><th>Medio</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead>
        <tbody>
          ${metodosPresentes
            .map((m) => {
              const d = desglose[m] || { ingresos: 0, egresos: 0 };
              const neto = d.ingresos - d.egresos;
              return `<tr><td>${escaparHTML(m)}${m === 'Efectivo' ? ' 💵' : ''}</td><td>${formatCOP(d.ingresos)}</td><td>${formatCOP(d.egresos)}</td><td style="font-weight:700;">${formatCOP(neto)}</td></tr>`;
            })
            .join('')}
          <tr style="font-weight:700;"><td>Total</td><td>${formatCOP(totalIngresos)}</td><td>${formatCOP(totalEgresos)}</td><td>${formatCOP(totalIngresos - totalEgresos)}</td></tr>
        </tbody>
      </table>
      <p class="mensaje-vacio" style="margin-top:0.5rem;">Todo lo que entró y salió hoy, agrupado por medio de pago — incluye estadías, mostrador y movimientos manuales.</p>
    </div>
  `;
}

// =========================================================
// Saldos por cuenta + transferencias.
// =========================================================
async function cargarSaldosPorCuenta(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando saldos por cuenta…</p>';

  let saldos;
  try {
    saldos = await calcularSaldosPorCuenta();
  } catch (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando saldos por cuenta: ${error.message}</p>`;
    return;
  }

  const total = METODOS_PAGO.reduce((sum, m) => sum + (saldos[m] || 0), 0);
  const permitido = puedeOperar();

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-morado">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.75rem; flex-wrap:wrap;">
        <h3 style="margin:0;">💼 Saldos por cuenta <span class="mensaje-vacio" style="font-weight:400;">(acumulado histórico)</span></h3>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${permitido ? '<button type="button" id="btn-transferir-cuentas" class="btn btn-secundario btn-chico">🔁 Transferir entre cuentas</button>' : ''}
          <button type="button" id="btn-exportar-csv-saldos" class="btn btn-secundario btn-chico">⬇ Excel</button>
          <button type="button" id="btn-exportar-pdf-saldos" class="btn btn-secundario btn-chico">⬇ PDF</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Cuenta</th><th>Saldo acumulado</th></tr></thead>
          <tbody>
            ${METODOS_PAGO.map(
              (m) => `<tr><td>${m}${m === 'Efectivo' ? ' 💵' : ''}</td><td class="monto" style="font-weight:600;">${formatCOP(saldos[m] || 0)}</td></tr>`
            ).join('')}
            <tr style="font-weight:700;"><td>Total</td><td class="monto">${formatCOP(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.6rem;">Es el saldo acumulado de siempre por cada medio de pago. Usa "Transferir entre cuentas" para mover saldo de un medio a otro — por ejemplo, consolidar lo acumulado en Nequi hacia Efectivo o hacia una cuenta bancaria.</p>
    </div>
  `;

  if (permitido) {
    elemento.querySelector('#btn-transferir-cuentas').addEventListener('click', () => abrirModalTransferencia(container, elemento, saldos));
  }

  elemento.querySelector('#btn-exportar-csv-saldos').addEventListener('click', () => {
    const filas = [
      ['Saldos por cuenta — Santa Ana House 21'],
      ['Generado', formatFechaHora(new Date().toISOString())],
      [],
      ['Cuenta', 'Saldo acumulado'],
      ...METODOS_PAGO.map((m) => [m, saldos[m] || 0]),
      ['Total', total],
    ];
    descargarCSV('saldos-por-cuenta.csv', filas);
  });

  elemento.querySelector('#btn-exportar-pdf-saldos').addEventListener('click', () => {
    const cuerpo = `
      <table>
        <thead><tr><th>Cuenta</th><th>Saldo acumulado</th></tr></thead>
        <tbody>
          ${METODOS_PAGO.map((m) => filaTablaSimple([m, formatCOP(saldos[m] || 0)])).join('')}
          <tr style="font-weight:700;">${filaTablaSimple(['Total', formatCOP(total)])}</tr>
        </tbody>
      </table>
    `;
    abrirVistaImpresion('Saldos por cuenta — Santa Ana House 21', `Generado ${formatFechaHora(new Date().toISOString())}`, cuerpo);
  });
}

async function abrirModalTransferencia(container, elementoSeccion, saldosActuales) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>🔁 Transferir entre cuentas</h3>
      <form id="form-transferencia">
        <div class="modal-contenido">
          <p class="mensaje-vacio">Mueve saldo de una cuenta a otra — no cuenta como ingreso ni egreso del negocio, solo reubica dónde está la plata.</p>
          <div class="form-grid">
            <label>Desde
              <select name="cuenta_origen" required>
                ${METODOS_PAGO.map((m) => `<option value="${m}">${m} — ${formatCOP(saldosActuales[m] || 0)}</option>`).join('')}
              </select>
            </label>
            <label>Hacia
              <select name="cuenta_destino" required>
                ${METODOS_PAGO.map((m, idx) => `<option value="${m}" ${idx === 1 ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </label>
            <label>Monto
              <input type="text" name="monto" id="input-monto-transferencia" placeholder="$0" required />
            </label>
          </div>
          <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
            Motivo (opcional)
            <input type="text" name="motivo" placeholder="Ej: consignación a la cuenta bancaria del negocio" style="text-transform:none; padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;" />
          </label>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-transferencia">Cancelar</button>
          <button type="submit" class="btn btn-primario">Transferir</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const inputMontoTransferencia = overlay.querySelector('#input-monto-transferencia');
  activarInputDinero(inputMontoTransferencia);

  overlay.querySelector('#btn-cancelar-transferencia').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-transferencia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const cuentaOrigen = form.get('cuenta_origen');
    const cuentaDestino = form.get('cuenta_destino');
    const monto = valorNumericoInput(inputMontoTransferencia);

    if (monto <= 0) {
      mostrarToast('Ingresa un monto válido.', 'error');
      return;
    }

    if (cuentaOrigen === cuentaDestino) {
      mostrarToast('La cuenta de origen y destino no pueden ser la misma.', 'error');
      return;
    }

    const saldoOrigen = saldosActuales[cuentaOrigen] || 0;
    if (monto > saldoOrigen) {
      const ok = await mostrarConfirmacion({
        titulo: 'Saldo insuficiente en la cuenta de origen',
        contenidoHTML: `<strong>${escaparHTML(cuentaOrigen)}</strong> tiene un saldo acumulado de <strong>${formatCOP(saldoOrigen)}</strong>, menor al monto a transferir (<strong>${formatCOP(monto)}</strong>). Esto dejaría esa cuenta en negativo. ¿Transferir de todas formas?`,
        textoConfirmar: 'Sí, transferir de todas formas',
      });
      if (!ok) return;
    }

    const usuario = getUsuarioActual();
    const { error } = await supabase.from('caja_transferencias').insert({
      cuenta_origen: cuentaOrigen,
      cuenta_destino: cuentaDestino,
      monto,
      motivo: form.get('motivo').trim() || null,
      registrado_por: usuario?.id || null,
    });

    if (error) {
      mostrarToast(`Error registrando la transferencia: ${error.message}`, 'error');
      return;
    }

    mostrarToast(`Transferidos ${formatCOP(monto)} de ${cuentaOrigen} a ${cuentaDestino}.`, 'exito');
    overlay.remove();
    if (elementoSeccion) await cargarSaldosPorCuenta(container, elementoSeccion);
  });
}

// =========================================================
// Consumo de minibar del día calendario de hoy (informativo). No se suma
// aparte al desglose por método de pago porque ese dinero ya entra ahí
// solo, cuando el huésped liquida el minibar al hacer check-out (ver
// recepcion.js).
// =========================================================
async function cargarTarjetaMinibarHoy(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando consumo de minibar…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const { data: consumos, error } = await supabase
    .from('minibar_consumos')
    .select('cantidad, monto, creado_en, minibar_productos(nombre)')
    .gte('creado_en', hoyISO)
    .lt('creado_en', mananaISO)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando consumo de minibar: ${error.message}</p>`;
    return;
  }

  const totalMonto = (consumos || []).reduce((sum, c) => sum + Number(c.monto), 0);
  const totalItems = (consumos || []).reduce((sum, c) => sum + Number(c.cantidad), 0);

  const porProducto = new Map();
  (consumos || []).forEach((c) => {
    const nombre = c.minibar_productos ? c.minibar_productos.nombre : 'Producto eliminado';
    const actual = porProducto.get(nombre) || { cantidad: 0, monto: 0 };
    actual.cantidad += Number(c.cantidad);
    actual.monto += Number(c.monto);
    porProducto.set(nombre, actual);
  });

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-naranja">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">🥤 Consumo de minibar — hoy</h3>
        <strong style="font-size:1.2rem;">${formatCOP(totalMonto)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.5rem;">${totalItems} producto(s) consumido(s) hoy — movimiento de inventario. El cobro real ya queda incluido en "Ingresos por reservas" en cuanto el huésped liquida el minibar al hacer check-out.</p>
      ${
        porProducto.size === 0
          ? '<p class="mensaje-vacio">Sin consumo de minibar hoy.</p>'
          : `
        <table class="tabla-simple">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th></tr></thead>
          <tbody>
            ${Array.from(porProducto.entries())
              .sort((a, b) => b[1].monto - a[1].monto)
              .map(([nombre, d]) => `<tr><td>${escaparHTML(nombre)}</td><td>${d.cantidad}</td><td>${formatCOP(d.monto)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      `
      }
    </div>
  `;
}

// =========================================================
// Historial por día — reemplaza la antigua bitácora de "cierres de
// turno". Muestra los últimos días con sus totales, y "Ver detalle" abre
// el desglose completo con exportar.
// =========================================================
async function cargarHistorialPorDia(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando historial…</p>';

  const DIAS_A_MOSTRAR = 10;
  const hoy = new Date();
  const desdeISO = toISODate(addDays(hoy, -(DIAS_A_MOSTRAR - 1)));
  const hastaISO = toISODate(addDays(hoy, 1));

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }, { data: ventasMostrador, error: errVentas }] = await Promise.all([
    supabase.from('reservas_pagos').select('monto, fecha').gte('fecha', desdeISO).lt('fecha', hastaISO),
    supabase.from('caja_movimientos').select('monto, tipo, creado_en').gte('creado_en', desdeISO).lt('creado_en', hastaISO),
    supabase.from('ventas_mostrador').select('monto, creado_en').gte('creado_en', desdeISO).lt('creado_en', hastaISO),
  ]);

  if (errPagos || errMov || errVentas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el historial: ${(errPagos || errMov || errVentas).message}</p>`;
    return;
  }

  const hoyISO = toISODate(hoy);
  const dias = [];
  for (let i = 0; i < DIAS_A_MOSTRAR; i++) {
    dias.push(toISODate(addDays(hoy, -i)));
  }

  function totalesDelDia(fechaISO) {
    const ingresosReservas = (pagos || []).filter((p) => toISODate(new Date(p.fecha)) === fechaISO).reduce((sum, p) => sum + Number(p.monto), 0);
    const ventasHoy = (ventasMostrador || []).filter((v) => toISODate(new Date(v.creado_en)) === fechaISO).reduce((sum, v) => sum + Number(v.monto), 0);
    const movDia = (movimientos || []).filter((m) => toISODate(new Date(m.creado_en)) === fechaISO);
    const ingresosManuales = movDia.filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
    const egresos = movDia.filter((m) => m.tipo === 'egreso').reduce((sum, m) => sum + Number(m.monto), 0);
    const ingresos = ingresosReservas + ventasHoy + ingresosManuales;
    return { ingresos, egresos, neto: ingresos - egresos };
  }

  elemento.innerHTML = `
    <div class="tarjeta tarjeta-acento tarjeta-acento-morado">
      <h3>📅 Historial por día</h3>
      <p class="mensaje-vacio" style="margin-bottom:0.6rem;">Últimos ${DIAS_A_MOSTRAR} días — "Ver detalle" muestra el desglose completo, con exportar a Excel/PDF.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Día</th><th>Ingresos</th><th>Egresos</th><th>Neto</th><th></th></tr></thead>
          <tbody>
            ${dias
              .map((fechaISO, idx) => {
                const t = totalesDelDia(fechaISO);
                const esHoy = fechaISO === hoyISO;
                return `
                  <tr ${esHoy ? 'style="background:rgba(30,78,140,0.06);"' : ''}>
                    <td>${fechaISO}${esHoy ? ' <span class="mensaje-vacio">(hoy)</span>' : ''}</td>
                    <td>${formatCOP(t.ingresos)}</td>
                    <td>${formatCOP(t.egresos)}</td>
                    <td style="font-weight:700; color:${t.neto >= 0 ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)'};">${formatCOP(t.neto)}</td>
                    <td><button type="button" class="btn-editar btn-ver-detalle-dia" data-fecha="${fechaISO}" data-idx="${idx}">Ver detalle</button></td>
                  </tr>
                  <tr class="fila-detalle-dia oculto" data-detalle-idx="${idx}">
                    <td colspan="5"><div class="detalle-dia-contenido"><p class="mensaje-vacio">Cargando…</p></div></td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-detalle-dia').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fila = elemento.querySelector(`.fila-detalle-dia[data-detalle-idx="${btn.dataset.idx}"]`);
      if (!fila) return;
      const yaAbierta = !fila.classList.contains('oculto');
      fila.classList.toggle('oculto');
      if (yaAbierta) return;

      const contenedor = fila.querySelector('.detalle-dia-contenido');
      if (contenedor.dataset.cargado === '1') return;
      await pintarDetalleDia(contenedor, btn.dataset.fecha);
      contenedor.dataset.cargado = '1';
    });
  });
}

async function pintarDetalleDia(contenedor, fechaISO) {
  contenedor.innerHTML = '<p class="mensaje-vacio">Cargando detalle…</p>';
  const mananaISO = toISODate(addDays(new Date(`${fechaISO}T00:00:00`), 1));

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }, { data: transferencias, error: errTrans }, { data: ventasMostrador, error: errVentas }] =
    await Promise.all([
      supabase.from('reservas_pagos').select('*').gte('fecha', fechaISO).lt('fecha', mananaISO).order('fecha', { ascending: true }),
      supabase.from('caja_movimientos').select('*').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
      supabase.from('caja_transferencias').select('*').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
      supabase.from('ventas_mostrador').select('*, minibar_productos(nombre)').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
    ]);

  if (errPagos || errMov || errTrans || errVentas) {
    contenedor.innerHTML = `<p class="mensaje-vacio">Error cargando el detalle: ${(errPagos || errMov || errTrans || errVentas).message}</p>`;
    return;
  }

  const datosDia = {
    fechaISO,
    pagos: pagos || [],
    movimientos: movimientos || [],
    transferencias: transferencias || [],
    ventasMostrador: ventasMostrador || [],
  };

  contenedor.innerHTML = `
    <p style="font-weight:600; margin-bottom:0.3rem;">Pagos de reservas (${datosDia.pagos.length})</p>
    ${
      datosDia.pagos.length === 0
        ? '<p class="mensaje-vacio">Sin pagos de reservas este día.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead><tbody>${datosDia.pagos
            .map((p) => `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${p.metodo_pago || '—'}</td><td>${escaparHTML(p.comentarios || '—')}</td></tr>`)
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Movimientos manuales (${datosDia.movimientos.length})</p>
    ${
      datosDia.movimientos.length === 0
        ? '<p class="mensaje-vacio">Sin movimientos manuales este día.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead><tbody>${datosDia.movimientos
            .map(
              (m) =>
                `<tr><td>${formatFechaHora(m.creado_en)}</td><td>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td><td>${escaparHTML(m.categoria || '—')}</td><td>${formatCOP(m.monto)}</td><td>${m.metodo_pago || '—'}</td><td>${escaparHTML(m.descripcion || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Ventas por mostrador (${datosDia.ventasMostrador.length})</p>
    ${
      datosDia.ventasMostrador.length === 0
        ? '<p class="mensaje-vacio">Sin ventas de mostrador este día.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead><tbody>${datosDia.ventasMostrador
            .map(
              (v) =>
                `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${v.cantidad}</td><td>${formatCOP(v.monto)}</td><td>${v.metodo_pago}</td><td>${escaparHTML(v.cliente_nombre || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Transferencias entre cuentas (${datosDia.transferencias.length})</p>
    ${
      datosDia.transferencias.length === 0
        ? '<p class="mensaje-vacio">Sin transferencias este día.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead><tbody>${datosDia.transferencias
            .map(
              (t) =>
                `<tr><td>${formatFechaHora(t.creado_en)}</td><td>${escaparHTML(t.cuenta_origen)}</td><td>${escaparHTML(t.cuenta_destino)}</td><td>${formatCOP(t.monto)}</td><td>${escaparHTML(t.motivo || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.85rem;">
      <button type="button" class="btn btn-secundario btn-chico btn-exportar-csv-dia">⬇ Excel</button>
      <button type="button" class="btn btn-secundario btn-chico btn-exportar-pdf-dia">⬇ PDF</button>
    </div>
  `;

  contenedor.querySelector('.btn-exportar-csv-dia').addEventListener('click', () => exportarDiaCSV(datosDia));
  contenedor.querySelector('.btn-exportar-pdf-dia').addEventListener('click', () => exportarDiaPDF(datosDia));
}

function exportarDiaCSV(d) {
  const filas = [
    [`Registro diario — ${d.fechaISO} — Santa Ana House 21`],
    [],
    ['Pagos de reservas'],
    ['Fecha', 'Monto', 'Método', 'Comentario'],
    ...(d.pagos.length ? d.pagos.map((p) => [formatFechaHora(p.fecha), p.monto, p.metodo_pago || '', p.comentarios || '']) : [['Sin pagos este día.', '', '', '']]),
    [],
    ['Movimientos manuales'],
    ['Fecha', 'Tipo', 'Categoría', 'Monto', 'Método', 'Descripción'],
    ...(d.movimientos.length
      ? d.movimientos.map((m) => [formatFechaHora(m.creado_en), m.tipo, m.categoria || '', m.monto, m.metodo_pago || '', m.descripcion || ''])
      : [['Sin movimientos este día.', '', '', '', '', '']]),
    [],
    ['Ventas por mostrador'],
    ['Fecha', 'Producto', 'Cantidad', 'Monto', 'Método', 'Cliente'],
    ...(d.ventasMostrador.length
      ? d.ventasMostrador.map((v) => [formatFechaHora(v.creado_en), v.minibar_productos ? v.minibar_productos.nombre : '', v.cantidad, v.monto, v.metodo_pago, v.cliente_nombre || ''])
      : [['Sin ventas de mostrador este día.', '', '', '', '', '']]),
    [],
    ['Transferencias entre cuentas'],
    ['Fecha', 'De', 'Hacia', 'Monto', 'Motivo'],
    ...(d.transferencias.length
      ? d.transferencias.map((t) => [formatFechaHora(t.creado_en), t.cuenta_origen, t.cuenta_destino, t.monto, t.motivo || ''])
      : [['Sin transferencias este día.', '', '', '', '']]),
  ];
  descargarCSV(`registro-diario-${d.fechaISO}.csv`, filas);
}

function exportarDiaPDF(d) {
  const cuerpo = `
    <h2>Pagos de reservas (${d.pagos.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
      <tbody>
        ${
          d.pagos.length
            ? d.pagos.map((p) => filaTablaSimple([formatFechaHora(p.fecha), formatCOP(p.monto), p.metodo_pago || '—', escaparHTML(p.comentarios || '—')])).join('')
            : filaTablaSimple(['Sin pagos este día.', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Movimientos manuales (${d.movimientos.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead>
      <tbody>
        ${
          d.movimientos.length
            ? d.movimientos
                .map((m) =>
                  filaTablaSimple([
                    formatFechaHora(m.creado_en),
                    m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                    escaparHTML(m.categoria || '—'),
                    formatCOP(m.monto),
                    m.metodo_pago || '—',
                    escaparHTML(m.descripcion || '—'),
                  ])
                )
                .join('')
            : filaTablaSimple(['Sin movimientos este día.', '', '', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Ventas por mostrador (${d.ventasMostrador.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead>
      <tbody>
        ${
          d.ventasMostrador.length
            ? d.ventasMostrador
                .map((v) =>
                  filaTablaSimple([
                    formatFechaHora(v.creado_en),
                    v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—',
                    v.cantidad,
                    formatCOP(v.monto),
                    v.metodo_pago,
                    escaparHTML(v.cliente_nombre || '—'),
                  ])
                )
                .join('')
            : filaTablaSimple(['Sin ventas de mostrador este día.', '', '', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Transferencias entre cuentas (${d.transferencias.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead>
      <tbody>
        ${
          d.transferencias.length
            ? d.transferencias
                .map((t) => filaTablaSimple([formatFechaHora(t.creado_en), escaparHTML(t.cuenta_origen), escaparHTML(t.cuenta_destino), formatCOP(t.monto), escaparHTML(t.motivo || '—')]))
                .join('')
            : filaTablaSimple(['Sin transferencias este día.', '', '', '', ''])
        }
      </tbody>
    </table>
  `;
  abrirVistaImpresion(`Registro diario — ${d.fechaISO} — Santa Ana House 21`, 'Detalle del día', cuerpo);
}

registerModule({
  id: 'caja',
  label: 'Registro diario',
  icono: '💰',
  roles: ['propietario', 'administrador', 'recepcionista', 'contador', 'auditor'],
  render,
});
