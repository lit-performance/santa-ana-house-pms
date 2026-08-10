// caja.js
//
// Módulo: "Registro diario de ventas" (antes "Caja", el id interno y el
// nombre del archivo se quedan igual para no romper nada). Apertura y
// cierre de turno de caja con arqueo, registro de movimientos manuales
// (ingresos/egresos) y ventas por mostrador del turno abierto, saldos por
// cuenta (medio de pago) acumulados de todo el tiempo, transferencias
// entre cuentas, y exportables (Excel/PDF) para auditoría del propietario.
//
// Pensada para ser LA pestaña de mayor uso del día (junto con Recepción):
// arriba de todo va el pulso del día (resumen de ventas + estado de caja),
// luego lo que falta por cobrar (huéspedes alojados), luego el turno en
// curso con las ventas de mostrador — clientes que compran algo del
// inventario sin hospedarse, no vale la pena crearles ficha de huésped —
// y al final lo que se consulta con menos frecuencia (saldos por cuenta,
// minibar informativo, historial de cierres).
//
// Se investigó cómo lo resuelven otros PMS de hotel (night audit / entrega
// de turno entre recepcionistas) para que esta pantalla sea coherente con
// esa práctica:
//   - El arqueo de un turno solo pide contar EFECTIVO físico (los demás
//     medios son electrónicos, su saldo ya lo dice el sistema).
//   - El conteo se hace por denominación (billetes + monedas), no un solo
//     número — es el error más común en cierres de caja mal hechos.
//   - Si el conteo no cuadra con lo esperado, hay que explicar por qué
//     (campo obligatorio en ese caso).
//   - La base inicial de un turno nuevo se sugiere sola con lo que quedó
//     contado en el cierre anterior (continuidad entre turnos).
//   - Queda registrado (con nombre, no solo un ID interno) quién abrió y
//     quién cerró cada turno — es la bitácora de entrega de turno.
//   - Todo cierre se puede descargar (Excel/PDF) con el detalle completo,
//     no solo los totales, para que el propietario audite sin tener que
//     pedir explicaciones.
//
// Los abonos de reservas (reservas_pagos, ya registrados desde Reservas y
// Recepción, incluyendo los pagos de liquidación al check-out) NO se
// duplican aquí — este módulo los LEE directamente de esa tabla y los
// muestra como "ingresos automáticos". caja_movimientos solo guarda lo que
// no nace de una reserva (gastos operativos, propinas, ingresos varios).
//
// Medios de pago: cada método (Efectivo, Nequi, Daviplata, QR,
// Transferencia Bancaria, Datáfono, Llave — ver METODOS_PAGO) se consolida
// como si fuera una cuenta aparte.
//
//   - "Desglose por medio de pago" (dentro de un turno abierto) es del
//     TURNO actual: cuánto entró/salió por cada medio desde que se abrió.
//   - "Saldos por cuenta" (siempre visible, con o sin turno abierto) es de
//     TODO el tiempo: el saldo acumulado histórico de cada medio, sumando
//     reservas_pagos + caja_movimientos + caja_transferencias — ver
//     `calcularSaldosPorCuenta`. Es lo que permite, por ejemplo, ver que
//     Nequi acumuló $800.000 sin retirar y transferirlos (registrar el
//     movimiento) hacia Efectivo o hacia la cuenta bancaria del negocio.
//
// Transferencias entre cuentas (caja_transferencias, ver
// 041_caja_transferencias.sql): mueven saldo de una cuenta a otra sin que
// cuente como ingreso/egreso real del negocio (por eso no viven en
// caja_movimientos). Son independientes del turno de caja — excepto que,
// si una transferencia involucra Efectivo y ocurre mientras hay un turno
// abierto, sí se sube/baja el "esperado en efectivo" de ese turno (ver
// `saldoEsperadoEfectivo` en pintarTurnoAbierto), porque eso sí cambia lo
// que debería contarse físicamente en el cajón.
//
// Regla de negocio: solo puede haber UN turno de caja abierto a la vez
// (impuesto por un índice único parcial en la base de datos).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora, toISODate, addDays } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { calcularHabitacionesEnUso } from './cuentas.js';

const ROLES_OPERAN_CAJA = ['propietario', 'administrador', 'recepcionista'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];
const DENOMINACIONES_BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];

function puedeOperar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_OPERAN_CAJA.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// --- Resolver nombres reales a partir de IDs de usuario (para mostrar
// quién abrió/cerró un turno o registró algo, en vez de un uuid interno) ---
async function obtenerNombresUsuarios(ids) {
  const idsUnicos = [...new Set((ids || []).filter(Boolean))];
  if (idsUnicos.length === 0) return new Map();
  const { data } = await supabase.from('usuarios').select('id, nombre').in('id', idsUnicos);
  return new Map((data || []).map((u) => [u.id, u.nombre]));
}

// Suma ingresos/egresos por método de pago DENTRO DE UN TURNO, combinando
// reservas_pagos (siempre ingreso) y caja_movimientos (ingreso o egreso).
// Devuelve un objeto { [metodo]: { ingresos, egresos } } con TODOS los
// métodos de METODOS_PAGO presentes (aunque estén en cero), más una clave
// extra por si algún registro viejo trae un método que ya no está en la
// lista.
function calcularDesglosePorMetodo(pagos, movimientos, ventasMostrador) {
  const desglose = {};
  METODOS_PAGO.forEach((m) => {
    desglose[m] = { ingresos: 0, egresos: 0 };
  });

  const bucket = (metodo) => {
    if (!desglose[metodo]) desglose[metodo] = { ingresos: 0, egresos: 0 };
    return desglose[metodo];
  };

  (pagos || []).forEach((p) => {
    bucket(p.metodo_pago || 'Efectivo').ingresos += Number(p.monto);
  });

  (ventasMostrador || []).forEach((v) => {
    bucket(v.metodo_pago || 'Efectivo').ingresos += Number(v.monto);
  });

  (movimientos || []).forEach((m) => {
    const b = bucket(m.metodo_pago || 'Efectivo');
    if (m.tipo === 'ingreso') b.ingresos += Number(m.monto);
    else b.egresos += Number(m.monto);
  });

  return desglose;
}

// --- Saldos por cuenta: acumulado de TODO el tiempo, no solo el turno
// abierto — reservas_pagos + caja_movimientos + caja_transferencias. ---
export async function calcularSaldosPorCuenta() {
  const [
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: transferencias, error: errTrans },
    { data: ventasMostrador, error: errVentas },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('monto, metodo_pago'),
    supabase.from('caja_movimientos').select('monto, metodo_pago, tipo'),
    supabase.from('caja_transferencias').select('monto, cuenta_origen, cuenta_destino'),
    supabase.from('ventas_mostrador').select('monto, metodo_pago'),
  ]);

  if (errPagos) throw errPagos;
  if (errMov) throw errMov;
  if (errTrans) throw errTrans;
  if (errVentas) throw errVentas;

  const saldos = {};
  METODOS_PAGO.forEach((m) => {
    saldos[m] = 0;
  });
  const bucket = (m) => {
    if (!(m in saldos)) saldos[m] = 0;
    return m;
  };

  (pagos || []).forEach((p) => {
    const m = bucket(p.metodo_pago || 'Efectivo');
    saldos[m] += Number(p.monto);
  });

  (ventasMostrador || []).forEach((v) => {
    const m = bucket(v.metodo_pago || 'Efectivo');
    saldos[m] += Number(v.monto);
  });

  (movimientos || []).forEach((mv) => {
    const m = bucket(mv.metodo_pago || 'Efectivo');
    saldos[m] += mv.tipo === 'ingreso' ? Number(mv.monto) : -Number(mv.monto);
  });

  (transferencias || []).forEach((t) => {
    const origen = bucket(t.cuenta_origen);
    const destino = bucket(t.cuenta_destino);
    saldos[origen] -= Number(t.monto);
    saldos[destino] += Number(t.monto);
  });

  return saldos;
}

// =========================================================
// Exportables genéricos (Excel/PDF) — mismo mecanismo seguro ya usado en
// el resumen de checkout: CSV con BOM (Excel lo abre con doble clic) y
// vista de impresión del navegador para "Guardar como PDF". Cero
// librerías externas nuevas.
// =========================================================
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

function abrirVistaImpresion(titulo, subtitulo, cuerpoHTML) {
  const ventana = window.open('', '_blank');
  if (!ventana) {
    mostrarToast('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e inténtalo de nuevo.', 'error');
    return;
  }
  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>${escaparHTML(titulo)}</title>
      <style>
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; padding: 2rem; color: #222; }
        h1 { font-size: 1.3rem; margin-bottom: 0.1rem; }
        h2 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
        .sub { color: #666; margin-top: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.3rem; }
        th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
        th { background: #f4f4f6; }
        @media print { body { padding: 0.5rem; } }
      </style>
    </head>
    <body>
      <h1>${escaparHTML(titulo)}</h1>
      <p class="sub">${escaparHTML(subtitulo)}</p>
      ${cuerpoHTML}
    </body>
    </html>
  `);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

function filaTablaSimple(cols) {
  return `<tr>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

// =========================================================
async function render(container) {
  // Orden pensado para ser la pestaña de más uso del día: primero el
  // pulso del día (cuánto se ha vendido, cuánto hay en caja), luego lo
  // que queda pendiente por cobrar (huéspedes alojados), luego el turno
  // en curso (ventas de mostrador + arqueo + cierre), y al final lo que
  // se consulta con menos frecuencia (saldos por cuenta, minibar
  // informativo, historial de cierres).
  container.innerHTML = `
    <h2>Registro diario de ventas</h2>
    <div id="resumen-dia-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="habitaciones-uso-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="caja-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="saldos-cuenta-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="minibar-hoy-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([
    cargarResumenDelDia(container.querySelector('#resumen-dia-wrap')),
    cargarHabitacionesEnUso(container.querySelector('#habitaciones-uso-wrap')),
    cargarSaldosPorCuenta(container, container.querySelector('#saldos-cuenta-wrap')),
    cargarResumenMinibarHoy(container.querySelector('#minibar-hoy-wrap')),
    cargarEstado(container),
  ]);
}

// =========================================================
// Resumen del día — el pulso del negocio hoy, independiente de si el
// turno de caja está abierto o cerrado: cuánto se ha vendido en total (
// reservas liquidadas + ventas de mostrador + ingresos manuales) y cuánto
// efectivo hay en este momento.
// =========================================================
async function cargarResumenDelDia(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando el resumen del día…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const [
    { data: pagosHoy, error: errPagos },
    { data: movimientosHoy, error: errMov },
    { data: ventasHoy, error: errVentas },
    { data: turnoAbierto, error: errTurno },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('monto').gte('fecha', hoyISO).lt('fecha', mananaISO),
    supabase.from('caja_movimientos').select('monto, tipo').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
    supabase.from('ventas_mostrador').select('monto').gte('creado_en', hoyISO).lt('creado_en', mananaISO),
    supabase.from('caja_turnos').select('id, abierto_en, saldo_inicial').eq('estado', 'abierta').limit(1).maybeSingle(),
  ]);

  const error = errPagos || errMov || errVentas || errTurno;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando el resumen del día: ${error.message}</p>`;
    return;
  }

  const ventasReservasHoy = (pagosHoy || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ventasManualesHoy = (movimientosHoy || []).filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const ventasMostradorHoy = (ventasHoy || []).reduce((sum, v) => sum + Number(v.monto), 0);
  const egresosHoy = (movimientosHoy || []).filter((m) => m.tipo === 'egreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const totalVentasHoy = ventasReservasHoy + ventasManualesHoy + ventasMostradorHoy;

  elemento.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">💵 Ventas de hoy</div>
        <div class="stat-card-valor">${formatCOP(totalVentasHoy)}</div>
        <div class="stat-card-subtitulo">Estadías: ${formatCOP(ventasReservasHoy)} · Mostrador: ${formatCOP(ventasMostradorHoy)} · Otras: ${formatCOP(ventasManualesHoy)}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">↘️ Egresos de hoy</div>
        <div class="stat-card-valor">${formatCOP(egresosHoy)}</div>
        <div class="stat-card-subtitulo">Gastos y salidas manuales registradas hoy</div>
      </div>
      <div class="stat-card ${turnoAbierto ? 'stat-card-azul' : 'stat-card-naranja'}">
        <div class="stat-card-label">🗝 Estado de la caja</div>
        <div class="stat-card-valor" style="font-size:1.3rem;">${turnoAbierto ? 'Abierta' : 'Cerrada'}</div>
        <div class="stat-card-subtitulo">${turnoAbierto ? `Desde ${formatFechaHora(turnoAbierto.abierto_en)}` : 'Ábrela para empezar a vender'}</div>
      </div>
    </div>
    <p class="mensaje-vacio" style="margin-top:0.6rem;">Este resumen es del día calendario de hoy (no del turno) — para el detalle exacto del turno en curso, revisa "Desglose por medio de pago" más abajo.</p>
  `;
}

// =========================================================
// Saldos por cuenta + transferencias
// =========================================================
async function cargarSaldosPorCuenta(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando saldos por cuenta…</p>';

  let saldos;
  try {
    saldos = await calcularSaldosPorCuenta();
  } catch (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando saldos por cuenta: ${error.message}</p>`;
    return;
  }

  const total = METODOS_PAGO.reduce((sum, m) => sum + (saldos[m] || 0), 0);
  const permitido = puedeOperar();

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.75rem; flex-wrap:wrap;">
        <h3 style="margin:0;">💼 Saldos por cuenta <span class="mensaje-vacio" style="font-weight:400;">(acumulado histórico)</span></h3>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${permitido ? '<button type="button" id="btn-transferir-cuentas" class="btn btn-secundario btn-chico">🔁 Transferir entre cuentas</button>' : ''}
          <button type="button" id="btn-exportar-csv-saldos" class="btn btn-secundario btn-chico">⬇ Excel</button>
          <button type="button" id="btn-exportar-pdf-saldos" class="btn btn-secundario btn-chico">⬇ PDF</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Cuenta</th><th>Saldo acumulado</th></tr></thead>
          <tbody>
            ${METODOS_PAGO.map(
              (m) => `<tr><td>${m}${m === 'Efectivo' ? ' 💵' : ''}</td><td class="monto" style="font-weight:600;">${formatCOP(saldos[m] || 0)}</td></tr>`
            ).join('')}
            <tr style="font-weight:700;"><td>Total</td><td class="monto">${formatCOP(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.6rem;">Es el saldo acumulado de siempre por cada medio de pago (no se reinicia con cada turno). Usa "Transferir entre cuentas" para mover saldo de un medio a otro — por ejemplo, consolidar lo acumulado en Nequi hacia Efectivo o hacia una cuenta bancaria.</p>
    </div>
  `;

  if (permitido) {
    elemento.querySelector('#btn-transferir-cuentas').addEventListener('click', () => abrirModalTransferencia(container, saldos));
  }

  elemento.querySelector('#btn-exportar-csv-saldos').addEventListener('click', () => {
    const filas = [
      ['Saldos por cuenta — Santa Ana House 21'],
      ['Generado', formatFechaHora(new Date().toISOString())],
      [],
      ['Cuenta', 'Saldo acumulado'],
      ...METODOS_PAGO.map((m) => [m, saldos[m] || 0]),
      ['Total', total],
    ];
    descargarCSV('saldos-por-cuenta.csv', filas);
  });

  elemento.querySelector('#btn-exportar-pdf-saldos').addEventListener('click', () => {
    const cuerpo = `
      <table>
        <thead><tr><th>Cuenta</th><th>Saldo acumulado</th></tr></thead>
        <tbody>
          ${METODOS_PAGO.map((m) => filaTablaSimple([m, formatCOP(saldos[m] || 0)])).join('')}
          <tr style="font-weight:700;">${filaTablaSimple(['Total', formatCOP(total)])}</tr>
        </tbody>
      </table>
    `;
    abrirVistaImpresion('Saldos por cuenta — Santa Ana House 21', `Generado ${formatFechaHora(new Date().toISOString())}`, cuerpo);
  });
}

async function abrirModalTransferencia(container, saldosActuales) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>🔁 Transferir entre cuentas</h3>
      <form id="form-transferencia">
        <div class="modal-contenido">
          <p class="mensaje-vacio">Mueve saldo de una cuenta a otra — no cuenta como ingreso ni egreso del negocio, solo reubica dónde está la plata.</p>
          <div class="form-grid">
            <label>Desde
              <select name="cuenta_origen" required>
                ${METODOS_PAGO.map((m) => `<option value="${m}">${m} — ${formatCOP(saldosActuales[m] || 0)}</option>`).join('')}
              </select>
            </label>
            <label>Hacia
              <select name="cuenta_destino" required>
                ${METODOS_PAGO.map((m, idx) => `<option value="${m}" ${idx === 1 ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </label>
            <label>Monto
              <input type="number" name="monto" step="1000" min="1" required />
            </label>
          </div>
          <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
            Motivo (opcional)
            <input type="text" name="motivo" placeholder="Ej: consignación a la cuenta bancaria del negocio" style="text-transform:none; padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;" />
          </label>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-transferencia">Cancelar</button>
          <button type="submit" class="btn btn-primario">Transferir</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-transferencia').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-transferencia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const cuentaOrigen = form.get('cuenta_origen');
    const cuentaDestino = form.get('cuenta_destino');
    const monto = Number(form.get('monto'));

    if (cuentaOrigen === cuentaDestino) {
      mostrarToast('La cuenta de origen y destino no pueden ser la misma.', 'error');
      return;
    }

    const saldoOrigen = saldosActuales[cuentaOrigen] || 0;
    if (monto > saldoOrigen) {
      const ok = await mostrarConfirmacion({
        titulo: 'Saldo insuficiente en la cuenta de origen',
        contenidoHTML: `<strong>${escaparHTML(cuentaOrigen)}</strong> tiene un saldo acumulado de <strong>${formatCOP(saldoOrigen)}</strong>, menor al monto a transferir (<strong>${formatCOP(monto)}</strong>). Esto dejaría esa cuenta en negativo. ¿Transferir de todas formas?`,
        textoConfirmar: 'Sí, transferir de todas formas',
      });
      if (!ok) return;
    }

    const usuario = getUsuarioActual();
    const { error } = await supabase.from('caja_transferencias').insert({
      cuenta_origen: cuentaOrigen,
      cuenta_destino: cuentaDestino,
      monto,
      motivo: form.get('motivo').trim() || null,
      registrado_por: usuario?.id || null,
    });

    if (error) {
      mostrarToast(`Error registrando la transferencia: ${error.message}`, 'error');
      return;
    }

    mostrarToast(`Transferidos ${formatCOP(monto)} de ${cuentaOrigen} a ${cuentaDestino}.`, 'exito');
    overlay.remove();
    await cargarSaldosPorCuenta(container, container.querySelector('#saldos-cuenta-wrap'));
    await cargarEstado(container);
  });
}

// =========================================================
// Consumo de minibar del día calendario de hoy (no del turno de caja — el
// turno puede abrirse/cerrarse en cualquier momento, pero "cuánto se
// consumió hoy" siempre se refiere al día calendario, igual que Recepción).
// Es un valor INFORMATIVO de movimiento de inventario: no se suma aparte
// al desglose por método de pago porque ese dinero ya entra ahí solo, en
// el momento en que el huésped liquida el minibar al hacer check-out (ver
// recepcion.js). Este bloque es visible siempre, con caja abierta o
// cerrada, porque el consumo de minibar no depende del turno.
// =========================================================
async function cargarResumenMinibarHoy(elemento) {
  if (!elemento) return;
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando consumo de minibar…</p>';

  const hoyISO = toISODate(new Date());
  const mananaISO = toISODate(addDays(new Date(), 1));

  const { data: consumos, error } = await supabase
    .from('minibar_consumos')
    .select('cantidad, monto, creado_en, minibar_productos(nombre)')
    .gte('creado_en', hoyISO)
    .lt('creado_en', mananaISO)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando consumo de minibar: ${error.message}</p>`;
    return;
  }

  const totalMonto = (consumos || []).reduce((sum, c) => sum + Number(c.monto), 0);
  const totalItems = (consumos || []).reduce((sum, c) => sum + Number(c.cantidad), 0);

  const porProducto = new Map();
  (consumos || []).forEach((c) => {
    const nombre = c.minibar_productos ? c.minibar_productos.nombre : 'Producto eliminado';
    const actual = porProducto.get(nombre) || { cantidad: 0, monto: 0 };
    actual.cantidad += Number(c.cantidad);
    actual.monto += Number(c.monto);
    porProducto.set(nombre, actual);
  });

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">🥤 Consumo de minibar — hoy</h3>
        <strong style="font-size:1.2rem;">${formatCOP(totalMonto)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.5rem;">${totalItems} producto(s) consumido(s) hoy — movimiento de inventario. El cobro real ya queda incluido en "Ingresos por reservas" en cuanto el huésped liquida el minibar al hacer check-out.</p>
      ${
        porProducto.size === 0
          ? '<p class="mensaje-vacio">Sin consumo de minibar hoy.</p>'
          : `
        <table class="tabla-simple">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th></tr></thead>
          <tbody>
            ${Array.from(porProducto.entries())
              .sort((a, b) => b[1].monto - a[1].monto)
              .map(([nombre, d]) => `<tr><td>${escaparHTML(nombre)}</td><td>${d.cantidad}</td><td>${formatCOP(d.monto)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      `
      }
    </div>
  `;
}

async function cargarHabitacionesEnUso(elemento) {
  if (!elemento) return;
  elemento.innerHTML = `<p class="mensaje-vacio">Cargando habitaciones en uso…</p>`;

  let items = [];
  try {
    items = await calcularHabitacionesEnUso();
  } catch (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando habitaciones en uso: ${error.message}</p>`;
    return;
  }

  const conSaldo = items.filter((i) => i.saldoPendiente > 0).length;

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.75rem;">
        <h3 style="margin:0;">🧳 Huéspedes alojados ${items.length ? `(${items.length})` : ''}</h3>
        <button type="button" id="btn-refrescar-habitaciones-uso" class="btn btn-secundario btn-chico">🔄 Actualizar</button>
      </div>
      ${
        conSaldo > 0
          ? `<p class="mensaje-vacio" style="color:var(--color-rojo-oscuro); font-weight:600;">${conSaldo} habitación(es) con saldo pendiente por liquidar.</p>`
          : ''
      }
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Habitación</th><th>Huésped</th><th>Ingreso</th><th>Monto total</th><th>Abonado</th><th>Saldo pendiente</th></tr></thead>
          <tbody>
            ${
              items
                .map(
                  (i) => `<tr>
                    <td>${escaparHTML(i.habitacionLabel)}</td>
                    <td>${escaparHTML(i.huespedNombre)}</td>
                    <td>${formatFechaHora(i.horaIngreso)}</td>
                    <td>${formatCOP(i.montoTotal)}</td>
                    <td>${formatCOP(i.totalAbonado)}</td>
                    <td style="color:${i.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">${formatCOP(i.saldoPendiente)}</td>
                  </tr>`
                )
                .join('') || '<tr><td colspan="6" class="mensaje-vacio">No hay habitaciones ocupadas ahora mismo.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.75rem;">El saldo se liquida desde Recepción al hacer check-out.</p>
    </div>
  `;

  elemento.querySelector('#btn-refrescar-habitaciones-uso').addEventListener('click', () => cargarHabitacionesEnUso(elemento));
}

async function cargarEstado(container) {
  const wrap = container.querySelector('#caja-wrap');

  const { data: turno, error } = await supabase
    .from('caja_turnos')
    .select('*')
    .eq('estado', 'abierta')
    .order('abierto_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando caja: ${error.message}</p>`;
    return;
  }

  if (!turno) {
    await pintarSinTurno(container, wrap);
  } else {
    await pintarTurnoAbierto(container, wrap, turno);
  }
}

async function pintarSinTurno(container, wrap) {
  const permitido = puedeOperar();

  // Continuidad entre turnos: se sugiere la base inicial con lo que quedó
  // contado en el cierre anterior, para no digitarlo a mano cada vez ni
  // arrancar un turno nuevo con un número que no coincide con lo que de
  // verdad hay en la caja/caja fuerte.
  const { data: ultimoCierre } = await supabase
    .from('caja_turnos')
    .select('saldo_contado, cerrado_en')
    .eq('estado', 'cerrada')
    .order('cerrado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseSugerida = ultimoCierre ? Number(ultimoCierre.saldo_contado) : null;

  wrap.innerHTML = `
    <div class="tarjeta">
      <h3>No hay una caja abierta</h3>
      <p class="mensaje-vacio">Abre la caja al iniciar el turno para empezar a registrar ingresos, egresos y ventas por mostrador.</p>
      ${
        permitido
          ? `
        <form id="form-abrir-caja" class="form-grid" style="margin-top:1rem;">
          <label>Base inicial (efectivo)
            <input type="number" name="saldo_inicial" step="1000" min="0" required value="${baseSugerida !== null ? baseSugerida : ''}" />
          </label>
          <label>Observaciones
            <input type="text" name="observaciones_apertura" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-primario">Abrir caja</button>
        </form>
        <p class="mensaje-vacio" style="margin-top:0.5rem; font-size:0.78rem;">
          ${
            baseSugerida !== null
              ? `Sugerido: lo que quedó contado en el último cierre (${formatCOP(baseSugerida)}, ${formatFechaHora(ultimoCierre.cerrado_en)}). Ajústalo si el conteo físico de hoy es distinto.`
              : 'No hay cierres anteriores todavía — digita el efectivo real que hay en caja para empezar.'
          }
        </p>
      `
          : `<p class="mensaje-vacio">Tu rol no tiene permiso para abrir caja.</p>`
      }
    </div>
    <div id="historial-cierres-wrap" style="margin-top:1.5rem;"></div>
  `;

  if (permitido) {
    wrap.querySelector('#form-abrir-caja').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const usuario = getUsuarioActual();
      const { error } = await supabase.from('caja_turnos').insert({
        saldo_inicial: Number(form.get('saldo_inicial')),
        observaciones_apertura: form.get('observaciones_apertura').trim() || null,
        abierto_por: usuario.id,
      });
      if (error) {
        mostrarToast(`Error abriendo caja: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Caja abierta.', 'exito');
      await cargarEstado(container);
    });
  }

  await cargarHistorialCierres(container, wrap.querySelector('#historial-cierres-wrap'));
}

async function pintarTurnoAbierto(container, wrap, turno) {
  const permitido = puedeOperar();

  const [
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: transferenciasTurno, error: errTrans },
    { data: ventasMostradorTurno, error: errVentas },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('*').gte('fecha', turno.abierto_en),
    supabase.from('caja_movimientos').select('*').eq('turno_id', turno.id).order('creado_en', { ascending: false }),
    supabase.from('caja_transferencias').select('*').gte('creado_en', turno.abierto_en).order('creado_en', { ascending: false }),
    supabase
      .from('ventas_mostrador')
      .select('*, minibar_productos(nombre)')
      .eq('turno_id', turno.id)
      .order('creado_en', { ascending: false }),
  ]);

  if (errPagos || errMov || errTrans || errVentas) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando movimientos: ${(errPagos || errMov || errTrans || errVentas).message}</p>`;
    return;
  }

  const desglose = calcularDesglosePorMetodo(pagos, movimientos, ventasMostradorTurno);
  const metodosPresentes = Array.from(new Set([...METODOS_PAGO, ...Object.keys(desglose)]));

  const totalIngresos = Object.values(desglose).reduce((sum, m) => sum + m.ingresos, 0);
  const totalEgresos = Object.values(desglose).reduce((sum, m) => sum + m.egresos, 0);
  const ingresosReservas = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ingresosManuales = (movimientos || []).filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
  const ingresosMostrador = (ventasMostradorTurno || []).reduce((sum, v) => sum + Number(v.monto), 0);

  const efectivo = desglose['Efectivo'] || { ingresos: 0, egresos: 0 };

  // Las transferencias no son ingreso/egreso real (no se suman a
  // totalIngresos/totalEgresos, para no inflar esos totales), pero sí
  // mueven cuánto debería haber físicamente en el cajón si involucran
  // Efectivo.
  const efectivoTransferenciasNeto = (transferenciasTurno || []).reduce((sum, t) => {
    if (t.cuenta_destino === 'Efectivo') return sum + Number(t.monto);
    if (t.cuenta_origen === 'Efectivo') return sum - Number(t.monto);
    return sum;
  }, 0);

  const saldoEsperadoEfectivo = Number(turno.saldo_inicial) + efectivo.ingresos - efectivo.egresos + efectivoTransferenciasNeto;

  const nombresUsuarios = await obtenerNombresUsuarios([turno.abierto_por, getUsuarioActual()?.id]);
  const nombreAbrio = nombresUsuarios.get(turno.abierto_por) || '—';
  const nombreActual = nombresUsuarios.get(getUsuarioActual()?.id) || getUsuarioActual()?.nombre || '—';

  wrap.innerHTML = `
    <div class="tarjeta" style="background:var(--color-fondo-suave, #f8f9fb); margin-bottom:1rem;">
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; align-items:center;">
        <div>
          <strong>🤝 Entrega de turno</strong>
          <p class="mensaje-vacio" style="margin:0.2rem 0 0;">Abierta por <strong>${escaparHTML(nombreAbrio)}</strong> el ${formatFechaHora(turno.abierto_en)}</p>
        </div>
        <div style="text-align:right;">
          <span class="mensaje-vacio">Sesión actual:</span> <strong>${escaparHTML(nombreActual)}</strong>
        </div>
      </div>
    </div>

    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Base inicial (efectivo)</div>
        <div class="stat-card-valor">${formatCOP(turno.saldo_inicial)}</div>
        <div class="stat-card-subtitulo">Abierta ${formatFechaHora(turno.abierto_en)}</div>
      </div>
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos del turno (todos los medios)</div>
        <div class="stat-card-valor">${formatCOP(totalIngresos)}</div>
        <div class="stat-card-subtitulo">Reservas: ${formatCOP(ingresosReservas)} · Mostrador: ${formatCOP(ingresosMostrador)} · Manuales: ${formatCOP(ingresosManuales)}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Esperado en efectivo (para arqueo)</div>
        <div class="stat-card-valor">${formatCOP(saldoEsperadoEfectivo)}</div>
        <div class="stat-card-subtitulo">Egresos totales: ${formatCOP(totalEgresos)}</div>
      </div>
    </div>

    <div class="tarjeta">
      <h3>💱 Desglose por medio de pago (este turno)</h3>
      <table class="tabla-simple">
        <thead><tr><th>Medio</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead>
        <tbody>
          ${metodosPresentes
            .map((m) => {
              const d = desglose[m] || { ingresos: 0, egresos: 0 };
              const neto = d.ingresos - d.egresos;
              return `<tr><td>${escaparHTML(m)}${m === 'Efectivo' ? ' 💵' : ''}</td><td>${formatCOP(d.ingresos)}</td><td>${formatCOP(d.egresos)}</td><td style="font-weight:700;">${formatCOP(neto)}</td></tr>`;
            })
            .join('')}
          <tr style="font-weight:700;"><td>Total</td><td>${formatCOP(totalIngresos)}</td><td>${formatCOP(totalEgresos)}</td><td>${formatCOP(totalIngresos - totalEgresos)}</td></tr>
        </tbody>
      </table>
      <p class="mensaje-vacio" style="margin-top:0.5rem;">Solo Efectivo necesita conteo físico al cerrar caja — los demás medios son electrónicos, su saldo es lo que marca esta tabla. Las transferencias entre cuentas no están incluidas aquí (no son ingreso/egreso real) — se ven abajo.</p>
    </div>

    <div id="ventas-mostrador-wrap"></div>

    ${
      (transferenciasTurno || []).length > 0
        ? `
      <div class="tarjeta">
        <h3>🔁 Transferencias entre cuentas (este turno)</h3>
        <table class="tabla-simple">
          <thead><tr><th>Fecha</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead>
          <tbody>
            ${transferenciasTurno
              .map(
                (t) =>
                  `<tr><td>${formatFechaHora(t.creado_en)}</td><td>${escaparHTML(t.cuenta_origen)}</td><td>${escaparHTML(t.cuenta_destino)}</td><td class="monto">${formatCOP(t.monto)}</td><td>${escaparHTML(t.motivo || '—')}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `
        : ''
    }

    ${
      permitido
        ? `
      <div class="acciones-tarjeta" style="justify-content:flex-start; margin-bottom:1.25rem;">
        <button type="button" id="btn-nuevo-movimiento" class="btn btn-secundario">+ Movimiento</button>
        <button type="button" id="btn-cerrar-caja" class="btn btn-peligro">Cerrar caja</button>
      </div>
    `
        : ''
    }

    <div class="tarjeta">
      <h3>Ingresos por reservas (automáticos)</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
          <tbody>
            ${
              (pagos || [])
                .slice()
                .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                .map(
                  (p) =>
                    `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${p.metodo_pago || '—'}</td><td>${p.comentarios || '—'}</td></tr>`
                )
                .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin pagos de reservas en este turno.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="tarjeta">
      <h3>Movimientos manuales</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead>
          <tbody>
            ${
              (movimientos || [])
                .map(
                  (m) =>
                    `<tr><td>${formatFechaHora(m.creado_en)}</td><td>${m.tipo === 'ingreso' ? '⬆️ Ingreso' : '⬇️ Egreso'}</td><td>${m.categoria || '—'}</td><td>${formatCOP(m.monto)}</td><td>${m.metodo_pago || '—'}</td><td>${m.descripcion || '—'}</td></tr>`
                )
                .join('') || '<tr><td colspan="6" class="mensaje-vacio">Sin movimientos manuales todavía.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>

    <div id="historial-cierres-wrap"></div>
  `;

  if (permitido) {
    wrap.querySelector('#btn-nuevo-movimiento').addEventListener('click', () => abrirModalMovimiento(container, turno.id));
    wrap.querySelector('#btn-cerrar-caja').addEventListener('click', () =>
      abrirModalCierre(container, turno, saldoEsperadoEfectivo, desglose)
    );
  }

  await cargarVentasMostrador(container, wrap.querySelector('#ventas-mostrador-wrap'), turno.id, ventasMostradorTurno);
  await cargarHistorialCierres(container, wrap.querySelector('#historial-cierres-wrap'));
}

// =========================================================
// Ventas por mostrador: productos de bodega vendidos directo en
// Recepción a un cliente que no se hospeda (no vale la pena crearle
// ficha de huésped) — no se cargan a ninguna habitación. Descuenta
// inventario_bodega y deja su propio movimiento en
// inventario_movimientos, igual que cualquier otra salida de bodega.
// Requiere un turno abierto (igual que un movimiento manual).
// =========================================================
async function cargarVentasMostrador(container, elemento, turnoId, ventasIniciales) {
  if (!elemento) return;
  const permitido = puedeOperar();

  const [{ data: bodega, error: errBodega }, { data: productos, error: errProductos }] = await Promise.all([
    supabase.from('inventario_bodega').select('producto_id, cantidad_actual'),
    supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre'),
  ]);

  if (errBodega || errProductos) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando productos de bodega: ${(errBodega || errProductos).message}</p>`;
    return;
  }

  const stockPorProducto = new Map((bodega || []).map((b) => [b.producto_id, b.cantidad_actual]));
  const categorias = [...new Set((productos || []).map((p) => p.categoria))];
  const totalVentas = (ventasIniciales || []).reduce((sum, v) => sum + Number(v.monto), 0);

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
        <h3 style="margin:0;">🛒 Ventas por mostrador (este turno)</h3>
        <strong style="font-size:1.1rem;">${formatCOP(totalVentas)}</strong>
      </div>
      <p class="mensaje-vacio" style="margin-bottom:0.75rem;">Para un cliente que compra algo del inventario sin hospedarse — no queda ligado a ninguna habitación ni huésped, solo descuenta bodega y suma a la venta del día.</p>
      ${
        permitido
          ? `
        <form id="form-venta-mostrador" class="form-grid">
          <label>Producto
            <select name="producto_id" required>
              ${categorias
                .map(
                  (cat) => `
                <optgroup label="${escaparHTML(cat)}">
                  ${(productos || [])
                    .filter((p) => p.categoria === cat)
                    .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)} — ${formatCOP(p.precio)} (${stockPorProducto.get(p.id) || 0} en bodega)</option>`)
                    .join('')}
                </optgroup>
              `
                )
                .join('')}
            </select>
          </label>
          <label>Cantidad
            <input type="number" name="cantidad" min="1" value="1" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago">
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Cliente <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="cliente_nombre" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-secundario btn-chico">+ Registrar venta</button>
        </form>
      `
          : ''
      }
      <div class="tabla-scroll" style="margin-top:0.75rem;">
        <table class="tabla-simple">
          <thead><tr><th>Hora</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead>
          <tbody>
            ${
              (ventasIniciales || [])
                .map(
                  (v) =>
                    `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${v.cantidad}</td><td>${formatCOP(v.monto)}</td><td>${v.metodo_pago}</td><td>${escaparHTML(v.cliente_nombre || '—')}</td></tr>`
                )
                .join('') || '<tr><td colspan="6" class="mensaje-vacio">Sin ventas de mostrador en este turno.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!permitido) return;

  elemento.querySelector('#form-venta-mostrador').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const productoId = Number(form.get('producto_id'));
    const cantidad = Number(form.get('cantidad'));
    const producto = (productos || []).find((p) => p.id === productoId);
    if (!producto) return;

    const stockDisponible = stockPorProducto.get(productoId) || 0;
    if (cantidad > stockDisponible) {
      const seguir = await mostrarConfirmacion({
        titulo: 'Stock insuficiente en bodega',
        contenidoHTML: `En bodega solo hay ${stockDisponible} unidad(es) registradas de ${escaparHTML(producto.nombre)}. ¿Continuar de todas formas?`,
        textoConfirmar: 'Continuar',
      });
      if (!seguir) return;
    }

    const monto = producto.precio * cantidad;
    const usuario = getUsuarioActual();

    const { error: errVenta } = await supabase.from('ventas_mostrador').insert({
      turno_id: turnoId,
      producto_id: productoId,
      cantidad,
      precio_unitario: producto.precio,
      monto,
      metodo_pago: form.get('metodo_pago'),
      cliente_nombre: form.get('cliente_nombre').trim() || null,
      registrado_por: usuario?.id || null,
    });

    if (errVenta) {
      mostrarToast(`Error registrando la venta: ${errVenta.message}`, 'error');
      return;
    }

    const { data: filaBodega } = await supabase
      .from('inventario_bodega')
      .select('id, cantidad_actual')
      .eq('producto_id', productoId)
      .maybeSingle();

    if (filaBodega) {
      await supabase
        .from('inventario_bodega')
        .update({ cantidad_actual: filaBodega.cantidad_actual - cantidad, actualizado_en: new Date().toISOString() })
        .eq('id', filaBodega.id);
    }

    await supabase.from('inventario_movimientos').insert({
      tipo: 'venta_mostrador',
      producto_id: productoId,
      cantidad,
      notas: 'Venta directa por mostrador.',
      registrado_por: usuario?.id || null,
    });

    mostrarToast('Venta registrada.', 'exito');
    document.dispatchEvent(new CustomEvent('inventario:actualizado'));
    await cargarEstado(container);
    const wrapSaldos = container.querySelector('#saldos-cuenta-wrap');
    if (wrapSaldos) await cargarSaldosPorCuenta(container, wrapSaldos);
    const wrapResumen = container.querySelector('#resumen-dia-wrap');
    if (wrapResumen) await cargarResumenDelDia(wrapResumen);
  });
}

// =========================================================
// Cierres anteriores — bitácora de entrega de turno, con detalle
// itemizado y exportable por cierre (para auditoría del propietario).
// =========================================================
async function cargarHistorialCierres(container, elemento) {
  if (!elemento) return;
  elemento.innerHTML = `<h3>Cierres anteriores</h3><p class="mensaje-vacio">Cargando…</p>`;
  const { data, error } = await supabase
    .from('caja_turnos')
    .select('*')
    .eq('estado', 'cerrada')
    .order('cerrado_en', { ascending: false })
    .limit(10);

  if (error) {
    elemento.innerHTML = `<h3>Cierres anteriores</h3><p class="mensaje-vacio">Error: ${error.message}</p>`;
    return;
  }

  const idsUsuarios = [];
  (data || []).forEach((t) => {
    idsUsuarios.push(t.abierto_por, t.cerrado_por);
  });
  const nombresUsuarios = await obtenerNombresUsuarios(idsUsuarios);

  elemento.innerHTML = `
    <h3>Cierres anteriores</h3>
    <p class="mensaje-vacio">Bitácora de entregas de turno: quién abrió, quién cerró, cuánto entró en efectivo vs otros medios, y la diferencia del arqueo. "Ver detalle" muestra el desglose completo y el detalle transacción por transacción, descargable en Excel/PDF.</p>
    <div class="tabla-scroll">
      <table class="tabla-simple">
        <thead><tr><th>Cerrada</th><th>Abrió</th><th>Cerró</th><th>Base inicial</th><th>Ingresos efectivo</th><th>Ingresos otros medios</th><th>Esperado efectivo</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead>
        <tbody>
          ${
            (data || [])
              .map(
                (t, idx) => `
                <tr>
                  <td>${formatFechaHora(t.cerrado_en)}</td>
                  <td>${escaparHTML(nombresUsuarios.get(t.abierto_por) || '—')}</td>
                  <td>${escaparHTML(nombresUsuarios.get(t.cerrado_por) || '—')}</td>
                  <td>${formatCOP(t.saldo_inicial)}</td>
                  <td>${formatCOP(t.total_ingresos_efectivo)}</td>
                  <td>${formatCOP(t.total_ingresos_digital)}</td>
                  <td>${formatCOP(t.saldo_esperado)}</td>
                  <td>${formatCOP(t.saldo_contado)}</td>
                  <td style="color:${Number(t.diferencia) === 0 ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)'}; font-weight:700;">${formatCOP(t.diferencia)}</td>
                  <td><button type="button" class="btn-editar btn-ver-detalle-cierre" data-idx="${idx}" data-turno-id="${t.id}">Ver detalle</button></td>
                </tr>
                <tr class="fila-detalle-cierre oculto" data-detalle-idx="${idx}">
                  <td colspan="10"><div class="detalle-cierre-contenido"><p class="mensaje-vacio">Cargando detalle…</p></div></td>
                </tr>
              `
              )
              .join('') || '<tr><td colspan="10" class="mensaje-vacio">Sin cierres registrados todavía.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-detalle-cierre').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fila = elemento.querySelector(`.fila-detalle-cierre[data-detalle-idx="${btn.dataset.idx}"]`);
      if (!fila) return;
      const yaAbierta = !fila.classList.contains('oculto');
      fila.classList.toggle('oculto');
      if (yaAbierta) return;

      const turno = (data || []).find((t) => t.id === Number(btn.dataset.turnoId));
      if (!turno) return;
      const contenedorDetalle = fila.querySelector('.detalle-cierre-contenido');
      if (contenedorDetalle.dataset.cargado === '1') return; // ya se cargó una vez, no repetir la consulta

      await pintarDetalleCierre(contenedorDetalle, turno, nombresUsuarios);
      contenedorDetalle.dataset.cargado = '1';
    });
  });
}

async function pintarDetalleCierre(contenedor, turno, nombresUsuarios) {
  contenedor.innerHTML = '<p class="mensaje-vacio">Cargando detalle…</p>';

  const desde = turno.abierto_en;
  const hasta = turno.cerrado_en;

  const [
    { data: pagos, error: errPagos },
    { data: movimientos, error: errMov },
    { data: transferencias, error: errTrans },
    { data: ventasMostrador, error: errVentas },
  ] = await Promise.all([
    supabase.from('reservas_pagos').select('*').gte('fecha', desde).lt('fecha', hasta).order('fecha', { ascending: true }),
    supabase.from('caja_movimientos').select('*').eq('turno_id', turno.id).order('creado_en', { ascending: true }),
    supabase
      .from('caja_transferencias')
      .select('*')
      .gte('creado_en', desde)
      .lt('creado_en', hasta)
      .order('creado_en', { ascending: true }),
    supabase.from('ventas_mostrador').select('*, minibar_productos(nombre)').eq('turno_id', turno.id).order('creado_en', { ascending: true }),
  ]);

  if (errPagos || errMov || errTrans || errVentas) {
    contenedor.innerHTML = `<p class="mensaje-vacio">Error cargando el detalle: ${(errPagos || errMov || errTrans || errVentas).message}</p>`;
    return;
  }

  const datosDetalle = {
    turno,
    nombreAbrio: nombresUsuarios.get(turno.abierto_por) || '—',
    nombreCerro: nombresUsuarios.get(turno.cerrado_por) || '—',
    pagos: pagos || [],
    movimientos: movimientos || [],
    transferencias: transferencias || [],
    ventasMostrador: ventasMostrador || [],
  };

  contenedor.innerHTML = `
    ${
      turno.desglose_metodos
        ? `
      <p style="font-weight:600; margin-bottom:0.3rem;">Desglose por medio de pago</p>
      <table class="tabla-simple">
        <thead><tr><th>Medio</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead>
        <tbody>
          ${Object.entries(turno.desglose_metodos)
            .map(
              ([medio, d]) =>
                `<tr><td>${escaparHTML(medio)}</td><td>${formatCOP(d.ingresos)}</td><td>${formatCOP(d.egresos)}</td><td>${formatCOP(d.ingresos - d.egresos)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
    `
        : ''
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Pagos de reservas (${datosDetalle.pagos.length})</p>
    ${
      datosDetalle.pagos.length === 0
        ? '<p class="mensaje-vacio">Sin pagos de reservas en este turno.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead><tbody>${datosDetalle.pagos
            .map((p) => `<tr><td>${formatFechaHora(p.fecha)}</td><td>${formatCOP(p.monto)}</td><td>${p.metodo_pago || '—'}</td><td>${escaparHTML(p.comentarios || '—')}</td></tr>`)
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Movimientos manuales (${datosDetalle.movimientos.length})</p>
    ${
      datosDetalle.movimientos.length === 0
        ? '<p class="mensaje-vacio">Sin movimientos manuales en este turno.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead><tbody>${datosDetalle.movimientos
            .map(
              (m) =>
                `<tr><td>${formatFechaHora(m.creado_en)}</td><td>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td><td>${escaparHTML(m.categoria || '—')}</td><td>${formatCOP(m.monto)}</td><td>${m.metodo_pago || '—'}</td><td>${escaparHTML(m.descripcion || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Ventas por mostrador (${datosDetalle.ventasMostrador.length})</p>
    ${
      datosDetalle.ventasMostrador.length === 0
        ? '<p class="mensaje-vacio">Sin ventas de mostrador en este turno.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead><tbody>${datosDetalle.ventasMostrador
            .map(
              (v) =>
                `<tr><td>${formatFechaHora(v.creado_en)}</td><td>${v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—'}</td><td>${v.cantidad}</td><td>${formatCOP(v.monto)}</td><td>${v.metodo_pago}</td><td>${escaparHTML(v.cliente_nombre || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    <p style="font-weight:600; margin:0.85rem 0 0.3rem;">Transferencias entre cuentas (${datosDetalle.transferencias.length})</p>
    ${
      datosDetalle.transferencias.length === 0
        ? '<p class="mensaje-vacio">Sin transferencias en este turno.</p>'
        : `<table class="tabla-simple"><thead><tr><th>Fecha</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead><tbody>${datosDetalle.transferencias
            .map(
              (t) =>
                `<tr><td>${formatFechaHora(t.creado_en)}</td><td>${escaparHTML(t.cuenta_origen)}</td><td>${escaparHTML(t.cuenta_destino)}</td><td>${formatCOP(t.monto)}</td><td>${escaparHTML(t.motivo || '—')}</td></tr>`
            )
            .join('')}</tbody></table>`
    }

    ${turno.observaciones_cierre ? `<p style="margin-top:0.85rem;"><strong>Observaciones del cierre:</strong> ${escaparHTML(turno.observaciones_cierre)}</p>` : ''}

    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.85rem;">
      <button type="button" class="btn btn-secundario btn-chico btn-exportar-csv-cierre">⬇ Excel</button>
      <button type="button" class="btn btn-secundario btn-chico btn-exportar-pdf-cierre">⬇ PDF</button>
    </div>
  `;

  contenedor.querySelector('.btn-exportar-csv-cierre').addEventListener('click', () => exportarCierreCSV(datosDetalle));
  contenedor.querySelector('.btn-exportar-pdf-cierre').addEventListener('click', () => exportarCierrePDF(datosDetalle));
}

function exportarCierreCSV(d) {
  const t = d.turno;
  const filas = [
    ['Cierre de caja — Santa Ana House 21'],
    ['Abierta por', d.nombreAbrio, formatFechaHora(t.abierto_en)],
    ['Cerrada por', d.nombreCerro, formatFechaHora(t.cerrado_en)],
    [],
    ['Base inicial', t.saldo_inicial],
    ['Esperado en efectivo', t.saldo_esperado],
    ['Contado en efectivo', t.saldo_contado],
    ['Diferencia', t.diferencia],
    ['Observaciones del cierre', t.observaciones_cierre || ''],
    [],
    ['Pagos de reservas'],
    ['Fecha', 'Monto', 'Método', 'Comentario'],
    ...(d.pagos.length ? d.pagos.map((p) => [formatFechaHora(p.fecha), p.monto, p.metodo_pago || '', p.comentarios || '']) : [['Sin pagos en este turno.', '', '', '']]),
    [],
    ['Movimientos manuales'],
    ['Fecha', 'Tipo', 'Categoría', 'Monto', 'Método', 'Descripción'],
    ...(d.movimientos.length
      ? d.movimientos.map((m) => [formatFechaHora(m.creado_en), m.tipo, m.categoria || '', m.monto, m.metodo_pago || '', m.descripcion || ''])
      : [['Sin movimientos en este turno.', '', '', '', '', '']]),
    [],
    ['Ventas por mostrador'],
    ['Fecha', 'Producto', 'Cantidad', 'Monto', 'Método', 'Cliente'],
    ...(d.ventasMostrador.length
      ? d.ventasMostrador.map((v) => [formatFechaHora(v.creado_en), v.minibar_productos ? v.minibar_productos.nombre : '', v.cantidad, v.monto, v.metodo_pago, v.cliente_nombre || ''])
      : [['Sin ventas de mostrador en este turno.', '', '', '', '', '']]),
    [],
    ['Transferencias entre cuentas'],
    ['Fecha', 'De', 'Hacia', 'Monto', 'Motivo'],
    ...(d.transferencias.length
      ? d.transferencias.map((t2) => [formatFechaHora(t2.creado_en), t2.cuenta_origen, t2.cuenta_destino, t2.monto, t2.motivo || ''])
      : [['Sin transferencias en este turno.', '', '', '', '']]),
  ];
  descargarCSV(`cierre-caja-${toISODate(new Date(t.cerrado_en))}-turno-${t.id}.csv`, filas);
}

function exportarCierrePDF(d) {
  const t = d.turno;
  const cuerpo = `
    <h2>Entrega de turno</h2>
    <table>
      <tr><td>Abierta por</td><td>${escaparHTML(d.nombreAbrio)} — ${formatFechaHora(t.abierto_en)}</td></tr>
      <tr><td>Cerrada por</td><td>${escaparHTML(d.nombreCerro)} — ${formatFechaHora(t.cerrado_en)}</td></tr>
    </table>

    <h2>Arqueo de efectivo</h2>
    <table>
      <tr><td>Base inicial</td><td>${formatCOP(t.saldo_inicial)}</td></tr>
      <tr><td>Esperado</td><td>${formatCOP(t.saldo_esperado)}</td></tr>
      <tr><td>Contado</td><td>${formatCOP(t.saldo_contado)}</td></tr>
      <tr><td>Diferencia</td><td>${formatCOP(t.diferencia)}</td></tr>
    </table>
    ${t.observaciones_cierre ? `<p><strong>Observaciones:</strong> ${escaparHTML(t.observaciones_cierre)}</p>` : ''}

    <h2>Pagos de reservas (${d.pagos.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Comentario</th></tr></thead>
      <tbody>
        ${
          d.pagos.length
            ? d.pagos.map((p) => filaTablaSimple([formatFechaHora(p.fecha), formatCOP(p.monto), p.metodo_pago || '—', escaparHTML(p.comentarios || '—')])).join('')
            : filaTablaSimple(['Sin pagos en este turno.', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Movimientos manuales (${d.movimientos.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Monto</th><th>Método</th><th>Descripción</th></tr></thead>
      <tbody>
        ${
          d.movimientos.length
            ? d.movimientos
                .map((m) =>
                  filaTablaSimple([
                    formatFechaHora(m.creado_en),
                    m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                    escaparHTML(m.categoria || '—'),
                    formatCOP(m.monto),
                    m.metodo_pago || '—',
                    escaparHTML(m.descripcion || '—'),
                  ])
                )
                .join('')
            : filaTablaSimple(['Sin movimientos en este turno.', '', '', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Ventas por mostrador (${d.ventasMostrador.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Monto</th><th>Método</th><th>Cliente</th></tr></thead>
      <tbody>
        ${
          d.ventasMostrador.length
            ? d.ventasMostrador
                .map((v) =>
                  filaTablaSimple([
                    formatFechaHora(v.creado_en),
                    v.minibar_productos ? escaparHTML(v.minibar_productos.nombre) : '—',
                    v.cantidad,
                    formatCOP(v.monto),
                    v.metodo_pago,
                    escaparHTML(v.cliente_nombre || '—'),
                  ])
                )
                .join('')
            : filaTablaSimple(['Sin ventas de mostrador en este turno.', '', '', '', '', ''])
        }
      </tbody>
    </table>

    <h2>Transferencias entre cuentas (${d.transferencias.length})</h2>
    <table>
      <thead><tr><th>Fecha</th><th>De</th><th>Hacia</th><th>Monto</th><th>Motivo</th></tr></thead>
      <tbody>
        ${
          d.transferencias.length
            ? d.transferencias
                .map((t2) => filaTablaSimple([formatFechaHora(t2.creado_en), escaparHTML(t2.cuenta_origen), escaparHTML(t2.cuenta_destino), formatCOP(t2.monto), escaparHTML(t2.motivo || '—')]))
                .join('')
            : filaTablaSimple(['Sin transferencias en este turno.', '', '', '', ''])
        }
      </tbody>
    </table>
  `;
  abrirVistaImpresion(`Cierre de caja #${t.id} — Santa Ana House 21`, `Turno del ${formatFechaHora(t.abierto_en)} al ${formatFechaHora(t.cerrado_en)}`, cuerpo);
}

async function abrirModalMovimiento(container, turnoId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>Nuevo movimiento</h3>
      <form id="form-movimiento" class="modal-contenido">
        <div class="form-grid">
          <label>Tipo
            <select name="tipo" required>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </label>
          <label>Categoría
            <input type="text" name="categoria" placeholder="Ej: Insumos, Propina, Otro" />
          </label>
          <label>Monto
            <input type="number" name="monto" step="1000" min="1" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago">
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Descripción
          <textarea name="descripcion" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-movimiento">Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-movimiento').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-movimiento').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const usuario = getUsuarioActual();
    const { error } = await supabase.from('caja_movimientos').insert({
      turno_id: turnoId,
      tipo: form.get('tipo'),
      categoria: form.get('categoria').trim() || null,
      monto: Number(form.get('monto')),
      metodo_pago: form.get('metodo_pago'),
      descripcion: form.get('descripcion').trim() || null,
      registrado_por: usuario.id,
    });
    if (error) {
      mostrarToast(`Error: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Movimiento registrado.', 'exito');
    overlay.remove();
    await cargarEstado(container);
  });
}

// =========================================================
// Cerrar caja: conteo de efectivo POR DENOMINACIÓN (menos errores que un
// solo campo total) + explicación obligatoria si la diferencia no da
// exacto.
// =========================================================
async function abrirModalCierre(container, turno, saldoEsperadoEfectivo, desglose) {
  const efectivo = desglose['Efectivo'] || { ingresos: 0, egresos: 0 };
  const otrosMedios = Object.entries(desglose).filter(([medio]) => medio !== 'Efectivo');
  const totalOtrosIngresos = otrosMedios.reduce((sum, [, d]) => sum + d.ingresos, 0);
  const totalOtrosEgresos = otrosMedios.reduce((sum, [, d]) => sum + d.egresos, 0);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>Cerrar caja</h3>
      <form id="form-cierre-caja">
        <div class="modal-contenido">
          <table class="tabla-simple" style="margin-bottom:0.75rem;">
            <thead><tr><th>Medio</th><th>Ingresos</th><th>Egresos</th></tr></thead>
            <tbody>
              ${Object.entries(desglose)
                .map(([medio, d]) => `<tr><td>${escaparHTML(medio)}</td><td class="monto">${formatCOP(d.ingresos)}</td><td class="monto">${formatCOP(d.egresos)}</td></tr>`)
                .join('')}
            </tbody>
          </table>
          <p class="mensaje-vacio">Esperado en efectivo: <strong class="monto">${formatCOP(saldoEsperadoEfectivo)}</strong> (esto es lo único que hay que contar físicamente — los demás medios ya son electrónicos).</p>

          <div class="tarjeta" style="margin-top:0.75rem; background:var(--color-fondo-suave, #f8f9fb);">
            <h4 style="margin-top:0;">Conteo de efectivo por denominación</h4>
            <table class="tabla-simple">
              <thead><tr><th>Denominación</th><th>Cantidad</th><th>Subtotal</th></tr></thead>
              <tbody>
                ${DENOMINACIONES_BILLETES.map(
                  (v) => `
                  <tr>
                    <td>${formatCOP(v)}</td>
                    <td><input type="number" min="0" step="1" value="0" class="input-cantidad-denominacion" data-valor="${v}" style="width:90px;" /></td>
                    <td class="monto subtotal-denominacion" data-valor="${v}">${formatCOP(0)}</td>
                  </tr>
                `
                ).join('')}
                <tr>
                  <td>Monedas y billetes menores (efectivo directo)</td>
                  <td><input type="number" min="0" step="100" value="0" id="input-monedas-otros" style="width:90px;" /></td>
                  <td class="monto" id="subtotal-monedas">${formatCOP(0)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="font-weight:700;"><td colspan="2">Total contado</td><td class="monto" id="total-contado-denominaciones">${formatCOP(0)}</td></tr>
              </tfoot>
            </table>
          </div>

          <div class="form-grid" style="margin-top:0.75rem;">
            <label>Diferencia
              <input type="text" id="input-diferencia-display" disabled value="${formatCOP(0 - saldoEsperadoEfectivo)}" />
            </label>
          </div>
          <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:0.75rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);" id="label-observaciones-cierre">
            Observaciones
            <textarea name="observaciones_cierre" id="input-observaciones-cierre" rows="2" placeholder="Opcional" style="text-transform:none; padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
          </label>
          <p class="mensaje-vacio" id="aviso-explicacion-diferencia" style="margin-top:0.3rem; font-size:0.78rem; color:var(--color-rojo-oscuro); display:none;">El conteo no cuadra con lo esperado — explica en Observaciones a qué se debe la diferencia antes de cerrar.</p>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-cierre">Cancelar</button>
          <button type="submit" class="btn btn-peligro">Confirmar cierre</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  let totalContadoActual = 0;

  function recalcularConteo() {
    let total = 0;
    overlay.querySelectorAll('.input-cantidad-denominacion').forEach((input) => {
      const valor = Number(input.dataset.valor);
      const cantidad = Number(input.value) || 0;
      const subtotal = valor * cantidad;
      total += subtotal;
      overlay.querySelector(`.subtotal-denominacion[data-valor="${valor}"]`).textContent = formatCOP(subtotal);
    });
    const monedas = Number(overlay.querySelector('#input-monedas-otros').value) || 0;
    overlay.querySelector('#subtotal-monedas').textContent = formatCOP(monedas);
    total += monedas;

    totalContadoActual = total;
    overlay.querySelector('#total-contado-denominaciones').textContent = formatCOP(total);

    const diferencia = total - saldoEsperadoEfectivo;
    overlay.querySelector('#input-diferencia-display').value = formatCOP(diferencia);

    const textarea = overlay.querySelector('#input-observaciones-cierre');
    const aviso = overlay.querySelector('#aviso-explicacion-diferencia');
    const labelObs = overlay.querySelector('#label-observaciones-cierre');
    if (diferencia !== 0) {
      textarea.required = true;
      aviso.style.display = 'block';
      labelObs.firstChild.textContent = 'Observaciones (obligatorio — explica la diferencia)';
    } else {
      textarea.required = false;
      aviso.style.display = 'none';
      labelObs.firstChild.textContent = 'Observaciones';
    }
  }

  overlay.querySelectorAll('.input-cantidad-denominacion, #input-monedas-otros').forEach((input) => {
    input.addEventListener('input', recalcularConteo);
  });
  recalcularConteo();

  overlay.querySelector('#btn-cancelar-cierre').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-cierre-caja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const saldoContado = totalContadoActual;
    const diferencia = saldoContado - saldoEsperadoEfectivo;

    if (diferencia !== 0 && !form.get('observaciones_cierre').trim()) {
      mostrarToast('El conteo no cuadra con lo esperado — explica la diferencia en Observaciones antes de cerrar.', 'error');
      return;
    }

    const ok = await mostrarConfirmacion({
      titulo: 'Confirmar cierre de caja',
      contenidoHTML: `Diferencia en efectivo: <strong>${formatCOP(diferencia)}</strong>${diferencia !== 0 ? ' — revisa el conteo antes de confirmar.' : ''} ¿Cerrar la caja?`,
      textoConfirmar: 'Cerrar caja',
    });
    if (!ok) return;

    const usuario = getUsuarioActual();
    const { error } = await supabase
      .from('caja_turnos')
      .update({
        estado: 'cerrada',
        saldo_esperado: saldoEsperadoEfectivo,
        saldo_contado: saldoContado,
        diferencia,
        total_ingresos_efectivo: efectivo.ingresos,
        total_ingresos_digital: totalOtrosIngresos,
        total_egresos_efectivo: efectivo.egresos,
        total_egresos_digital: totalOtrosEgresos,
        desglose_metodos: desglose,
        observaciones_cierre: form.get('observaciones_cierre').trim() || null,
        cerrado_por: usuario.id,
        cerrado_en: new Date().toISOString(),
      })
      .eq('id', turno.id);

    if (error) {
      mostrarToast(`Error cerrando caja: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Caja cerrada.', 'exito');
    overlay.remove();
    await cargarEstado(container);
  });
}

registerModule({
  id: 'caja',
  label: 'Registro diario de ventas',
  icono: '💰',
  roles: ['propietario', 'administrador', 'recepcionista', 'contador', 'auditor'],
  render,
});
