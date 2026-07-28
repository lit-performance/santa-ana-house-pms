// dashboard.js
//
// Módulo 1: Inicio. A diferencia de los demás módulos, este SÍ tiene
// permiso de leer datos de otras tablas (habitaciones, reservas, y en el
// futuro caja, minibar, huéspedes, documentos) — es su función, igual que
// Contabilidad en el CRM de Servicentro B&B. Cada vez que se construya un
// módulo nuevo (Caja, Minibar...), este archivo se actualiza para
// reemplazar los placeholders "—" por datos reales.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { badgeEstadoHabitacion } from './badges.js';
import { toISODate, addDays, formatFechaCorta } from './dates.js';

async function render(container) {
  container.innerHTML = `
    <h2>Inicio</h2>

    <div id="kpis-habitaciones" class="grid-tres-columnas" style="grid-template-columns: repeat(4, 1fr);">
      <p class="mensaje-vacio">Cargando…</p>
    </div>

    <div class="grid-dos-columnas" style="margin-top:1.5rem;">
      <div class="tarjeta">
        <h3>Caja del día</h3>
        <p class="mensaje-vacio">— Se activa cuando esté listo el módulo Caja.</p>
      </div>
      <div class="tarjeta">
        <h3>Próximos check-in / check-out</h3>
        <div id="proximos-wrap"><p class="mensaje-vacio">Cargando…</p></div>
      </div>
    </div>

    <div class="tarjeta" style="margin-top:1.5rem;">
      <h3>Alertas</h3>
      <div id="alertas-wrap"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;

  await cargarKpis(container);
  await cargarProximos(container);
  await cargarAlertas(container);
}

async function cargarKpis(container) {
  const wrap = container.querySelector('#kpis-habitaciones');
  const { data: habitaciones, error } = await supabase.from('habitaciones').select('estado');

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones: ${error.message}</p>`;
    return;
  }

  const contar = (estado) => (habitaciones || []).filter((h) => h.estado === estado).length;

  const kpis = [
    { label: 'Ocupadas', valor: contar('ocupada'), color: 'rojo' },
    { label: 'Libres', valor: contar('disponible'), color: 'verde' },
    { label: 'En limpieza', valor: contar('limpieza'), color: 'naranja' },
    { label: 'Fuera de servicio', valor: contar('fuera_servicio') + contar('mantenimiento') + contar('bloqueada'), color: 'azul' },
  ];

  wrap.innerHTML = kpis
    .map(
      (k) => `
    <div class="stat-card stat-card-${k.color}">
      <div class="stat-card-label">${k.label}</div>
      <div class="stat-card-valor">${k.valor}</div>
    </div>
  `
    )
    .join('');
}

async function cargarProximos(container) {
  const wrap = container.querySelector('#proximos-wrap');
  const hoyISO = toISODate(new Date());
  const limiteISO = toISODate(addDays(new Date(), 7));

  const [{ data: entrantes, error: errEntrantes }, { data: salientes, error: errSalientes }] = await Promise.all([
    supabase
      .from('reservas')
      .select('id, huesped_nombre, fecha_checkin, habitaciones(numero)')
      .in('estado', ['reservada', 'confirmada'])
      .gte('fecha_checkin', hoyISO)
      .lte('fecha_checkin', limiteISO)
      .order('fecha_checkin')
      .limit(5),
    supabase
      .from('reservas')
      .select('id, huesped_nombre, fecha_checkout, habitaciones(numero)')
      .eq('estado', 'hospedado')
      .lte('fecha_checkout', limiteISO)
      .order('fecha_checkout')
      .limit(5),
  ]);

  if (errEntrantes || errSalientes) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando próximos: ${(errEntrantes || errSalientes).message}</p>`;
    return;
  }

  const listaEntrantes =
    entrantes && entrantes.length > 0
      ? `<ul style="margin:0.4rem 0 0; padding-left:1.1rem; font-size:0.9rem;">${entrantes
          .map((r) => `<li>${formatFechaCorta(r.fecha_checkin)} — ${escaparHTML(r.huesped_nombre)}${r.habitaciones ? ` (Hab. ${r.habitaciones.numero})` : ''}</li>`)
          .join('')}</ul>`
      : '<p class="mensaje-vacio">Sin check-in próximos.</p>';

  const listaSalientes =
    salientes && salientes.length > 0
      ? `<ul style="margin:0.4rem 0 0; padding-left:1.1rem; font-size:0.9rem;">${salientes
          .map((r) => `<li>${formatFechaCorta(r.fecha_checkout)} — ${escaparHTML(r.huesped_nombre)}${r.habitaciones ? ` (Hab. ${r.habitaciones.numero})` : ''}</li>`)
          .join('')}</ul>`
      : '<p class="mensaje-vacio">Sin check-out próximos.</p>';

  wrap.innerHTML = `
    <p><strong>Check-in (próximos 7 días):</strong></p>
    ${listaEntrantes}
    <p style="margin-top:0.75rem;"><strong>Check-out (próximos 7 días):</strong></p>
    ${listaSalientes}
  `;
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function cargarAlertas(container) {
  const wrap = container.querySelector('#alertas-wrap');
  const { data: habitaciones, error } = await supabase
    .from('habitaciones')
    .select('numero, nombre, estado')
    .eq('estado', 'limpieza')
    .order('numero');

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
    return;
  }

  const partes = [];

  if (habitaciones && habitaciones.length > 0) {
    partes.push(`
      <p><strong>Habitaciones pendientes de limpieza (${habitaciones.length}):</strong></p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Número</th><th>Nombre</th><th>Estado</th></tr></thead>
          <tbody>
            ${habitaciones
              .map((h) => `<tr><td>${h.numero}</td><td>${h.nombre}</td><td>${badgeEstadoHabitacion(h.estado)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
    `);
  } else {
    partes.push('<p class="mensaje-vacio">No hay habitaciones pendientes de limpieza.</p>');
  }

  partes.push(`
    <p class="mensaje-vacio" style="margin-top:1rem;">
      Minibar por agotarse, facturas pendientes, huéspedes frecuentes y documentos próximos a vencer
      se activan cuando estén listos los módulos correspondientes (Minibar, Facturación, Huéspedes, Documentos).
    </p>
  `);

  wrap.innerHTML = partes.join('');
}

registerModule({
  id: 'dashboard',
  label: 'Inicio',
  icono: '🏠',
  roles: ['propietario', 'administrador'],
  render,
});
