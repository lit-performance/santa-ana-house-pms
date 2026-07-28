// badges.js
//
// Traduce el estado interno (snake_case en BD) a la etiqueta visible en
// español y a la clase CSS del badge correspondiente. Ningún módulo debe
// reimplementar este mapeo — todos importan de aquí.

const ESTADOS_HABITACION = {
  disponible: { label: 'Disponible', clase: 'badge-disponible' },
  ocupada: { label: 'Ocupada', clase: 'badge-ocupada' },
  limpieza: { label: 'En limpieza', clase: 'badge-limpieza' },
  inspeccion: { label: 'Inspección', clase: 'badge-inspeccion' },
  mantenimiento: { label: 'Mantenimiento', clase: 'badge-mantenimiento' },
  bloqueada: { label: 'Bloqueada', clase: 'badge-bloqueada' },
  fuera_servicio: { label: 'Fuera de servicio', clase: 'badge-fuera-servicio' },
};

export function badgeEstadoHabitacion(estado) {
  const info = ESTADOS_HABITACION[estado] || { label: estado, clase: 'badge-inactivo' };
  return `<span class="badge ${info.clase}">${info.label}</span>`;
}

export function opcionesEstadoHabitacion() {
  return Object.entries(ESTADOS_HABITACION).map(([valor, info]) => ({ valor, label: info.label }));
}
