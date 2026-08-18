// indicadores.js
//
// Módulo: Indicadores (vista administrativa para propietario/administrador).
//
// Estructura de arriba hacia abajo:
//   1. "🏆 Panel del propietario" — venta de hoy / esta semana / este mes /
//      este trimestre / este semestre, en $, con números grandes.
//   2. Gráfico de barras de ventas diarias del mes en curso + comparativo
//      contra el mismo corte del mes anterior (mismos días transcurridos,
//      para que la comparación sea justa).
//   3. "💼 Saldos por cuenta" — el saldo acumulado histórico de cada medio
//      de pago (Efectivo, Nequi, etc.), reutilizando calcularSaldosPorCuenta()
//      de caja.js (no se duplica el cálculo — ver ARCHITECTURE.md).
//   4. El reporte por rango de fechas que ya existía (día/semana/mes), con
//      la rotación de inventario de minibar al final.
//   5. El listado de Checkouts que ya existía — cada fila tiene "Ver
//      resumen" (abre la tarjeta completa) y "⬇ PDF" (descarga directa
//      del PDF sin pasar por el modal, para volver a bajar un checkout ya
//      hecho con un solo clic).
//
// El dinero se calcula directo de reservas_pagos + caja_movimientos +
// ventas_mostrador (ventas de mostrador — clientes que no se hospedan,
// ver caja.js), agrupado por la fecha real del pago/movimiento — NO desde
// caja_turnos — así no se pierde nada que haya entrado sin un turno de
// caja abierto en ese momento.
//
// La ocupación se calcula con la misma regla que usa el calendario de
// Reservas para bloquear celdas: cualquier reserva que NO esté cancelada
// ni sea no-show y cuya fecha cubra ese día cuenta como una habitación
// ocupada esa noche.
//
// Todas las gráficas de barras son CSS puro (mismo patrón que
// estadisticas.js) — sin librerías externas, para no depender de internet
// el día de la demo.
//
// Nota (170): la tabla del "🗓️ Reporte por rango de fechas" tiene ahora
// una columna final con botón "👁️ Ver" que abre la tarjeta emergente
// "Detalle del día" (ver detalle-dia.js) — el desglose completo y a
// colores de ESE día puntual (pagos de reservas, ventas de mostrador,
// movimientos manuales y transferencias), con descarga en Excel y PDF.
// Solo aparece cuando "Agrupar por" está en Día — con Semana o Mes cada
// fila junta varios días y "detalle del día" ya no aplica a un solo
// `fechaISO`, así que ahí la columna muestra un guión con una nota corta
// en vez del botón (cambiar el agrupador a Día para ver el detalle).
//
// Nota (159): a pedido de Elssy se dejaron solo 8 mini-tarjetas/bloques
// en este dashboard. Se quitaron tres bloques que existían antes:
// "🔁 Huéspedes recurrentes" (con su propia función cargarHuespedesRecurrentes,
// eliminada), "🔒 Cierres de caja del rango" (dentro de generarReporte,
// junto con la función obtenerNombresUsuarios que solo servía para eso) y
// "🛏️ Habitaciones más apetecidas" (también dentro de generarReporte). El
// resto del cálculo (ocupación, ingresos por período, rotación de
// minibar, checkouts) sigue exactamente igual. Si se quiere recuperar
// alguno de los tres bloques quitados, están completos en el historial de
// versiones del repo (ver el archivo indicadores.js anterior a este).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays, formatFechaCorta, formatFechaHora } from './dates.js';
import { calcularCheckoutsEnRango } from './cuentas.js';
import { mostrarResumenCheckout, descargarResumenCheckoutPDF } from './resumen-checkout.js';
import { calcularSaldosPorCuenta } from './caja.js';
import { mostrarModalDetalleDia } from './detalle-dia.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];
const ALTURA_MAX_BARRA_PX = 150;

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function graficaBarras({ titulo, items, formatoValor, colorBarra }) {
  const maxValor = Math.max(1, ...items.map((i) => i.valor));
  return `
    <div class="tarjeta">
      <h3>${titulo}</h3>
      <div style="display:flex; align-items:flex-end; gap:0.6rem; height:${ALTURA_MAX_BARRA_PX + 40}px; padding-top:1rem; overflow-x:auto;">
        ${
          items.length === 0
            ? '<p class="mensaje-vacio">Sin datos en este rango.</p>'
            : items
                .map((i) => {
                  const alturaPx = Math.max(2, Math.round((i.valor / maxValor) * ALTURA_MAX_BARRA_PX));
                  return `
            <div style="display:flex; flex-direction:column; align-items:center; min-width:46px;">
              <div style="font-size:0.68rem; margin-bottom:0.25rem; white-space:nowrap;">${formatoValor(i.valor)}</div>
              <div style="width:28px; height:${alturaPx}px; background:${colorBarra || 'var(--color-azul)'}; border-radius:4px 4px 0 0;"></div>
              <div style="font-size:0.68rem; margin-top:0.35rem; color:var(--color-texto-suave); text-align:center; max-width:60px; overflow:hidden; text-overflow:ellipsis;">${escaparHTML(i.etiqueta)}</div>
            </div>
          `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function inicioSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const diaSemana = d.getDay(); // 0=domingo … 6=sábado
  const offset = diaSemana === 0 ? 6 : diaSemana - 1; // días desde el lunes
  d.setDate(d.getDate() - offset);
  return toISODate(d);
}

function primerDiaMes(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function primerDiaTrimestre(d) {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function primerDiaSemestre(d) {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 6) * 6, 1);
}
function diasEnMes(anio, mesIndex0) {
  return new Date(anio, mesIndex0 + 1, 0).getDate();
}
function nombreMesCorto(mesIndex0) {
  return new Date(2000, mesIndex0, 1).toLocaleDateString('es-CO', { month: 'short' });
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  const inicioDefault = toISODate(addDays(hoyISO, -29));

  container.innerHTML = `
    <h2>Indicadores</h2>

    <div id="panel-kpis-wrap" style="margin-bottom:1.25rem;">
      <p class="mensaje-vacio">Calculando el panel del propietario…</p>
    </div>

    <div class="grid-dos-columnas" id="panel-graficas-wrap" style="margin-bottom:1.25rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>

    <div id="panel-saldos-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando saldos por cuenta…</p>
    </div>

    <div class="tarjeta">
      <h3 style="margin-top:0;">🗓️ Reporte por rango de fechas</h3>
      <form id="form-indicadores" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${inicioDefault}" required />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" required />
        </label>
        <label>Agrupar por
          <select name="agrupacion">
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primario">Generar</button>
      </form>
    </div>
    <div id="indicadores-resultado">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div class="tarjeta" style="margin-top:1.25rem;">
      <h3 style="margin-top:0;">📋 Checkouts</h3>
      <p class="mensaje-vacio" style="margin-top:-0.4rem;">Check-outs completados en el mismo rango de fechas de arriba.</p>
      <div id="indicadores-checkouts">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
    </div>
  `;

  container.querySelector('#form-indicadores').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const fechaInicio = form.get('fecha_inicio');
    const fechaFin = form.get('fecha_fin');
    generarReporte(container, fechaInicio, fechaFin, form.get('agrupacion'));
    cargarCheckouts(container, fechaInicio, fechaFin);
  });

  await Promise.all([
    cargarPanelPropietario(container),
    cargarSaldosCuentas(container),
    generarReporte(container, inicioDefault, hoyISO, 'dia'),
    cargarCheckouts(container, inicioDefault, hoyISO),
  ]);
}

// =========================================================
// 1) Panel del propietario: KPIs de venta por período + gráfica del mes
// =========================================================
async function cargarPanelPropietario(container) {
  const wrapKpis = container.querySelector('#panel-kpis-wrap');
  const wrapGraficas = container.querySelector('#panel-graficas-wrap');

  const ahora = new Date();
  const hoyISO = toISODate(ahora);
  const mananaISO = toISODate(addDays(ahora, 1));
  const inicioSemanaISO = inicioSemana(hoyISO);
  const inicioMesISO = toISODate(primerDiaMes(ahora));
  const inicioTrimestreISO = toISODate(primerDiaTrimestre(ahora));
  const inicioSemestreISO = toISODate(primerDiaSemestre(ahora));

  const mesAnteriorRef = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const inicioMesAnteriorISO = toISODate(mesAnteriorRef);
  const diaActual = ahora.getDate();
  const diasMesAnterior = diasEnMes(mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth());
  const corteMesAnterior = Math.min(diaActual, diasMesAnterior);
  const finCorteMesAnteriorISO = toISODate(addDays(new Date(inicioMesAnteriorISO + 'T00:00:00'), corteMesAnterior));

  // Se trae desde lo más atrás que se necesite (el inicio del semestre, o
  // el inicio del mes anterior si el semestre acaba de empezar) hasta hoy.
  const fetchDesdeISO = inicioMesAnteriorISO < inicioSemestreISO ? inicioMesAnteriorISO : inicioSemestreISO;

  const [{ data: pagos, error: errPagos }, { data: ventas, error: errVentas }, { data: movimientos, error: errMov }] = await Promise.all([
    supabase.from('reservas_pagos').select('fecha, monto').gte('fecha', fetchDesdeISO).lt('fecha', mananaISO),
    supabase.from('ventas_mostrador').select('creado_en, monto').gte('creado_en', fetchDesdeISO).lt('creado_en', mananaISO),
    supabase.from('caja_movimientos').select('creado_en, tipo, monto').eq('tipo', 'ingreso').gte('creado_en', fetchDesdeISO).lt('creado_en', mananaISO),
  ]);

  const error = errPagos || errVentas || errMov;
  if (error) {
    wrapKpis.innerHTML = `<p class="mensaje-vacio">Error calculando el panel: ${error.message}</p>`;
    wrapGraficas.innerHTML = '';
    return;
  }

  const eventos = [
    ...(pagos || []).map((p) => ({ fecha: toISODate(new Date(p.fecha)), monto: Number(p.monto) })),
    ...(ventas || []).map((v) => ({ fecha: toISODate(new Date(v.creado_en)), monto: Number(v.monto) })),
    ...(movimientos || []).map((m) => ({ fecha: toISODate(new Date(m.creado_en)), monto: Number(m.monto) })),
  ];

  const sumaDesde = (minISO, maxExclusivoISO) =>
    eventos.filter((e) => e.fecha >= minISO && e.fecha < maxExclusivoISO).reduce((s, e) => s + e.monto, 0);

  const ventaHoy = sumaDesde(hoyISO, mananaISO);
  const ventaSemana = sumaDesde(inicioSemanaISO, mananaISO);
  const ventaMes = sumaDesde(inicioMesISO, mananaISO);
  const ventaTrimestre = sumaDesde(inicioTrimestreISO, mananaISO);
  const ventaSemestre = sumaDesde(inicioSemestreISO, mananaISO);
  const ventaMesAnteriorCorte = sumaDesde(inicioMesAnteriorISO, finCorteMesAnteriorISO);

  const kpis = [
    { icono: '☀️', etiqueta: 'Venta de hoy', valor: ventaHoy, color: 'var(--color-azul)' },
    { icono: '📅', etiqueta: 'Esta semana', valor: ventaSemana, color: 'var(--color-verde)' },
    { icono: '🗓️', etiqueta: 'Este mes', valor: ventaMes, color: 'var(--color-pendiente)' },
    { icono: '📈', etiqueta: 'Este trimestre', valor: ventaTrimestre, color: '#6a3fb5' },
    { icono: '🏆', etiqueta: 'Este semestre', valor: ventaSemestre, color: 'var(--color-rojo)' },
  ];

  wrapKpis.innerHTML = `
    <div class="tarjeta" style="background:linear-gradient(135deg, var(--color-superficie), var(--color-fondo));">
      <h3 style="margin-top:0;">🏆 Panel del propietario</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:1rem;">
        ${kpis
          .map(
            (k) => `
          <div class="stat-card" style="border-top-color:${k.color};">
            <div class="stat-card-label">${k.icono} ${k.etiqueta}</div>
            <div class="stat-card-valor" style="font-size:1.85rem; color:${k.color};">${formatCOP(k.valor)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  // --- Gráfica de ventas diarias del mes en curso ---
  const itemsDiasMes = [];
  for (let d = 1; d <= diaActual; d++) {
    const fechaDiaISO = toISODate(new Date(ahora.getFullYear(), ahora.getMonth(), d));
    const valor = sumaDesde(fechaDiaISO, toISODate(addDays(new Date(fechaDiaISO + 'T00:00:00'), 1)));
    itemsDiasMes.push({ etiqueta: String(d), valor });
  }
  const etiquetaMesActual = ahora.toLocaleDateString('es-CO', { month: 'long' });

  // --- Comparativo con el mes anterior (mismos días transcurridos) ---
  const deltaPct =
    ventaMesAnteriorCorte > 0
      ? ((ventaMes - ventaMesAnteriorCorte) / ventaMesAnteriorCorte) * 100
      : ventaMes > 0
        ? 100
        : 0;
  const subiendo = deltaPct >= 0;
  const colorDelta = subiendo ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)';
  const flecha = subiendo ? '▲' : '▼';

  wrapGraficas.innerHTML = `
    ${graficaBarras({
      titulo: `📊 Ventas diarias de ${etiquetaMesActual.charAt(0).toUpperCase() + etiquetaMesActual.slice(1)} (acumulado: ${formatCOP(ventaMes)})`,
      items: itemsDiasMes,
      formatoValor: (v) => (v > 0 ? formatCOP(v).replace('$', '').trim() : ''),
      colorBarra: 'var(--color-verde)',
    })}
    <div class="tarjeta">
      <h3>🆚 Comparativo con el mes anterior</h3>
      <p class="mensaje-vacio" style="margin-top:-0.4rem;">Mismos ${corteMesAnterior} día(s) transcurridos en ambos meses, para que la comparación sea justa.</p>
      <div style="display:flex; gap:1.5rem; align-items:flex-end; margin-top:1rem; flex-wrap:wrap;">
        <div>
          <div class="stat-card-label">Mes anterior (mismo corte)</div>
          <div style="font-size:1.5rem; font-weight:700; color:var(--color-texto-suave);">${formatCOP(ventaMesAnteriorCorte)}</div>
        </div>
        <div style="font-size:1.5rem; color:var(--color-texto-suave);">→</div>
        <div>
          <div class="stat-card-label">Este mes (a la fecha)</div>
          <div style="font-size:1.9rem; font-weight:700; color:${colorDelta};">${formatCOP(ventaMes)}</div>
        </div>
        <div style="background:${subiendo ? 'rgba(30, 142, 90, 0.14)' : 'rgba(211, 47, 47, 0.14)'}; color:${colorDelta}; padding:0.4rem 0.9rem; border-radius:999px; font-weight:700; font-size:1rem;">
          ${flecha} ${Math.abs(deltaPct).toFixed(1)}%
        </div>
      </div>
    </div>
  `;
}

// =========================================================
// 2) Saldos por cuenta (histórico, reutiliza caja.js)
// =========================================================
async function cargarSaldosCuentas(container) {
  const wrap = container.querySelector('#panel-saldos-wrap');
  try {
    const saldos = await calcularSaldosPorCuenta();
    const entradas = Object.entries(saldos).sort((a, b) => b[1] - a[1]);
    const colores = ['var(--color-azul)', 'var(--color-verde)', 'var(--color-pendiente)', '#6a3fb5', 'var(--color-rojo)', 'var(--color-azul-oscuro)', 'var(--color-verde-oscuro)'];

    wrap.innerHTML = `
      <div class="tarjeta">
        <h3 style="margin-top:0;">💼 Saldos por cuenta</h3>
        <p class="mensaje-vacio" style="margin-top:-0.4rem;">Saldo acumulado histórico por medio de pago (pagos de huéspedes + ventas de mostrador + movimientos manuales + transferencias entre cuentas).</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:1rem; margin-top:1rem;">
          ${entradas
            .map(([metodo, valor], i) => {
              const color = valor < 0 ? 'var(--color-rojo-oscuro)' : colores[i % colores.length];
              return `
            <div class="stat-card" style="border-top-color:${color};">
              <div class="stat-card-label">${escaparHTML(metodo)}</div>
              <div class="stat-card-valor" style="color:${color};">${formatCOP(valor)}</div>
            </div>
          `;
            })
            .join('')}
        </div>
      </div>
    `;
  } catch (err) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando saldos por cuenta: ${err.message}</p>`;
  }
}

// =========================================================
// Checkouts del rango (existente) — cada fila tiene "Ver resumen" (abre
// el modal completo) y "⬇ PDF" (descarga directa sin pasar por el modal).
//
// Nota (165): la columna Saldo nunca muestra negativo (ver nota 164 en
// cuentas.js) — si el checkout quedó sobrepagado, debajo del $0 aparece
// en morado "↑ excedente $X" (dato nuevo `excedente` de cuentas.js).
// =========================================================
async function cargarCheckouts(container, fechaInicioISO, fechaFinISO) {
  const wrap = container.querySelector('#indicadores-checkouts');
  if (!wrap) return;

  if (!fechaInicioISO || !fechaFinISO || fechaFinISO < fechaInicioISO) {
    wrap.innerHTML = '<p class="mensaje-vacio">Revisa el rango de fechas.</p>';
    return;
  }

  wrap.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const finExclusivoISO = toISODate(addDays(fechaFinISO, 1));

  let checkouts;
  try {
    checkouts = await calcularCheckoutsEnRango(fechaInicioISO, finExclusivoISO);
  } catch (err) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando los checkouts: ${err.message}</p>`;
    return;
  }

  if (checkouts.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">No hay checkouts en este rango.</p>';
    return;
  }

  wrap.innerHTML = `
    <div class="tabla-scroll">
      <table class="tabla-simple">
        <thead>
          <tr>
            <th>Salida</th>
            <th>Huésped</th>
            <th>Habitación</th>
            <th>Noches</th>
            <th>Monto total</th>
            <th>Pagado</th>
            <th>Saldo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${checkouts
            .map(
              (c) => `
            <tr data-checkin-id="${c.checkinId}">
              <td>${formatFechaHora(c.checkOutEn)}</td>
              <td>${c.huespedNombre}</td>
              <td>${c.habitacionLabel}</td>
              <td>${c.cantidadNoches ?? '—'}</td>
              <td class="monto">${formatCOP(c.montoTotal)}</td>
              <td class="monto">${formatCOP(c.totalAbonado)}</td>
              <td class="monto" style="color:${c.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">
                ${formatCOP(c.saldoPendiente)}
                ${c.excedente > 0 ? `<div style="font-size:0.72rem; font-weight:700; color:#6a3fb5;">↑ excedente ${formatCOP(c.excedente)}</div>` : ''}
              </td>
              <td style="white-space:nowrap;">
                <button type="button" class="btn-editar btn-ver-resumen-checkout">Ver resumen</button>
                <button type="button" class="btn-editar btn-pdf-resumen-checkout" title="Descargar el PDF directo, sin abrir el resumen">⬇ PDF</button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('.btn-ver-resumen-checkout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const checkinId = Number(e.target.closest('tr').dataset.checkinId);
      mostrarResumenCheckout(checkinId);
    });
  });

  wrap.querySelectorAll('.btn-pdf-resumen-checkout').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const checkinId = Number(e.target.closest('tr').dataset.checkinId);
      descargarResumenCheckoutPDF(checkinId);
    });
  });
}

function claveYEtiquetaPeriodo(fechaISO, agrupacion) {
  if (agrupacion === 'semana') {
    const inicio = inicioSemana(fechaISO);
    const fin = toISODate(addDays(inicio, 6));
    return { clave: inicio, etiqueta: `Semana del ${formatFechaCorta(inicio)} al ${formatFechaCorta(fin)}` };
  }
  if (agrupacion === 'mes') {
    const clave = fechaISO.slice(0, 7);
    const etiqueta = new Date(fechaISO + 'T00:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    return { clave, etiqueta: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) };
  }
  return { clave: fechaISO, etiqueta: formatFechaCorta(fechaISO) };
}

async function generarReporte(container, fechaInicioISO, fechaFinISO, agrupacion) {
  const wrap = container.querySelector('#indicadores-resultado');
  wrap.innerHTML = '<p class="mensaje-vacio">Calculando…</p>';

  if (!fechaInicioISO || !fechaFinISO || fechaFinISO < fechaInicioISO) {
    wrap.innerHTML = '<p class="mensaje-vacio">Revisa el rango de fechas.</p>';
    return;
  }

  const finExclusivoISO = toISODate(addDays(fechaFinISO, 1));

  const [
    { data: habitacionesRows, error: errHab },
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: ventasMostrador, error: errVentas },
    { data: reservas, error: errReservas },
    { data: consumosMinibar, error: errMinibar },
  ] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre'),
    supabase.from('reservas_pagos').select('fecha, monto, metodo_pago').gte('fecha', fechaInicioISO).lt('fecha', finExclusivoISO),
    supabase
      .from('caja_movimientos')
      .select('creado_en, tipo, monto, metodo_pago')
      .gte('creado_en', fechaInicioISO)
      .lt('creado_en', finExclusivoISO),
    supabase
      .from('ventas_mostrador')
      .select('creado_en, monto, metodo_pago')
      .gte('creado_en', fechaInicioISO)
      .lt('creado_en', finExclusivoISO),
    supabase
      .from('reservas')
      .select('habitacion_id, fecha_checkin, fecha_checkout, estado')
      .lt('fecha_checkin', finExclusivoISO)
      .gt('fecha_checkout', fechaInicioISO),
    supabase
      .from('minibar_consumos')
      .select('cantidad, monto, creado_en, minibar_productos(nombre)')
      .gte('creado_en', fechaInicioISO)
      .lt('creado_en', finExclusivoISO),
  ]);

  const error = errHab || errPagos || errMov || errVentas || errReservas || errMinibar;
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error calculando indicadores: ${error.message}</p>`;
    return;
  }

  const totalHabitaciones = (habitacionesRows || []).length;

  // --- Bucket por día (base de todo; semana/mes se arman sumando días) ---
  const dias = [];
  for (let f = fechaInicioISO; f <= fechaFinISO; f = toISODate(addDays(f, 1))) {
    dias.push(f);
  }

  const porDia = new Map(
    dias.map((d) => [d, { ingresosEfectivo: 0, ingresosDigital: 0, egresosEfectivo: 0, egresosDigital: 0, ventasMostrador: 0, ocupadas: 0 }])
  );

  (pagos || []).forEach((p) => {
    const dia = toISODate(new Date(p.fecha));
    const bucket = porDia.get(dia);
    if (!bucket) return;
    if (p.metodo_pago === 'Efectivo') bucket.ingresosEfectivo += Number(p.monto);
    else bucket.ingresosDigital += Number(p.monto);
  });

  (ventasMostrador || []).forEach((v) => {
    const dia = toISODate(new Date(v.creado_en));
    const bucket = porDia.get(dia);
    if (!bucket) return;
    if (v.metodo_pago === 'Efectivo') bucket.ingresosEfectivo += Number(v.monto);
    else bucket.ingresosDigital += Number(v.monto);
    bucket.ventasMostrador += Number(v.monto);
  });

  (movimientos || []).forEach((m) => {
    const dia = toISODate(new Date(m.creado_en));
    const bucket = porDia.get(dia);
    if (!bucket) return;
    const esEfectivo = m.metodo_pago === 'Efectivo';
    if (m.tipo === 'ingreso') {
      if (esEfectivo) bucket.ingresosEfectivo += Number(m.monto);
      else bucket.ingresosDigital += Number(m.monto);
    } else {
      if (esEfectivo) bucket.egresosEfectivo += Number(m.monto);
      else bucket.egresosDigital += Number(m.monto);
    }
  });

  const reservasActivas = (reservas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));
  dias.forEach((dia) => {
    const bucket = porDia.get(dia);
    bucket.ocupadas = reservasActivas.filter((r) => dia >= r.fecha_checkin && dia < r.fecha_checkout).length;
  });

  // --- Agrupar días en el período pedido ---
  const periodos = new Map();
  dias.forEach((dia) => {
    const { clave, etiqueta } = claveYEtiquetaPeriodo(dia, agrupacion);
    if (!periodos.has(clave)) {
      periodos.set(clave, {
        etiqueta,
        ingresosEfectivo: 0,
        ingresosDigital: 0,
        egresosEfectivo: 0,
        egresosDigital: 0,
        ventasMostrador: 0,
        nochesOcupadas: 0,
        numDias: 0,
      });
    }
    const p = periodos.get(clave);
    const b = porDia.get(dia);
    p.ingresosEfectivo += b.ingresosEfectivo;
    p.ingresosDigital += b.ingresosDigital;
    p.egresosEfectivo += b.egresosEfectivo;
    p.egresosDigital += b.egresosDigital;
    p.ventasMostrador += b.ventasMostrador;
    p.nochesOcupadas += b.ocupadas;
    p.numDias += 1;
  });

  const filas = Array.from(periodos.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // más reciente primero
    .map(([clave, p]) => {
      const totalIngresos = p.ingresosEfectivo + p.ingresosDigital;
      const totalEgresos = p.egresosEfectivo + p.egresosDigital;
      const capacidadNoches = totalHabitaciones * p.numDias;
      const ocupacionPct = capacidadNoches > 0 ? (p.nochesOcupadas / capacidadNoches) * 100 : 0;
      // Cuando agrupacion === 'dia', claveYEtiquetaPeriodo() usa el propio
      // fechaISO como clave (ver más abajo) — por eso sirve tal cual para
      // el botón "👁️ Ver" de detalle-dia.js. Con semana/mes, clave es un
      // inicio de semana o un "YYYY-MM", no un día puntual, así que ahí NO
      // se usa (ver columna final en la tabla, más abajo).
      return { ...p, clave, totalIngresos, totalEgresos, neto: totalIngresos - totalEgresos, ocupacionPct };
    });

  const totalIngresosRango = filas.reduce((sum, f) => sum + f.totalIngresos, 0);
  const totalEgresosRango = filas.reduce((sum, f) => sum + f.totalEgresos, 0);
  const totalVentasMostradorRango = filas.reduce((sum, f) => sum + f.ventasMostrador, 0);
  const totalNochesOcupadasRango = filas.reduce((sum, f) => sum + f.nochesOcupadas, 0);
  const capacidadTotalRango = totalHabitaciones * dias.length;
  const ocupacionPromedioRango = capacidadTotalRango > 0 ? (totalNochesOcupadasRango / capacidadTotalRango) * 100 : 0;

  // --- Rotación de inventario de minibar (top 8 por unidades consumidas) ---
  const porProductoMinibar = new Map();
  (consumosMinibar || []).forEach((c) => {
    const nombre = c.minibar_productos?.nombre || 'Producto';
    porProductoMinibar.set(nombre, (porProductoMinibar.get(nombre) || 0) + Number(c.cantidad));
  });
  const topMinibar = Array.from(porProductoMinibar.entries())
    .map(([etiqueta, valor]) => ({ etiqueta, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  const bloqueMinibar = graficaBarras({
    titulo: '🥤 Rotación de inventario de minibar (unidades consumidas)',
    items: topMinibar,
    formatoValor: (v) => `${v}`,
    colorBarra: 'var(--color-pendiente)',
  });

  wrap.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos del rango</div>
        <div class="stat-card-valor">${formatCOP(totalIngresosRango)}</div>
        <div class="stat-card-subtitulo">Egresos: ${formatCOP(totalEgresosRango)} · Mostrador: ${formatCOP(totalVentasMostradorRango)}</div>
      </div>
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Ocupación promedio</div>
        <div class="stat-card-valor">${ocupacionPromedioRango.toFixed(1)}%</div>
        <div class="stat-card-subtitulo">${totalNochesOcupadasRango} noches vendidas de ${capacidadTotalRango}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Neto del rango</div>
        <div class="stat-card-valor">${formatCOP(totalIngresosRango - totalEgresosRango)}</div>
        <div class="stat-card-subtitulo">${dias.length} día(s) · ${totalHabitaciones} habitaciones</div>
      </div>
    </div>
    <div class="tabla-scroll">
      <table class="tabla-simple">
        <thead>
          <tr>
            <th>Periodo</th>
            <th>Ingresos efectivo</th>
            <th>Ingresos digital</th>
            <th>Total ingresos</th>
            <th>Egresos</th>
            <th>Neto</th>
            <th>Ocupación</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            filas
              .map(
                (f) => `<tr>
                  <td>${f.etiqueta}</td>
                  <td>${formatCOP(f.ingresosEfectivo)}</td>
                  <td>${formatCOP(f.ingresosDigital)}</td>
                  <td>${formatCOP(f.totalIngresos)}</td>
                  <td>${formatCOP(f.totalEgresos)}</td>
                  <td style="font-weight:700;">${formatCOP(f.neto)}</td>
                  <td>${f.ocupacionPct.toFixed(1)}% <span class="mensaje-vacio">(${f.nochesOcupadas}/${totalHabitaciones * f.numDias})</span></td>
                  <td>${
                    agrupacion === 'dia'
                      ? `<button type="button" class="btn-editar btn-ver-detalle-periodo" data-fecha="${f.clave}">👁️ Ver</button>`
                      : '<span class="mensaje-vacio" title="Cambia \'Agrupar por\' a Día para ver el detalle">—</span>'
                  }</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="8" class="mensaje-vacio">Sin datos en este rango.</td></tr>'
          }
        </tbody>
      </table>
    </div>

    <div style="height:1rem;"></div>
    ${bloqueMinibar}
  `;

  wrap.querySelectorAll('.btn-ver-detalle-periodo').forEach((btn) => {
    btn.addEventListener('click', () => mostrarModalDetalleDia(btn.dataset.fecha));
  });
}

registerModule({
  id: 'indicadores',
  label: 'Indicadores',
  icono: '📌',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
