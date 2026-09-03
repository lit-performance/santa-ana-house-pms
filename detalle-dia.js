// detalle-dia.js
//
// Módulo (165→170): tarjeta emergente "Detalle del día" — el desglose
// completo y a colores de un día puntual (pagos de reservas, ventas por
// mostrador, movimientos manuales y transferencias entre cuentas), con
// descarga en Excel (.csv) y PDF. Se usa desde Indicadores en la tabla
// "🗓️ Reporte por rango de fechas" (columna 👁️ Ver, solo cuando se
// agrupa por Día — ver indicadores.js) — mismo patrón de "resumen +
// botón 👁️ Ver que abre una ventana emergente ancha" que ya se usa en
// Inventario, Registro diario y la liquidación de check-out.
//
// Nota: Registro diario (caja.js) ya tenía un "Ver detalle" propio para
// esto mismo, pero como un renglón que se despliega dentro de la misma
// tabla (no una tarjeta emergente) y sin colores por tipo de movimiento.
// Se dejó intacto tal cual estaba — no se tocó caja.js — para no arriesgar
// nada que ya funciona ahí; este archivo es independiente y nuevo, pensado
// para Indicadores. Si más adelante se quiere unificar los dos (que
// Registro diario también use esta tarjeta emergente a colores en vez de
// su renglón desplegable), es un cambio aparte.
//
// Fuente de datos: reservas_pagos, caja_movimientos, ventas_mostrador y
// caja_transferencias del día exacto (`fechaISO` 00:00 a 23:59 hora
// local) — las mismas 4 tablas que ya consulta Registro diario para su
// propio "Ver detalle", así que los números siempre coinciden entre las
// dos pantallas.

import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { formatFechaHora, formatFechaCorta, toISODate, addDays } from './dates.js';
import { mostrarToast } from './ui.js';

const HOTEL_NOMBRE = 'Santa Ana House 21';
const HOTEL_DIRECCION = 'Carrera 21 6A-07 Bogotá';
const HOTEL_LOGO_URL = 'https://lit-performance.github.io/santa-ana-house-pms/logo.png';
const MARCA_LIT_PERFORMANCE = 'Lit Performance · 3245067380';

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// =========================================================
// Datos: una sola consulta a las 4 tablas, para el día exacto.
// =========================================================
async function obtenerDetalleDia(fechaISO) {
  const mananaISO = toISODate(addDays(fechaISO, 1));

  const [
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: ventasMostrador, error: errVentas },
    { data: transferencias, error: errTrans },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('*').gte('fecha', fechaISO).lt('fecha', mananaISO).order('fecha', { ascending: true }),
    supabase.from('caja_movimientos').select('*').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
    supabase.from('ventas_mostrador').select('*, minibar_productos(nombre)').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
    supabase.from('caja_transferencias').select('*').gte('creado_en', fechaISO).lt('creado_en', mananaISO).order('creado_en', { ascending: true }),
  ]);

  const error = errPagos || errMov || errVentas || errTrans;
  if (error) throw error;

  const movimientosLista = movimientos || [];
  const ingresosPagos = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ingresosVentas = (ventasMostrador || []).reduce((sum, v) => sum + Number(v.monto), 0);
  const ingresosManuales = movimientosLista.filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const egresos = movimientosLista.filter((m) => m.tipo === 'egreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const totalIngresos = ingresosPagos + ingresosVentas + ingresosManuales;

  return {
    fechaISO,
    pagos: pagos || [],
    movimientos: movimientosLista,
    ventasMostrador: ventasMostrador || [],
    transferencias: transferencias || [],
    ingresosPagos,
    ingresosVentas,
    ingresosManuales,
    egresos,
    totalIngresos,
    neto: totalIngresos - egresos,
  };
}

// =========================================================
// Tarjeta emergente (modal ancho) — vista a colores en pantalla.
// =========================================================
function renderContenidoModal(datos) {
  const filasPagosHTML = datos.pagos.length
    ? datos.pagos
        .map(
          (p) => `<tr><td>${formatFechaHora(p.fecha)}</td><td class="monto" style="color:var(--color-verde-oscuro);">${formatCOP(p.monto)}</td><td>${escaparHTML(p.metodo_pago || '—')}</td><td>${escaparHTML(p.comentarios || '—')}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="mensaje-vacio">Sin pagos de reservas este día.</td></tr>';

  const filasVentasHTML = datos.ventasMostrador.length
    ? datos.ventasMostrador
        .map(
          (v) =>
            `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${v.cantidad ?? '—'}</td><td class="monto" style="color:var(--color-verde-oscuro);">${formatCOP(v.monto)}</td><td>${escaparHTML(v.metodo_pago || '—')}</td><td>${escaparHTML(v.cliente_nombre || '—')}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="mensaje-vacio">Sin ventas de mostrador este día.</td></tr>';

  const filasMovimientosHTML = datos.movimientos.length
    ? datos.movimientos
        .map((m) => {
          const esIngreso = m.tipo === 'ingreso';
          const color = esIngreso ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)';
          return `<tr><td>${formatFechaHora(m.creado_en)}</td><td style="color:${color}; font-weight:600;">${esIngreso ? '🟢 Ingreso' : '🔴 Egreso'}</td><td>${escaparHTML(m.categoria || '—')}</td><td class="monto" style="color:${color};">${formatCOP(m.monto)}</td><td>${escaparHTML(m.metodo_pago || '—')}</td><td>${escaparHTML(m.descripcion || '—')}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="mensaje-vacio">Sin movimientos manuales este día.</td></tr>';

  const filasTransferenciasHTML = datos.transferencias.length
    ? datos.transferencias
        .map(
          (t) =>
            `<tr><td>${formatFechaHora(t.creado_en)}</td><td>${escaparHTML(t.cuenta_origen)}</td><td>${escaparHTML(t.cuenta_destino)}</td><td class="monto">${formatCOP(t.monto)}</td><td>${escaparHTML(t.motivo || '—')}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="mensaje-vacio">Sin transferencias este día.</td></tr>';

  return `
    <h3 style="margin-top:0;">📅 Detalle del día — ${formatFechaCorta(datos.fechaISO)}</h3>

    <div class="grid-tres-columnas" style="margin-bottom:1.25rem;">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos</div>
        <div class="stat-card-valor">${formatCOP(datos.totalIngresos)}</div>
        <div class="stat-card-subtitulo">Reservas ${formatCOP(datos.ingresosPagos)} · Mostrador ${formatCOP(datos.ingresosVentas)} · Manuales ${formatCOP(datos.ingresosManuales)}</div>
      </div>
      <div class="stat-card stat-card-rojo">
        <div class="stat-card-label">Egresos</div>
        <div class="stat-card-valor">${formatCOP(datos.egresos)}</div>
        <div class="stat-card-subtitulo">${datos.movimientos.filter((m) => m.tipo === 'egreso').length} movimiento(s) manual(es)</div>
      </div>
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Neto del día</div>
        <div class="stat-card-valor">${formatCOP(datos.neto)}</div>
        <div class="stat-card-subtitulo">Ingresos − egresos (no incluye transferencias)</div>
      </div>
    </div>

    <div class="tarjeta tarjeta-acento tarjeta-acento-verde" style="margin-bottom:1rem;">
      <h4 style="margin-top:0;">💳 Pagos de reservas (${datos.pagos.length})</h4>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha y hora</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
          <tbody>${filasPagosHTML}</tbody>
        </table>
      </div>
    </div>

    <div class="tarjeta tarjeta-acento tarjeta-acento-azul" style="margin-bottom:1rem;">
      <h4 style="margin-top:0;">🛍️ Ventas por mostrador (${datos.ventasMostrador.length})</h4>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha y hora</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead>
          <tbody>${filasVentasHTML}</tbody>
        </table>
      </div>
    </div>

    <div class="tarjeta tarjeta-acento tarjeta-acento-naranja" style="margin-bottom:1rem;">
      <h4 style="margin-top:0;">🧾 Movimientos manuales (${datos.movimientos.length})</h4>
      <p class="mensaje-vacio" style="margin-top:-0.4rem;">Verde = ingreso manual, rojo = egreso — cada fila descuenta o suma según su tipo.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead>
          <tbody>${filasMovimientosHTML}</tbody>
        </table>
      </div>
    </div>

    <div class="tarjeta tarjeta-acento tarjeta-acento-morado" style="margin-bottom:1rem;">
      <h4 style="margin-top:0;">🔁 Transferencias entre cuentas (${datos.transferencias.length})</h4>
      <p class="mensaje-vacio" style="margin-top:-0.4rem;">No son ingreso ni egreso del negocio — solo mueven saldo de una cuenta a otra, por eso no están en el neto de arriba.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha y hora</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead>
          <tbody>${filasTransferenciasHTML}</tbody>
        </table>
      </div>
    </div>

    <div class="acciones-tarjeta" style="justify-content:flex-start;">
      <button type="button" class="btn btn-secundario btn-chico" id="btn-excel-detalle-dia">⬇ Excel</button>
      <button type="button" class="btn btn-secundario btn-chico" id="btn-pdf-detalle-dia">⬇ PDF</button>
    </div>
  `;
}

/**
 * Abre la tarjeta emergente ancha con el detalle a colores de un día.
 * @param {string} fechaISO
 */
export async function mostrarModalDetalleDia(fechaISO) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-super-ancha">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });

  let datos;
  try {
    datos = await obtenerDetalleDia(fechaISO);
  } catch (error) {
    overlay.querySelector('.modal-caja').innerHTML = `<p class="mensaje-vacio">Error cargando el detalle del día: ${error.message}</p>
      <div class="modal-acciones"><button type="button" class="btn btn-secundario" id="btn-cerrar-detalle-dia-error">Cerrar</button></div>`;
    overlay.querySelector('#btn-cerrar-detalle-dia-error').addEventListener('click', cerrar);
    return;
  }

  const caja = overlay.querySelector('.modal-caja');
  caja.innerHTML = `
    ${renderContenidoModal(datos)}
    <div class="modal-acciones">
      <button type="button" class="btn btn-secundario" id="btn-cerrar-detalle-dia">Cerrar</button>
    </div>
  `;

  caja.querySelector('#btn-cerrar-detalle-dia').addEventListener('click', cerrar);
  caja.querySelector('#btn-excel-detalle-dia').addEventListener('click', () => descargarDetalleDiaCSV(datos));
  caja.querySelector('#btn-pdf-detalle-dia').addEventListener('click', () => abrirDetalleDiaPDF(datos));
}

// =========================================================
// Descarga en Excel (.csv)
// =========================================================
function filasCSV(datos) {
  return [
    [HOTEL_NOMBRE],
    [HOTEL_DIRECCION],
    [],
    [`Detalle del día — ${formatFechaCorta(datos.fechaISO)}`],
    [],
    ['Ingresos', datos.totalIngresos],
    ['  De pagos de reservas', datos.ingresosPagos],
    ['  De ventas de mostrador', datos.ingresosVentas],
    ['  De movimientos manuales', datos.ingresosManuales],
    ['Egresos', datos.egresos],
    ['Neto del día (no incluye transferencias)', datos.neto],
    [],
    ['Pagos de reservas'],
    ['Fecha y hora', 'Monto', 'Método', 'Comentario'],
    ...(datos.pagos.length
      ? datos.pagos.map((p) => [formatFechaHora(p.fecha), p.monto, p.metodo_pago || '', p.comentarios || ''])
      : [['Sin pagos este día.', '', '', '']]),
    [],
    ['Ventas por mostrador'],
    ['Fecha y hora', 'Producto', 'Cantidad', 'Monto', 'Método', 'Cliente'],
    ...(datos.ventasMostrador.length
      ? datos.ventasMostrador.map((v) => [formatFechaHora(v.creado_en), v.minibar_productos ? v.minibar_productos.nombre : '', v.cantidad, v.monto, v.metodo_pago, v.cliente_nombre || ''])
      : [['Sin ventas de mostrador este día.', '', '', '', '', '']]),
    [],
    ['Movimientos manuales'],
    ['Fecha y hora', 'Tipo', 'Categoría', 'Monto', 'Método', 'Descripción'],
    ...(datos.movimientos.length
      ? datos.movimientos.map((m) => [formatFechaHora(m.creado_en), m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso', m.categoria || '', m.monto, m.metodo_pago || '', m.descripcion || ''])
      : [['Sin movimientos manuales este día.', '', '', '', '', '']]),
    [],
    ['Transferencias entre cuentas (no afectan el neto)'],
    ['Fecha y hora', 'De', 'Hacia', 'Monto', 'Motivo'],
    ...(datos.transferencias.length
      ? datos.transferencias.map((t) => [formatFechaHora(t.creado_en), t.cuenta_origen, t.cuenta_destino, t.monto, t.motivo || ''])
      : [['Sin transferencias este día.', '', '', '', '']]),
    [],
    [MARCA_LIT_PERFORMANCE],
  ];
}

// (220) Delimitador ";" en vez de ",": Excel en configuración regional
// Colombia/Latinoamérica usa la coma como separador DECIMAL, así que
// espera ";" como separador de columnas en un CSV — con "," todo el
// contenido de cada fila caía en una sola celda al abrir con doble clic.
// Cada campo va entre comillas igual que antes, así que ";" o "," dentro
// de un campo no rompen nada.
function descargarDetalleDiaCSV(datos) {
  const filas = filasCSV(datos);
  const csv = filas.map((fila) => fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `detalle-dia-${datos.fechaISO}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

// =========================================================
// Descarga en PDF (ventana de impresión, mismo patrón que
// resumen-checkout.js — sin librerías externas).
// =========================================================
function abrirDetalleDiaPDF(datos) {
  const ventana = window.open('', '_blank');
  if (!ventana) {
    mostrarToast('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e inténtalo de nuevo.', 'error');
    return;
  }

  const filaOVacio = (filas, colspan, textoVacio) =>
    filas.length ? filas.join('') : `<tr><td colspan="${colspan}">${textoVacio}</td></tr>`;

  const filasPagosHTML = filaOVacio(
    datos.pagos.map((p) => `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${escaparHTML(p.metodo_pago || '—')}</td><td>${escaparHTML(p.comentarios || '—')}</td></tr>`),
    4,
    'Sin pagos de reservas este día.'
  );

  const filasVentasHTML = filaOVacio(
    datos.ventasMostrador.map(
      (v) =>
        `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${v.cantidad ?? '—'}</td><td>${formatCOP(v.monto)}</td><td>${escaparHTML(v.metodo_pago || '—')}</td><td>${escaparHTML(v.cliente_nombre || '—')}</td></tr>`
    ),
    6,
    'Sin ventas de mostrador este día.'
  );

  const filasMovimientosHTML = filaOVacio(
    datos.movimientos.map(
      (m) =>
        `<tr><td>${formatFechaHora(m.creado_en)}</td><td>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td><td>${escaparHTML(m.categoria || '—')}</td><td>${formatCOP(m.monto)}</td><td>${escaparHTML(m.metodo_pago || '—')}</td><td>${escaparHTML(m.descripcion || '—')}</td></tr>`
    ),
    6,
    'Sin movimientos manuales este día.'
  );

  const filasTransferenciasHTML = filaOVacio(
    datos.transferencias.map(
      (t) => `<tr><td>${formatFechaHora(t.creado_en)}</td><td>${escaparHTML(t.cuenta_origen)}</td><td>${escaparHTML(t.cuenta_destino)}</td><td>${formatCOP(t.monto)}</td><td>${escaparHTML(t.motivo || '—')}</td></tr>`
    ),
    5,
    'Sin transferencias este día.'
  );

  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Detalle del día — ${escaparHTML(formatFechaCorta(datos.fechaISO))}</title>
      <style>
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; padding: 2rem; color: #222; }
        .encabezado-pdf { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.6rem; padding-bottom: 0.6rem; border-bottom: 2px solid #1a5276; }
        .encabezado-pdf img { height: 62px; max-width: 140px; object-fit: contain; }
        .encabezado-pdf .datos-hotel-pdf h1 { font-size: 1.25rem; margin: 0; }
        .encabezado-pdf .datos-hotel-pdf p { margin: 0.15rem 0 0; color: #666; font-size: 0.85rem; }
        h2 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
        .sub { color: #666; margin-top: 0.4rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.3rem; }
        th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
        th { background: #f4f4f6; }
        .totales { display: flex; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
        .cajon { flex: 1; min-width: 140px; border-radius: 8px; padding: 0.7rem 0.9rem; border: 1px solid #ccc; }
        .cajon-label { font-size: 0.7rem; text-transform: uppercase; color: #555; }
        .cajon-valor { font-size: 1.2rem; font-weight: 700; }
        .pie-pdf { margin-top: 2.5rem; padding-top: 0.75rem; border-top: 1px solid #ddd; text-align: center; font-size: 0.75rem; color: #888; }
        @media print { body { padding: 0.5rem; } }
      </style>
    </head>
    <body>
      <div class="encabezado-pdf">
        <img src="${HOTEL_LOGO_URL}" alt="${escaparHTML(HOTEL_NOMBRE)}" onerror="this.style.display='none'" />
        <div class="datos-hotel-pdf">
          <h1>${escaparHTML(HOTEL_NOMBRE)}</h1>
          <p>${escaparHTML(HOTEL_DIRECCION)}</p>
        </div>
      </div>
      <p class="sub">📅 Detalle del día — ${escaparHTML(formatFechaCorta(datos.fechaISO))}</p>

      <div class="totales">
        <div class="cajon" style="border-color:#1e7e34;"><div class="cajon-label" style="color:#1e7e34;">Ingresos</div><div class="cajon-valor" style="color:#1e7e34;">${formatCOP(datos.totalIngresos)}</div></div>
        <div class="cajon" style="border-color:#a12626;"><div class="cajon-label" style="color:#a12626;">Egresos</div><div class="cajon-valor" style="color:#a12626;">${formatCOP(datos.egresos)}</div></div>
        <div class="cajon" style="border-color:#1a5276;"><div class="cajon-label" style="color:#1a5276;">Neto del día</div><div class="cajon-valor" style="color:#1a5276;">${formatCOP(datos.neto)}</div></div>
      </div>

      <h2>💳 Pagos de reservas (${datos.pagos.length})</h2>
      <table>
        <thead><tr><th>Fecha y hora</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
        <tbody>${filasPagosHTML}</tbody>
      </table>

      <h2>🛍️ Ventas por mostrador (${datos.ventasMostrador.length})</h2>
      <table>
        <thead><tr><th>Fecha y hora</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead>
        <tbody>${filasVentasHTML}</tbody>
      </table>

      <h2>🧾 Movimientos manuales (${datos.movimientos.length})</h2>
      <table>
        <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead>
        <tbody>${filasMovimientosHTML}</tbody>
      </table>

      <h2>🔁 Transferencias entre cuentas (${datos.transferencias.length})</h2>
      <table>
        <thead><tr><th>Fecha y hora</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead>
        <tbody>${filasTransferenciasHTML}</tbody>
      </table>

      <div class="pie-pdf">${escaparHTML(MARCA_LIT_PERFORMANCE)}</div>
    </body>
    </html>
  `);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}
