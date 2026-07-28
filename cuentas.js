// cuentas.js
//
// Helper compartido entre Recepción, Caja y Minibar: calcula el saldo
// pendiente de cada habitación actualmente ocupada (check-in activo, sin
// check-out aún), cruzando recepcion_checkins -> reservas (monto_total de
// la habitación) + minibar_consumos (extras de minibar) -> reservas_pagos
// (abonos ya registrados, incluyendo los de liquidación al check-out).
// Ningún módulo debe reimplementar esta cuenta — todos importan de aquí
// para que "cuánto debe" se calcule siempre igual en toda la app.

import { supabase } from './supabase-client.js';

/**
 * @returns {Promise<Array<{
 *   checkinId: number,
 *   habitacionId: number,
 *   habitacionLabel: string,
 *   huespedNombre: string,
 *   tipoDocumento: string|null,
 *   numeroDocumento: string|null,
 *   cantidadNoches: number|null,
 *   reservaId: number|null,
 *   montoHabitacion: number,
 *   montoMinibar: number,
 *   montoTotal: number,
 *   totalAbonado: number,
 *   saldoPendiente: number,
 *   horaIngreso: string,
 * }>>}
 */
export async function calcularHabitacionesEnUso() {
  const { data: checkins, error: errCheckins } = await supabase
    .from('recepcion_checkins')
    .select('id, habitacion_id, reserva_id, nombre, tipo_documento, numero_documento, cantidad_noches, hora_ingreso, habitaciones(numero, nombre)')
    .is('check_out_en', null)
    .order('hora_ingreso', { ascending: false });

  if (errCheckins) throw errCheckins;
  if (!checkins || checkins.length === 0) return [];

  const reservaIds = checkins.map((c) => c.reserva_id).filter((id) => id !== null);

  const [
    { data: reservas, error: errReservas },
    { data: pagos, error: errPagos },
    { data: minibar, error: errMinibar },
  ] = await Promise.all([
    reservaIds.length
      ? supabase.from('reservas').select('id, monto_total').in('id', reservaIds)
      : Promise.resolve({ data: [], error: null }),
    reservaIds.length
      ? supabase.from('reservas_pagos').select('reserva_id, monto').in('reserva_id', reservaIds)
      : Promise.resolve({ data: [], error: null }),
    reservaIds.length
      ? supabase.from('minibar_consumos').select('reserva_id, monto').in('reserva_id', reservaIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (errReservas) throw errReservas;
  if (errPagos) throw errPagos;
  if (errMinibar) throw errMinibar;

  const montoHabitacionPorReserva = new Map((reservas || []).map((r) => [r.id, Number(r.monto_total) || 0]));

  const abonadoPorReserva = new Map();
  (pagos || []).forEach((p) => {
    abonadoPorReserva.set(p.reserva_id, (abonadoPorReserva.get(p.reserva_id) || 0) + Number(p.monto));
  });

  const minibarPorReserva = new Map();
  (minibar || []).forEach((m) => {
    minibarPorReserva.set(m.reserva_id, (minibarPorReserva.get(m.reserva_id) || 0) + Number(m.monto));
  });

  return checkins.map((c) => {
    const montoHabitacion = c.reserva_id ? montoHabitacionPorReserva.get(c.reserva_id) || 0 : 0;
    const montoMinibar = c.reserva_id ? minibarPorReserva.get(c.reserva_id) || 0 : 0;
    const montoTotal = montoHabitacion + montoMinibar;
    const totalAbonado = c.reserva_id ? abonadoPorReserva.get(c.reserva_id) || 0 : 0;
    return {
      checkinId: c.id,
      habitacionId: c.habitacion_id,
      habitacionLabel: c.habitaciones ? `${c.habitaciones.numero} — ${c.habitaciones.nombre}` : '—',
      huespedNombre: c.nombre,
      tipoDocumento: c.tipo_documento,
      numeroDocumento: c.numero_documento,
      cantidadNoches: c.cantidad_noches,
      reservaId: c.reserva_id,
      montoHabitacion,
      montoMinibar,
      montoTotal,
      totalAbonado,
      saldoPendiente: montoTotal - totalAbonado,
      horaIngreso: c.hora_ingreso,
    };
  });
}
