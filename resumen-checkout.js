// resumen-checkout.js
//
// Tarjeta visual de "Resumen de liquidación" que se abre automáticamente
// justo después de confirmar un check-out (ver recepcion.js) y que
// también se puede volver a abrir después desde el listado de Checkouts
// en Indicadores (ver indicadores.js) — ambos llaman a la misma función
// `mostrarResumenCheckout(checkinId)` de aquí, que a su vez usa
// `obtenerResumenLiquidacion` de cuentas.js como única fuente de datos,
// para que el resumen diga siempre lo mismo sin importar desde dónde se
// abra.
//
// Incluye dos formas de descarga, elegidas a propósito para no depender
// de ninguna librería externa (cero riesgo de que algo falle el día de
// la demo, ya que este proyecto no tiene paso de build):
//   - "Descargar Excel": genera un .csv (mismo método ya usado en
//     Reportes/Contabilidad) — Excel lo abre perfecto con doble clic.
//   - "Descargar PDF": abre una vista de impresión ya formateada y
//     dispara el diálogo de imprimir del navegador, donde se elige
//     "Guardar como PDF".
//
// Nota sobre `descargarResumenCheckoutPDF` (exportada aparte): hace lo
// mismo que el botón "Descargar PDF" del modal, pero sin necesidad de
// abrir el modal primero — se usa desde el botón "⬇ PDF" del listado de
// Checkouts en Indicadores, para volver a descargar un checkout ya hecho
// con un solo clic.
//
// Nota sobre la marca del hotel y de Lit Performance en los descargables:
// tanto el PDF como el Excel llevan arriba el nombre y dirección del
// hotel (el PDF además con el logo, arriba a la izquierda — usando la URL
// pública de GitHub Pages, porque la ventana de impresión se abre en
// blanco y no puede resolver una ruta relativa como "logo.png"), y al
// final llevan la marca "Lit Performance · 3245067380" (desarrollador del
// sistema). Si el hotel cambia de dirección o de logo más adelante, este
// es el único lugar que hay que tocar para que se actualice en todos los
// descargables.

import { obtenerResumenLiquidacion } from './cuentas.js';
import { formatCOP } from './currency.js';
import { formatFechaCorta, formatFechaHora } from './dates.js';
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

function filaResumen(label, valor) {
  return `
    <div style="display:flex; justify-content:space-between; gap:1rem; padding:0.35rem 0; border-bottom:1px solid var(--color-borde, #eee);">
      <span style="color:var(--color-texto-suave, #666);">${escaparHTML(label)}</span>
      <strong>${valor}</strong>
    </div>
  `;
}

function cajonMonto(label, montoTexto, color, fondo) {
  return `
    <div style="flex:1; min-width:150px; background:${fondo}; border:1px solid ${color}; border-radius:10px; padding:0.85rem 1rem;">
      <div style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.02em; color:${color};">${escaparHTML(label)}</div>
      <div style="font-size:1.35rem; font-weight:700; color:${color};">${montoTexto}</div>
    </div>
  `;
}

function infoPago(comentarios) {
  const c = (comentarios || '').toLowerCase();
  if (c.includes('anticipado')) return { etiqueta: '🟢 Pago anticipado', color: 'var(--color-verde-oscuro, #1e7e34)', fondo: '#e6f4ea' };
  if (c.includes('parcial')) return { etiqueta: '🟡 Abono parcial', color: '#8a6d00', fondo: '#fff8e1' };
  if (c.includes('liquidaci') || c.includes('check-out') || c.includes('checkout')) {
    return { etiqueta: '🔵 Pago en check-out', color: '#1a5276', fondo: '#eaf2f8' };
  }
  return { etiqueta: '⚪ Abono', color: 'var(--color-texto-suave, #666)', fondo: '#f2f2f2' };
}

function encabezadoHabitacion(datos) {
  const partes = [datos.habitacionNumero, datos.habitacionNombre].filter(Boolean).join(' — ');
  return datos.tipoHabitacionNombre ? `${partes} (${datos.tipoHabitacionNombre})` : partes || '—';
}

function filasCSV(datos) {
  const filas = [
    [HOTEL_NOMBRE],
    [HOTEL_DIRECCION],
    [],
    ['Resumen de liquidación'],
    [],
    ['Huésped', datos.huespedNombre],
    ['Documento', `${datos.tipoDocumento || ''} ${datos.numeroDocumento || ''}`.trim()],
    ['Celular', datos.celular || ''],
    ['Habitación', encabezadoHabitacion(datos)],
    ['Tarifa', datos.tarifaCodigo || ''],
    ['Noches', datos.cantidadNoches ?? ''],
    ['Ingreso', formatFechaHora(datos.horaIngreso)],
    ['Salida', formatFechaHora(datos.horaSalida)],
    [],
    ['Consumo de minibar'],
    ['Producto', 'Cantidad', 'Monto', 'Fecha'],
    ...(datos.minibarItems.length
      ? datos.minibarItems.map((m) => [m.nombre, m.cantidad, m.monto, formatFechaHora(m.fecha)])
      : [['Sin consumo de minibar registrado.', '', '', '']]),
    [],
    ['Historial de pagos'],
    ['Fecha y hora', 'Tipo', 'Método de pago', 'Monto', 'Comentarios'],
    ...(datos.pagos.length
      ? datos.pagos.map((p) => [formatFechaHora(p.fecha), infoPago(p.comentarios).etiqueta.replace(/^[^\s]+\s/, ''), p.metodoPago, p.monto, p.comentarios || ''])
      : [['Sin pagos registrados.', '', '', '', '']]),
    [],
    ['Monto habitación', datos.montoHabitacion],
    ['Monto minibar', datos.montoMinibar],
    ['Monto total', datos.montoTotal],
    ['Total pagado', datos.totalAbonado],
    ['Saldo pendiente', datos.saldoPendiente],
    [],
    ['Comentarios del check-in', datos.observacionesCheckin || ''],
    ['Comentarios del check-out', datos.observacionesCheckout || ''],
    [],
    [MARCA_LIT_PERFORMANCE],
  ];
  return filas;
}

function descargarCSV(datos) {
  const filas = filasCSV(datos);
  const csv = filas.map((fila) => fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `liquidacion-checkin-${datos.checkinId}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function abrirVistaPDF(datos) {
  const ventana = window.open('', '_blank');
  if (!ventana) {
    mostrarToast('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e inténtalo de nuevo.', 'error');
    return;
  }

  const filasMinibarHTML = datos.minibarItems.length
    ? datos.minibarItems
        .map((m) => `<tr><td>${escaparHTML(m.nombre)}</td><td>${m.cantidad}</td><td>${formatCOP(m.monto)}</td><td>${formatFechaHora(m.fecha)}</td></tr>`)
        .join('')
    : '<tr><td colspan="4">Sin consumo de minibar registrado.</td></tr>';

  const filasPagosHTML = datos.pagos.length
    ? datos.pagos
        .map((p) => {
          const info = infoPago(p.comentarios);
          return `<tr><td>${formatFechaHora(p.fecha)}</td><td style="color:${info.color};">${info.etiqueta}</td><td>${escaparHTML(p.metodoPago)}</td><td>${formatCOP(p.monto)}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="4">Sin pagos registrados.</td></tr>';

  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Resumen de liquidación — ${escaparHTML(datos.huespedNombre)}</title>
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
        .badge-ok { background: #e6f4ea; color: #1e7e34; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
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
      <p class="sub">🧾 Resumen de liquidación — ${escaparHTML(encabezadoHabitacion(datos))} · <span class="badge-ok">✅ Check-out completado</span></p>

      <h2>👤 Huésped</h2>
      <table>
        <tr><td>Nombre</td><td><strong>${escaparHTML(datos.huespedNombre)}</strong></td></tr>
        <tr><td>Documento</td><td>${escaparHTML(`${datos.tipoDocumento || ''} ${datos.numeroDocumento || ''}`.trim())}</td></tr>
        <tr><td>Celular</td><td>${escaparHTML(datos.celular || '—')}</td></tr>
      </table>

      <h2>🛏 Estadía</h2>
      <table>
        <tr><td>Ingreso</td><td>${formatFechaHora(datos.horaIngreso)}</td></tr>
        <tr><td>Salida</td><td>${formatFechaHora(datos.horaSalida)}</td></tr>
        <tr><td>Noches</td><td>${datos.cantidadNoches ?? '—'}</td></tr>
        <tr><td>Tarifa</td><td>${escaparHTML(datos.tarifaCodigo || '—')}</td></tr>
      </table>

      <h2>🥤 Consumo de minibar</h2>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th><th>Fecha</th></tr></thead>
        <tbody>${filasMinibarHTML}</tbody>
      </table>

      <h2>💳 Historial de pagos</h2>
      <table>
        <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Método</th><th>Monto</th></tr></thead>
        <tbody>${filasPagosHTML}</tbody>
      </table>

      <div class="totales">
        <div class="cajon" style="border-color:#1a5276;"><div class="cajon-label" style="color:#1a5276;">Monto total</div><div class="cajon-valor" style="color:#1a5276;">${formatCOP(datos.montoTotal)}</div></div>
        <div class="cajon" style="border-color:#1e7e34;"><div class="cajon-label" style="color:#1e7e34;">Total pagado</div><div class="cajon-valor" style="color:#1e7e34;">${formatCOP(datos.totalAbonado)}</div></div>
        <div class="cajon" style="border-color:${datos.saldoPendiente > 0 ? '#a12626' : '#1e7e34'};"><div class="cajon-label" style="color:${datos.saldoPendiente > 0 ? '#a12626' : '#1e7e34'};">Saldo pendiente</div><div class="cajon-valor" style="color:${datos.saldoPendiente > 0 ? '#a12626' : '#1e7e34'};">${formatCOP(datos.saldoPendiente)}</div></div>
      </div>

      ${datos.observacionesCheckin || datos.observacionesCheckout ? `
        <h2>📝 Comentarios</h2>
        <table>
          ${datos.observacionesCheckin ? `<tr><td>Check-in</td><td>${escaparHTML(datos.observacionesCheckin)}</td></tr>` : ''}
          ${datos.observacionesCheckout ? `<tr><td>Check-out</td><td>${escaparHTML(datos.observacionesCheckout)}</td></tr>` : ''}
        </table>
      ` : ''}

      <div class="pie-pdf">${escaparHTML(MARCA_LIT_PERFORMANCE)}</div>
    </body>
    </html>
  `);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

export async function mostrarResumenCheckout(checkinId) {
  let datos;
  try {
    datos = await obtenerResumenLiquidacion(checkinId);
  } catch (err) {
    mostrarToast(`No se pudo cargar el resumen de liquidación: ${err.message}`, 'error');
    return;
  }
  pintarModalResumen(datos);
}

// Descarga directa del PDF de un checkout ya hecho, sin pasar por el
// modal — usada desde el botón "⬇ PDF" del listado de Checkouts en
// Indicadores (ver indicadores.js), para no obligar a abrir "Ver
// resumen" primero solo para volver a descargarlo.
export async function descargarResumenCheckoutPDF(checkinId) {
  let datos;
  try {
    datos = await obtenerResumenLiquidacion(checkinId);
  } catch (err) {
    mostrarToast(`No se pudo generar el PDF: ${err.message}`, 'error');
    return;
  }
  abrirVistaPDF(datos);
}

function pintarModalResumen(datos) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 0.2rem;">🧾 Resumen de liquidación</h3>
          <p class="mensaje-vacio" style="margin:0;">${escaparHTML(encabezadoHabitacion(datos))}</p>
        </div>
        <span class="badge badge-check-out">✅ Check-out completado</span>
      </div>

      <div class="modal-contenido">
        <div class="tarjeta" style="margin-top:1rem; background:var(--color-fondo-suave, #f8f9fb);">
          <h4 style="margin-top:0;">👤 Huésped</h4>
          ${filaResumen('Nombre', escaparHTML(datos.huespedNombre))}
          ${filaResumen('Documento', escaparHTML(`${datos.tipoDocumento || ''} ${datos.numeroDocumento || ''}`.trim() || '—'))}
          ${filaResumen('Celular', escaparHTML(datos.celular || '—'))}
        </div>

        <div class="tarjeta" style="margin-top:0.85rem;">
          <h4 style="margin-top:0;">🛏 Estadía</h4>
          ${filaResumen('Ingreso', formatFechaHora(datos.horaIngreso))}
          ${filaResumen('Salida', formatFechaHora(datos.horaSalida))}
          ${filaResumen('Noches', datos.cantidadNoches ?? '—')}
          ${filaResumen('Tarifa', escaparHTML(datos.tarifaCodigo || '—'))}
        </div>

        <div class="tarjeta" style="margin-top:0.85rem;">
          <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
            <h4 style="margin:0;">🥤 Consumo de minibar</h4>
            <strong>${formatCOP(datos.montoMinibar)}</strong>
          </div>
          ${
            datos.minibarItems.length === 0
              ? '<p class="mensaje-vacio">Sin consumo de minibar registrado.</p>'
              : `
            <table class="tabla-simple">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th><th>Fecha</th></tr></thead>
              <tbody>
                ${datos.minibarItems
                  .map((m) => `<tr><td>${escaparHTML(m.nombre)}</td><td>${m.cantidad}</td><td class="monto">${formatCOP(m.monto)}</td><td>${formatFechaHora(m.fecha)}</td></tr>`)
                  .join('')}
              </tbody>
            </table>
          `
          }
        </div>

        <div class="tarjeta" style="margin-top:0.85rem;">
          <h4 style="margin-top:0;">💳 Historial de pagos</h4>
          ${
            datos.pagos.length === 0
              ? '<p class="mensaje-vacio">Sin pagos registrados.</p>'
              : `
            <table class="tabla-simple">
              <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Método</th><th>Monto</th></tr></thead>
              <tbody>
                ${datos.pagos
                  .map((p) => {
                    const info = infoPago(p.comentarios);
                    return `<tr><td>${formatFechaHora(p.fecha)}</td><td><span style="color:${info.color}; font-weight:600;">${info.etiqueta}</span></td><td>${escaparHTML(p.metodoPago)}</td><td class="monto">${formatCOP(p.monto)}</td></tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          `
          }
        </div>

        <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:1rem;">
          ${cajonMonto('Monto total', formatCOP(datos.montoTotal), '#1a5276', '#eaf2f8')}
          ${cajonMonto('Total pagado', formatCOP(datos.totalAbonado), 'var(--color-verde-oscuro, #1e7e34)', '#e6f4ea')}
          ${cajonMonto('Saldo pendiente', formatCOP(datos.saldoPendiente), datos.saldoPendiente > 0 ? 'var(--color-rojo-oscuro, #a12626)' : 'var(--color-verde-oscuro, #1e7e34)', datos.saldoPendiente > 0 ? '#fdecea' : '#e6f4ea')}
        </div>

        ${
          datos.observacionesCheckin || datos.observacionesCheckout
            ? `
          <div class="tarjeta" style="margin-top:0.85rem; background:var(--color-alerta-fondo, #fff8e1);">
            <h4 style="margin-top:0;">📝 Comentarios</h4>
            ${datos.observacionesCheckin ? filaResumen('Check-in', escaparHTML(datos.observacionesCheckin)) : ''}
            ${datos.observacionesCheckout ? filaResumen('Check-out', escaparHTML(datos.observacionesCheckout)) : ''}
          </div>
        `
            : ''
        }
      </div>

      <div class="modal-acciones" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-secundario" id="btn-cerrar-resumen-checkout">Cerrar</button>
        <button type="button" class="btn btn-secundario" id="btn-descargar-excel-resumen">⬇ Descargar Excel</button>
        <button type="button" class="btn btn-primario" id="btn-descargar-pdf-resumen">⬇ Descargar PDF</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cerrar-resumen-checkout').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#btn-descargar-excel-resumen').addEventListener('click', () => descargarCSV(datos));
  overlay.querySelector('#btn-descargar-pdf-resumen').addEventListener('click', () => abrirVistaPDF(datos));
}
