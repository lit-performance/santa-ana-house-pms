// rendimiento-habitaciones.js
//
// Módulo: Rendimiento por habitación (218/219 — subpestaña nueva de
// Análisis, a pedido explícito del cliente final vía Elssy). Muestra,
// para un rango de fechas elegido, cada habitación (nombrada por su
// número) con las noches que estuvo ocupada y el dinero que generó —
// separando lo que entró por concepto de habitación de lo que entró por
// consumo de minibar, con el total de todas las habitaciones al final.
//
// Decisión de diseño (ver conversación con Elssy): esto NO es un "cierre
// mensual" que bloquea o congela datos — es solo un filtro de fechas
// sobre una vista, igual que el "Reporte por rango de fechas" de
// Indicadores. Este sistema, desde el rediseño de Registro diario, evita
// a propósito cualquier apertura/cierre manual (ver cabecera de caja.js)
// — todo es continuo y recalculable en cualquier momento.
//
// Cómo se atribuye el dinero a cada habitación (219 — cambió desde la
// primera versión de este archivo, ver nota abajo):
//   - $ habitación: se usa `reservas.monto_total` (el valor acordado de
//     la ESTADÍA, ya confirmado en el código que es independiente del
//     minibar — el minibar se liquida aparte), NO el historial de pagos
//     (reservas_pagos). Se cuenta el monto COMPLETO de cualquier reserva
//     que se cruce con el rango elegido (no cancelada ni no-show) —
//     igual que el resto de la app calcula "ocupación" por cruce de
//     fechas. Si una estadía cruza la frontera del rango (por ejemplo,
//     empezó en agosto y el rango elegido es septiembre), se cuenta
//     completa en cualquier rango con el que se cruce — no se reparte
//     entre meses. Se avisa esto en pantalla para que no sorprenda.
//   - $ minibar: suma de minibar_consumos.monto con creado_en dentro del
//     rango, agrupado directo por su propio habitacion_id — esto SÍ es
//     un dato real por día, sin ningún supuesto de por medio.
//   - Noches ocupadas: cualquier reserva que no esté cancelada ni sea
//     no-show y cuya fecha cubra ese día cuenta como una noche ocupada.
//
// Nota (219): la primera versión de este archivo (218) calculaba "$
// habitación" desde reservas_pagos (fecha real del pago), igual que el
// resto de Indicadores. Elssy pidió cambiarlo a reservas.monto_total
// cruzado con el checkout — más sólido gerencialmente (el monto queda
// fijado por la reserva/estadía, no depende de cuándo se registró el
// pago) y evita el problema de repartir un pago entre varias noches. Por
// esto ya NO se consulta reservas_pagos en este archivo.
//
// Nota / limitación conocida: si una reserva cambió de habitación a
// mitad de la estadía (ver H27 en reservas.js/recepcion.js), su
// monto_total queda atribuido aquí a la habitación que tiene ACTUALMENTE
// asignada — no hay forma de partirlo entre las dos sin guardar un
// historial de cambios de habitación por reserva, que hoy no existe. En
// la práctica debería ser un caso raro (huésped reubicado de habitación).
//
// Detalle por habitación (219): cada fila de la tabla tiene un botón
// "👁️ Ver detalle" que abre una tarjeta con dos vistas de esa habitación
// — el listado de reservas/estadías del rango (huésped, fechas, estado,
// $ habitación, $ minibar) y el calendario día por día (ocupada/
// desocupada + minibar de ese día puntual). Dos botones de descarga en
// Excel (.csv) en la pantalla principal cubren TODAS las habitaciones a
// la vez, para que el propietario filtre por habitación y fecha con los
// propios filtros de columna de Excel, en vez de tener que elegir una
// habitación primero dentro de la app.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays, formatFechaCorta } from './dates.js';
import { crearAnillo, crearBarrasHorizontalesApiladas, leerColor } from './graficas.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];

const ETIQUETAS_ESTADO_RESERVA = {
  reservada: '📅 Reservada (aún no llega)',
  confirmada: '📅 Confirmada (aún no llega)',
  check_in: '🔵 En curso',
  hospedado: '🔵 En curso',
  check_out: '✅ Checkout confirmado',
  cancelada: '❌ Cancelada',
  no_show: '🚫 No-show',
};

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// (220) Para interpolar texto dentro de un atributo HTML entre comillas
// dobles (title="...") no basta con escaparHTML: esa función escapa & < >
// (porque así serializa innerHTML un nodo de texto), pero NO escapa la
// comilla doble literal ("), que sí puede cortar el atributo antes de
// tiempo si, por ejemplo, el nombre de un huésped trae comillas. Se usa
// esta variante en cualquier título/tooltip del calendario de ocupación.
function escaparAtributo(texto) {
  return escaparHTML(texto).replace(/"/g, '&quot;');
}

// Orden natural por número de habitación aunque venga como texto ("101",
// "102B", etc.) — primero por la parte numérica, luego alfabético como
// desempate.
function compararNumeroHabitacion(a, b) {
  const numA = parseInt(a.numero, 10);
  const numB = parseInt(b.numero, 10);
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB;
  return String(a.numero).localeCompare(String(b.numero));
}

// Exportables genéricos (Excel/PDF): CSV con BOM (Excel lo abre con
// doble clic) — mismo patrón que ya usa caja.js/detalle-dia.js.
// (220) Delimitador ";" en vez de ",": Excel en configuración regional
// Colombia/Latinoamérica usa la coma como separador DECIMAL, así que
// espera ";" como separador de columnas en un CSV — con "," todo el
// contenido de cada fila caía en una sola celda al abrir con doble clic.
// Cada campo va entre comillas igual que antes, así que ";" o "," dentro
// de un campo no rompen nada.
function descargarCSV(nombreArchivo, filas) {
  const csv = filas.map((fila) => fila.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
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

const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function etiquetaMes(mesISO) {
  const [anio, m] = mesISO.split('-');
  return `${NOMBRES_MES[Number(m) - 1]} ${anio}`;
}

// Mediodía fijo para evitar que el huso horario local mueva el día de la
// semana calculado (con solo "YYYY-MM-DD" el navegador puede interpretar
// medianoche UTC, que en América cae en el día anterior).
function esFinDeSemana(fechaISO) {
  const dow = new Date(`${fechaISO}T12:00:00`).getDay();
  return dow === 0 || dow === 6;
}

// (221) Inicial del día de la semana (L M M J V S D) para identificar de
// un vistazo, sin tener que calcular fechas, qué columnas del calendario
// son los días de mayor ocupación esperada. Índice = Date.getDay() (0 =
// domingo), por eso el arreglo empieza en 'D'.
const LETRAS_DIA_SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
function letraDiaSemana(fechaISO) {
  const dow = new Date(`${fechaISO}T12:00:00`).getDay();
  return LETRAS_DIA_SEMANA[dow];
}

// (220) Calendario de ocupación: tabla HTML (no gráfica de Chart.js — es
// una grilla de estado/categoría por celda, no una magnitud a comparar,
// así que una tabla coloreada comunica mejor que un chart). Habitaciones
// en filas (primera columna fija con position:sticky para no perderla al
// hacer scroll horizontal en rangos largos — se usa border-collapse:
// separate porque sticky no funciona de forma confiable con collapse),
// días en columnas agrupadas por mes. Fin de semana con fondo suave para
// ubicarse rápido. Cada celda lleva un title="" nativo (fecha + huésped +
// minibar del día) — sin librería de tooltips, para mantenerlo simple.
function construirCalendarioOcupacion({ habitaciones, dias, reservaActivaPorDiaYHabitacion, minibarPorDiaYHabitacion, colorOcupada, colorDesocupada }) {
  if (habitaciones.length === 0 || dias.length === 0) return '';

  const avisoRango =
    dias.length > 92
      ? `<p class="mensaje-vacio" style="margin:0 0 0.6rem; font-size:0.78rem;">⚠️ El rango elegido tiene ${dias.length} días — para leerlo más cómodo, considera elegir un rango más corto (por ejemplo, un mes).</p>`
      : '';

  const gruposMes = [];
  dias.forEach((d) => {
    const mes = d.slice(0, 7);
    const ultimo = gruposMes[gruposMes.length - 1];
    if (ultimo && ultimo.mes === mes) ultimo.dias.push(d);
    else gruposMes.push({ mes, dias: [d] });
  });

  const encabezadoMeses = gruposMes
    .map((g) => `<th colspan="${g.dias.length}" style="text-align:center; font-weight:600; font-size:0.72rem; border-bottom:1px solid var(--color-borde); padding-bottom:2px;">${etiquetaMes(g.mes)}</th>`)
    .join('');

  const encabezadoDias = dias
    .map((d) => {
      const numeroDia = d.slice(8, 10);
      const letra = letraDiaSemana(d);
      const fondo = esFinDeSemana(d) ? 'background:var(--color-fondo);' : '';
      return `<th style="font-weight:400; font-size:0.66rem; padding:2px 3px; ${fondo}" title="${escaparAtributo(formatFechaCorta(d))}">
        <div style="font-weight:700; font-size:0.62rem; color:var(--color-texto-suave); line-height:1.2;">${letra}</div>
        <div style="line-height:1.2;">${numeroDia}</div>
      </th>`;
    })
    .join('');

  const filasHabitaciones = habitaciones
    .map((h) => {
      const celdas = dias
        .map((d) => {
          const reserva = reservaActivaPorDiaYHabitacion.get(`${h.id}_${d}`);
          const minibarDia = minibarPorDiaYHabitacion.get(`${h.id}_${d}`) || 0;
          const ocupada = !!reserva;
          const partesTitulo = [formatFechaCorta(d), ocupada ? `Ocupada — ${reserva.huesped_nombre || 'huésped sin nombre'}` : 'Desocupada'];
          if (minibarDia > 0) partesTitulo.push(`Minibar: ${formatCOP(minibarDia)}`);
          const titulo = escaparAtributo(partesTitulo.join(' · '));
          let fondoCelda = ocupada ? colorOcupada : colorDesocupada;
          if (!ocupada && esFinDeSemana(d)) fondoCelda = 'var(--color-fondo)';
          return `<td title="${titulo}" style="background:${fondoCelda}; width:16px; height:16px; padding:0; border:1px solid var(--color-tarjeta, #fff);"></td>`;
        })
        .join('');
      return `<tr>
        <td style="position:sticky; left:0; background:var(--color-tarjeta, #fff); font-weight:600; white-space:nowrap; padding:2px 8px; border-right:1px solid var(--color-borde);">${escaparHTML(h.numero)}</td>
        ${celdas}
      </tr>`;
    })
    .join('');

  return `
    <div class="tarjeta" style="margin-bottom:1.25rem;">
      <h3 style="margin-top:0;">🗓️ Calendario de ocupación (días × habitaciones)</h3>
      ${avisoRango}
      <div style="display:flex; align-items:center; gap:1.25rem; margin-bottom:0.75rem; font-size:0.78rem; color:var(--color-texto-suave);">
        <div style="display:flex; align-items:center; gap:0.4rem;"><span style="width:12px; height:12px; background:${colorOcupada}; display:inline-block; border-radius:2px;"></span> Ocupada</div>
        <div style="display:flex; align-items:center; gap:0.4rem;"><span style="width:12px; height:12px; background:${colorDesocupada}; display:inline-block; border-radius:2px; border:1px solid var(--color-borde);"></span> Desocupada</div>
      </div>
      <div class="tabla-scroll" style="overflow-x:auto;">
        <table style="border-collapse:separate; border-spacing:0; font-size:0.7rem;">
          <thead>
            <tr><th style="position:sticky; left:0; background:var(--color-tarjeta, #fff); z-index:1;"></th>${encabezadoMeses}</tr>
            <tr><th style="position:sticky; left:0; background:var(--color-tarjeta, #fff); z-index:1; border-right:1px solid var(--color-borde);">Hab.</th>${encabezadoDias}</tr>
          </thead>
          <tbody>
            ${filasHabitaciones}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  const inicioDefault = toISODate(addDays(hoyISO, -29));

  container.innerHTML = `
    <h2>Rendimiento por habitación</h2>
    <p class="mensaje-vacio" style="margin-top:-0.6rem;">Cuánto generó cada habitación en el rango elegido — separando lo que entró por la habitación de lo que entró por consumo de minibar.</p>

    <div class="tarjeta">
      <h3 style="margin-top:0;">🗓️ Rango de fechas</h3>
      <form id="form-rendimiento-habitaciones" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${inicioDefault}" required />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" required />
        </label>
        <button type="submit" class="btn btn-primario">Generar</button>
      </form>
      <div style="display:flex; gap:0.6rem; flex-wrap:wrap; margin-top:0.85rem;">
        <button type="button" class="btn btn-secundario btn-chico" id="btn-excel-ocupacion-diaria">⬇ Excel: Ocupación diaria</button>
        <button type="button" class="btn btn-secundario btn-chico" id="btn-excel-reservas-rango">⬇ Excel: Reservas del rango</button>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.6rem; font-size:0.75rem;">Los dos Excel incluyen TODAS las habitaciones del rango elegido arriba — filtra por habitación o por fecha con los propios filtros de columna de Excel.</p>
    </div>

    <div id="rendimiento-habitaciones-resultado" style="margin-top:1.25rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#form-rendimiento-habitaciones').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    generarRendimiento(container, form.get('fecha_inicio'), form.get('fecha_fin'));
  });

  await generarRendimiento(container, inicioDefault, hoyISO);
}

async function generarRendimiento(container, fechaInicioISO, fechaFinISO) {
  const wrap = container.querySelector('#rendimiento-habitaciones-resultado');
  wrap.innerHTML = '<p class="mensaje-vacio">Calculando…</p>';

  if (!fechaInicioISO || !fechaFinISO || fechaFinISO < fechaInicioISO) {
    wrap.innerHTML = '<p class="mensaje-vacio">Revisa el rango de fechas.</p>';
    return;
  }

  const finExclusivoISO = toISODate(addDays(fechaFinISO, 1));

  const [{ data: habitacionesRows, error: errHab }, { data: reservasRows, error: errReservas }, { data: consumosMinibar, error: errMinibar }] =
    await Promise.all([
      supabase.from('habitaciones').select('id, numero, nombre'),
      supabase
        .from('reservas')
        .select('id, habitacion_id, huesped_nombre, fecha_checkin, fecha_checkout, estado, monto_total')
        .lt('fecha_checkin', finExclusivoISO)
        .gt('fecha_checkout', fechaInicioISO),
      supabase
        .from('minibar_consumos')
        .select('monto, habitacion_id, creado_en')
        .gte('creado_en', fechaInicioISO)
        .lt('creado_en', finExclusivoISO),
    ]);

  const error = errHab || errReservas || errMinibar;
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error calculando el rendimiento: ${error.message}</p>`;
    return;
  }

  const habitaciones = [...(habitacionesRows || [])].sort(compararNumeroHabitacion);
  const habitacionPorId = new Map(habitaciones.map((h) => [h.id, h]));

  // Reservas que ocupan (no canceladas ni no-show) — se usan para
  // ocupación diaria Y para $ habitación (monto_total completo de cada
  // una, ver nota de cabecera).
  const reservasActivas = (reservasRows || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));

  const dias = [];
  for (let f = fechaInicioISO; f <= fechaFinISO; f = toISODate(addDays(f, 1))) dias.push(f);

  // --- Noches ocupadas por habitación + índice día->reservas activas (para el calendario y el Excel de ocupación diaria) ---
  const nochesPorHabitacion = new Map();
  const reservaActivaPorDiaYHabitacion = new Map(); // clave `${habitacionId}_${fecha}` -> reserva
  habitaciones.forEach((h) => nochesPorHabitacion.set(h.id, 0));
  dias.forEach((dia) => {
    reservasActivas
      .filter((r) => dia >= r.fecha_checkin && dia < r.fecha_checkout)
      .forEach((r) => {
        if (!nochesPorHabitacion.has(r.habitacion_id)) return;
        nochesPorHabitacion.set(r.habitacion_id, nochesPorHabitacion.get(r.habitacion_id) + 1);
        reservaActivaPorDiaYHabitacion.set(`${r.habitacion_id}_${dia}`, r);
      });
  });

  // --- $ habitación por habitación: monto_total completo de cada reserva activa que se cruza con el rango ---
  const montoHabitacionPorHabitacion = new Map();
  const reservasPorHabitacion = new Map(); // habitacionId -> [reserva, ...] (para el detalle y el Excel de reservas)
  habitaciones.forEach((h) => {
    montoHabitacionPorHabitacion.set(h.id, 0);
    reservasPorHabitacion.set(h.id, []);
  });
  reservasActivas.forEach((r) => {
    if (!montoHabitacionPorHabitacion.has(r.habitacion_id)) return;
    montoHabitacionPorHabitacion.set(r.habitacion_id, montoHabitacionPorHabitacion.get(r.habitacion_id) + Number(r.monto_total || 0));
    reservasPorHabitacion.get(r.habitacion_id).push(r);
  });

  // --- $ minibar, directo por minibar_consumos.habitacion_id + índice por día (calendario y Excel) ---
  const montoMinibarPorHabitacion = new Map();
  const minibarPorDiaYHabitacion = new Map(); // clave `${habitacionId}_${fecha}` -> suma del día
  habitaciones.forEach((h) => montoMinibarPorHabitacion.set(h.id, 0));
  (consumosMinibar || []).forEach((c) => {
    if (c.habitacion_id == null || !montoMinibarPorHabitacion.has(c.habitacion_id)) return;
    montoMinibarPorHabitacion.set(c.habitacion_id, montoMinibarPorHabitacion.get(c.habitacion_id) + Number(c.monto));
    const dia = toISODate(new Date(c.creado_en));
    const clave = `${c.habitacion_id}_${dia}`;
    minibarPorDiaYHabitacion.set(clave, (minibarPorDiaYHabitacion.get(clave) || 0) + Number(c.monto));
  });

  const filas = habitaciones.map((h) => {
    const montoHabitacion = montoHabitacionPorHabitacion.get(h.id) || 0;
    const montoMinibar = montoMinibarPorHabitacion.get(h.id) || 0;
    return {
      habitacionId: h.id,
      numero: h.numero,
      nombre: h.nombre,
      noches: nochesPorHabitacion.get(h.id) || 0,
      montoHabitacion,
      montoMinibar,
      montoTotal: montoHabitacion + montoMinibar,
    };
  });

  const totalHabitacion = filas.reduce((sum, f) => sum + f.montoHabitacion, 0);
  const totalMinibar = filas.reduce((sum, f) => sum + f.montoMinibar, 0);
  const totalGeneral = totalHabitacion + totalMinibar;
  const totalNoches = filas.reduce((sum, f) => sum + f.noches, 0);
  const pctHabitacion = totalGeneral > 0 ? (totalHabitacion / totalGeneral) * 100 : 0;
  const pctMinibar = totalGeneral > 0 ? 100 - pctHabitacion : 0;

  const colorHabitacion = leerColor('--color-azul', '#1e4e8c');
  const colorMinibar = leerColor('--color-pendiente', '#c77c11');
  const colorOcupada = leerColor('--color-azul', '#1e4e8c');
  const colorDesocupada = leerColor('--color-borde', '#e0e0e0');

  const calendarioHTML = construirCalendarioOcupacion({
    habitaciones,
    dias,
    reservaActivaPorDiaYHabitacion,
    minibarPorDiaYHabitacion,
    colorOcupada,
    colorDesocupada,
  });

  wrap.innerHTML = `
    <div class="grid-tres-columnas" style="margin-bottom:1.25rem;">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">💰 Total del rango</div>
        <div class="stat-card-valor">${formatCOP(totalGeneral)}</div>
        <div class="stat-card-subtitulo">${totalNoches} noche(s) vendida(s) en total</div>
      </div>
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">🛏️ Por habitaciones</div>
        <div class="stat-card-valor">${formatCOP(totalHabitacion)}</div>
        <div class="stat-card-subtitulo">${pctHabitacion.toFixed(1)}% del total</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">🥤 Por minibar</div>
        <div class="stat-card-valor">${formatCOP(totalMinibar)}</div>
        <div class="stat-card-subtitulo">${pctMinibar.toFixed(1)}% del total</div>
      </div>
    </div>

    <p class="mensaje-vacio" style="margin:-0.6rem 0 1.25rem; font-size:0.78rem;">💡 El $ de habitación es el valor completo de cada estadía que se cruza con este rango — si una estadía cruza la frontera del rango (por ejemplo, empieza antes de la fecha "Desde"), se cuenta completa aquí, no se reparte entre rangos.</p>

    <div class="grid-dos-columnas" style="margin-bottom:1.25rem;">
      <div class="tarjeta">
        <h3 style="margin-top:0;">🎯 Habitación vs. minibar</h3>
        <div style="display:flex; align-items:center; gap:1.5rem; flex-wrap:wrap;">
          <div style="width:140px; height:140px;">
            <canvas id="chart-anillo-habitacion-minibar"></canvas>
          </div>
          <div style="font-size:0.85rem; color:var(--color-texto-suave);">
            <div style="display:flex; align-items:center; gap:0.4rem; margin-bottom:0.4rem;"><span style="width:10px; height:10px; border-radius:50%; background:${colorHabitacion}; display:inline-block;"></span> Habitación — ${formatCOP(totalHabitacion)}</div>
            <div style="display:flex; align-items:center; gap:0.4rem;"><span style="width:10px; height:10px; border-radius:50%; background:${colorMinibar}; display:inline-block;"></span> Minibar — ${formatCOP(totalMinibar)}</div>
          </div>
        </div>
      </div>
      <div class="tarjeta">
        <h3 style="margin-top:0;">📊 $ por habitación (habitación + minibar)</h3>
        <div style="height:${Math.max(220, filas.length * 32)}px;">
          <canvas id="chart-barras-habitaciones"></canvas>
        </div>
      </div>
    </div>

    ${calendarioHTML}

    <div class="tarjeta">
      <h3 style="margin-top:0;">🛏️ Detalle por habitación</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Habitación</th>
              <th>Noches ocupadas</th>
              <th>$ Habitación</th>
              <th>$ Minibar</th>
              <th>$ Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              filas
                .map(
                  (f) => `<tr data-habitacion-id="${f.habitacionId}">
                <td>${escaparHTML(f.numero)}${f.nombre ? ` <span class="mensaje-vacio">— ${escaparHTML(f.nombre)}</span>` : ''}</td>
                <td>${f.noches}</td>
                <td>${formatCOP(f.montoHabitacion)}</td>
                <td>${formatCOP(f.montoMinibar)}</td>
                <td style="font-weight:700;">${formatCOP(f.montoTotal)}</td>
                <td><button type="button" class="btn-editar btn-ver-detalle-habitacion">👁️ Ver detalle</button></td>
              </tr>`
                )
                .join('') || '<tr><td colspan="6" class="mensaje-vacio">No hay habitaciones registradas.</td></tr>'
            }
          </tbody>
          <tfoot>
            <tr style="font-weight:700; border-top:2px solid var(--color-borde);">
              <td>TOTAL</td>
              <td>${totalNoches}</td>
              <td>${formatCOP(totalHabitacion)}</td>
              <td>${formatCOP(totalMinibar)}</td>
              <td>${formatCOP(totalGeneral)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  crearAnillo(container.querySelector('#chart-anillo-habitacion-minibar'), {
    porcentaje: pctHabitacion,
    colorPrincipal: colorHabitacion,
    colorFondo: colorMinibar,
    etiqueta: 'Habitación',
  });

  if (filas.length > 0) {
    // Igual que el Top 10 de Indicadores: se invierte el arreglo para que
    // la habitación #1 (menor numeración) quede arriba en la gráfica.
    const filasParaGrafica = [...filas].reverse();
    crearBarrasHorizontalesApiladas(container.querySelector('#chart-barras-habitaciones'), {
      labels: filasParaGrafica.map((f) => `Hab. ${f.numero}`),
      series: [
        { label: 'Habitación', data: filasParaGrafica.map((f) => f.montoHabitacion), color: colorHabitacion },
        { label: 'Minibar', data: filasParaGrafica.map((f) => f.montoMinibar), color: colorMinibar },
      ],
      formatoValor: (v) => formatCOP(v),
    });
  }

  wrap.querySelectorAll('.btn-ver-detalle-habitacion').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const habitacionId = Number(e.target.closest('tr').dataset.habitacionId);
      const habitacion = habitacionPorId.get(habitacionId);
      abrirModalDetalleHabitacion(habitacion, {
        reservas: reservasPorHabitacion.get(habitacionId) || [],
        dias,
        reservaActivaPorDiaYHabitacion,
        minibarPorDiaYHabitacion,
        fechaInicioISO,
        fechaFinISO,
      });
    });
  });

  // --- Botones de descarga Excel (todas las habitaciones del rango) ---
  const btnExcelOcupacion = container.querySelector('#btn-excel-ocupacion-diaria');
  const btnExcelReservas = container.querySelector('#btn-excel-reservas-rango');
  if (btnExcelOcupacion) {
    btnExcelOcupacion.onclick = () =>
      descargarExcelOcupacionDiaria(habitaciones, dias, reservaActivaPorDiaYHabitacion, minibarPorDiaYHabitacion, fechaInicioISO, fechaFinISO);
  }
  if (btnExcelReservas) {
    btnExcelReservas.onclick = () => descargarExcelReservasRango(habitaciones, reservasPorHabitacion, dias, fechaInicioISO, fechaFinISO);
  }
}

// =========================================================
// Modal "Ver detalle" de una habitación: reservas del rango + calendario
// día por día (ocupada/desocupada + minibar de ese día).
// =========================================================
function abrirModalDetalleHabitacion(habitacion, { reservas, dias, reservaActivaPorDiaYHabitacion, minibarPorDiaYHabitacion, fechaInicioISO, fechaFinISO }) {
  const reservasOrdenadas = [...reservas].sort((a, b) => (a.fecha_checkin < b.fecha_checkin ? -1 : 1));

  const filasReservas = reservasOrdenadas
    .map((r) => {
      const nochesEnRango = dias.filter((d) => d >= r.fecha_checkin && d < r.fecha_checkout).length;
      const montoMinibarEstadia = dias
        .filter((d) => d >= r.fecha_checkin && d < r.fecha_checkout)
        .reduce((sum, d) => sum + (minibarPorDiaYHabitacion.get(`${habitacion.id}_${d}`) || 0), 0);
      return `<tr>
        <td>${escaparHTML(r.huesped_nombre || '—')}</td>
        <td>${formatFechaCorta(r.fecha_checkin)}</td>
        <td>${formatFechaCorta(r.fecha_checkout)}</td>
        <td>${nochesEnRango}</td>
        <td>${ETIQUETAS_ESTADO_RESERVA[r.estado] || r.estado}</td>
        <td>${r.monto_total != null ? formatCOP(r.monto_total) : '—'}</td>
        <td>${formatCOP(montoMinibarEstadia)}</td>
      </tr>`;
    })
    .join('');

  const filasCalendario = dias
    .map((d) => {
      const reserva = reservaActivaPorDiaYHabitacion.get(`${habitacion.id}_${d}`);
      const minibarDia = minibarPorDiaYHabitacion.get(`${habitacion.id}_${d}`) || 0;
      return `<tr>
        <td>${formatFechaCorta(d)}</td>
        <td>${reserva ? '🟢 Ocupada' : '⚪ Desocupada'}</td>
        <td>${reserva ? escaparHTML(reserva.huesped_nombre || '—') : '—'}</td>
        <td>${formatCOP(minibarDia)}</td>
      </tr>`;
    })
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-super-ancha">
      <h3>🛏️ Habitación ${escaparHTML(habitacion.numero)}${habitacion.nombre ? ` — ${escaparHTML(habitacion.nombre)}` : ''}</h3>
      <p class="mensaje-vacio" style="margin-top:-0.4rem;">Del ${formatFechaCorta(fechaInicioISO)} al ${formatFechaCorta(fechaFinISO)}</p>

      <h4 style="margin-bottom:0.4rem;">Reservas del rango (${reservasOrdenadas.length})</h4>
      <div class="tabla-scroll" style="margin-bottom:1.25rem;">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Huésped</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Noches (en rango)</th>
              <th>Estado</th>
              <th>$ Habitación</th>
              <th>$ Minibar</th>
            </tr>
          </thead>
          <tbody>
            ${filasReservas || '<tr><td colspan="7" class="mensaje-vacio">Sin reservas en este rango.</td></tr>'}
          </tbody>
        </table>
      </div>

      <h4 style="margin-bottom:0.4rem;">Calendario día por día</h4>
      <div class="tabla-scroll" style="max-height:320px; overflow-y:auto;">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Huésped</th>
              <th>$ Minibar del día</th>
            </tr>
          </thead>
          <tbody>
            ${filasCalendario}
          </tbody>
        </table>
      </div>

      <div class="modal-acciones" style="margin-top:1.25rem;">
        <button type="button" class="btn btn-secundario" id="btn-cerrar-detalle-habitacion">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cerrar-detalle-habitacion').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// =========================================================
// Excel: Ocupación diaria (todas las habitaciones del rango)
// =========================================================
function descargarExcelOcupacionDiaria(habitaciones, dias, reservaActivaPorDiaYHabitacion, minibarPorDiaYHabitacion, fechaInicioISO, fechaFinISO) {
  const filas = [['Habitación', 'Nombre', 'Fecha', 'Estado', 'Huésped', 'Monto minibar del día']];
  habitaciones.forEach((h) => {
    dias.forEach((d) => {
      const reserva = reservaActivaPorDiaYHabitacion.get(`${h.id}_${d}`);
      const minibarDia = minibarPorDiaYHabitacion.get(`${h.id}_${d}`) || 0;
      filas.push([h.numero, h.nombre || '', d, reserva ? 'Ocupada' : 'Desocupada', reserva ? reserva.huesped_nombre || '' : '', minibarDia]);
    });
  });
  descargarCSV(`ocupacion-diaria-${fechaInicioISO}-a-${fechaFinISO}.csv`, filas);
}

// =========================================================
// Excel: Reservas del rango (todas las habitaciones)
// =========================================================
function descargarExcelReservasRango(habitaciones, reservasPorHabitacion, dias, fechaInicioISO, fechaFinISO) {
  const filas = [['Habitación', 'Nombre', 'Huésped', 'Check-in', 'Check-out', 'Noches (en rango)', 'Estado', 'Monto habitación', 'Reserva ID']];
  habitaciones.forEach((h) => {
    (reservasPorHabitacion.get(h.id) || []).forEach((r) => {
      const nochesEnRango = dias.filter((d) => d >= r.fecha_checkin && d < r.fecha_checkout).length;
      filas.push([
        h.numero,
        h.nombre || '',
        r.huesped_nombre || '',
        r.fecha_checkin,
        r.fecha_checkout,
        nochesEnRango,
        ETIQUETAS_ESTADO_RESERVA[r.estado] || r.estado,
        r.monto_total ?? 0,
        r.id,
      ]);
    });
  });
  descargarCSV(`reservas-por-habitacion-${fechaInicioISO}-a-${fechaFinISO}.csv`, filas);
}

registerModule({
  id: 'rendimiento-habitaciones',
  label: 'Rendimiento por habitación',
  icono: '🛏️',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
