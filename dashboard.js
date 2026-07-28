// dashboard.js
//
// Módulo 1: Inicio. A diferencia de los demás módulos, este SÍ tiene
// permiso de leer datos de otras tablas (habitaciones, y en el futuro
// reservas, caja, minibar, huéspedes, documentos) — es su función, igual
// que Contabilidad en el CRM de Servicentro B&B. Cada vez que se construya
// un módulo nuevo (Reservas, Caja, Minibar...), este archivo se actualiza
// para reemplazar los placeholders "—" por datos reales.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { badgeEstadoHabitacion } from './badges.js';

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
        <p class="mensaje-vacio">— Se activa cuando esté listo el módulo Reservas.</p>
      </div>
    </div>

    <div class="tarjeta" style="margin-top:1.5rem;">
      <h3>Alertas</h3>
      <div id="alertas-wrap"><p class="mensaje-vacio">Cargando…</p></div>
    </div>
  `;

  await cargarKpis(container);
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
