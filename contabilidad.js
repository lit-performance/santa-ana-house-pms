// contabilidad.js
//
// Módulo: Contabilidad. Consolidado de ingresos y egresos del hotel para
// el contador, por rango de fechas.
//
// Ingresos = pagos de reservas (reservas_pagos, habitación + minibar
// liquidados) + ventas por mostrador (ventas_mostrador — clientes que no
// se hospedan, ver caja.js) + movimientos manuales de ingreso en Caja
// (ventas varias, etc.). No se duplica nada: reservas_pagos,
// ventas_mostrador y caja_movimientos son mutuamente excluyentes por
// diseño (ver caja.js).
//
// Egresos = TODO movimiento tipo='egreso' en caja_movimientos, separado
// en dos líneas para el detalle: "Compras" (categoria='Compras', las
// registra inventario.js en cada compra real a bodega — compras.js está
// desactivado y no se usa) y "Otros egresos" (gastos.js y cualquier otro
// egreso manual). Ambas líneas sacan la MISMA plata de la MISMA consulta
// — es un desglose para lectura, no dos fuentes que se suman aparte, así
// que no hay riesgo de duplicar el total.
//
// El rango de fechas se lee directo de las tablas fuente (no de
// caja_turnos) para no perder dinero que entró con la caja cerrada, mismo
// criterio que ya usa indicadores.js.
//
// Nota (196 / auditoría H10 y H11): antes este módulo leía el costo de
// compras desde `ordenes_compra`/`ordenes_compra_items` — una tabla que
// ya no usa nadie (inventario.js, el flujo real de compras, nunca
// escribe ahí; solo lo hacía compras.js, hoy desactivado — ver H2). Esa
// consulta casi siempre traía $0, y el comentario decía "todavía no
// existe un módulo de Gastos" cuando gastos.js ya lleva tiempo en
// producción. En la práctica el total SIEMPRE fue correcto (porque
// "Egresos registrados en Caja" ya sumaba TODOS los egresos, compras
// incluidas, al no filtrar por categoría) — el problema era que el
// desglose visible mentía: mostraba "Compras recibidas (costo): $0"
// aunque sí hubiera compras reales ese rango, folded silenciosamente
// dentro de "Egresos en Caja". Ahora "Compras" y "Otros egresos" se
// calculan de la misma consulta a caja_movimientos, separando por
// categoría — mismo total de siempre, desglose real.

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

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }, { data: ventasMostrador, error: errVentas }, { data: facturas, error: errFacturas }] =
    await Promise.all([
      supabase.from('reservas_pagos').select('monto, fecha').gte('fecha', desde).lte('fecha', hasta),
      supabase.from('caja_movimientos').select('tipo, categoria, monto, creado_en').gte('creado_en', desde).lte('creado_en', hasta),
      supabase.from('ventas_mostrador').select('monto, creado_en').gte('creado_en', desde).lte('creado_en', hasta),
      supabase.from('facturas').select('total').eq('estado', 'emitida').gte('fecha_emision', fechaInicio).lte('fecha_emision', fechaFin),
    ]);

  const error = errPagos || errMov || errVentas || errFacturas;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error calculando el consolidado: ${error.message}</p>`;
    return;
  }

  const ingresosPagos = (pagos || []).reduce((acc, p) => acc + Number(p.monto), 0);
  const ingresosMostrador = (ventasMostrador || []).reduce((acc, v) => acc + Number(v.monto), 0);
  const ingresosCaja = (movimientos || []).filter((m) => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
  const egresos = (movimientos || []).filter((m) => m.tipo === 'egreso');
  const egresosCompras = egresos.filter((m) => m.categoria === 'Compras').reduce((acc, m) => acc + Number(m.monto), 0);
  const egresosOtros = egresos.filter((m) => m.categoria !== 'Compras').reduce((acc, m) => acc + Number(m.monto), 0);
  const totalFacturado = (facturas || []).reduce((acc, f) => acc + Number(f.total), 0);

  const ingresosTotales = ingresosPagos + ingresosMostrador + ingresosCaja;
  const egresosTotales = egresosOtros + egresosCompras;
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
            <tr><td>Ventas por mostrador</td><td>${formatCOP(ingresosMostrador)}</td></tr>
            <tr><td>Ingresos varios registrados en Caja</td><td>${formatCOP(ingresosCaja)}</td></tr>
            <tr><td><strong>Total ingresos</strong></td><td><strong>${formatCOP(ingresosTotales)}</strong></td></tr>
            <tr><td>Compras a bodega (costo)</td><td>${formatCOP(egresosCompras)}</td></tr>
            <tr><td>Otros egresos en Caja (gastos, etc.)</td><td>${formatCOP(egresosOtros)}</td></tr>
            <tr><td><strong>Total egresos</strong></td><td><strong>${formatCOP(egresosTotales)}</strong></td></tr>
            <tr><td><strong>Neto</strong></td><td><strong>${formatCOP(neto)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:1rem;">
        <button type="button" id="btn-exportar-csv" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-csv').addEventListener('click', () => {
    const filas = [
      ['Concepto', 'Valor'],
      ['Rango', `${fechaInicio} a ${fechaFin}`],
      ['Ingresos por reservas', ingresosPagos],
      ['Ventas por mostrador', ingresosMostrador],
      ['Ingresos varios en Caja', ingresosCaja],
      ['Total ingresos', ingresosTotales],
      ['Compras a bodega (costo)', egresosCompras],
      ['Otros egresos en Caja', egresosOtros],
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
  parentId: 'grupo-analisis',
  render,
});
