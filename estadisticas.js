// estadisticas.js
//
// Módulo: Estadísticas. Tendencias históricas de ocupación e ingresos mes
// a mes (por defecto últimos 12 meses), más un ranking de las habitaciones
// más rentables del rango. Usa el mismo cálculo por día que indicadores.js
// (reservas_pagos + caja_movimientos + ventas_mostrador para dinero,
// reservas activas para ocupación) pero agrupado siempre por mes y con
// gráficas de barras en CSS puro (sin librerías externas, para no
// depender de internet el día de la demo).
//
// Nota (215 / auditoría H37): faltaba sumar ventas_mostrador a los
// ingresos — indicadores.js/auditoria.js/detalle-dia.js sí la incluyen,
// así que esta pantalla mostraba una cifra de ingresos menor a la de
// esas otras para el mismo período.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays } from './dates.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];
const ALTURA_MAX_BARRA_PX = 160;

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function primerDiaDeMesesAtras(n) {
  const hoy = new Date();
  return toISODate(new Date(hoy.getFullYear(), hoy.getMonth() - n, 1));
}

function etiquetaMes(claveYYYYMM) {
  const etiqueta = new Date(`${claveYYYYMM}-01T00:00:00`).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
  return etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1);
}

function graficaBarras({ titulo, items, formatoValor }) {
  const maxValor = Math.max(1, ...items.map((i) => i.valor));
  return `
    <div class="tarjeta">
      <h3>${titulo}</h3>
      <div style="display:flex; align-items:flex-end; gap:0.75rem; height:${ALTURA_MAX_BARRA_PX + 40}px; padding-top:1rem; overflow-x:auto;">
        ${items
          .map((i) => {
            const alturaPx = Math.max(2, Math.round((i.valor / maxValor) * ALTURA_MAX_BARRA_PX));
            return `
            <div style="display:flex; flex-direction:column; align-items:center; min-width:56px;">
              <div style="font-size:0.72rem; margin-bottom:0.25rem; white-space:nowrap;">${formatoValor(i.valor)}</div>
              <div style="width:32px; height:${alturaPx}px; background:var(--color-verde-oscuro, #2f6b3a); border-radius:4px 4px 0 0;"></div>
              <div style="font-size:0.72rem; margin-top:0.35rem; color:var(--color-texto-suave); text-align:center;">${escaparHTML(i.etiqueta)}</div>
            </div>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  const inicioDefault = primerDiaDeMesesAtras(11);

  container.innerHTML = `
    <h2>Estadísticas</h2>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <form id="form-estadisticas" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${inicioDefault}" />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" />
        </label>
        <button type="submit" class="btn btn-primario">Generar</button>
      </form>
    </div>
    <div id="estadisticas-resultado-wrap">
      <p class="mensaje-vacio">Calculando…</p>
    </div>
  `;

  container.querySelector('#form-estadisticas').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await generarEstadisticas(container.querySelector('#estadisticas-resultado-wrap'), form.get('fecha_inicio'), form.get('fecha_fin'));
  });

  await generarEstadisticas(container.querySelector('#estadisticas-resultado-wrap'), inicioDefault, hoyISO);
}

async function generarEstadisticas(elemento, fechaInicio, fechaFin) {
  elemento.innerHTML = '<p class="mensaje-vacio">Calculando…</p>';

  if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) {
    elemento.innerHTML = '<p class="mensaje-vacio">Revisa el rango de fechas.</p>';
    return;
  }

  const finExclusivoISO = toISODate(addDays(fechaFin, 1));

  const [
    { data: habitaciones, error: errHab },
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: ventas, error: errVentas },
    { data: reservas, error: errReservas },
  ] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').order('numero'),
    supabase.from('reservas_pagos').select('fecha, monto').gte('fecha', fechaInicio).lt('fecha', finExclusivoISO),
    supabase.from('caja_movimientos').select('creado_en, tipo, monto').gte('creado_en', fechaInicio).lt('creado_en', finExclusivoISO),
    // (215 / auditoría H37) Antes faltaba ventas_mostrador — indicadores.js
    // sí la incluye, así que esta pantalla mostraba un ingreso menor para
    // el mismo período.
    supabase.from('ventas_mostrador').select('creado_en, monto').gte('creado_en', fechaInicio).lt('creado_en', finExclusivoISO),
    supabase
      .from('reservas')
      .select('habitacion_id, fecha_checkin, fecha_checkout, estado, monto_total')
      .lt('fecha_checkin', finExclusivoISO)
      .gt('fecha_checkout', fechaInicio),
  ]);

  const error = errHab || errPagos || errMov || errVentas || errReservas;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error calculando estadísticas: ${error.message}</p>`;
    return;
  }

  const totalHabitaciones = (habitaciones || []).length;
  const reservasActivas = (reservas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));

  // --- Bucket por día ---
  const dias = [];
  for (let f = fechaInicio; f <= fechaFin; f = toISODate(addDays(f, 1))) {
    dias.push(f);
  }
  const porDia = new Map(dias.map((d) => [d, { ingresos: 0, ocupadas: 0 }]));

  (pagos || []).forEach((p) => {
    const dia = toISODate(new Date(p.fecha));
    const b = porDia.get(dia);
    if (b) b.ingresos += Number(p.monto);
  });
  (movimientos || []).forEach((m) => {
    if (m.tipo !== 'ingreso') return;
    const dia = toISODate(new Date(m.creado_en));
    const b = porDia.get(dia);
    if (b) b.ingresos += Number(m.monto);
  });
  // (215 / H37) Ver nota arriba.
  (ventas || []).forEach((v) => {
    const dia = toISODate(new Date(v.creado_en));
    const b = porDia.get(dia);
    if (b) b.ingresos += Number(v.monto);
  });
  dias.forEach((dia) => {
    const b = porDia.get(dia);
    b.ocupadas = reservasActivas.filter((r) => dia >= r.fecha_checkin && dia < r.fecha_checkout).length;
  });

  // --- Agrupar por mes ---
  const porMes = new Map();
  dias.forEach((dia) => {
    const clave = dia.slice(0, 7);
    if (!porMes.has(clave)) porMes.set(clave, { ingresos: 0, nochesOcupadas: 0, numDias: 0 });
    const m = porMes.get(clave);
    const b = porDia.get(dia);
    m.ingresos += b.ingresos;
    m.nochesOcupadas += b.ocupadas;
    m.numDias += 1;
  });

  const meses = Array.from(porMes.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([clave, m]) => {
      const capacidad = totalHabitaciones * m.numDias;
      const ocupacionPct = capacidad > 0 ? (m.nochesOcupadas / capacidad) * 100 : 0;
      return { clave, etiqueta: etiquetaMes(clave), ingresos: m.ingresos, ocupacionPct, nochesOcupadas: m.nochesOcupadas, capacidad };
    });

  // --- Ranking de habitaciones por ingresos en el rango ---
  const ingresosPorHabitacion = new Map();
  reservasActivas.forEach((r) => {
    const actual = ingresosPorHabitacion.get(r.habitacion_id) || 0;
    ingresosPorHabitacion.set(r.habitacion_id, actual + Number(r.monto_total || 0));
  });
  const ranking = (habitaciones || [])
    .map((h) => ({ etiqueta: `${h.numero}`, nombreCompleto: `${h.numero} — ${h.nombre}`, valor: ingresosPorHabitacion.get(h.id) || 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  const totalIngresos = meses.reduce((acc, m) => acc + m.ingresos, 0);
  const promedioOcupacion = meses.length > 0 ? meses.reduce((acc, m) => acc + m.ocupacionPct, 0) / meses.length : 0;
  const mejorMes = meses.reduce((mejor, m) => (!mejor || m.ingresos > mejor.ingresos ? m : mejor), null);

  elemento.innerHTML = `
    <div class="grid-tres-columnas" style="margin-bottom:1.5rem;">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos totales del rango</div>
        <div class="stat-card-valor">${formatCOP(totalIngresos)}</div>
        <div class="stat-card-subtitulo">${meses.length} mes(es)</div>
      </div>
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Ocupación promedio</div>
        <div class="stat-card-valor">${promedioOcupacion.toFixed(1)}%</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Mejor mes</div>
        <div class="stat-card-valor">${mejorMes ? mejorMes.etiqueta : '—'}</div>
        <div class="stat-card-subtitulo">${mejorMes ? formatCOP(mejorMes.ingresos) : ''}</div>
      </div>
    </div>

    ${graficaBarras({ titulo: 'Ingresos por mes', items: meses.map((m) => ({ etiqueta: m.etiqueta, valor: m.ingresos })), formatoValor: (v) => formatCOP(v) })}

    <div style="height:1rem;"></div>

    ${graficaBarras({ titulo: 'Ocupación por mes', items: meses.map((m) => ({ etiqueta: m.etiqueta, valor: m.ocupacionPct })), formatoValor: (v) => `${v.toFixed(0)}%` })}

    <div style="height:1rem;"></div>

    ${
      ranking.length > 0
        ? graficaBarras({ titulo: 'Habitaciones más rentables (top 8 del rango)', items: ranking, formatoValor: (v) => formatCOP(v) })
        : ''
    }

    <div style="height:1rem;"></div>

    <div class="tarjeta">
      <h3>Detalle mensual</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Mes</th><th>Ingresos</th><th>Noches ocupadas</th><th>Ocupación</th></tr></thead>
          <tbody>
            ${meses
              .map(
                (m) => `<tr>
                  <td>${m.etiqueta}</td>
                  <td>${formatCOP(m.ingresos)}</td>
                  <td>${m.nochesOcupadas} / ${m.capacidad}</td>
                  <td>${m.ocupacionPct.toFixed(1)}%</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin datos en este rango.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

registerModule({
  id: 'estadisticas',
  label: 'Estadísticas',
  icono: '📉',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
