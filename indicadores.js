// indicadores.js
//
// Módulo: Indicadores (vista administrativa para propietario/administrador).
//
// Estructura de arriba hacia abajo:
//   1. "🏆 Panel del propietario" — venta de hoy / esta semana / este mes /
//      este trimestre / este semestre / huéspedes este mes, en números
//      grandes, más una fila de "mejores y peores días" para que el
//      propietario vea de un vistazo cómo va el negocio sin tener que
//      configurar nada.
//   2. Gráfica de línea de ventas diarias del mes en curso vs el mismo
//      corte del mes anterior + comparativo en números grandes + anillo
//      de ocupación del mes + ADR/RevPAR del mes.
//   3. "💼 Saldos por cuenta" — el saldo acumulado histórico de cada medio
//      de pago (Efectivo, Transferencia Bancaria, Llave), reutilizando
//      calcularSaldosPorCuenta() de caja.js (no se duplica el cálculo —
//      ver ARCHITECTURE.md).
//   4. El reporte por rango de fechas que ya existía (día/semana/mes), con
//      el Top 10 de productos vendidos (minibar + mostrador) al final.
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
// Nota (217 / fortalecimiento de Indicadores, a pedido de Elssy de cara a
// la entrega final del producto): las gráficas de barras ya NO son CSS
// puro — antes se evitaba a propósito cualquier librería externa "para
// no depender de internet el día de la demo", pero para la entrega final
// se prioriza una presentación más pulida (tooltips, curvas, anillos de
// progreso). Ahora se usa Chart.js vía el módulo compartido `graficas.js`
// (import ESM desde CDN, mismo patrón que supabase-js en usuarios.js).
// Además de mejorar la presentación, se agregaron 5 indicadores nuevos
// pedidos explícitamente: huéspedes del mes, Top 10 de productos
// vendidos (antes solo top 8 y solo minibar — ahora también incluye
// ventas de mostrador), mejor día de ocupación del mes, mejor/peor día
// de ocupación de la semana en curso, y mejor día de venta del mes. Se
// agregó también ADR y RevPAR del mes (métricas estándar de la industria
// hotelera) como valor agregado — son casi gratis con los datos que ya
// se traían.
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
import { crearAnillo, crearLineaComparativa, crearBarrasHorizontales, leerColor } from './graficas.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
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

// (217) Suma cuántas personas trae un check-in: el huésped principal más
// sus acompañantes (recepcion_checkins.acompanantes_detalle, jsonb). Se
// usa tanto para "Huéspedes este mes" como para su comparativo del mes
// anterior.
function personasDelCheckin(checkin) {
  const acompanantes = Array.isArray(checkin.acompanantes_detalle) ? checkin.acompanantes_detalle.length : 0;
  return 1 + acompanantes;
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

    <div id="panel-extra-wrap" style="margin-bottom:1.25rem;">
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
// 1) Panel del propietario: KPIs de venta por período + huéspedes del
//    mes + mejores/peores días + gráfica del mes + ocupación + ADR/RevPAR
// =========================================================
async function cargarPanelPropietario(container) {
  const wrapKpis = container.querySelector('#panel-kpis-wrap');
  const wrapGraficas = container.querySelector('#panel-graficas-wrap');
  const wrapExtra = container.querySelector('#panel-extra-wrap');

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

  // (217) La ocupación de este mes y de la semana en curso puede empezar
  // antes que fetchDesdeISO (la semana puede arrancar en el mes anterior)
  // o después (si el semestre acaba de empezar, fetchDesdeISO es más
  // atrás de lo que hace falta para ocupación) — se calcula aparte para
  // no forzar al resto del panel a traer más histórico del que necesita.
  const inicioOcupacionISO = inicioSemanaISO < inicioMesISO ? inicioSemanaISO : inicioMesISO;

  const [
    { data: pagos, error: errPagos },
    { data: ventas, error: errVentas },
    { data: movimientos, error: errMov },
    { data: habitacionesRows, error: errHab },
    { data: reservas, error: errReservas },
    { data: checkinsMes, error: errCheckinsMes },
    { data: checkinsMesAnteriorCorte, error: errCheckinsMesAnt },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('fecha, monto').gte('fecha', fetchDesdeISO).lt('fecha', mananaISO),
    supabase.from('ventas_mostrador').select('creado_en, monto').gte('creado_en', fetchDesdeISO).lt('creado_en', mananaISO),
    supabase.from('caja_movimientos').select('creado_en, tipo, monto').eq('tipo', 'ingreso').gte('creado_en', fetchDesdeISO).lt('creado_en', mananaISO),
    supabase.from('habitaciones').select('id'),
    supabase
      .from('reservas')
      .select('habitacion_id, fecha_checkin, fecha_checkout, estado')
      .lt('fecha_checkin', mananaISO)
      .gt('fecha_checkout', inicioOcupacionISO),
    supabase.from('recepcion_checkins').select('hora_ingreso, acompanantes_detalle').gte('hora_ingreso', inicioMesISO).lt('hora_ingreso', mananaISO),
    supabase
      .from('recepcion_checkins')
      .select('hora_ingreso, acompanantes_detalle')
      .gte('hora_ingreso', inicioMesAnteriorISO)
      .lt('hora_ingreso', finCorteMesAnteriorISO),
  ]);

  const error = errPagos || errVentas || errMov || errHab || errReservas || errCheckinsMes || errCheckinsMesAnt;
  if (error) {
    wrapKpis.innerHTML = `<p class="mensaje-vacio">Error calculando el panel: ${error.message}</p>`;
    wrapGraficas.innerHTML = '';
    wrapExtra.innerHTML = '';
    return;
  }

  const totalHabitaciones = (habitacionesRows || []).length;

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

  // --- Huéspedes del mes (217) ---
  const personasMes = (checkinsMes || []).reduce((sum, c) => sum + personasDelCheckin(c), 0);
  const personasMesAnteriorCorte = (checkinsMesAnteriorCorte || []).reduce((sum, c) => sum + personasDelCheckin(c), 0);
  const deltaPersonasPct =
    personasMesAnteriorCorte > 0
      ? ((personasMes - personasMesAnteriorCorte) / personasMesAnteriorCorte) * 100
      : personasMes > 0
        ? 100
        : 0;
  const personasSubiendo = deltaPersonasPct >= 0;

  const kpis = [
    { icono: '☀️', etiqueta: 'Venta de hoy', valor: formatCOP(ventaHoy), color: 'var(--color-azul)' },
    { icono: '📅', etiqueta: 'Esta semana', valor: formatCOP(ventaSemana), color: 'var(--color-verde)' },
    { icono: '🗓️', etiqueta: 'Este mes', valor: formatCOP(ventaMes), color: 'var(--color-pendiente)' },
    { icono: '📈', etiqueta: 'Este trimestre', valor: formatCOP(ventaTrimestre), color: '#6a3fb5' },
    { icono: '🏆', etiqueta: 'Este semestre', valor: formatCOP(ventaSemestre), color: 'var(--color-rojo)' },
    {
      icono: '👥',
      etiqueta: 'Huéspedes este mes',
      valor: `${personasMes}`,
      color: 'var(--color-azul-oscuro)',
      subtitulo: `${(checkinsMes || []).length} estadía(s) · ${personasSubiendo ? '▲' : '▼'} ${Math.abs(deltaPersonasPct).toFixed(0)}% vs mes anterior`,
    },
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
            <div class="stat-card-valor" style="font-size:1.85rem; color:${k.color};">${k.valor}</div>
            ${k.subtitulo ? `<div class="stat-card-subtitulo">${k.subtitulo}</div>` : ''}
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  // --- Ocupación por día (mes + semana en curso), a partir de la misma
  // consulta de reservas — sin traer nada dos veces. ---
  const reservasActivas = (reservas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));
  const ocupacionDia = (fechaISO) =>
    totalHabitaciones > 0
      ? (reservasActivas.filter((r) => fechaISO >= r.fecha_checkin && fechaISO < r.fecha_checkout).length / totalHabitaciones) * 100
      : 0;
  const ocupadasDia = (fechaISO) => reservasActivas.filter((r) => fechaISO >= r.fecha_checkin && fechaISO < r.fecha_checkout).length;

  // --- Gráfica de ventas diarias del mes en curso (con ocupación) ---
  const itemsDiasMes = [];
  let nochesOcupadasMes = 0;
  for (let d = 1; d <= diaActual; d++) {
    const fechaDiaISO = toISODate(new Date(ahora.getFullYear(), ahora.getMonth(), d));
    const valor = sumaDesde(fechaDiaISO, toISODate(addDays(new Date(fechaDiaISO + 'T00:00:00'), 1)));
    itemsDiasMes.push({ etiqueta: String(d), fechaISO: fechaDiaISO, valor });
    nochesOcupadasMes += ocupadasDia(fechaDiaISO);
  }
  const etiquetaMesActual = ahora.toLocaleDateString('es-CO', { month: 'long' });

  // --- Comparativo con el mes anterior (mismos días transcurridos) ---
  const itemsDiasMesAnterior = [];
  for (let d = 1; d <= corteMesAnterior; d++) {
    const fechaDiaISO = toISODate(new Date(mesAnteriorRef.getFullYear(), mesAnteriorRef.getMonth(), d));
    itemsDiasMesAnterior.push(sumaDesde(fechaDiaISO, toISODate(addDays(new Date(fechaDiaISO + 'T00:00:00'), 1))));
  }

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
    <div class="tarjeta">
      <h3>📊 Ventas diarias de ${etiquetaMesActual.charAt(0).toUpperCase() + etiquetaMesActual.slice(1)} (acumulado: ${formatCOP(ventaMes)})</h3>
      <div style="height:260px;">
        <canvas id="chart-ventas-comparativo"></canvas>
      </div>
    </div>
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

  crearLineaComparativa(container.querySelector('#chart-ventas-comparativo'), {
    labels: itemsDiasMes.map((i) => i.etiqueta),
    series: [
      {
        label: etiquetaMesActual.charAt(0).toUpperCase() + etiquetaMesActual.slice(1),
        data: itemsDiasMes.map((i) => i.valor),
        color: leerColor('--color-verde', '#1e8e5a'),
      },
      { label: 'Mes anterior', data: itemsDiasMesAnterior, color: leerColor('--color-texto-suave', '#6b6b6b') },
    ],
    formatoValor: (v) => formatCOP(v),
  });

  // --- Mejor día de ocupación del mes / mejor y peor día de la semana /
  // mejor día de venta del mes / ADR / RevPAR (todo 217) ---
  const mejorDiaOcupacionMes = itemsDiasMes.reduce(
    (mejor, i) => (!mejor || ocupadasDia(i.fechaISO) > mejor.ocupadas ? { fechaISO: i.fechaISO, ocupadas: ocupadasDia(i.fechaISO) } : mejor),
    null
  );
  const mejorDiaVentaMes = itemsDiasMes.reduce((mejor, i) => (!mejor || i.valor > mejor.valor ? i : mejor), null);

  const diasSemanaActual = [];
  for (let f = inicioSemanaISO; f <= hoyISO; f = toISODate(addDays(f, 1))) diasSemanaActual.push(f);
  const ocupacionSemana = diasSemanaActual.map((f) => ({ fechaISO: f, ocupadas: ocupadasDia(f), pct: ocupacionDia(f) }));
  const mejorDiaSemana = ocupacionSemana.reduce((mejor, d) => (!mejor || d.ocupadas > mejor.ocupadas ? d : mejor), null);
  const peorDiaSemana = ocupacionSemana.reduce((peor, d) => (!peor || d.ocupadas < peor.ocupadas ? d : peor), null);

  const ingresosHabitacionMes = (pagos || [])
    .filter((p) => toISODate(new Date(p.fecha)) >= inicioMesISO)
    .reduce((sum, p) => sum + Number(p.monto), 0);
  const adrMes = nochesOcupadasMes > 0 ? ingresosHabitacionMes / nochesOcupadasMes : null;
  const revparMes = totalHabitaciones > 0 ? ingresosHabitacionMes / (totalHabitaciones * diaActual) : 0;
  const ocupacionPromedioMes = totalHabitaciones > 0 ? (nochesOcupadasMes / (totalHabitaciones * diaActual)) * 100 : 0;

  const tarjetaDestacada = (icono, etiqueta, valorPrincipal, subtitulo, color) => `
    <div class="stat-card" style="border-top-color:${color};">
      <div class="stat-card-label">${icono} ${etiqueta}</div>
      <div class="stat-card-valor" style="color:${color};">${valorPrincipal}</div>
      ${subtitulo ? `<div class="stat-card-subtitulo">${subtitulo}</div>` : ''}
    </div>
  `;

  wrapExtra.innerHTML = `
    <div class="grid-dos-columnas">
      <div class="tarjeta">
        <h3 style="margin-top:0;">🎯 Ocupación de ${etiquetaMesActual}</h3>
        <div style="display:flex; align-items:center; gap:1.5rem; flex-wrap:wrap;">
          <div style="width:140px; height:140px;">
            <canvas id="chart-anillo-ocupacion-mes"></canvas>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:0.75rem; flex:1; min-width:220px;">
            <div class="stat-card">
              <div class="stat-card-label">ADR (tarifa promedio)</div>
              <div class="stat-card-valor" style="font-size:1.3rem;">${adrMes !== null ? formatCOP(adrMes) : '—'}</div>
              <div class="stat-card-subtitulo">Por noche vendida</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-label">RevPAR</div>
              <div class="stat-card-valor" style="font-size:1.3rem;">${formatCOP(revparMes)}</div>
              <div class="stat-card-subtitulo">Por habitación disponible</div>
            </div>
          </div>
        </div>
      </div>
      <div class="tarjeta">
        <h3 style="margin-top:0;">🏅 Mejores y peores días</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0.75rem;">
          ${
            mejorDiaOcupacionMes
              ? tarjetaDestacada(
                  '🏅',
                  'Mejor ocupación (mes)',
                  `${formatFechaCorta(mejorDiaOcupacionMes.fechaISO)}`,
                  `${mejorDiaOcupacionMes.ocupadas}/${totalHabitaciones} habitación(es)`,
                  'var(--color-azul)'
                )
              : ''
          }
          ${
            mejorDiaVentaMes && mejorDiaVentaMes.valor > 0
              ? tarjetaDestacada('💰', 'Mejor día en ventas (mes)', formatFechaCorta(mejorDiaVentaMes.fechaISO), formatCOP(mejorDiaVentaMes.valor), 'var(--color-verde-oscuro)')
              : ''
          }
          ${
            mejorDiaSemana
              ? tarjetaDestacada(
                  '📈',
                  'Mejor día (esta semana)',
                  formatFechaCorta(mejorDiaSemana.fechaISO),
                  `${mejorDiaSemana.ocupadas}/${totalHabitaciones} · ${mejorDiaSemana.pct.toFixed(0)}%`,
                  'var(--color-verde-oscuro)'
                )
              : ''
          }
          ${
            peorDiaSemana
              ? tarjetaDestacada(
                  '📉',
                  'Día más flojo (esta semana)',
                  formatFechaCorta(peorDiaSemana.fechaISO),
                  `${peorDiaSemana.ocupadas}/${totalHabitaciones} · ${peorDiaSemana.pct.toFixed(0)}%`,
                  'var(--color-rojo-oscuro)'
                )
              : ''
          }
        </div>
        ${diasSemanaActual.length === 1 ? '<p class="mensaje-vacio" style="margin-top:0.6rem; font-size:0.75rem;">Apenas empieza la semana — mejor y peor día todavía son el mismo.</p>' : ''}
      </div>
    </div>
  `;

  crearAnillo(container.querySelector('#chart-anillo-ocupacion-mes'), {
    porcentaje: ocupacionPromedioMes,
    colorPrincipal: leerColor('--color-azul', '#1e4e8c'),
    etiqueta: 'Ocupación',
  });
}

// =========================================================
// 2) Saldos por cuenta (histórico, reutiliza caja.js)
// =========================================================
async function cargarSaldosCuentas(container) {
  const wrap = container.querySelector('#panel-saldos-wrap');
  try {
    const { saldos } = await calcularSaldosPorCuenta();
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
      .select('creado_en, monto, metodo_pago, cantidad, producto_id, minibar_productos(nombre)')
      .gte('creado_en', fechaInicioISO)
      .lt('creado_en', finExclusivoISO),
    supabase
      .from('reservas')
      .select('habitacion_id, fecha_checkin, fecha_checkout, estado')
      .lt('fecha_checkin', finExclusivoISO)
      .gt('fecha_checkout', fechaInicioISO),
    supabase
      .from('minibar_consumos')
      .select('cantidad, monto, creado_en, producto_id, minibar_productos(nombre)')
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

  // --- Top 10 de productos vendidos (217): antes solo minibar y top 8 —
  // ahora combina consumo de minibar (huéspedes hospedados) + ventas de
  // mostrador (clientes que no se hospedan), mismo catálogo de productos
  // (minibar_productos), ranking por $ generado con las unidades como
  // dato secundario en el tooltip. ---
  const porProducto = new Map();
  const acumularProducto = (nombre, unidades, monto) => {
    if (!porProducto.has(nombre)) porProducto.set(nombre, { unidades: 0, monto: 0 });
    const entrada = porProducto.get(nombre);
    entrada.unidades += unidades;
    entrada.monto += monto;
  };
  (consumosMinibar || []).forEach((c) => {
    acumularProducto(c.minibar_productos?.nombre || 'Producto eliminado', Number(c.cantidad), Number(c.monto));
  });
  (ventasMostrador || []).forEach((v) => {
    acumularProducto(v.minibar_productos?.nombre || 'Producto eliminado', Number(v.cantidad || 1), Number(v.monto));
  });
  const top10Productos = Array.from(porProducto.entries())
    .map(([nombre, datos]) => ({ nombre, unidades: datos.unidades, monto: datos.monto }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 10);

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
    <div class="tarjeta">
      <h3>🏆 Top 10 productos vendidos (minibar + mostrador)</h3>
      ${
        top10Productos.length === 0
          ? '<p class="mensaje-vacio">Sin ventas de productos en este rango.</p>'
          : `<div style="height:${Math.max(220, top10Productos.length * 34)}px;"><canvas id="chart-top10-productos"></canvas></div>`
      }
    </div>
  `;

  wrap.querySelectorAll('.btn-ver-detalle-periodo').forEach((btn) => {
    btn.addEventListener('click', () => mostrarModalDetalleDia(btn.dataset.fecha));
  });

  if (top10Productos.length > 0) {
    // Chart.js con indexAxis:'y' dibuja de abajo hacia arriba — se invierte
    // el arreglo para que el #1 quede arriba, como se lee un ranking.
    const productosParaGrafica = [...top10Productos].reverse();
    crearBarrasHorizontales(wrap.querySelector('#chart-top10-productos'), {
      labels: productosParaGrafica.map((p) => p.nombre),
      datos: productosParaGrafica.map((p) => p.monto),
      datosSecundarios: productosParaGrafica.map((p) => p.unidades),
      etiquetaSecundaria: 'unidades',
      color: leerColor('--color-pendiente', '#c77c11'),
      formatoValor: (v) => formatCOP(v),
    });
  }
}

registerModule({
  id: 'indicadores',
  label: 'Indicadores',
  icono: '📌',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
