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
//   4. "🔁 Huéspedes recurrentes" — huéspedes con 2 o más estadías,
//      histórico completo (no cambia con el rango de fechas de abajo).
//   5. El reporte por rango de fechas que ya existía (día/semana/mes),
//      ahora con tres secciones nuevas al final: cierres de caja del
//      rango, rotación de inventario de minibar y habitaciones más
//      apetecidas (por noches ocupadas, no por ingresos — para eso ya
//      está el ranking de Estadísticas).
//   6. El listado de Checkouts que ya existía.
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

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays, formatFechaCorta, formatFechaHora } from './dates.js';
import { calcularCheckoutsEnRango } from './cuentas.js';
import { mostrarResumenCheckout } from './resumen-checkout.js';
import { calcularSaldosPorCuenta } from './caja.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];
const ALTURA_MAX_BARRA_PX = 150;

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function obtenerNombresUsuarios(ids) {
  const idsUnicos = [...new Set((ids || []).filter(Boolean))];
  if (idsUnicos.length === 0) return new Map();
  const { data } = await supabase.from('usuarios').select('id, nombre').in('id', idsUnicos);
  return new Map((data || []).map((u) => [u.id, u.nombre]));
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

    <div id="panel-saldos-wrap" style="margin-bottom:1.25rem;">
      <p class="mensaje-vacio">Cargando saldos por cuenta…</p>
    </div>

    <div id="panel-recurrentes-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando huéspedes recurrentes…</p>
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
    cargarHuespedesRecurrentes(container),
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
// 3) Huéspedes recurrentes (histórico completo)
// =========================================================
async function cargarHuespedesRecurrentes(container) {
  const wrap = container.querySelector('#panel-recurrentes-wrap');

  const { data: reservas, error } = await supabase
    .from('reservas')
    .select('huesped_documento, huesped_nombre, fecha_checkin, monto_total, estado');

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando huéspedes recurrentes: ${error.message}</p>`;
    return;
  }

  const activas = (reservas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado) && r.huesped_documento);
  const porDocumento = new Map();
  activas.forEach((r) => {
    if (!porDocumento.has(r.huesped_documento)) {
      porDocumento.set(r.huesped_documento, { nombre: r.huesped_nombre, visitas: 0, gastoTotal: 0, ultimaVisita: null });
    }
    const info = porDocumento.get(r.huesped_documento);
    info.visitas += 1;
    info.gastoTotal += Number(r.monto_total || 0);
    info.nombre = r.huesped_nombre || info.nombre;
    if (!info.ultimaVisita || r.fecha_checkin > info.ultimaVisita) info.ultimaVisita = r.fecha_checkin;
  });

  const recurrentes = Array.from(porDocumento.entries())
    .filter(([, info]) => info.visitas >= 2)
    .map(([documento, info]) => ({ documento, ...info }))
    .sort((a, b) => b.visitas - a.visitas || b.gastoTotal - a.gastoTotal)
    .slice(0, 10);

  wrap.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.25rem;">
        <h3 style="margin:0;">🔁 Huéspedes recurrentes</h3>
        <span class="stat-card-valor" style="font-size:1.3rem; color:var(--color-verde-oscuro);">${recurrentes.length}</span>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.2rem;">Huéspedes con 2 o más estadías — histórico completo, no cambia con el rango de fechas de abajo.</p>
      ${
        recurrentes.length === 0
          ? '<p class="mensaje-vacio">Todavía no hay huéspedes con más de una estadía.</p>'
          : `
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead><tr><th>Huésped</th><th>Documento</th><th>Visitas</th><th>Última visita</th><th>Gasto total</th></tr></thead>
            <tbody>
              ${recurrentes
                .map(
                  (r) => `<tr>
                <td>${escaparHTML(r.nombre)}</td>
                <td>${escaparHTML(r.documento)}</td>
                <td style="font-weight:700;">${r.visitas}</td>
                <td>${r.ultimaVisita ? formatFechaCorta(r.ultimaVisita) : '—'}</td>
                <td>${formatCOP(r.gastoTotal)}</td>
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
// Checkouts del rango (existente)
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
              <td class="monto" style="color:${c.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">${formatCOP(c.saldoPendiente)}</td>
              <td><button type="button" class="btn-editar btn-ver-resumen-checkout">Ver resumen</button></td>
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
    { data: cierresCaja, error: errCierres },
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
    supabase
      .from('caja_turnos')
      .select('id, cerrado_en, cerrado_por, saldo_esperado, saldo_contado, diferencia')
      .eq('estado', 'cerrada')
      .gte('cerrado_en', fechaInicioISO)
      .lt('cerrado_en', finExclusivoISO)
      .order('cerrado_en', { ascending: false }),
  ]);

  const error = errHab || errPagos || errMov || errVentas || errReservas || errMinibar || errCierres;
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
    .map(([, p]) => {
      const totalIngresos = p.ingresosEfectivo + p.ingresosDigital;
      const totalEgresos = p.egresosEfectivo + p.egresosDigital;
      const capacidadNoches = totalHabitaciones * p.numDias;
      const ocupacionPct = capacidadNoches > 0 ? (p.nochesOcupadas / capacidadNoches) * 100 : 0;
      return { ...p, totalIngresos, totalEgresos, neto: totalIngresos - totalEgresos, ocupacionPct };
    });

  const totalIngresosRango = filas.reduce((sum, f) => sum + f.totalIngresos, 0);
  const totalEgresosRango = filas.reduce((sum, f) => sum + f.totalEgresos, 0);
  const totalVentasMostradorRango = filas.reduce((sum, f) => sum + f.ventasMostrador, 0);
  const totalNochesOcupadasRango = filas.reduce((sum, f) => sum + f.nochesOcupadas, 0);
  const capacidadTotalRango = totalHabitaciones * dias.length;
  const ocupacionPromedioRango = capacidadTotalRango > 0 ? (totalNochesOcupadasRango / capacidadTotalRango) * 100 : 0;

  // --- Cierres de caja del rango ---
  const nombresCierre = await obtenerNombresUsuarios((cierresCaja || []).map((c) => c.cerrado_por));
  const cierresConDiferencia = (cierresCaja || []).filter((c) => Number(c.diferencia) !== 0).length;

  const bloqueCierres = `
    <div class="tarjeta">
      <h3 style="margin-top:0;">🔒 Cierres de caja del rango</h3>
      <div class="grid-tres-columnas" style="margin-bottom:1rem;">
        <div class="stat-card stat-card-azul">
          <div class="stat-card-label">Cierres realizados</div>
          <div class="stat-card-valor">${(cierresCaja || []).length}</div>
        </div>
        <div class="stat-card ${cierresConDiferencia > 0 ? 'stat-card-naranja' : 'stat-card-verde'}">
          <div class="stat-card-label">Con diferencia</div>
          <div class="stat-card-valor">${cierresConDiferencia}</div>
        </div>
        <div class="stat-card stat-card-verde">
          <div class="stat-card-label">Sin diferencia</div>
          <div class="stat-card-valor">${(cierresCaja || []).length - cierresConDiferencia}</div>
        </div>
      </div>
      ${
        (cierresCaja || []).length === 0
          ? '<p class="mensaje-vacio">Sin cierres de caja en este rango.</p>'
          : `
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead><tr><th>Cerrado</th><th>Por</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead>
            <tbody>
              ${cierresCaja
                .map(
                  (c) => `<tr>
                <td>${formatFechaHora(c.cerrado_en)}</td>
                <td>${escaparHTML(nombresCierre.get(c.cerrado_por) || '—')}</td>
                <td>${formatCOP(c.saldo_esperado)}</td>
                <td>${formatCOP(c.saldo_contado)}</td>
                <td style="font-weight:700; color:${Number(c.diferencia) !== 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'};">${formatCOP(c.diferencia)}</td>
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

  // --- Habitaciones más apetecidas (top 8 por noches ocupadas) ---
  const porHabitacion = new Map();
  reservasActivas.forEach((r) => {
    const noches = dias.filter((d) => d >= r.fecha_checkin && d < r.fecha_checkout).length;
    porHabitacion.set(r.habitacion_id, (porHabitacion.get(r.habitacion_id) || 0) + noches);
  });
  const topHabitaciones = (habitacionesRows || [])
    .map((h) => ({ etiqueta: h.numero, valor: porHabitacion.get(h.id) || 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  const bloqueHabitaciones = graficaBarras({
    titulo: '🛏️ Habitaciones más apetecidas (noches ocupadas)',
    items: topHabitaciones,
    formatoValor: (v) => `${v}`,
    colorBarra: '#6a3fb5',
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

    <div style="height:1rem;"></div>
    ${bloqueCierres}
    <div style="height:1rem;"></div>
    ${bloqueMinibar}
    <div style="height:1rem;"></div>
    ${bloqueHabitaciones}
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
