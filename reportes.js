// reportes.js
//
// Módulo: Reportes. Cuatro listados operativos exportables a CSV (para
// abrir en Excel), sobre los mismos datos que ya usan Reservas, Huéspedes,
// Caja/Minibar e Indicadores — este módulo no crea tablas propias, solo
// las consulta y las presenta en formato de reporte descargable.
//
// 1. Reservas del período — listado detallado por fecha de check-in.
// 2. Ocupación por habitación — noches ocupadas e ingresos por habitación
//    en el rango (si una reserva cruza el rango, su monto se cuenta
//    completo una sola vez, sin prorratear por noche).
// 3. Huéspedes — listado completo con visitas y total histórico gastado
//    (no usa el rango de fechas, es el mismo cálculo que huespedes.js).
// 4. Ventas por producto — ranking de productos del minibar, combinando
//    ventas de mostrador (Caja) y consumo en habitaciones, en el rango.
//    Ver nota (236) más abajo.
//
// Reactivado (236) — había quedado oculto (roles: []) desde 160 a pedido
// de Elssy; vuelve a tener roles ['propietario', 'administrador'], igual
// que Estadísticas/Rendimiento por habitación/Indicadores.
//
// Nota (215 / auditoría H40): "Reservas del período" no filtraba por
// estado en absoluto — sumaba canceladas/no-show junto con las válidas,
// a diferencia de "Ocupación por habitación" (más abajo), que sí excluye
// esos estados con ESTADOS_NO_OCUPAN. Ahora ambos reportes son
// consistentes entre sí.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate, addDays, formatFechaCorta, limiteDiaBogota } from './dates.js';
import { badgeEstadoReserva } from './badges.js';

const ESTADOS_NO_OCUPAN = ['cancelada', 'no_show'];
const ESTADOS_VISITA = ['hospedado', 'check_out'];

const TIPOS_REPORTE = [
  { id: 'reservas', label: 'Reservas del período' },
  { id: 'ocupacion', label: 'Ocupación por habitación' },
  { id: 'ventas_producto', label: 'Ventas por producto' },
  { id: 'huespedes', label: 'Huéspedes (histórico completo)' },
];

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function calcularNoches(checkinISO, checkoutISO) {
  if (!checkinISO || !checkoutISO) return 0;
  const ms = new Date(checkoutISO) - new Date(checkinISO);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

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

async function render(container) {
  const hoyISO = toISODate(new Date());
  const inicioDefault = toISODate(addDays(hoyISO, -29));

  container.innerHTML = `
    <h2>Reportes</h2>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <form id="form-reportes" class="form-grid">
        <label>Tipo de reporte
          <select name="tipo">
            ${TIPOS_REPORTE.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}
          </select>
        </label>
        <label>Desde
          <input type="date" name="fecha_inicio" value="${inicioDefault}" />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" />
        </label>
        <button type="submit" class="btn btn-primario">Generar</button>
      </form>
      <p class="mensaje-vacio" style="margin-top:0.5rem; font-size:0.78rem;">El reporte de Huéspedes muestra el histórico completo; el rango de fechas no aplica para ese. Para Ventas por producto, el rango se evalúa en hora de Colombia (incluye toda la noche del día "Hasta").</p>
    </div>
    <div id="reportes-resultado-wrap">
      <p class="mensaje-vacio">Elige un reporte y dale a Generar.</p>
    </div>
  `;

  container.querySelector('#form-reportes').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await generarReporte(container.querySelector('#reportes-resultado-wrap'), form.get('tipo'), form.get('fecha_inicio'), form.get('fecha_fin'));
  });

  await generarReporte(container.querySelector('#reportes-resultado-wrap'), 'reservas', inicioDefault, hoyISO);
}

async function generarReporte(elemento, tipo, fechaInicio, fechaFin) {
  elemento.innerHTML = '<p class="mensaje-vacio">Calculando…</p>';

  if (tipo === 'reservas') return reporteReservas(elemento, fechaInicio, fechaFin);
  if (tipo === 'ocupacion') return reporteOcupacion(elemento, fechaInicio, fechaFin);
  if (tipo === 'ventas_producto') return reporteVentasPorProducto(elemento, fechaInicio, fechaFin);
  if (tipo === 'huespedes') return reporteHuespedes(elemento);
}

async function reporteReservas(elemento, fechaInicio, fechaFin) {
  const { data: reservasCrudas, error } = await supabase
    .from('reservas')
    .select('*, habitaciones(numero, nombre)')
    .gte('fecha_checkin', fechaInicio)
    .lte('fecha_checkin', fechaFin)
    .order('fecha_checkin', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error generando el reporte: ${error.message}</p>`;
    return;
  }

  // (215 / auditoría H40) Antes este reporte no filtraba por estado en
  // absoluto — sumaba canceladas/no-show junto con las válidas, a
  // diferencia de reporteOcupacion (más abajo), que sí usa esta misma
  // constante ESTADOS_NO_OCUPAN para excluirlas.
  const reservas = (reservasCrudas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));

  if (reservas.length === 0) {
    elemento.innerHTML = '<p class="mensaje-vacio">Sin reservas en este rango.</p>';
    return;
  }

  const totalMonto = reservas.reduce((acc, r) => acc + Number(r.monto_total || 0), 0);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.75rem;">
        <h3 style="margin:0;">Reservas del período — ${reservas.length} reserva(s), total ${formatCOP(totalMonto)}</h3>
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr><th>Huésped</th><th>Documento</th><th>Teléfono</th><th>Habitación</th><th>Check-in</th><th>Check-out</th><th>Noches</th><th>Estado</th><th>Monto</th></tr>
          </thead>
          <tbody>
            ${reservas
              .map((r) => {
                const noches = calcularNoches(r.fecha_checkin, r.fecha_checkout);
                const habitacion = r.habitaciones ? `${r.habitaciones.numero} — ${r.habitaciones.nombre}` : '—';
                return `<tr>
                  <td>${escaparHTML(r.huesped_nombre)}</td>
                  <td>${escaparHTML(r.huesped_documento || '—')}</td>
                  <td>${escaparHTML(r.huesped_telefono || '—')}</td>
                  <td>${escaparHTML(habitacion)}</td>
                  <td>${formatFechaCorta(r.fecha_checkin)}</td>
                  <td>${formatFechaCorta(r.fecha_checkout)}</td>
                  <td>${noches}</td>
                  <td>${badgeEstadoReserva(r.estado)}</td>
                  <td>${r.monto_total ? formatCOP(r.monto_total) : '—'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const filas = [['Huésped', 'Documento', 'Teléfono', 'Habitación', 'Check-in', 'Check-out', 'Noches', 'Estado', 'Monto']];
    reservas.forEach((r) => {
      const habitacion = r.habitaciones ? `${r.habitaciones.numero} — ${r.habitaciones.nombre}` : '';
      filas.push([
        r.huesped_nombre,
        r.huesped_documento || '',
        r.huesped_telefono || '',
        habitacion,
        r.fecha_checkin,
        r.fecha_checkout,
        calcularNoches(r.fecha_checkin, r.fecha_checkout),
        r.estado,
        r.monto_total || 0,
      ]);
    });
    descargarCSV(`reservas_${fechaInicio}_a_${fechaFin}.csv`, filas);
  });
}

async function reporteOcupacion(elemento, fechaInicio, fechaFin) {
  const finExclusivoISO = toISODate(addDays(fechaFin, 1));

  const [{ data: habitaciones, error: errHab }, { data: reservas, error: errRes }, { data: pasadiasRows, error: errPasadias }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre').order('numero'),
    supabase
      .from('reservas')
      .select('habitacion_id, fecha_checkin, fecha_checkout, estado, monto_total')
      .lt('fecha_checkin', finExclusivoISO)
      .gt('fecha_checkout', fechaInicio),
    // (236 / pasadía) Una pasadía guarda fecha_checkin = fecha_checkout
    // (rango vacío, ver 228), así que nunca cumple ".gt('fecha_checkout',
    // fechaInicio)" de arriba cuando cae justo en el primer día del rango
    // — se consulta aparte para no perder su ingreso (igual que ya se hizo
    // en rendimiento-habitaciones.js y estadisticas.js).
    supabase
      .from('reservas')
      .select('habitacion_id, estado, monto_total')
      .eq('es_pasadia', true)
      .gte('fecha_checkin', fechaInicio)
      .lte('fecha_checkin', fechaFin),
  ]);

  const error = errHab || errRes || errPasadias;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error generando el reporte: ${error.message}</p>`;
    return;
  }

  const dias = [];
  for (let f = fechaInicio; f <= fechaFin; f = toISODate(addDays(f, 1))) {
    dias.push(f);
  }

  const reservasActivas = (reservas || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));
  const pasadiasActivas = (pasadiasRows || []).filter((r) => !ESTADOS_NO_OCUPAN.includes(r.estado));

  const filas = (habitaciones || []).map((h) => {
    const reservasHabitacion = reservasActivas.filter((r) => r.habitacion_id === h.id);
    const pasadiasHabitacion = pasadiasActivas.filter((r) => r.habitacion_id === h.id);
    const nochesOcupadas = dias.filter((dia) => reservasHabitacion.some((r) => dia >= r.fecha_checkin && dia < r.fecha_checkout)).length;
    // (236 / pasadía) El ingreso de la pasadía sí se suma — solo se deja
    // fuera de nochesOcupadas/ocupacionPct, porque una pasadía no pasa la
    // noche y no debe contar como noche ocupada (misma regla que en todo
    // el resto de la app desde 228).
    const ingresos =
      reservasHabitacion.reduce((acc, r) => acc + Number(r.monto_total || 0), 0) +
      pasadiasHabitacion.reduce((acc, r) => acc + Number(r.monto_total || 0), 0);
    const ocupacionPct = dias.length > 0 ? (nochesOcupadas / dias.length) * 100 : 0;
    return {
      habitacion: `${h.numero} — ${h.nombre}`,
      nochesOcupadas,
      totalDias: dias.length,
      ocupacionPct,
      ingresos,
      reservas: reservasHabitacion.length + pasadiasHabitacion.length,
    };
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.75rem;">
        <h3 style="margin:0;">Ocupación por habitación — ${fechaInicio} a ${fechaFin}</h3>
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Habitación</th><th>Noches ocupadas</th><th>Ocupación</th><th>Reservas</th><th>Ingresos</th></tr></thead>
          <tbody>
            ${filas
              .map(
                (f) => `<tr>
                  <td>${escaparHTML(f.habitacion)}</td>
                  <td>${f.nochesOcupadas} / ${f.totalDias}</td>
                  <td>${f.ocupacionPct.toFixed(1)}%</td>
                  <td>${f.reservas}</td>
                  <td>${formatCOP(f.ingresos)}</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin habitaciones configuradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const csvFilas = [['Habitación', 'Noches ocupadas', 'Total días', 'Ocupación %', 'Reservas', 'Ingresos']];
    filas.forEach((f) => {
      csvFilas.push([f.habitacion, f.nochesOcupadas, f.totalDias, f.ocupacionPct.toFixed(1), f.reservas, f.ingresos]);
    });
    descargarCSV(`ocupacion_${fechaInicio}_a_${fechaFin}.csv`, csvFilas);
  });
}

// (236) Ventas por producto — junta ventas_mostrador (venta directa en
// Caja) y minibar_consumos (consumo cargado a una habitación), agrupadas
// por producto. Ambas tablas comparten la misma forma (producto_id,
// cantidad, monto, creado_en) así que se combinan sin prorratear nada.
// Se usa limiteDiaBogota para el límite del rango porque ambas columnas
// creado_en son timestamptz (ver 235 / zona horaria) — sin esto, el
// primer y el último día del rango podrían perder ventas de la noche.
async function reporteVentasPorProducto(elemento, fechaInicio, fechaFin) {
  const desde = limiteDiaBogota(fechaInicio);
  const hasta = limiteDiaBogota(toISODate(addDays(fechaFin, 1)));

  const [
    { data: productos, error: errProductos },
    { data: mostrador, error: errMostrador },
    { data: minibar, error: errMinibar },
  ] = await Promise.all([
    supabase.from('minibar_productos').select('id, nombre, categoria'),
    supabase.from('ventas_mostrador').select('producto_id, cantidad, monto, creado_en').gte('creado_en', desde).lt('creado_en', hasta),
    supabase.from('minibar_consumos').select('producto_id, cantidad, monto, creado_en').gte('creado_en', desde).lt('creado_en', hasta),
  ]);

  const error = errProductos || errMostrador || errMinibar;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error generando el reporte: ${error.message}</p>`;
    return;
  }

  const productoPorId = new Map((productos || []).map((p) => [p.id, p]));

  const porProducto = new Map();
  function sumar(productoId, cantidad, monto, origen) {
    const fila = porProducto.get(productoId) || {
      productoId,
      cantidadMostrador: 0,
      montoMostrador: 0,
      cantidadMinibar: 0,
      montoMinibar: 0,
    };
    if (origen === 'mostrador') {
      fila.cantidadMostrador += cantidad;
      fila.montoMostrador += monto;
    } else {
      fila.cantidadMinibar += cantidad;
      fila.montoMinibar += monto;
    }
    porProducto.set(productoId, fila);
  }

  (mostrador || []).forEach((v) => sumar(v.producto_id, Number(v.cantidad || 0), Number(v.monto || 0), 'mostrador'));
  (minibar || []).forEach((v) => sumar(v.producto_id, Number(v.cantidad || 0), Number(v.monto || 0), 'minibar'));

  const filas = Array.from(porProducto.values())
    .map((f) => {
      const producto = productoPorId.get(f.productoId);
      return {
        ...f,
        nombre: producto?.nombre || `Producto #${f.productoId} (eliminado)`,
        categoria: producto?.categoria || '—',
        cantidadTotal: f.cantidadMostrador + f.cantidadMinibar,
        montoTotal: f.montoMostrador + f.montoMinibar,
      };
    })
    .sort((a, b) => b.montoTotal - a.montoTotal);

  if (filas.length === 0) {
    elemento.innerHTML = '<p class="mensaje-vacio">Sin ventas de productos en este rango.</p>';
    return;
  }

  const totalCantidad = filas.reduce((acc, f) => acc + f.cantidadTotal, 0);
  const totalMonto = filas.reduce((acc, f) => acc + f.montoTotal, 0);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.75rem;">
        <h3 style="margin:0;">Ventas por producto — ${filas.length} producto(s), ${totalCantidad} unidad(es), total ${formatCOP(totalMonto)}</h3>
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      <p class="mensaje-vacio" style="margin-top:-0.4rem; font-size:0.78rem;">Combina ventas de mostrador (Caja) + consumo de minibar en habitaciones. Ordenado de mayor a menor monto total.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Producto</th><th>Categoría</th>
              <th>Cant. mostrador</th><th>Monto mostrador</th>
              <th>Cant. minibar</th><th>Monto minibar</th>
              <th>Cant. total</th><th>Monto total</th>
            </tr>
          </thead>
          <tbody>
            ${filas
              .map(
                (f) => `<tr>
                  <td>${escaparHTML(f.nombre)}</td>
                  <td>${escaparHTML(f.categoria)}</td>
                  <td>${f.cantidadMostrador}</td>
                  <td>${formatCOP(f.montoMostrador)}</td>
                  <td>${f.cantidadMinibar}</td>
                  <td>${formatCOP(f.montoMinibar)}</td>
                  <td>${f.cantidadTotal}</td>
                  <td>${formatCOP(f.montoTotal)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const csvFilas = [
      ['Producto', 'Categoría', 'Cant. mostrador', 'Monto mostrador', 'Cant. minibar', 'Monto minibar', 'Cant. total', 'Monto total'],
    ];
    filas.forEach((f) => {
      csvFilas.push([f.nombre, f.categoria, f.cantidadMostrador, f.montoMostrador, f.cantidadMinibar, f.montoMinibar, f.cantidadTotal, f.montoTotal]);
    });
    descargarCSV(`ventas_por_producto_${fechaInicio}_a_${fechaFin}.csv`, csvFilas);
  });
}

async function reporteHuespedes(elemento) {
  const { data: huespedes, error } = await supabase.from('huespedes').select('*').order('nombre');

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error generando el reporte: ${error.message}</p>`;
    return;
  }

  if (!huespedes || huespedes.length === 0) {
    elemento.innerHTML = '<p class="mensaje-vacio">No hay huéspedes registrados todavía.</p>';
    return;
  }

  const documentos = huespedes.map((h) => h.numero_documento);
  const { data: estadias, error: errEstadias } = await supabase
    .from('reservas')
    .select('huesped_documento, estado, monto_total, fecha_checkin')
    .in('huesped_documento', documentos)
    .in('estado', ESTADOS_VISITA);

  if (errEstadias) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando historial: ${errEstadias.message}</p>`;
    return;
  }

  const statsPorDocumento = {};
  (estadias || []).forEach((r) => {
    const s = (statsPorDocumento[r.huesped_documento] ||= { visitas: 0, total: 0, ultima: null });
    s.visitas += 1;
    s.total += Number(r.monto_total || 0);
    if (!s.ultima || r.fecha_checkin > s.ultima) s.ultima = r.fecha_checkin;
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.75rem;">
        <h3 style="margin:0;">Huéspedes — ${huespedes.length} registrado(s)</h3>
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th>Empresa</th><th>Visitas</th><th>Total gastado</th><th>Última visita</th></tr></thead>
          <tbody>
            ${huespedes
              .map((h) => {
                const s = statsPorDocumento[h.numero_documento] || { visitas: 0, total: 0, ultima: null };
                return `<tr>
                  <td>${escaparHTML(h.nombre)}</td>
                  <td>${escaparHTML(h.numero_documento)}</td>
                  <td>${escaparHTML(h.telefono || '—')}</td>
                  <td>${escaparHTML(h.correo || '—')}</td>
                  <td>${escaparHTML(h.empresa || '—')}</td>
                  <td>${s.visitas}</td>
                  <td>${formatCOP(s.total)}</td>
                  <td>${s.ultima ? formatFechaCorta(s.ultima) : '—'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const csvFilas = [['Nombre', 'Documento', 'Teléfono', 'Correo', 'Empresa', 'Visitas', 'Total gastado', 'Última visita']];
    huespedes.forEach((h) => {
      const s = statsPorDocumento[h.numero_documento] || { visitas: 0, total: 0, ultima: null };
      csvFilas.push([h.nombre, h.numero_documento, h.telefono || '', h.correo || '', h.empresa || '', s.visitas, s.total, s.ultima || '']);
    });
    descargarCSV('huespedes.csv', csvFilas);
  });
}

registerModule({
  id: 'reportes',
  label: 'Reportes',
  icono: '📈',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-analisis',
  render,
});
