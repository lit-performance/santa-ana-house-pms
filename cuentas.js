// cuentas.js
//
// Helper compartido entre Recepción, Caja y Minibar: calcula el saldo
// pendiente de cada habitación actualmente ocupada (check-in activo, sin
// check-out aún), cruzando recepcion_checkins -> reservas (monto_total de
// la habitación) + minibar_consumos (extras de minibar) -> reservas_pagos
// (abonos ya registrados, incluyendo los de liquidación al check-out).
// Ningún módulo debe reimplementar esta cuenta — todos importan de aquí
// para que "cuánto debe" se calcule siempre igual en toda la app.
//
// También vive aquí `obtenerResumenLiquidacion`, que arma el detalle
// completo de UN check-in (huésped, habitación, tipo, noches, minibar
// itemizado e historial completo de pagos) para la tarjeta-resumen que se
// abre al hacer check-out (ver resumen-checkout.js) — se usa tanto justo
// después del check-out como para volver a verla luego desde el listado
// de Checkouts en Indicadores. Misma razón: una sola fuente de verdad.
//
// Nota (164): `saldoPendiente` SIEMPRE se entrega acotado a un mínimo de
// 0 con Math.max(0, ...) en las tres funciones de este archivo. Antes se
// entregaba el resultado crudo de montoTotal - totalAbonado, que se podía
// ir a negativo apenas una habitación quedaba sobrepagada (por ejemplo,
// al corregir a mano un cobro de más) — y como ningún módulo que consume
// este helper (Recepción, Caja, Indicadores, resumen-checkout.js) espera
// un signo negativo, ese saldo aparecía tal cual en pantalla como "-$ ..."
// en vez de "$0", que es lo que de verdad significa "ya no debe nada".
//
// Nota (165): el campo nuevo `excedente` es justamente ese "cuánto se
// sobrepagó" del que hablaba la nota anterior — Math.max(0, totalAbonado
// - montoTotal), el espejo de saldoPendiente. Vale más que 0 solo cuando
// a la habitación le cobraron/abonaron de más (el caso típico: se
// registró un pago repetido, o se corrigió a mano un error de cobro
// agregando plata de más en vez de anular el pago original). No modifica
// saldoPendiente ni ninguna otra cuenta existente — es un dato aparte
// para que quien revise pueda VER que hay un sobrepago (y por cuánto),
// en vez de que quede escondido detrás de un simple "$0".

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
 *   excedente: number,
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
      saldoPendiente: Math.max(0, montoTotal - totalAbonado),
      excedente: Math.max(0, totalAbonado - montoTotal),
      horaIngreso: c.hora_ingreso,
    };
  });
}

/**
 * Lista los check-outs completados dentro de un rango de fechas
 * (`check_out_en` entre `fechaInicioISO` y `finExclusivoISO`, exclusivo),
 * con su monto total (habitación + minibar), lo pagado y el saldo que
 * haya quedado — para el listado de Checkouts en Indicadores. Misma
 * lógica de cálculo que `calcularHabitacionesEnUso`, solo que mirando
 * hacia check-ins YA cerrados en vez de los que siguen activos.
 */
export async function calcularCheckoutsEnRango(fechaInicioISO, finExclusivoISO) {
  const { data: checkins, error: errCheckins } = await supabase
    .from('recepcion_checkins')
    .select('id, habitacion_id, reserva_id, nombre, cantidad_noches, check_out_en, habitaciones(numero, nombre)')
    .not('check_out_en', 'is', null)
    .gte('check_out_en', fechaInicioISO)
    .lt('check_out_en', finExclusivoISO)
    .order('check_out_en', { ascending: false });

  if (errCheckins) throw errCheckins;
  if (!checkins || checkins.length === 0) return [];

  const reservaIds = checkins.map((c) => c.reserva_id).filter((id) => id !== null);

  const [
    { data: reservas, error: errReservas },
    { data: pagos, error: errPagos },
    { data: minibar, error: errMinibar },
  ] = await Promise.all([
    reservaIds.length ? supabase.from('reservas').select('id, monto_total').in('id', reservaIds) : Promise.resolve({ data: [], error: null }),
    reservaIds.length ? supabase.from('reservas_pagos').select('reserva_id, monto').in('reserva_id', reservaIds) : Promise.resolve({ data: [], error: null }),
    reservaIds.length ? supabase.from('minibar_consumos').select('reserva_id, monto').in('reserva_id', reservaIds) : Promise.resolve({ data: [], error: null }),
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
      habitacionLabel: c.habitaciones ? `${c.habitaciones.numero} — ${c.habitaciones.nombre}` : '—',
      huespedNombre: c.nombre,
      cantidadNoches: c.cantidad_noches,
      checkOutEn: c.check_out_en,
      montoTotal,
      totalAbonado,
      saldoPendiente: Math.max(0, montoTotal - totalAbonado),
      excedente: Math.max(0, totalAbonado - montoTotal),
    };
  });
}

/**
 * Arma el detalle completo de UN check-in para la tarjeta-resumen de
 * liquidación/checkout: datos del huésped, habitación + tipo, noches,
 * minibar itemizado y el historial COMPLETO de pagos de la reserva
 * (anticipo, abonos parciales y el pago final del check-out), cada uno
 * con su fecha/hora y método. Sirve tanto recién hecho el check-out como
 * para volver a consultarlo después desde Indicadores.
 *
 * @param {number} checkinId
 */
export async function obtenerResumenLiquidacion(checkinId) {
  const { data: checkin, error: errCheckin } = await supabase
    .from('recepcion_checkins')
    .select('*, habitaciones(numero, nombre, tipo_id)')
    .eq('id', checkinId)
    .single();
  if (errCheckin) throw errCheckin;

  const reservaId = checkin.reserva_id;
  const tipoId = checkin.habitaciones ? checkin.habitaciones.tipo_id : null;

  const [
    { data: tipoHabitacion },
    { data: tarifa },
    { data: reserva },
    { data: pagos, error: errPagos },
    { data: minibar, error: errMinibar },
  ] = await Promise.all([
    tipoId ? supabase.from('tipos_habitacion').select('nombre').eq('id', tipoId).maybeSingle() : Promise.resolve({ data: null }),
    checkin.tarifa_id
      ? supabase.from('tarifas').select('codigo, precio_temporada_baja').eq('id', checkin.tarifa_id).maybeSingle()
      : Promise.resolve({ data: null }),
    reservaId
      ? supabase.from('reservas').select('monto_total, fecha_checkin, fecha_checkout, estado').eq('id', reservaId).maybeSingle()
      : Promise.resolve({ data: null }),
    reservaId
      ? supabase.from('reservas_pagos').select('*').eq('reserva_id', reservaId).order('fecha', { ascending: true })
      : Promise.resolve({ data: [] }),
    reservaId
      ? supabase
          .from('minibar_consumos')
          .select('*, minibar_productos(nombre, categoria)')
          .eq('reserva_id', reservaId)
          .order('creado_en', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  if (errPagos) throw errPagos;
  if (errMinibar) throw errMinibar;

  const montoHabitacion = reserva ? Number(reserva.monto_total) || 0 : 0;
  const montoMinibar = (minibar || []).reduce((sum, m) => sum + Number(m.monto), 0);
  const montoTotal = montoHabitacion + montoMinibar;
  const totalAbonado = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);

  return {
    checkinId: checkin.id,
    reservaId,
    huespedNombre: checkin.nombre,
    tipoDocumento: checkin.tipo_documento,
    numeroDocumento: checkin.numero_documento,
    celular: checkin.celular,
    habitacionNumero: checkin.habitaciones ? checkin.habitaciones.numero : null,
    habitacionNombre: checkin.habitaciones ? checkin.habitaciones.nombre : null,
    tipoHabitacionNombre: tipoHabitacion ? tipoHabitacion.nombre : null,
    tarifaCodigo: tarifa ? tarifa.codigo : null,
    cantidadNoches: checkin.cantidad_noches,
    fechaCheckinReserva: reserva ? reserva.fecha_checkin : null,
    fechaCheckoutReserva: reserva ? reserva.fecha_checkout : null,
    horaIngreso: checkin.hora_ingreso,
    horaSalida: checkin.check_out_en,
    montoHabitacion,
    montoMinibar,
    montoTotal,
    totalAbonado,
    saldoPendiente: Math.max(0, montoTotal - totalAbonado),
    excedente: Math.max(0, totalAbonado - montoTotal),
    minibarItems: (minibar || []).map((m) => ({
      nombre: m.minibar_productos ? m.minibar_productos.nombre : '—',
      categoria: m.minibar_productos ? m.minibar_productos.categoria : null,
      cantidad: m.cantidad,
      monto: Number(m.monto),
      fecha: m.creado_en,
    })),
    pagos: (pagos || []).map((p) => ({
      monto: Number(p.monto),
      metodoPago: p.metodo_pago,
      fecha: p.fecha,
      comentarios: p.comentarios || null,
    })),
    observacionesCheckin: checkin.observaciones || null,
    observacionesCheckout: checkin.observaciones_checkout || null,
  };
}
