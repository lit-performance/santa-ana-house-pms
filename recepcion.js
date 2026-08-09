// recepcion.js
//
// Módulo 4: Recepción. Pantalla de manejo diario de la recepcionista — y
// también la pantalla de "inicio" del sistema (se fusionó aquí el antiguo
// módulo Dashboard/Inicio, que quedó redundante como pestaña aparte).
// Al entrar se ve de un vistazo: cuántas llegadas y salidas hay hoy,
// cuántas habitaciones están ocupadas, cuánto saldo pendiente hay en total,
// y un resumen rápido del estado del resto de habitaciones (libres, en
// limpieza, fuera de servicio). Debajo, una tarjeta de "Llegadas de hoy"
// (reservas sin check-in todavía, con botón para iniciar el check-in ya
// precargado) y la tabla de habitaciones en uso con badge "Sale hoy" y
// saldo pendiente resaltado, ordenada para que lo más urgente (sale hoy +
// debe plata) aparezca primero.
//
// "+ Nuevo Check-in" abre un formulario completo (reemplaza el contenido del
// contenedor, no un modal — son demasiados campos para un modal chico) con
// todos los datos que pide el Módulo 4, acompañantes con datos completos,
// pago al check-in (que alimenta Caja automático), firma digital (canvas)
// y consentimiento Habeas Data.
//
// Nota sobre "Ver disponibilidad" en la tarjeta Estadía: abre una mini
// versión del calendario de Reservas (próximos 10 días x habitaciones) para
// decidir dónde alojar sin salir del check-in. Solo la columna de HOY es
// clicable para elegir habitación (el check-in es para hoy); las demás
// columnas son solo para ver si la habitación se queda libre durante toda
// la estadía. Usa las mismas reglas de bloqueo que el calendario de
// Reservas (ver reservas.js) para que ambas pantallas digan lo mismo.
//
// Nota de alcance: "Fotografía del documento" queda como un campo de URL
// (para pegar un link si ya la subieron a otro lado) — la carga de
// archivos requiere configurar Supabase Storage, pendiente para una
// ronda futura.
//
// Nota importante: TODO check-in (venga de una reserva o sea walk-in)
// queda vinculado a una fila en `reservas` con estado 'hospedado', y
// además guarda/actualiza la ficha del huésped en `huespedes` (por
// numero_documento). Esto es lo que hace que el calendario de Reservas
// y el módulo Huéspedes reflejen la ocupación e historial real sin
// importar por dónde entró el huésped.
//
// Nota sobre acompañantes: si el huésped trae acompañante(s), se piden
// TODOS sus datos (no solo el nombre) — nombre, tipo y número de
// documento, nacionalidad, fecha de nacimiento y celular — igual de
// completos que los del huésped principal. Se guardan en la columna
// jsonb `acompanantes_detalle` de recepcion_checkins (uno o varios
// bloques, se pueden agregar más con "+ Agregar otro acompañante"). Si el
// acompañante trae número de documento, también queda (o se actualiza) en
// el listado general de huespedes, igual que el huésped principal — sin
// documento no hay con qué identificarlo ahí, así que en ese caso solo
// queda guardado dentro del check-in.
//
// Nota sobre acompañante menor de edad: si la fecha de nacimiento indica
// que el acompañante es menor de 18 años, aparece una alerta recordando
// pedir el registro civil de nacimiento (para verificar que el adulto es
// su padre/madre) o la autorización notarial correspondiente si viaja con
// otra persona, más una casilla para que la recepcionista confirme que
// verificó el documento. Esto es un recordatorio operativo — no bloquea
// el check-in, queda guardado dentro del acompañante (verificado_menor)
// como bitácora.
//
// Nota sobre métodos de pago: la lista completa vive en METODOS_PAGO —
// Efectivo, Nequi, Daviplata, QR, Transferencia Bancaria, Datáfono,
// Llave. Caja consolida cada uno como si fuera una cuenta aparte (ver
// caja.js), así que agregar/quitar un método aquí también cambia lo que
// se ve ahí.
//
// Nota sobre campos obligatorios en Estadía: habitación, tarifa, cantidad
// de noches, método de pago y "Pago al check-in" son obligatorios — y si
// el pago es parcial o anticipado, el monto a cobrar también. Esto es a
// propósito: evita check-ins a medio llenar que después generan dudas en
// Caja o en Reservas sobre cuánto se cobró o a qué tarifa.
//
// Nota sobre el pago al check-in: "Pago al check-in" (pendiente / parcial
// / anticipado) NO se guarda en una columna suelta — si hay monto, se
// inserta directo en `reservas_pagos` (la misma tabla de abonos que ya
// usan Reservas y la liquidación del check-out), así el pago aparece
// automático en Caja ("Ingresos por reservas"), Indicadores y
// Contabilidad sin ningún paso manual extra. El campo "Monto total
// estimado" (noches × tarifa) es solo una ayuda visual para la
// recepcionista, no se guarda.
//
// Nota sobre liquidación al check-out: el botón "Check-out" ya NO libera
// la habitación directo — abre un modal que muestra el saldo pendiente
// (monto de la habitación + consumo de minibar − abonos ya registrados en
// reservas_pagos, calculado con el helper compartido cuentas.js) y permite
// registrar el pago final antes de liberar la habitación. Si queda saldo
// pendiente después del pago, se pide confirmación explícita antes de
// continuar — el checkout no se bloquea, pero no se puede hacer "sin
// darse cuenta" de que quedó plata por cobrar. Ese pago final se registra
// en reservas_pagos igual que un abono normal, así que aparece automático
// en Caja e Indicadores.
//
// Nota sobre "✏️ Editar" en la tabla de habitaciones en uso: abre un
// modal para corregir un check-in ya registrado (typo en el nombre,
// documento mal digitado, cambio de tarifa, cambio de habitación, etc).
// Lo que SÍ se puede editar: todos los datos del huésped, acompañantes,
// tarifa, cantidad de noches, método de pago y depósito. Lo que NO se
// edita desde aquí: la firma digital y el consentimiento de Habeas Data
// (quedan tal como se capturaron en el momento del check-in — no tiene
// sentido "re-firmar" retroactivamente), y los pagos ya registrados en
// Caja (esos se corrigen desde Caja o desde el propio módulo Reservas,
// nunca reescribiendo el check-in). Si se cambia la habitación, el
// cambio se sincroniza con la reserva vinculada y con el estado de AMBAS
// habitaciones (la anterior pasa a limpieza, la nueva a ocupada) para que
// Reservas y Housekeeping no queden desincronizados.
//
// Nota sobre "Pago que recibes ahora" y el minibar: cada vez que se
// agrega o quita un consumo dentro del modal de liquidación, el campo
// "Pago que recibes ahora" se vuelve a calcular y se fuerza su valor al
// nuevo saldo pendiente (a menos que la recepcionista ya lo haya editado a
// mano, en cuyo caso se respeta lo que escribió) — así nunca queda un
// consumo de minibar agregado sin que el monto a cobrar lo refleje.
//
// Nota sobre comentarios del check-out: el modal de liquidación tiene su
// propio campo de comentarios (aparte de las "Observaciones" del
// check-in), para anotar algo puntual del momento de la salida (ej. "dejó
// olvidada una chaqueta", "pidió factura por correo"). Se guarda siempre
// en recepcion_checkins.observaciones_checkout (ver sql/021), tenga o no
// un pago asociado, y si hubo pago también queda anexado al comentario de
// ese abono en reservas_pagos para que aparezca en el detalle de Caja.
//
// Nota sobre minibar en la liquidación del check-out: el modal de
// "Check-out" ya no muestra el consumo de minibar como una sola línea de
// total — lista cada producto consumido (con cantidad y monto) y permite
// agregar (o quitar) un consumo de último momento sin salir del modal, por
// si algo no se había registrado todavía. Cada cambio ahí recalcula el
// monto total y el saldo pendiente en vivo, y también actualiza el
// inventario de la habitación (misma función que usa minibar.js), así que
// nunca queda desincronizado. Ver también el badge "🥤" en la tabla de
// habitaciones en uso, que avisa cuándo una habitación ya tiene consumo de
// minibar antes de siquiera abrir el checkout.
//
// Nota sobre el resumen visual de la liquidación (tarjeta Estadía): se
// arma en vivo con lo que la recepcionista va llenando (habitación,
// tarifa, noches, tipo de pago, monto a cobrar, saldo) usando cajones de
// color para que sea imposible perderse — azul para el estimado total,
// verde para lo que se cobra ahora, rojo (o verde si queda en cero) para
// el saldo pendiente. No guarda nada aparte: es solo una vista de lo que
// ya está en el formulario, para reducir errores de digitación antes de
// guardar el check-in.
//
// Nota sobre el cruce con Housekeeping al elegir habitación en el
// check-in: el desplegable de Habitación solo deja elegir habitaciones
// cuyo estado sea 'disponible' — las demás (ocupada, limpieza,
// inspección, mantenimiento, bloqueada, fuera de servicio) aparecen
// deshabilitadas con su estado entre paréntesis. Justo antes de guardar,
// se vuelve a confirmar el estado contra la base de datos (por si cambió
// mientras se llenaba el formulario) y se bloquea el check-in si ya no
// está disponible. Así Recepción nunca puede hospedar a alguien en una
// habitación que Housekeeping tiene marcada como no disponible.
//
// Nota sobre autocompletar datos de huésped: al salir del campo Número de
// documento (o del campo Nombre, si el documento sigue vacío), se busca
// primero en el check-in más reciente de esa persona (recepcion_checkins,
// tiene el set completo de campos) y si no aparece ahí, en la ficha
// básica de huespedes (solo contacto). Si encuentra algo, rellena los
// campos y avisa con un toast — así un huésped recurrente no tiene que
// volver a dictar todos sus datos.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatFechaHora, toISODate, addDays } from './dates.js';
import { formatCOP } from './currency.js';
import { calcularHabitacionesEnUso } from './cuentas.js';
import { getUsuarioActual } from './auth.js';
import { ajustarInventarioHabitacion } from './inventario.js';
import { mostrarResumenCheckout } from './resumen-checkout.js';

const TIPOS_DOCUMENTO = ['Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'Tarjeta de identidad', 'PEP', 'Otro'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];

// Mismas reglas de bloqueo que reservas.js, para que "Ver disponibilidad"
// diga exactamente lo mismo que el calendario de Reservas.
const ESTADOS_BLOQUEO_INDEFINIDO = ['mantenimiento', 'bloqueada', 'fuera_servicio'];
const ESTADOS_BLOQUEO_HOY = ['ocupada', 'limpieza', 'inspeccion'];
const ETIQUETA_ESTADO_HABITACION = {
  ocupada: '🔴 Ocupada',
  limpieza: '🧹 Limpieza',
  inspeccion: '🔍 Inspección',
  mantenimiento: '🔧 Mantenim.',
  bloqueada: '🚫 Bloqueada',
  fuera_servicio: '⛔ Fuera serv.',
};
const DIAS_VISIBLES_DISPONIBILIDAD = 10;

// Colores/etiquetas del resumen visual de liquidación (tarjeta Estadía).
const ETIQUETA_ESTADO_PAGO = {
  pendiente: { texto: '🕒 Pendiente — sin pago todavía', color: '#8a6d00', fondo: 'var(--color-alerta-fondo, #fff8e1)', borde: '#e8c547' },
  parcial: { texto: '🔷 Parcial — abono ahora', color: '#0b5fae', fondo: '#eaf3ff', borde: '#8ec1f5' },
  anticipado: { texto: '✅ Anticipado — pago completo', color: 'var(--color-verde-oscuro, #1b7a3d)', fondo: '#eafbea', borde: '#8fd3a4' },
};

async function render(container) {
  await vistaLista(container);
}

async function vistaLista(container) {
  container.innerHTML = `
    <h2>Recepción — Hoy</h2>
    <div id="resumen-hoy-wrap" style="margin-bottom:1.25rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-bottom:1.25rem;">
      <button id="btn-nuevo-checkin" class="btn btn-primario">+ Nuevo Check-in (walk-in)</button>
    </div>
    <div id="llegadas-hoy-wrap" style="margin-bottom:1.25rem;"></div>
    <div id="checkins-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nuevo-checkin').addEventListener('click', () => vistaFormulario(container));

  await cargarVistaHoy(container);
}

async function cargarVistaHoy(container) {
  const wrapResumen = container.querySelector('#resumen-hoy-wrap');
  const wrapLlegadas = container.querySelector('#llegadas-hoy-wrap');
  const wrapCheckins = container.querySelector('#checkins-wrap');

  let items = [];
  try {
    items = await calcularHabitacionesEnUso();
  } catch (error) {
    wrapResumen.innerHTML = '';
    wrapLlegadas.innerHTML = '';
    wrapCheckins.innerHTML = `<p class="mensaje-vacio">Error cargando huéspedes: ${error.message}</p>`;
    return;
  }

  const hoyISO = toISODate(new Date());

  const { data: llegadasHoy, error: errLlegadas } = await supabase
    .from('reservas')
    .select('id, habitacion_id, huesped_nombre, huesped_telefono, huesped_documento, fecha_checkin, fecha_checkout, tarifa_id, habitaciones(numero, nombre)')
    .eq('fecha_checkin', hoyISO)
    .in('estado', ['reservada', 'confirmada'])
    .order('id');

  const reservaIds = items.map((i) => i.reservaId).filter((id) => id !== null);
  const { data: reservasActivas, error: errReservasActivas } = reservaIds.length
    ? await supabase.from('reservas').select('id, fecha_checkout').in('id', reservaIds)
    : { data: [], error: null };

  // --- Estado general de habitaciones (lo relevante que traía la antigua
  // pestaña "Inicio"): útil para saber de un vistazo dónde ubicar un
  // walk-in sin tener que abrir otra pantalla. ---
  const { data: habitacionesEstado, error: errHabEstado } = await supabase.from('habitaciones').select('estado');

  if (errLlegadas || errReservasActivas) {
    wrapCheckins.innerHTML = `<p class="mensaje-vacio">Error cargando el resumen de hoy: ${(errLlegadas || errReservasActivas).message}</p>`;
    return;
  }

  const checkoutPorReserva = new Map((reservasActivas || []).map((r) => [r.id, r.fecha_checkout]));
  const itemsConSaleHoy = items.map((i) => ({
    ...i,
    saleHoy: i.reservaId ? checkoutPorReserva.get(i.reservaId) === hoyISO : false,
  }));

  const salidasHoy = itemsConSaleHoy.filter((i) => i.saleHoy).length;
  const saldoTotalPendiente = itemsConSaleHoy.reduce((acc, i) => acc + Math.max(0, i.saldoPendiente), 0);

  const contarHabitaciones = (estado) => (habitacionesEstado || []).filter((h) => h.estado === estado).length;
  const libres = contarHabitaciones('disponible');
  const enLimpieza = contarHabitaciones('limpieza');
  const fueraServicio = contarHabitaciones('fuera_servicio') + contarHabitaciones('mantenimiento') + contarHabitaciones('bloqueada');

  // --- Resumen del día (4 tarjetas rápidas + línea de estado general) ---
  wrapResumen.innerHTML = `
    <div class="grid-dos-columnas" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Llegadas hoy</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${(llegadasHoy || []).length}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Salidas hoy</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${salidasHoy}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Habitaciones ocupadas</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${itemsConSaleHoy.length}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Saldo pendiente total</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0; color:${saldoTotalPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'};">${formatCOP(saldoTotalPendiente)}</p>
      </div>
    </div>
    ${
      errHabEstado
        ? ''
        : `<p style="margin:0.75rem 0 0; font-size:0.85rem; color:var(--color-texto-suave);">🏠 Libres: <strong>${libres}</strong> &nbsp;·&nbsp; 🧹 En limpieza: <strong>${enLimpieza}</strong> &nbsp;·&nbsp; ⛔ Fuera de servicio: <strong>${fueraServicio}</strong></p>`
    }
  `;

  // --- Llegadas de hoy (reservas sin check-in todavía) ---
  if ((llegadasHoy || []).length === 0) {
    wrapLlegadas.innerHTML = '';
  } else {
    wrapLlegadas.innerHTML = `
      <div class="tarjeta">
        <h3>🛬 Llegadas de hoy (${llegadasHoy.length})</h3>
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead>
              <tr>
                <th>Habitación</th>
                <th>Huésped</th>
                <th>Teléfono</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${llegadasHoy
                .map(
                  (r) => `
                <tr>
                  <td>${r.habitaciones ? `${escaparHTML(r.habitaciones.numero)} — ${escaparHTML(r.habitaciones.nombre)}` : '—'}</td>
                  <td>${escaparHTML(r.huesped_nombre)}</td>
                  <td>${escaparHTML(r.huesped_telefono || '—')}</td>
                  <td><button type="button" class="btn-editar btn-iniciar-checkin" data-reserva-id="${r.id}">Iniciar check-in</button></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wrapLlegadas.querySelectorAll('.btn-iniciar-checkin').forEach((btn) => {
      btn.addEventListener('click', () => vistaFormulario(container, Number(btn.dataset.reservaId)));
    });
  }

  // --- Habitaciones en uso, ordenadas por urgencia: sale hoy + debe plata
  // primero, luego sale hoy, luego debe plata, luego el resto. ---
  const itemsOrdenados = [...itemsConSaleHoy].sort((a, b) => {
    const score = (i) => (i.saleHoy && i.saldoPendiente > 0 ? 3 : i.saleHoy ? 2 : i.saldoPendiente > 0 ? 1 : 0);
    return score(b) - score(a);
  });

  if (itemsOrdenados.length === 0) {
    wrapCheckins.innerHTML = '<p class="mensaje-vacio">No hay huéspedes hospedados actualmente.</p>';
    return;
  }

  wrapCheckins.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Habitación</th>
          <th>Huésped</th>
          <th>Documento</th>
          <th>Hora ingreso</th>
          <th>Noches</th>
          <th>Sale hoy</th>
          <th>Saldo pendiente</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${itemsOrdenados
          .map(
            (i) => `
          <tr data-checkin-id="${i.checkinId}" style="${i.saleHoy ? 'background:var(--color-alerta-fondo, #fff8e1);' : ''}">
            <td>${i.habitacionLabel}</td>
            <td>${escaparHTML(i.huespedNombre)}</td>
            <td>${i.tipoDocumento || '—'} ${i.numeroDocumento || ''}</td>
            <td>${formatFechaHora(i.horaIngreso)}</td>
            <td>${i.cantidadNoches ?? '—'}</td>
            <td>${i.saleHoy ? '🔶 Sí' : '—'}</td>
            <td style="color:${i.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">
              ${formatCOP(i.saldoPendiente)}
              ${i.montoMinibar > 0 ? `<div style="font-size:0.72rem; font-weight:500; color:var(--color-texto-suave);">🥤 incluye ${formatCOP(i.montoMinibar)} de minibar</div>` : ''}
            </td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn-editar btn-editar-checkin" data-checkin-id="${i.checkinId}">✏️ Editar</button>
              <button type="button" class="btn-editar btn-checkout" data-checkin-id="${i.checkinId}">Check-out</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  wrapCheckins.querySelectorAll('.btn-checkout').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = itemsOrdenados.find((i) => i.checkinId === Number(btn.dataset.checkinId));
      if (item) abrirModalLiquidacion(container, item);
    });
  });

  wrapCheckins.querySelectorAll('.btn-editar-checkin').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = itemsOrdenados.find((i) => i.checkinId === Number(btn.dataset.checkinId));
      if (item) abrirModalEditarCheckin(container, item);
    });
  });
}

async function abrirModalLiquidacion(container, item) {
  // --- Consumos de minibar de esta reserva, en detalle (no solo el total
  // que ya trae `item` desde cuentas.js) + catálogo de productos activos,
  // para poder agregar un consumo de último momento sin salir de aquí. ---
  const [{ data: consumosIniciales, error: errConsumos }, { data: productos, error: errProductos }] = await Promise.all([
    item.reservaId
      ? supabase
          .from('minibar_consumos')
          .select('*, minibar_productos(nombre)')
          .eq('reserva_id', item.reservaId)
          .order('creado_en', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre'),
  ]);

  if (errConsumos || errProductos) {
    mostrarToast(`Error cargando el detalle de minibar: ${(errConsumos || errProductos).message}`, 'error');
    return;
  }

  let consumos = consumosIniciales || [];
  const categorias = [...new Set((productos || []).map((p) => p.categoria))];
  let montoEditadoManualmente = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>Liquidar y hacer check-out</h3>
      <form id="form-liquidacion">
        <div class="modal-contenido">
          <p class="mensaje-vacio">${escaparHTML(item.huespedNombre)} — ${item.habitacionLabel}</p>
          <div id="liquidacion-cuerpo"></div>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-liquidacion">Cancelar</button>
          <button type="submit" class="btn btn-primario">Confirmar y hacer check-out</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const cuerpo = overlay.querySelector('#liquidacion-cuerpo');
  const inputPago = () => overlay.querySelector('input[name="pago_final"]');

  function montoMinibarActual() {
    return consumos.reduce((sum, c) => sum + Number(c.monto), 0);
  }
  function montoTotalActual() {
    return item.montoHabitacion + montoMinibarActual();
  }
  function saldoActual() {
    return Math.max(0, montoTotalActual() - item.totalAbonado);
  }

  function pintarLiquidacion() {
    // Antes de reescribir el HTML, se guarda lo que la recepcionista ya
    // haya tocado (método de pago, monto editado a mano) para no perderlo
    // al repintar después de agregar/quitar un consumo.
    const metodoPrevio = overlay.querySelector('select[name="metodo_pago"]')?.value;
    const pagoPrevio = inputPago()?.value;
    const comentarioPrevio = overlay.querySelector('textarea[name="comentarios_checkout"]')?.value;

    const montoMinibar = montoMinibarActual();
    const montoTotal = montoTotalActual();
    const saldo = saldoActual();

    cuerpo.innerHTML = `
      <table class="tabla-simple" style="margin-top:0.5rem;">
        <tbody>
          <tr><td>Habitación (${item.cantidadNoches ?? '—'} noches)</td><td class="monto">${formatCOP(item.montoHabitacion)}</td></tr>
          <tr><td><strong>Monto total</strong></td><td class="monto" style="font-weight:700;">${formatCOP(montoTotal)}</td></tr>
          <tr><td>Abonado hasta ahora</td><td class="monto">${formatCOP(item.totalAbonado)}</td></tr>
          <tr><td><strong>Saldo pendiente</strong></td><td class="monto" style="color:${saldo > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">${formatCOP(saldo)}</td></tr>
        </tbody>
      </table>

      <div class="tarjeta" style="margin-top:0.85rem; background:var(--color-fondo-suave, #f8f9fb);">
        <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
          <h3 style="margin:0;">🥤 Consumo de minibar</h3>
          <strong style="font-size:1.1rem;">${formatCOP(montoMinibar)}</strong>
        </div>
        ${
          consumos.length === 0
            ? '<p class="mensaje-vacio">Sin consumo de minibar registrado.</p>'
            : `
          <table class="tabla-simple">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th><th></th></tr></thead>
            <tbody>
              ${consumos
                .map(
                  (c) => `
                <tr>
                  <td>${c.minibar_productos ? escaparHTML(c.minibar_productos.nombre) : '—'}</td>
                  <td>${c.cantidad}</td>
                  <td class="monto">${formatCOP(c.monto)}</td>
                  <td><button type="button" class="btn-editar btn-quitar-consumo-liquidacion" data-id="${c.id}">Quitar</button></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `
        }
        ${
          item.reservaId
            ? `
          <div class="form-grid" style="margin-top:0.75rem;">
            <label>Producto
              <select id="select-producto-liquidacion">
                ${categorias
                  .map(
                    (cat) => `
                  <optgroup label="${escaparHTML(cat)}">
                    ${(productos || [])
                      .filter((p) => p.categoria === cat)
                      .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)} — ${formatCOP(p.precio)}</option>`)
                      .join('')}
                  </optgroup>
                `
                  )
                  .join('')}
              </select>
            </label>
            <label>Cantidad
              <input type="number" id="input-cantidad-liquidacion" min="1" value="1" />
            </label>
            <button type="button" id="btn-agregar-consumo-liquidacion" class="btn btn-secundario btn-chico">+ Agregar consumo</button>
          </div>
        `
            : '<p class="mensaje-vacio" style="margin-top:0.5rem;">Este check-in no tiene reserva vinculada; no se puede agregar consumo desde aquí.</p>'
        }
      </div>

      <div class="form-grid" style="margin-top:1rem;">
        <label>Pago que recibes ahora
          <input type="number" name="pago_final" step="1000" min="0" value="${saldo}" />
        </label>
        <label>Método de pago
          <select name="metodo_pago">
            ${METODOS_PAGO.map((m) => `<option value="${m}" ${metodoPrevio === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.3rem; font-size:0.78rem;">Este monto ya incluye el consumo de minibar de arriba. Si agregas o quitas un consumo, se vuelve a calcular solo.</p>
      <p class="mensaje-vacio" style="margin-top:0.5rem; font-size:0.78rem;">Si el pago es menor al saldo pendiente, te pedimos confirmar antes de liberar la habitación — el checkout no se bloquea, pero el saldo queda registrado como pendiente de cobro.</p>

      <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
        Comentarios del check-out (opcional)
        <textarea name="comentarios_checkout" rows="2" placeholder="Ej: dejó olvidada una chaqueta, pidió factura por correo…" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit; text-transform:none;">${comentarioPrevio || ''}</textarea>
      </label>
    `;

    // El valor del campo de pago se fuerza explícitamente aquí (no solo
    // vía el atributo "value" de arriba) para que quede garantizado que
    // refleja el saldo recién calculado — incluyendo minibar — apenas se
    // repinta, sin depender de cómo cada navegador procese el HTML.
    if (!montoEditadoManualmente) {
      inputPago().value = saldo;
    } else if (pagoPrevio !== undefined) {
      inputPago().value = pagoPrevio;
    }

    inputPago().addEventListener('input', () => {
      montoEditadoManualmente = true;
    });

    cuerpo.querySelectorAll('.btn-quitar-consumo-liquidacion').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const consumoId = Number(btn.dataset.id);
        const consumo = consumos.find((c) => c.id === consumoId);
        if (!consumo) return;

        const { error } = await supabase.from('minibar_consumos').delete().eq('id', consumoId);
        if (error) {
          mostrarToast(`Error quitando el consumo: ${error.message}`, 'error');
          return;
        }

        try {
          const usuario = getUsuarioActual();
          await ajustarInventarioHabitacion(item.habitacionId, consumo.producto_id, consumo.cantidad, usuario?.id || null, 'ajuste_habitacion');
        } catch (errInv) {
          mostrarToast('Consumo quitado, pero no se pudo revertir el inventario de la habitación.', 'error');
        }

        consumos = consumos.filter((c) => c.id !== consumoId);
        montoEditadoManualmente = false;
        mostrarToast('Consumo quitado de la liquidación. El monto a cobrar se actualizó.', 'exito');
        pintarLiquidacion();
      });
    });

    const btnAgregar = cuerpo.querySelector('#btn-agregar-consumo-liquidacion');
    if (btnAgregar) {
      btnAgregar.addEventListener('click', async () => {
        const selectProducto = cuerpo.querySelector('#select-producto-liquidacion');
        const inputCantidad = cuerpo.querySelector('#input-cantidad-liquidacion');
        const productoId = Number(selectProducto.value);
        const cantidad = Number(inputCantidad.value) || 1;
        const producto = (productos || []).find((p) => p.id === productoId);
        if (!producto) return;

        const usuario = getUsuarioActual();
        const { data: nuevoConsumo, error } = await supabase
          .from('minibar_consumos')
          .insert({
            reserva_id: item.reservaId,
            habitacion_id: item.habitacionId,
            producto_id: productoId,
            cantidad,
            precio_unitario: producto.precio,
            monto: producto.precio * cantidad,
            registrado_por: usuario?.id || null,
          })
          .select('*, minibar_productos(nombre)')
          .single();

        if (error) {
          mostrarToast(`Error agregando el consumo: ${error.message}`, 'error');
          return;
        }

        try {
          await ajustarInventarioHabitacion(item.habitacionId, productoId, -cantidad, usuario?.id || null, 'consumo');
        } catch (errInv) {
          mostrarToast('Consumo agregado, pero no se pudo actualizar el inventario de la habitación.', 'error');
        }

        consumos = [nuevoConsumo, ...consumos];
        montoEditadoManualmente = false;
        mostrarToast('Consumo agregado. El monto a cobrar se actualizó para incluirlo.', 'exito');
        pintarLiquidacion();
      });
    }
  }

  pintarLiquidacion();

  overlay.querySelector('#btn-cancelar-liquidacion').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-liquidacion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const pagoFinal = form.get('pago_final') ? Number(form.get('pago_final')) : 0;
    const metodoPago = form.get('metodo_pago');
    const comentarioCheckout = form.get('comentarios_checkout')?.trim() || null;
    const saldoRestante = saldoActual() - pagoFinal;

    if (saldoRestante > 0) {
      const ok = await mostrarConfirmacion({
        titulo: 'Saldo pendiente al hacer check-out',
        contenidoHTML: `Después de este pago queda un saldo pendiente de <strong>${formatCOP(saldoRestante)}</strong> para <strong>${escaparHTML(item.huespedNombre)}</strong>. ¿Confirmas el check-out de todas formas? El saldo queda registrado como pendiente de cobro.`,
        textoConfirmar: 'Sí, hacer check-out con saldo pendiente',
      });
      if (!ok) return;
    }

    if (pagoFinal > 0) {
      if (!item.reservaId) {
        mostrarToast('No hay una reserva vinculada a este check-in; no se pudo registrar el pago. Se hará el check-out sin registrarlo.', 'error');
      } else {
        const { error: errPago } = await supabase.from('reservas_pagos').insert({
          reserva_id: item.reservaId,
          monto: pagoFinal,
          metodo_pago: metodoPago,
          comentarios: comentarioCheckout ? `Pago de liquidación al check-out. ${comentarioCheckout}` : 'Pago de liquidación al check-out.',
        });
        if (errPago) {
          mostrarToast(`Error registrando el pago: ${errPago.message}`, 'error');
          return;
        }
      }
    }

    const checkoutOk = await ejecutarCheckout(container, item, comentarioCheckout);
    overlay.remove();

    // Apenas se confirma el check-out, se abre la tarjeta-resumen con
    // todo el detalle del servicio (habitación, minibar, historial
    // completo de pagos) — visual, descargable y también consultable
    // luego desde el listado de Checkouts en Indicadores.
    if (checkoutOk) {
      await mostrarResumenCheckout(item.checkinId);
    }
  });
}

async function ejecutarCheckout(container, item, comentarioCheckout) {
  const { error: errCheckin } = await supabase
    .from('recepcion_checkins')
    .update({ check_out_en: new Date().toISOString(), observaciones_checkout: comentarioCheckout || null })
    .eq('id', item.checkinId);

  if (errCheckin) {
    mostrarToast(`Error en check-out: ${errCheckin.message}`, 'error');
    return false;
  }

  const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
    p_habitacion_id: item.habitacionId,
    p_estado: 'limpieza',
  });
  if (errEstado) {
    mostrarToast(`Check-out guardado, pero no se pudo actualizar el estado de la habitación: ${errEstado.message}`, 'error');
  }

  if (item.reservaId) {
    await supabase.from('reservas').update({ estado: 'check_out' }).eq('id', item.reservaId);
  }

  mostrarToast('Check-out registrado. La habitación quedó en limpieza.', 'exito');
  await vistaLista(container);
  return true;
}

// --- "✏️ Editar" un check-in ya registrado ---
async function abrirModalEditarCheckin(container, item) {
  const [{ data: checkin, error: errCheckin }, { data: habitaciones }, { data: tarifas }] = await Promise.all([
    supabase.from('recepcion_checkins').select('*').eq('id', item.checkinId).single(),
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
  ]);

  if (errCheckin) {
    mostrarToast(`Error cargando el check-in: ${errCheckin.message}`, 'error');
    return;
  }

  const acompanantesExistentes = Array.isArray(checkin.acompanantes_detalle) ? checkin.acompanantes_detalle : [];
  const habitacionOriginalId = checkin.habitacion_id;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>✏️ Editar check-in — ${escaparHTML(checkin.nombre)}</h3>
      <form id="form-editar-checkin" class="modal-contenido">
        <p class="mensaje-vacio">Si cambias de habitación aquí, la reserva vinculada y el estado de ambas habitaciones se actualizan solos. La firma digital, el Habeas Data y los pagos ya registrados no se tocan desde este formulario.</p>

        <h4>Datos del huésped</h4>
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required value="${escaparHTML(checkin.nombre)}" />
          </label>
          <label>Tipo de documento
            <select name="tipo_documento">
              ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}" ${checkin.tipo_documento === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required value="${escaparHTML(checkin.numero_documento)}" />
          </label>
          <label>Nacionalidad
            <input type="text" name="nacionalidad" value="${escaparHTML(checkin.nacionalidad || '')}" />
          </label>
          <label>Fecha de nacimiento
            <input type="date" name="fecha_nacimiento" value="${checkin.fecha_nacimiento || ''}" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" value="${escaparHTML(checkin.direccion || '')}" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" value="${escaparHTML(checkin.ciudad || '')}" />
          </label>
          <label>Departamento
            <input type="text" name="departamento" value="${escaparHTML(checkin.departamento || '')}" />
          </label>
          <label>País
            <input type="text" name="pais" value="${escaparHTML(checkin.pais || '')}" />
          </label>
          <label>Correo
            <input type="email" name="correo" value="${escaparHTML(checkin.correo || '')}" />
          </label>
          <label>Celular
            <input type="text" name="celular" value="${escaparHTML(checkin.celular || '')}" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" value="${escaparHTML(checkin.empresa || '')}" />
          </label>
          <label>Placa del vehículo
            <input type="text" name="placa_vehiculo" value="${escaparHTML(checkin.placa_vehiculo || '')}" />
          </label>
          <label>Foto del documento (URL)
            <input type="url" name="foto_documento_url" value="${escaparHTML(checkin.foto_documento_url || '')}" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${escaparHTML(checkin.observaciones || '')}</textarea>
        </label>

        <h4 style="margin-top:1.25rem;">Acompañantes</h4>
        <div id="acompanantes-editar-lista"></div>
        <button type="button" id="btn-agregar-acompanante-editar" class="btn btn-secundario btn-chico">+ Agregar acompañante</button>

        <h4 style="margin-top:1.25rem;">Estadía</h4>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" id="select-habitacion-editar" required>
              ${(habitaciones || [])
                .map((h) => {
                  const esLaActual = h.id === checkin.habitacion_id;
                  const bloqueada = h.estado !== 'disponible' && !esLaActual;
                  return `<option value="${h.id}" ${esLaActual ? 'selected' : ''} ${bloqueada ? 'disabled' : ''}>${h.numero} — ${h.nombre}${bloqueada ? ` (${ETIQUETA_ESTADO_HABITACION[h.estado] || h.estado})` : ''}</option>`;
                })
                .join('')}
            </select>
          </label>
          <label>Tarifa
            <select name="tarifa_id" required>
              <option value="">—</option>
              ${(tarifas || [])
                .map((t) => `<option value="${t.id}" ${checkin.tarifa_id === t.id ? 'selected' : ''}>${t.codigo} / ${formatCOP(t.precio_temporada_baja)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Cantidad de noches
            <input type="number" name="cantidad_noches" min="1" required value="${checkin.cantidad_noches || 1}" />
          </label>
          <label>Método de pago
            <select name="metodo_pago" required>
              ${METODOS_PAGO.map((m) => `<option value="${m}" ${checkin.metodo_pago === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label>Depósito de garantía
            <input type="number" name="deposito" step="1000" value="${checkin.deposito ?? ''}" />
          </label>
        </div>

        <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">No editables desde aquí: firma digital, consentimiento Habeas Data y pagos ya registrados (se corrigen en Caja o Reservas).</p>

        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-editar-checkin">Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cambios</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // --- Acompañantes: misma plantilla que el check-in nuevo, pero
  // precargada con lo que ya había guardado. ---
  const listaAcompEditar = overlay.querySelector('#acompanantes-editar-lista');
  let contadorAcompEditar = 0;

  function agregarBloqueAcompEditar(datos) {
    contadorAcompEditar += 1;
    const envoltorio = document.createElement('div');
    envoltorio.innerHTML = filaAcompanante(contadorAcompEditar);
    const bloque = envoltorio.firstElementChild;
    if (datos) {
      const setCampo = (nombreCampo, valor) => {
        const el = bloque.querySelector(`[name="${nombreCampo}"]`);
        if (el && valor) el.value = valor;
      };
      setCampo('acomp_nombre', datos.nombre);
      setCampo('acomp_tipo_documento', datos.tipo_documento);
      setCampo('acomp_numero_documento', datos.numero_documento);
      setCampo('acomp_nacionalidad', datos.nacionalidad);
      setCampo('acomp_fecha_nacimiento', datos.fecha_nacimiento);
      setCampo('acomp_celular', datos.celular);
      const checkVerificado = bloque.querySelector('.check-verificacion-menor');
      if (checkVerificado && datos.verificado_menor) checkVerificado.checked = true;
    }
    bloque.querySelector('.btn-quitar-acompanante').addEventListener('click', () => bloque.remove());
    wireAlertaMenorAcompanante(bloque);
    listaAcompEditar.appendChild(bloque);
  }

  if (acompanantesExistentes.length) {
    acompanantesExistentes.forEach((a) => agregarBloqueAcompEditar(a));
  }
  overlay.querySelector('#btn-agregar-acompanante-editar').addEventListener('click', () => agregarBloqueAcompEditar(null));

  overlay.querySelector('#btn-cancelar-editar-checkin').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-editar-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);

    const nuevaHabitacionId = Number(form.get('habitacion_id'));
    const habitacionCambio = nuevaHabitacionId !== habitacionOriginalId;

    if (habitacionCambio) {
      const nuevaHabitacion = (habitaciones || []).find((h) => h.id === nuevaHabitacionId);
      if (nuevaHabitacion && nuevaHabitacion.estado !== 'disponible') {
        const ok = await mostrarConfirmacion({
          titulo: 'Habitación no disponible',
          contenidoHTML: `La habitación <strong>${nuevaHabitacion.numero} — ${nuevaHabitacion.nombre}</strong> figura como "${ETIQUETA_ESTADO_HABITACION[nuevaHabitacion.estado] || nuevaHabitacion.estado}", no disponible. ¿Confirmas que quieres mover al huésped ahí de todas formas?`,
          textoConfirmar: 'Sí, mover de todas formas',
        });
        if (!ok) return;
      }
    }

    const bloquesAcomp = Array.from(listaAcompEditar.querySelectorAll('.bloque-acompanante'));
    let acompanantesDetalle = bloquesAcomp
      .map((bloque) => ({
        nombre: bloque.querySelector('[name="acomp_nombre"]').value.trim(),
        tipo_documento: bloque.querySelector('[name="acomp_tipo_documento"]').value,
        numero_documento: bloque.querySelector('[name="acomp_numero_documento"]').value.trim() || null,
        nacionalidad: bloque.querySelector('[name="acomp_nacionalidad"]').value.trim() || null,
        fecha_nacimiento: bloque.querySelector('[name="acomp_fecha_nacimiento"]').value || null,
        celular: bloque.querySelector('[name="acomp_celular"]').value.trim() || null,
        verificado_menor: bloque.querySelector('.check-verificacion-menor')?.checked || false,
      }))
      .filter((a) => a.nombre);
    if (acompanantesDetalle.length === 0) acompanantesDetalle = null;

    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;

    const payload = {
      nombre,
      tipo_documento: form.get('tipo_documento'),
      numero_documento: documento,
      nacionalidad: form.get('nacionalidad').trim() || null,
      fecha_nacimiento: form.get('fecha_nacimiento') || null,
      direccion: form.get('direccion').trim() || null,
      ciudad: form.get('ciudad').trim() || null,
      departamento: form.get('departamento').trim() || null,
      pais: form.get('pais').trim() || null,
      correo: form.get('correo').trim() || null,
      celular,
      empresa: form.get('empresa').trim() || null,
      placa_vehiculo: form.get('placa_vehiculo').trim() || null,
      foto_documento_url: form.get('foto_documento_url').trim() || null,
      observaciones: form.get('observaciones').trim() || null,
      acompanantes_detalle: acompanantesDetalle,
      habitacion_id: nuevaHabitacionId,
      tarifa_id: form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null,
      cantidad_noches: form.get('cantidad_noches') ? Number(form.get('cantidad_noches')) : 1,
      metodo_pago: form.get('metodo_pago'),
      deposito: form.get('deposito') ? Number(form.get('deposito')) : null,
    };

    const { error: errUpdate } = await supabase.from('recepcion_checkins').update(payload).eq('id', checkin.id);
    if (errUpdate) {
      mostrarToast(`Error guardando cambios: ${errUpdate.message}`, 'error');
      return;
    }

    // --- Mantener sincronizada la reserva vinculada (huésped + habitación) ---
    if (checkin.reserva_id) {
      const { error: errReserva } = await supabase
        .from('reservas')
        .update({
          huesped_nombre: nombre,
          huesped_documento: documento,
          huesped_telefono: celular,
          habitacion_id: nuevaHabitacionId,
        })
        .eq('id', checkin.reserva_id);
      if (errReserva) {
        mostrarToast(`Check-in actualizado, pero no se pudo sincronizar la reserva vinculada: ${errReserva.message}`, 'error');
      }
    }

    // --- Cambio de habitación: liberar la anterior, ocupar la nueva ---
    if (habitacionCambio) {
      await supabase.rpc('cambiar_estado_habitacion', { p_habitacion_id: habitacionOriginalId, p_estado: 'limpieza' });
      await supabase.rpc('cambiar_estado_habitacion', { p_habitacion_id: nuevaHabitacionId, p_estado: 'ocupada' });
    }

    // --- Ficha de huésped (histórico), igual que en el check-in nuevo ---
    const { error: errHuesped } = await supabase.from('huespedes').upsert(
      {
        numero_documento: documento,
        tipo_documento: form.get('tipo_documento'),
        nombre,
        telefono: celular,
        correo: form.get('correo').trim() || null,
        empresa: form.get('empresa').trim() || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (errHuesped) {
      mostrarToast(`Cambios guardados, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
    }

    await alimentarHuespedesConAcompanantes(acompanantesDetalle);

    mostrarToast('Check-in actualizado.', 'exito');
    overlay.remove();
    await vistaLista(container);
  });
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// Edad en años cumplidos a partir de una fecha 'YYYY-MM-DD'. Devuelve null
// si no hay fecha (para no marcar como "menor" a alguien sin dato).
function calcularEdad(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date();
  const nacimiento = new Date(fechaISO);
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mesDiff = hoy.getMonth() - nacimiento.getMonth();
  if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;
  return edad;
}

// Muestra/oculta la alerta de menor de edad de un bloque de acompañante
// según su fecha de nacimiento, cada vez que esta cambia.
function wireAlertaMenorAcompanante(bloque) {
  const inputFecha = bloque.querySelector('.input-fecha-nacimiento-acomp');
  const alerta = bloque.querySelector('.alerta-menor-acompanante');
  if (!inputFecha || !alerta) return;

  function actualizar() {
    const edad = calcularEdad(inputFecha.value);
    alerta.classList.toggle('oculto', !(edad !== null && edad < 18));
  }

  inputFecha.addEventListener('change', actualizar);
  actualizar();
}

function filaAcompanante(indice) {
  return `
    <div class="bloque-acompanante tarjeta" style="margin-bottom:0.75rem;">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.5rem;">
        <strong style="font-size:0.85rem;">Acompañante ${indice}</strong>
        <button type="button" class="btn btn-secundario btn-chico btn-quitar-acompanante">Quitar</button>
      </div>
      <div class="form-grid">
        <label>Nombre completo
          <input type="text" name="acomp_nombre" required />
        </label>
        <label>Tipo de documento
          <select name="acomp_tipo_documento">
            ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </label>
        <label>Número de documento
          <input type="text" name="acomp_numero_documento" />
        </label>
        <label>Nacionalidad
          <input type="text" name="acomp_nacionalidad" />
        </label>
        <label>Fecha de nacimiento
          <input type="date" name="acomp_fecha_nacimiento" class="input-fecha-nacimiento-acomp" />
        </label>
        <label>Celular
          <input type="text" name="acomp_celular" />
        </label>
      </div>
      <div class="alerta-menor-acompanante oculto" style="margin-top:0.6rem; background:var(--color-alerta-fondo, #fff8e1); border:1px solid #e8c547; border-radius:8px; padding:0.65rem 0.85rem;">
        <p style="margin:0; font-size:0.82rem; color:#8a6d00; font-weight:600;">⚠️ Este acompañante es menor de edad.</p>
        <p style="margin:0.3rem 0 0; font-size:0.8rem; color:#8a6d00;">Solicita el registro civil de nacimiento para verificar que el adulto responsable es su padre/madre, o la autorización notarial correspondiente si viaja con otra persona.</p>
        <label style="display:flex; align-items:center; gap:0.4rem; margin-top:0.5rem; font-size:0.82rem; color:#8a6d00;">
          <input type="checkbox" class="check-verificacion-menor" style="width:auto;" />
          Verifiqué el documento (registro civil / autorización notarial)
        </label>
      </div>
    </div>
  `;
}

// --- Helpers del resumen visual de liquidación (tarjeta Estadía) ---
function filaResumen(label, valor, opts = {}) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.45rem 0.1rem; border-bottom:1px dashed var(--color-borde, #ddd);">
      <span style="font-size:0.82rem; color:var(--color-texto-suave, #666);">${label}</span>
      <span style="font-weight:${opts.negrita ? 700 : 500}; font-size:${opts.grande ? '1.05rem' : '0.92rem'};">${escaparHTML(String(valor))}</span>
    </div>
  `;
}

function cajonMonto(label, montoTexto, color, fondo, borde) {
  return `
    <div style="background:${fondo}; border:1.5px solid ${borde}; border-radius:10px; padding:0.7rem 1rem; margin-top:0.6rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
      <span style="font-weight:700; color:${color}; font-size:0.85rem;">${label}</span>
      <span style="font-weight:800; font-size:1.3rem; color:${color};">${montoTexto}</span>
    </div>
  `;
}

// --- Autocompletar datos de un huésped que ya existe en el sistema ---
// Busca primero en su check-in más reciente (recepcion_checkins, tiene el
// set completo de campos) y si no aparece, en la ficha básica de
// huespedes (solo contacto). Devuelve null si no encuentra nada.
async function buscarHuespedPorDocumento(documento) {
  if (!documento) return null;

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .eq('numero_documento', documento)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase.from('huespedes').select('*').eq('numero_documento', documento).maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

async function buscarHuespedPorNombre(nombre) {
  if (!nombre || nombre.trim().length < 3) return null;
  const valor = nombre.trim();

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .ilike('nombre', valor)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase
    .from('huespedes')
    .select('*')
    .ilike('nombre', valor)
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

// Da de alta (o actualiza) en el listado general de huespedes a cada
// acompañante que traiga número de documento — sin documento no hay con
// qué identificarlo ahí, así que esos quedan solo dentro del check-in.
async function alimentarHuespedesConAcompanantes(acompanantesDetalle) {
  if (!Array.isArray(acompanantesDetalle) || acompanantesDetalle.length === 0) return;

  for (const acomp of acompanantesDetalle) {
    if (!acomp.numero_documento) continue;
    const { error } = await supabase.from('huespedes').upsert(
      {
        numero_documento: acomp.numero_documento,
        tipo_documento: acomp.tipo_documento || null,
        nombre: acomp.nombre,
        telefono: acomp.celular || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (error) {
      mostrarToast(`No se pudo agregar a ${acomp.nombre} al listado de huéspedes: ${error.message}`, 'error');
    }
  }
}

// --- "Ver disponibilidad": mini calendario (10 días) para elegir
// habitación desde dentro del check-in, sin salir a la pestaña Reservas. ---
async function abrirModalDisponibilidad(selectHabitacion) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyISO = toISODate(hoy);
  const fechas = Array.from({ length: DIAS_VISIBLES_DISPONIBILIDAD }, (_, i) => addDays(hoy, i));
  const rangoFinISO = toISODate(addDays(hoy, DIAS_VISIBLES_DISPONIBILIDAD));

  const [{ data: habitaciones, error: errHab }, { data: reservas, error: errRes }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('reservas').select('*').lte('fecha_checkin', rangoFinISO).gt('fecha_checkout', hoyISO),
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  if (errHab || errRes) {
    overlay.innerHTML = `
      <div class="modal-caja modal-caja-ancha">
        <h3>Disponibilidad de habitaciones</h3>
        <p class="mensaje-vacio">Error cargando disponibilidad: ${(errHab || errRes).message}</p>
        <div class="modal-acciones"><button type="button" class="btn btn-secundario" id="btn-cerrar-disponibilidad">Cerrar</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-cerrar-disponibilidad').addEventListener('click', () => overlay.remove());
    return;
  }

  const encabezados = fechas
    .map((f) => {
      const iso = toISODate(f);
      const esHoy = iso === hoyISO;
      const label = f.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' });
      return `<th class="${esHoy ? 'celda-columna-hoy' : ''}">${label}${esHoy ? ' (hoy)' : ''}</th>`;
    })
    .join('');

  const filas = (habitaciones || [])
    .map((h) => {
      const bloqueoIndefinido = ESTADOS_BLOQUEO_INDEFINIDO.includes(h.estado);
      const bloqueoHoy = ESTADOS_BLOQUEO_HOY.includes(h.estado);
      const celdas = fechas
        .map((f) => {
          const iso = toISODate(f);
          const esHoy = iso === hoyISO;
          const reserva = (reservas || []).find(
            (r) => r.habitacion_id === h.id && iso >= r.fecha_checkin && iso < r.fecha_checkout
          );
          if (reserva) {
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-reserva-ocupada" title="${escaparHTML(reserva.huesped_nombre)}">${escaparHTML(reserva.huesped_nombre)}</div></td>`;
          }
          if (bloqueoIndefinido || (esHoy && bloqueoHoy)) {
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-habitacion-bloqueada ${h.estado}" title="Habitación en estado: ${h.estado}">${ETIQUETA_ESTADO_HABITACION[h.estado]}</div></td>`;
          }
          // Disponible: solo la columna de HOY es clicable para elegir
          // habitación (el check-in es para hoy); las demás columnas son
          // solo informativas, para ver si se queda libre toda la estadía.
          if (esHoy) {
            return `<td class="celda-columna-hoy"><div class="celda-reserva-vacia btn-elegir-habitacion" data-habitacion-id="${h.id}" title="Elegir esta habitación">✅ Libre</div></td>`;
          }
          return `<td><div class="celda-reserva-vacia" style="cursor:default;">Libre</div></td>`;
        })
        .join('');
      return `<tr><td class="celda-habitacion">${h.numero} — ${h.nombre}</td>${celdas}</tr>`;
    })
    .join('');

  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>Disponibilidad de habitaciones</h3>
      <p class="mensaje-vacio">Clic en "✅ Libre" de la columna de hoy para elegir esa habitación. Las columnas futuras son solo para ver si se mantiene libre durante la estadía.</p>
      <div class="tabla-scroll" style="max-height:60vh;">
        <table class="tabla-calendario-reservas">
          <thead><tr><th>Habitación</th>${encabezados}</tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="modal-acciones" style="margin-top:1rem;">
        <button type="button" class="btn btn-secundario" id="btn-cerrar-disponibilidad">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cerrar-disponibilidad').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll('.btn-elegir-habitacion').forEach((el) => {
    el.addEventListener('click', () => {
      selectHabitacion.value = el.dataset.habitacionId;
      overlay.remove();
      mostrarToast('Habitación seleccionada.', 'exito');
    });
  });
}

async function vistaFormulario(container, reservaIdPreseleccionada) {
  const [{ data: habitaciones }, { data: tarifas }, { data: reservas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
    supabase
      .from('reservas')
      .select('id, habitacion_id, huesped_nombre, huesped_telefono, huesped_documento, fecha_checkin, fecha_checkout, tarifa_id, estado')
      .in('estado', ['reservada', 'confirmada'])
      .order('fecha_checkin'),
  ]);

  container.innerHTML = `
    <h2>Nuevo Check-in</h2>
    <form id="form-checkin">
      <div class="tarjeta">
        <h3>Vincular a una reserva (opcional)</h3>
        <div class="form-grid">
          <label>Reserva
            <select id="select-reserva">
              <option value="">— Walk-in / sin reserva —</option>
              ${(reservas || [])
                .map((r) => `<option value="${r.id}">${escaparHTML(r.huesped_nombre)} — ${r.fecha_checkin} a ${r.fecha_checkout}</option>`)
                .join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="tarjeta">
        <h3>Datos del huésped</h3>
        <p class="mensaje-vacio" style="margin-bottom:0.75rem;">Si ya se hospedó antes, escribe su número de documento (o su nombre) y sale del campo — te autocompletamos lo que ya tenemos de él.</p>
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required />
          </label>
          <label>Tipo de documento
            <select name="tipo_documento">
              ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required />
          </label>
          <label>Nacionalidad
            <input type="text" name="nacionalidad" />
          </label>
          <label>Fecha de nacimiento
            <input type="date" name="fecha_nacimiento" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" />
          </label>
          <label>Departamento
            <input type="text" name="departamento" />
          </label>
          <label>País
            <input type="text" name="pais" value="Colombia" />
          </label>
          <label>Correo
            <input type="email" name="correo" />
          </label>
          <label>Celular
            <input type="text" name="celular" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" />
          </label>
          <label>Placa del vehículo
            <input type="text" name="placa_vehiculo" />
          </label>
          <label>Foto del documento (URL, opcional)
            <input type="url" name="foto_documento_url" placeholder="https://..." />
          </label>
        </div>

        <label style="display:flex; align-items:center; gap:0.5rem; margin-top:1.25rem; font-size:0.9rem;">
          <input type="checkbox" id="check-tiene-acompanante" style="width:auto;" />
          ¿Trae acompañante(s)?
        </label>
        <div id="acompanantes-wrap" class="oculto" style="margin-top:0.75rem;">
          <p class="mensaje-vacio" style="margin-bottom:0.5rem;">Se piden los mismos datos del huésped principal para cada acompañante. Si trae número de documento, también queda en el listado general de huéspedes.</p>
          <div id="acompanantes-lista"></div>
          <button type="button" id="btn-agregar-acompanante" class="btn btn-secundario btn-chico">+ Agregar otro acompañante</button>
        </div>

        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1.25rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
      </div>

      <div class="tarjeta">
        <h3>Estadía</h3>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" id="select-habitacion" required>
              <option value="">—</option>
              ${(habitaciones || [])
                .map((h) => {
                  const bloqueada = h.estado !== 'disponible';
                  return `<option value="${h.id}" ${bloqueada ? 'disabled' : ''}>${h.numero} — ${h.nombre}${bloqueada ? ` (${ETIQUETA_ESTADO_HABITACION[h.estado] || h.estado})` : ''}</option>`;
                })
                .join('')}
            </select>
          </label>
          <p class="mensaje-vacio" style="grid-column:1 / -1; font-size:0.78rem; margin:0.2rem 0 0;">Solo se pueden elegir habitaciones que figuren "disponible" ahora mismo. Usa "Ver disponibilidad" si necesitas ver otra opción, o corrige el estado desde Housekeeping.</p>
          <label>Tarifa
            <select name="tarifa_id" id="select-tarifa" required>
              <option value="">—</option>
              ${(tarifas || []).map((t) => `<option value="${t.id}">${t.codigo} / ${formatCOP(t.precio_temporada_baja)}</option>`).join('')}
            </select>
          </label>
          <label>Cantidad de noches
            <input type="number" name="cantidad_noches" id="input-noches" min="1" value="1" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago" id="select-metodo-pago-estadia" required>
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Depósito de garantía (opcional)
            <input type="number" name="deposito" step="1000" />
          </label>
        </div>
        <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.5rem;">
          <button type="button" id="btn-ver-disponibilidad" class="btn btn-secundario btn-chico">📅 Ver disponibilidad</button>
        </div>

        <div class="form-grid" style="margin-top:0.75rem;">
          <label>Pago al check-in
            <select id="select-estado-pago" name="estado_pago_checkin" required>
              <option value="pendiente">Pendiente (sin pago todavía)</option>
              <option value="parcial">Parcial (abono)</option>
              <option value="anticipado">Anticipado (pago completo)</option>
            </select>
          </label>
          <label id="wrap-monto-pago-checkin" class="oculto">Monto a cobrar ahora
            <input type="number" name="monto_pago_checkin" id="input-monto-pago" step="1000" min="0" />
          </label>
        </div>

        <div id="resumen-liquidacion-wrap" style="margin-top:1.25rem;"></div>
      </div>

      <div class="tarjeta">
        <h3>Firma digital</h3>
        <canvas id="canvas-firma" width="500" height="150" style="border:1px solid var(--color-borde); border-radius:6px; width:100%; max-width:500px; touch-action:none; cursor:crosshair;"></canvas>
        <div class="acciones-tarjeta">
          <button type="button" id="btn-limpiar-firma" class="btn btn-secundario btn-chico">Limpiar firma</button>
        </div>
        <label style="display:flex; align-items:center; gap:0.5rem; margin-top:0.75rem; font-size:0.9rem;">
          <input type="checkbox" name="consentimiento_habeas_data" id="check-habeas" required style="width:auto;" />
          El huésped autoriza el tratamiento de sus datos personales conforme a la Ley 1581 de 2012 (Habeas Data).
        </label>
      </div>

      <div class="modal-acciones" style="margin-top:1rem;">
        <button type="button" id="btn-cancelar-checkin" class="btn btn-secundario">Cancelar</button>
        <button type="submit" class="btn btn-primario">Registrar Check-in</button>
      </div>
    </form>
  `;

  // --- Firma digital (canvas) ---
  const canvas = container.querySelector('#canvas-firma');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';
  let dibujando = false;

  function posicionRelativa(evento) {
    const rect = canvas.getBoundingClientRect();
    const punto = evento.touches ? evento.touches[0] : evento;
    return {
      x: ((punto.clientX - rect.left) / rect.width) * canvas.width,
      y: ((punto.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function empezarTrazo(e) {
    dibujando = true;
    const p = posicionRelativa(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  }
  function trazar(e) {
    if (!dibujando) return;
    const p = posicionRelativa(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  }
  function terminarTrazo() {
    dibujando = false;
  }

  canvas.addEventListener('mousedown', empezarTrazo);
  canvas.addEventListener('mousemove', trazar);
  window.addEventListener('mouseup', terminarTrazo);
  canvas.addEventListener('touchstart', empezarTrazo);
  canvas.addEventListener('touchmove', trazar);
  canvas.addEventListener('touchend', terminarTrazo);

  container.querySelector('#btn-limpiar-firma').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // --- Ver disponibilidad ---
  container.querySelector('#btn-ver-disponibilidad').addEventListener('click', () => {
    abrirModalDisponibilidad(container.querySelector('#select-habitacion'));
  });

  // --- Acompañantes: toggle + bloques dinámicos con datos completos ---
  const checkAcompanante = container.querySelector('#check-tiene-acompanante');
  const wrapAcompanantes = container.querySelector('#acompanantes-wrap');
  const listaAcompanantes = container.querySelector('#acompanantes-lista');
  let contadorAcompanantes = 0;

  function agregarBloqueAcompanante() {
    contadorAcompanantes += 1;
    const envoltorio = document.createElement('div');
    envoltorio.innerHTML = filaAcompanante(contadorAcompanantes);
    const bloque = envoltorio.firstElementChild;
    bloque.querySelector('.btn-quitar-acompanante').addEventListener('click', () => bloque.remove());
    wireAlertaMenorAcompanante(bloque);
    listaAcompanantes.appendChild(bloque);
  }

  checkAcompanante.addEventListener('change', () => {
    wrapAcompanantes.classList.toggle('oculto', !checkAcompanante.checked);
    if (checkAcompanante.checked && listaAcompanantes.children.length === 0) {
      agregarBloqueAcompanante();
    }
  });

  container.querySelector('#btn-agregar-acompanante').addEventListener('click', agregarBloqueAcompanante);

  // --- Autocompletar datos si el huésped ya existe en el sistema ---
  const inputNombreHuesped = container.querySelector('input[name="nombre"]');
  const inputDocumentoHuesped = container.querySelector('input[name="numero_documento"]');

  function precargarDatosHuesped(resultado) {
    if (!resultado) return;
    const d = resultado.datos;

    const setVal = (selector, valor) => {
      const el = container.querySelector(selector);
      if (el && valor !== undefined && valor !== null && valor !== '') el.value = valor;
    };

    setVal('input[name="nombre"]', d.nombre);
    if (d.tipo_documento) setVal('select[name="tipo_documento"]', d.tipo_documento);
    setVal('input[name="numero_documento"]', d.numero_documento);
    setVal('input[name="celular"]', d.celular || d.telefono);
    setVal('input[name="correo"]', d.correo);
    setVal('input[name="empresa"]', d.empresa);

    // Estos campos solo existen en un check-in anterior (la ficha básica
    // de huespedes solo guarda datos de contacto), así que solo se
    // rellenan cuando la coincidencia viene de recepcion_checkins.
    if (resultado.origen === 'checkin') {
      setVal('input[name="nacionalidad"]', d.nacionalidad);
      setVal('input[name="fecha_nacimiento"]', d.fecha_nacimiento);
      setVal('input[name="direccion"]', d.direccion);
      setVal('input[name="ciudad"]', d.ciudad);
      setVal('input[name="departamento"]', d.departamento);
      setVal('input[name="pais"]', d.pais);
      setVal('input[name="placa_vehiculo"]', d.placa_vehiculo);
    }

    mostrarToast(`Encontramos a ${d.nombre} en el sistema — se autocompletaron sus datos.`, 'exito');
  }

  inputDocumentoHuesped.addEventListener('blur', async () => {
    const valor = inputDocumentoHuesped.value.trim();
    if (!valor) return;
    const resultado = await buscarHuespedPorDocumento(valor);
    precargarDatosHuesped(resultado);
  });

  inputNombreHuesped.addEventListener('blur', async () => {
    if (inputDocumentoHuesped.value.trim()) return;
    const valor = inputNombreHuesped.value.trim();
    if (!valor) return;
    const resultado = await buscarHuespedPorNombre(valor);
    precargarDatosHuesped(resultado);
  });

  // --- Monto estimado de la estadía (noches × tarifa) + pago al check-in ---
  const selectTarifaEstadia = container.querySelector('#select-tarifa');
  const inputNochesEstadia = container.querySelector('#input-noches');
  const selectEstadoPago = container.querySelector('#select-estado-pago');
  const wrapMontoPago = container.querySelector('#wrap-monto-pago-checkin');
  const inputMontoPago = container.querySelector('#input-monto-pago');

  function calcularMontoEstimado() {
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifaEstadia.value));
    const noches = Number(inputNochesEstadia.value) || 0;
    if (!tarifa || noches <= 0) return 0;
    return noches * Number(tarifa.precio_temporada_baja);
  }

  // Arma la tarjeta-recibo con lo que la recepcionista lleva llenado hasta
  // ahora — se repinta completa cada vez que cambia algo relevante.
  function pintarResumenLiquidacion() {
    const wrap = container.querySelector('#resumen-liquidacion-wrap');
    if (!wrap) return;

    const habitacionSel = container.querySelector('#select-habitacion');
    const habitacionTexto = habitacionSel && habitacionSel.value ? habitacionSel.selectedOptions[0].textContent : 'Sin elegir';
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifaEstadia.value));
    const noches = Number(inputNochesEstadia.value) || 0;
    const montoEstimado = calcularMontoEstimado();
    const estadoPago = selectEstadoPago.value;
    const metodoPagoSel = container.querySelector('#select-metodo-pago-estadia');
    const metodoPago = metodoPagoSel ? metodoPagoSel.value : '—';
    const montoACobrar = estadoPago === 'parcial' || estadoPago === 'anticipado' ? Number(inputMontoPago.value) || 0 : 0;
    const saldo = Math.max(0, montoEstimado - montoACobrar);
    const info = ETIQUETA_ESTADO_PAGO[estadoPago] || ETIQUETA_ESTADO_PAGO.pendiente;

    wrap.innerHTML = `
      <div class="tarjeta" style="background:var(--color-fondo-suave, #f8f9fb); border:2px solid var(--color-borde, #ddd);">
        <h3 style="margin-top:0;">🧾 Resumen de la liquidación</h3>
        ${filaResumen('Habitación', habitacionTexto, { negrita: true })}
        ${filaResumen('Tarifa', tarifa ? tarifa.codigo : 'Sin elegir', {})}
        ${filaResumen('Cantidad de noches', noches || '—', {})}
        ${cajonMonto('Monto estimado estadía', formatCOP(montoEstimado), '#0b5fae', '#eaf3ff', '#8ec1f5')}
        <div style="margin-top:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
          <span style="font-size:0.82rem; color:var(--color-texto-suave, #666);">Pago al check-in</span>
          <span style="display:inline-block; padding:0.3rem 0.7rem; border-radius:999px; background:${info.fondo}; color:${info.color}; font-weight:700; font-size:0.8rem; border:1px solid ${info.borde};">${info.texto}</span>
        </div>
        ${filaResumen('Método de pago', metodoPago, {})}
        ${cajonMonto('Monto a cobrar ahora', formatCOP(montoACobrar), 'var(--color-verde-oscuro, #1b7a3d)', '#eafbea', '#8fd3a4')}
        ${cajonMonto(
          'Saldo pendiente después de este pago',
          formatCOP(saldo),
          saldo > 0 ? 'var(--color-rojo-oscuro, #b3261e)' : 'var(--color-verde-oscuro, #1b7a3d)',
          saldo > 0 ? '#fdeceb' : '#eafbea',
          saldo > 0 ? '#f0a8a0' : '#8fd3a4'
        )}
      </div>
    `;
  }

  function actualizarHintMonto() {
    const estimado = calcularMontoEstimado();
    if (selectEstadoPago.value === 'anticipado') {
      inputMontoPago.value = estimado;
    }
    pintarResumenLiquidacion();
  }

  function actualizarVisibilidadPago() {
    const estado = selectEstadoPago.value;
    const mostrar = estado === 'parcial' || estado === 'anticipado';
    wrapMontoPago.classList.toggle('oculto', !mostrar);
    inputMontoPago.required = mostrar;
    if (estado === 'anticipado') {
      inputMontoPago.value = calcularMontoEstimado();
    } else if (estado === 'pendiente') {
      inputMontoPago.value = '';
    }
    pintarResumenLiquidacion();
  }

  selectTarifaEstadia.addEventListener('change', actualizarHintMonto);
  inputNochesEstadia.addEventListener('input', actualizarHintMonto);
  selectEstadoPago.addEventListener('change', actualizarVisibilidadPago);
  inputMontoPago.addEventListener('input', pintarResumenLiquidacion);
  container.querySelector('#select-habitacion').addEventListener('change', pintarResumenLiquidacion);
  const selectMetodoPagoEstadia = container.querySelector('#select-metodo-pago-estadia');
  if (selectMetodoPagoEstadia) selectMetodoPagoEstadia.addEventListener('change', pintarResumenLiquidacion);

  // --- Vincular reserva: precarga campos (compartido entre el selector
  // manual y la preselección que llega desde "Llegadas de hoy") ---
  function aplicarReserva(reserva) {
    if (!reserva) return;
    container.querySelector('input[name="nombre"]').value = reserva.huesped_nombre || '';
    container.querySelector('input[name="numero_documento"]').value = reserva.huesped_documento || '';
    container.querySelector('input[name="celular"]').value = reserva.huesped_telefono || '';
    container.querySelector('#select-habitacion').value = reserva.habitacion_id;
    if (reserva.tarifa_id) container.querySelector('#select-tarifa').value = reserva.tarifa_id;

    const noches = Math.round((new Date(reserva.fecha_checkout) - new Date(reserva.fecha_checkin)) / 86400000);
    container.querySelector('#input-noches').value = noches > 0 ? noches : '';
    actualizarHintMonto();
  }

  container.querySelector('#select-reserva').addEventListener('change', (e) => {
    const reservaId = e.target.value;
    if (!reservaId) return;
    aplicarReserva((reservas || []).find((r) => String(r.id) === reservaId));
  });

  if (reservaIdPreseleccionada) {
    const selectReserva = container.querySelector('#select-reserva');
    selectReserva.value = String(reservaIdPreseleccionada);
    aplicarReserva((reservas || []).find((r) => r.id === reservaIdPreseleccionada));
  }

  actualizarHintMonto();

  container.querySelector('#btn-cancelar-checkin').addEventListener('click', () => vistaLista(container));

  container.querySelector('#form-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!container.querySelector('#check-habeas').checked) {
      mostrarToast('Debes marcar el consentimiento de Habeas Data para continuar.', 'error');
      return;
    }

    const form = new FormData(e.target);
    const reservaIdSeleccionada = container.querySelector('#select-reserva').value || null;
    const hayFirma = ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v !== 0);

    const habitacionId = Number(form.get('habitacion_id'));

    // Verificación de último momento contra la base de datos: aunque el
    // desplegable ya deshabilita las habitaciones que no están
    // "disponible", el estado pudo cambiar mientras se llenaba el
    // formulario (por ejemplo, Housekeeping la marcó ocupada o en
    // mantenimiento justo ahora). Sin este chequeo, un check-in podía
    // colarse en una habitación bloqueada — Recepción y Housekeeping
    // quedaban desincronizados.
    const { data: habitacionActual, error: errHabActual } = await supabase
      .from('habitaciones')
      .select('estado, numero, nombre')
      .eq('id', habitacionId)
      .single();

    if (errHabActual) {
      mostrarToast(`No se pudo confirmar el estado de la habitación: ${errHabActual.message}`, 'error');
      return;
    }

    if (habitacionActual.estado !== 'disponible') {
      mostrarToast(
        `${habitacionActual.numero} — ${habitacionActual.nombre} ya no está disponible (${ETIQUETA_ESTADO_HABITACION[habitacionActual.estado] || habitacionActual.estado}). Elige otra habitación o corrige su estado desde Housekeeping antes de continuar.`,
        'error'
      );
      return;
    }

    const tarifaId = form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null;
    const cantidadNoches = form.get('cantidad_noches') ? Number(form.get('cantidad_noches')) : 1;
    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;
    const estadoPagoCheckin = form.get('estado_pago_checkin');
    const montoPagoCheckin = form.get('monto_pago_checkin') ? Number(form.get('monto_pago_checkin')) : 0;

    // --- Acompañantes: recolectar los bloques (si el checkbox está
    // marcado) y descartar cualquier bloque que haya quedado sin nombre. ---
    let acompanantesDetalle = null;
    if (checkAcompanante.checked) {
      const bloques = Array.from(listaAcompanantes.querySelectorAll('.bloque-acompanante'));
      acompanantesDetalle = bloques
        .map((bloque) => ({
          nombre: bloque.querySelector('[name="acomp_nombre"]').value.trim(),
          tipo_documento: bloque.querySelector('[name="acomp_tipo_documento"]').value,
          numero_documento: bloque.querySelector('[name="acomp_numero_documento"]').value.trim() || null,
          nacionalidad: bloque.querySelector('[name="acomp_nacionalidad"]').value.trim() || null,
          fecha_nacimiento: bloque.querySelector('[name="acomp_fecha_nacimiento"]').value || null,
          celular: bloque.querySelector('[name="acomp_celular"]').value.trim() || null,
          verificado_menor: bloque.querySelector('.check-verificacion-menor')?.checked || false,
        }))
        .filter((a) => a.nombre);
      if (acompanantesDetalle.length === 0) acompanantesDetalle = null;
    }

    // --- Vincular o crear la reserva asociada ---
    let reservaIdFinal = null;

    if (reservaIdSeleccionada) {
      reservaIdFinal = Number(reservaIdSeleccionada);
      const { error: errReservaUpd } = await supabase
        .from('reservas')
        .update({ estado: 'hospedado' })
        .eq('id', reservaIdFinal);
      if (errReservaUpd) {
        mostrarToast(`No se pudo actualizar la reserva vinculada: ${errReservaUpd.message}`, 'error');
      }
    } else {
      const hoyISO = toISODate(new Date());
      const { data: nuevaReserva, error: errReservaNueva } = await supabase
        .from('reservas')
        .insert({
          habitacion_id: habitacionId,
          huesped_nombre: nombre,
          huesped_telefono: celular,
          huesped_documento: documento,
          fecha_checkin: hoyISO,
          fecha_checkout: toISODate(addDays(hoyISO, cantidadNoches > 0 ? cantidadNoches : 1)),
          estado: 'hospedado',
          tarifa_id: tarifaId,
          comentarios: 'Creada automáticamente desde Recepción (walk-in).',
        })
        .select('id')
        .single();

      if (errReservaNueva) {
        mostrarToast(`Check-in continuará, pero no se pudo crear la reserva asociada: ${errReservaNueva.message}`, 'error');
      } else {
        reservaIdFinal = nuevaReserva.id;
      }
    }

    // --- Pago al check-in: si hay monto, se inserta en reservas_pagos
    // (misma tabla que lee Caja automático) — no hay campo suelto. ---
    if ((estadoPagoCheckin === 'parcial' || estadoPagoCheckin === 'anticipado') && montoPagoCheckin > 0) {
      if (!reservaIdFinal) {
        mostrarToast('No hay una reserva vinculada; no se pudo registrar el pago en Caja.', 'error');
      } else {
        const { error: errPagoInicial } = await supabase.from('reservas_pagos').insert({
          reserva_id: reservaIdFinal,
          monto: montoPagoCheckin,
          metodo_pago: form.get('metodo_pago'),
          comentarios: estadoPagoCheckin === 'anticipado' ? 'Pago anticipado registrado en el check-in.' : 'Abono parcial registrado en el check-in.',
        });
        if (errPagoInicial) {
          mostrarToast(`Check-in continuará, pero no se pudo registrar el pago en Caja: ${errPagoInicial.message}`, 'error');
        }
      }
    }

    // --- Ficha de huésped (histórico) ---
    // Guarda o actualiza los datos de contacto en `huespedes` (por
    // numero_documento) sin pisar preferencias/alergias/observaciones si
    // ya existían — eso se edita solo desde el módulo Huéspedes.
    const { error: errHuesped } = await supabase.from('huespedes').upsert(
      {
        numero_documento: documento,
        tipo_documento: form.get('tipo_documento'),
        nombre,
        telefono: celular,
        correo: form.get('correo').trim() || null,
        empresa: form.get('empresa').trim() || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (errHuesped) {
      mostrarToast(`Check-in guardado, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
    }

    // --- Acompañantes con documento también quedan en el listado general
    // de huespedes, igual que el huésped principal. ---
    await alimentarHuespedesConAcompanantes(acompanantesDetalle);

    const payload = {
      reserva_id: reservaIdFinal,
      habitacion_id: habitacionId,
      nombre,
      tipo_documento: form.get('tipo_documento'),
      numero_documento: documento,
      nacionalidad: form.get('nacionalidad').trim() || null,
      fecha_nacimiento: form.get('fecha_nacimiento') || null,
      direccion: form.get('direccion').trim() || null,
      ciudad: form.get('ciudad').trim() || null,
      departamento: form.get('departamento').trim() || null,
      pais: form.get('pais').trim() || null,
      correo: form.get('correo').trim() || null,
      celular,
      empresa: form.get('empresa').trim() || null,
      placa_vehiculo: form.get('placa_vehiculo').trim() || null,
      acompanantes_detalle: acompanantesDetalle,
      foto_documento_url: form.get('foto_documento_url').trim() || null,
      firma_digital: hayFirma ? canvas.toDataURL('image/png') : null,
      consentimiento_habeas_data: true,
      observaciones: form.get('observaciones').trim() || null,
      tarifa_id: tarifaId,
      cantidad_noches: cantidadNoches,
      metodo_pago: form.get('metodo_pago'),
      deposito: form.get('deposito') ? Number(form.get('deposito')) : null,
    };

    const { error: errInsert } = await supabase.from('recepcion_checkins').insert(payload);
    if (errInsert) {
      mostrarToast(`Error registrando check-in: ${errInsert.message}`, 'error');
      return;
    }

    const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
      p_habitacion_id: habitacionId,
      p_estado: 'ocupada',
    });
    if (errEstado) {
      mostrarToast(`Check-in guardado, pero no se pudo marcar la habitación como ocupada: ${errEstado.message}`, 'error');
    }

    mostrarToast('Check-in registrado.', 'exito');
    await vistaLista(container);
  });
}

registerModule({
  id: 'recepcion',
  label: 'Recepción',
  icono: '🛎',
  roles: ['propietario', 'administrador', 'recepcionista'],
  render,
});
