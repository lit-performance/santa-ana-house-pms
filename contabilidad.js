// contabilidad.js
//
// Módulo: Contabilidad. Consolidado de ingresos y egresos del hotel para
// el contador, por rango de fechas.
//
// Ingresos = pagos de reservas (reservas_pagos, habitación + minibar
// liquidados) + movimientos manuales de ingreso en Caja (ventas varias,
// etc.). No se duplica nada: reservas_pagos y caja_movimientos ya son
// mutuamente excluyentes por diseño (ver caja.js).
//
// Egresos = movimientos manuales de egreso en Caja + el costo de las
// órdenes de compra ya recibidas en el rango (ver compras.js). Todavía no
// existe un módulo dedicado de "Gastos" — cuando exista, se suma aquí
// igual que Compras.
//
// El rango de fechas se lee directo de las tablas fuente (no de
// caja_turnos) para no perder dinero que entró con la caja cerrada, mismo
// criterio que ya usa indicadores.js.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { formatCOP } from './currency.js';
import { toISODate } from './dates.js';

function primerDiaDelMes() {
  const hoy = new Date();
  return toISODate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  container.innerHTML = `
    <h2>Contabilidad</h2>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <form id="form-rango-contabilidad" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${primerDiaDelMes()}" />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" />
        </label>
        <button type="submit" class="btn btn-primario">Consultar</button>
      </form>
    </div>
    <div id="contabilidad-resultado-wrap">
      <p class="mensaje-vacio">Elige un rango y dale a Consultar.</p>
    </div>
  `;

  container.querySelector('#form-rango-contabilidad').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await generarConsolidado(
      container.querySelector('#contabilidad-resultado-wrap'),
      form.get('fecha_inicio'),
      form.get('fecha_fin')
    );
  });

  await generarConsolidado(container.querySelector('#contabilidad-resultado-wrap'), primerDiaDelMes(), hoyISO);
}

async function generarConsolidado(elemento, fechaInicio, fechaFin) {
  elemento.innerHTML = '<p class="mensaje-vacio">Calculando…</p>';

  // El rango de fechas cubre desde el inicio del día de fechaInicio hasta
  // el final del día de fechaFin (los timestamps se comparan en ISO).
  const desde = `${fechaInicio}T00:00:00`;
  const hasta = `${fechaFin}T23:59:59`;

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }, { data: ordenes, error: errOrdenes }, { data: facturas, error: errFacturas }] =
    await Promise.all([
      supabase.from('reservas_pagos').select('monto, fecha').gte('fecha', desde).lte('fecha', hasta),
      supabase.from('caja_movimientos').select('tipo, monto, creado_en').gte('creado_en', desde).lte('creado_en', hasta),
      supabase
        .from('ordenes_compra')
        .select('id, fecha_recibido, ordenes_compra_items(cantidad, precio_costo_unitario)')
        .eq('estado', 'recibido')
        .gte('fecha_recibido', desde)
        .lte('fecha_recibido', hasta),
      supabase.from('facturas').select('total').eq('estado', 'emitida').gte('fecha_emision', fechaInicio).lte('fecha_emision', fechaFin),
    ]);

  const error = errPagos || errMov || errOrdenes || errFacturas;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error calculando el consolidado: ${error.message}</p>`;
    return;
  }

  const ingresosPagos = (pagos || []).reduce((acc, p) => acc + Number(p.monto), 0);
  const ingresosCaja = (movimientos || []).filter((m) => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
  const egresosCaja = (movimientos || []).filter((m) => m.tipo === 'egreso').reduce((acc, m) => acc + Number(m.monto), 0);
  const egresosCompras = (ordenes || []).reduce((acc, o) => {
    const totalOrden = (o.ordenes_compra_items || []).reduce((s, it) => s + it.cantidad * it.precio_costo_unitario, 0);
    return acc + totalOrden;
  }, 0);
  const totalFacturado = (facturas || []).reduce((acc, f) => acc + Number(f.total), 0);

  const ingresosTotales = ingresosPagos + ingresosCaja;
  const egresosTotales = egresosCaja + egresosCompras;
  const neto = ingresosTotales - egresosTotales;

  elemento.innerHTML = `
    <div class="grid-dos-columnas" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); margin-bottom:1.5rem;">
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Ingresos del rango</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0; color:var(--color-verde-oscuro);">${formatCOP(ingresosTotales)}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Egresos del rango</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0; color:var(--color-rojo-oscuro);">${formatCOP(egresosTotales)}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Neto</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0; color:${neto >= 0 ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)'};">${formatCOP(neto)}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Total facturado</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0;">${formatCOP(totalFacturado)}</p>
      </div>
    </div>

    <div class="tarjeta">
      <h3>Detalle</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Concepto</th><th>Valor</th></tr></thead>
          <tbody>
            <tr><td>Ingresos por reservas (habitación + minibar liquidado)</td><td>${formatCOP(ingresosPagos)}</td></tr>
            <tr><td>Ingresos varios registrados en Caja</td><td>${formatCOP(ingresosCaja)}</td></tr>
            <tr><td><strong>Total ingresos</strong></td><td><strong>${formatCOP(ingresosTotales)}</strong></td></tr>
            <tr><td>Egresos registrados en Caja</td><td>${formatCOP(egresosCaja)}</td></tr>
            <tr><td>Compras recibidas (costo)</td><td>${formatCOP(egresosCompras)}</td></tr>
            <tr><td><strong>Total egresos</strong></td><td><strong>${formatCOP(egresosTotales)}</strong></td></tr>
            <tr><td><strong>Neto</strong></td><td><strong>${formatCOP(neto)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:1rem;">
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">Todavía no hay un módulo dedicado de "Gastos" — cuando exista, sus egresos se sumarán aquí igual que Compras.</p>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const filas = [
      ['Concepto', 'Valor'],
      ['Rango', `${fechaInicio} a ${fechaFin}`],
      ['Ingresos por reservas', ingresosPagos],
      ['Ingresos varios en Caja', ingresosCaja],
      ['Total ingresos', ingresosTotales],
      ['Egresos en Caja', egresosCaja],
      ['Compras recibidas', egresosCompras],
      ['Total egresos', egresosTotales],
      ['Neto', neto],
      ['Total facturado', totalFacturado],
    ];
    const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `contabilidad_${fechaInicio}_a_${fechaFin}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  });
}

registerModule({
  id: 'contabilidad',
  label: 'Contabilidad',
  icono: '📊',
  roles: ['propietario', 'administrador', 'contador'],
  parentId: 'grupo-finanzas',
  render,
});
