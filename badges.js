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

const ESTADOS_RESERVA = {
  reservada: { label: 'Reservada', clase: 'badge-reservada' },
  confirmada: { label: 'Confirmada', clase: 'badge-confirmada' },
  check_in: { label: 'Check In', clase: 'badge-check-in' },
  hospedado: { label: 'Hospedado', clase: 'badge-hospedado' },
  check_out: { label: 'Check Out', clase: 'badge-check-out' },
  cancelada: { label: 'Cancelada', clase: 'badge-cancelada' },
  no_show: { label: 'No Show', clase: 'badge-no-show' },
};

export function badgeEstadoReserva(estado) {
  const info = ESTADOS_RESERVA[estado] || { label: estado, clase: 'badge-inactivo' };
  return `<span class="badge ${info.clase}">${info.label}</span>`;
}

export function opcionesEstadoReserva() {
  return Object.entries(ESTADOS_RESERVA).map(([valor, info]) => ({ valor, label: info.label }));
}
