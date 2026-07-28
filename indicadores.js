// indicadores.js
//
// Módulo: Indicadores (vista administrativa para propietario/administrador).
// Resume, agrupado por día / semana / mes, cuánto dinero entró (separado en
// efectivo vs digital: transferencia, tarjeta, otro) y qué tan ocupado
// estuvo el hotel.
//
// El dinero se calcula directo de reservas_pagos + caja_movimientos,
// agrupado por la fecha real del pago/movimiento — NO desde caja_turnos —
// así no se pierde nada que haya entrado sin un turno de caja abierto en
// ese momento.
//
// La ocupación se calcula con la misma regla que usa el calendario de
// Reservas para bloquear celdas: cualquier reserva que NO esté cancelada
// ni sea no-show y cuya fecha cubra ese día cuenta como una habitación
// ocupada esa noche.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays, formatFechaCorta } from './dates.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];

async function render(container) {
  const hoyISO = toISODate(new Date());
  const inicioDefault = toISODate(addDays(hoyISO, -29));

  container.innerHTML = `
    <h2>Indicadores</h2>
    <div class="tarjeta">
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
  `;

  container.querySelector('#form-indicadores').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    generarReporte(container, form.get('fecha_inicio'), form.get('fecha_fin'), form.get('agrupacion'));
  });

  await generarReporte(container, inicioDefault, hoyISO, 'dia');
}

function inicioSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const diaSemana = d.getDay(); // 0=domingo … 6=sábado
  const offset = diaSemana === 0 ? 6 : diaSemana - 1; // días desde el lunes
  d.setDate(d.getDate() - offset);
  return toISODate(d);
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
    { data: totalHabitacionesRows, error: errHab },
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: reservas, error: errReservas },
  ] = await Promise.all([
    supabase.from('habitaciones').select('id'),
    supabase.from('reservas_pagos').select('fecha, monto, metodo_pago').gte('fecha', fechaInicioISO).lt('fecha', finExclusivoISO),
    supabase
      .from('caja_movimientos')
      .select('creado_en, tipo, monto, metodo_pago')
      .gte('creado_en', fechaInicioISO)
      .lt('creado_en', finExclusivoISO),
    supabase
      .from('reservas')
      .select('fecha_checkin, fecha_checkout, estado')
      .lt('fecha_checkin', finExclusivoISO)
      .gt('fecha_checkout', fechaInicioISO),
  ]);

  const error = errHab || errPagos || errMov || errReservas;
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error calculando indicadores: ${error.message}</p>`;
    return;
  }

  const totalHabitaciones = (totalHabitacionesRows || []).length;

  // --- Bucket por día (base de todo; semana/mes se arman sumando días) ---
  const dias = [];
  for (let f = fechaInicioISO; f <= fechaFinISO; f = toISODate(addDays(f, 1))) {
    dias.push(f);
  }

  const porDia = new Map(
    dias.map((d) => [d, { ingresosEfectivo: 0, ingresosDigital: 0, egresosEfectivo: 0, egresosDigital: 0, ocupadas: 0 }])
  );

  (pagos || []).forEach((p) => {
    const dia = toISODate(new Date(p.fecha));
    const bucket = porDia.get(dia);
    if (!bucket) return;
    if (p.metodo_pago === 'Efectivo') bucket.ingresosEfectivo += Number(p.monto);
    else bucket.ingresosDigital += Number(p.monto);
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
    p.nochesOcupadas += b.ocupadas;
    p.numDias += 1;
  });

  const filas = Array.from(periodos.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // más reciente primero
    .map(([, p]) => {
      const totalIngresos = p.ingresosEfectivo + p.ingresosDigital;
      const totalEgresos = p.egresosEfectivo + p.egresosDigital;
      const capacidadNoches = totalHabitaciones * p.numDias;
      const ocupacionPct = capacidadNoches > 0 ? (p.nochesOcupadas / capacidadNoches) * 100 : 0;
      return { ...p, totalIngresos, totalEgresos, neto: totalIngresos - totalEgresos, ocupacionPct };
    });

  const totalIngresosRango = filas.reduce((sum, f) => sum + f.totalIngresos, 0);
  const totalEgresosRango = filas.reduce((sum, f) => sum + f.totalEgresos, 0);
  const totalNochesOcupadasRango = filas.reduce((sum, f) => sum + f.nochesOcupadas, 0);
  const capacidadTotalRango = totalHabitaciones * dias.length;
  const ocupacionPromedioRango = capacidadTotalRango > 0 ? (totalNochesOcupadasRango / capacidadTotalRango) * 100 : 0;

  wrap.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos del rango</div>
        <div class="stat-card-valor">${formatCOP(totalIngresosRango)}</div>
        <div class="stat-card-subtitulo">Egresos: ${formatCOP(totalEgresosRango)}</div>
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
                </tr>`
              )
              .join('') || '<tr><td colspan="7" class="mensaje-vacio">Sin datos en este rango.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

registerModule({
  id: 'indicadores',
  label: 'Indicadores',
  icono: '📌',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
