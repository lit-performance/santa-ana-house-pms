// caja.js
//
// Módulo: Caja. Apertura y cierre de turno de caja con arqueo, más registro
// de movimientos manuales (ingresos/egresos) del turno abierto.
//
// Los abonos de reservas (reservas_pagos, ya registrados desde Reservas y
// Recepción, incluyendo los pagos de liquidación al check-out) NO se
// duplican aquí — este módulo los LEE directamente de esa tabla y los
// muestra como "ingresos automáticos" del turno abierto. caja_movimientos
// solo guarda lo que no nace de una reserva (gastos operativos, propinas,
// ingresos varios, etc).
//
// Medios de pago: cada método (Efectivo, Nequi, Daviplata, QR,
// Transferencia Bancaria, Datáfono, Llave — ver METODOS_PAGO) se consolida
// como si fuera una cuenta aparte. El desglose se calcula sumando
// reservas_pagos + caja_movimientos agrupados por metodo_pago, y se ve en
// la tarjeta "Desglose por medio de pago" mientras el turno está abierto.
// Solo Efectivo necesita arqueo físico (contar el cajón); los demás son
// electrónicos, así que su "saldo" es simplemente lo que entró menos lo
// que salió por ese medio durante el turno.
//
// Además, sin importar si hay turno abierto o no, se muestra siempre una
// tabla de "Habitaciones en uso" con el saldo pendiente de cada una (mismo
// cálculo que usa Recepción al liquidar en el check-out — ver cuentas.js).
//
// Entrega de turno: al cerrar la caja, el desglose completo por medio de
// pago se guarda en caja_turnos.desglose_metodos (jsonb) — ver
// sql/020_caja_metodos_pago.sql — y queda visible después en "Cierres
// anteriores" (botón "Ver detalle" por cierre), así sirve de bitácora de
// entregas de turno con el saldo de cada cuenta.
//
// Regla de negocio: solo puede haber UN turno de caja abierto a la vez
// (impuesto por un índice único parcial en la base de datos — ver
// sql/010_caja.sql). Mientras haya uno abierto, no se puede abrir otro.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { calcularHabitacionesEnUso } from './cuentas.js';

const ROLES_OPERAN_CAJA = ['propietario', 'administrador', 'recepcionista'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];

function puedeOperar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_OPERAN_CAJA.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// Suma ingresos/egresos por método de pago, combinando reservas_pagos
// (siempre ingreso) y caja_movimientos (ingreso o egreso). Devuelve un
// objeto { [metodo]: { ingresos, egresos } } con TODOS los métodos de
// METODOS_PAGO presentes (aunque estén en cero), más una clave "Otro" por
// si algún registro viejo trae un método que ya no está en la lista.
function calcularDesglosePorMetodo(pagos, movimientos) {
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

  (movimientos || []).forEach((m) => {
    const b = bucket(m.metodo_pago || 'Efectivo');
    if (m.tipo === 'ingreso') b.ingresos += Number(m.monto);
    else b.egresos += Number(m.monto);
  });

  return desglose;
}

async function render(container) {
  container.innerHTML = `
    <h2>Caja</h2>
    <div id="habitaciones-uso-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="caja-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([cargarHabitacionesEnUso(container.querySelector('#habitaciones-uso-wrap')), cargarEstado(container)]);
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
        <h3 style="margin:0;">🛎 Habitaciones en uso ${items.length ? `(${items.length})` : ''}</h3>
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
  wrap.innerHTML = `
    <div class="tarjeta">
      <h3>No hay una caja abierta</h3>
      <p class="mensaje-vacio">Abre la caja al iniciar el turno para empezar a registrar ingresos y egresos.</p>
      ${
        permitido
          ? `
        <form id="form-abrir-caja" class="form-grid" style="margin-top:1rem;">
          <label>Base inicial (efectivo)
            <input type="number" name="saldo_inicial" step="1000" min="0" required />
          </label>
          <label>Observaciones
            <input type="text" name="observaciones_apertura" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-primario">Abrir caja</button>
        </form>
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

  await cargarHistorialCierres(wrap.querySelector('#historial-cierres-wrap'));
}

async function pintarTurnoAbierto(container, wrap, turno) {
  const permitido = puedeOperar();

  const [{ data: pagos, error: errPagos }, { data: movimientos, error: errMov }] = await Promise.all([
    supabase.from('reservas_pagos').select('*').gte('fecha', turno.abierto_en),
    supabase.from('caja_movimientos').select('*').eq('turno_id', turno.id).order('creado_en', { ascending: false }),
  ]);

  if (errPagos || errMov) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando movimientos: ${(errPagos || errMov).message}</p>`;
    return;
  }

  const desglose = calcularDesglosePorMetodo(pagos, movimientos);
  const metodosPresentes = Array.from(new Set([...METODOS_PAGO, ...Object.keys(desglose)]));

  const totalIngresos = Object.values(desglose).reduce((sum, m) => sum + m.ingresos, 0);
  const totalEgresos = Object.values(desglose).reduce((sum, m) => sum + m.egresos, 0);
  const ingresosReservas = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ingresosManuales = (movimientos || []).filter((m) => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);

  const efectivo = desglose['Efectivo'] || { ingresos: 0, egresos: 0 };
  const saldoEsperadoEfectivo = Number(turno.saldo_inicial) + efectivo.ingresos - efectivo.egresos;

  wrap.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Base inicial (efectivo)</div>
        <div class="stat-card-valor">${formatCOP(turno.saldo_inicial)}</div>
        <div class="stat-card-subtitulo">Abierta ${formatFechaHora(turno.abierto_en)}</div>
      </div>
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos del turno (todos los medios)</div>
        <div class="stat-card-valor">${formatCOP(totalIngresos)}</div>
        <div class="stat-card-subtitulo">Reservas: ${formatCOP(ingresosReservas)} · Manuales: ${formatCOP(ingresosManuales)}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Esperado en efectivo (para arqueo)</div>
        <div class="stat-card-valor">${formatCOP(saldoEsperadoEfectivo)}</div>
        <div class="stat-card-subtitulo">Egresos totales: ${formatCOP(totalEgresos)}</div>
      </div>
    </div>

    <div class="tarjeta">
      <h3>💱 Desglose por medio de pago</h3>
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
      <p class="mensaje-vacio" style="margin-top:0.5rem;">Solo Efectivo necesita conteo físico al cerrar caja — los demás medios son electrónicos, su saldo es lo que marca esta tabla.</p>
    </div>

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

  await cargarHistorialCierres(wrap.querySelector('#historial-cierres-wrap'));
}

async function cargarHistorialCierres(elemento) {
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

  elemento.innerHTML = `
    <h3>Cierres anteriores</h3>
    <p class="mensaje-vacio">Bitácora de entregas de turno: quién cerró, cuánto entró en efectivo vs otros medios, y la diferencia del arqueo. "Ver detalle" muestra el desglose completo por medio de pago (Nequi, Daviplata, QR, etc).</p>
    <div class="tabla-scroll">
      <table class="tabla-simple">
        <thead><tr><th>Cerrada</th><th>Base inicial</th><th>Ingresos efectivo</th><th>Ingresos otros medios</th><th>Esperado efectivo</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead>
        <tbody>
          ${
            (data || [])
              .map(
                (t, idx) => `
                <tr>
                  <td>${formatFechaHora(t.cerrado_en)}</td>
                  <td>${formatCOP(t.saldo_inicial)}</td>
                  <td>${formatCOP(t.total_ingresos_efectivo)}</td>
                  <td>${formatCOP(t.total_ingresos_digital)}</td>
                  <td>${formatCOP(t.saldo_esperado)}</td>
                  <td>${formatCOP(t.saldo_contado)}</td>
                  <td style="color:${Number(t.diferencia) === 0 ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)'}; font-weight:700;">${formatCOP(t.diferencia)}</td>
                  <td>${t.desglose_metodos ? `<button type="button" class="btn-editar btn-ver-detalle-cierre" data-idx="${idx}">Ver detalle</button>` : '—'}</td>
                </tr>
                <tr class="fila-detalle-cierre oculto" data-detalle-idx="${idx}">
                  <td colspan="8">
                    ${
                      t.desglose_metodos
                        ? `
                      <table class="tabla-simple">
                        <thead><tr><th>Medio</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead>
                        <tbody>
                          ${Object.entries(t.desglose_metodos)
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
                  </td>
                </tr>
              `
              )
              .join('') || '<tr><td colspan="8" class="mensaje-vacio">Sin cierres registrados todavía.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  elemento.querySelectorAll('.btn-ver-detalle-cierre').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fila = elemento.querySelector(`.fila-detalle-cierre[data-detalle-idx="${btn.dataset.idx}"]`);
      if (fila) fila.classList.toggle('oculto');
    });
  });
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

async function abrirModalCierre(container, turno, saldoEsperadoEfectivo, desglose) {
  const efectivo = desglose['Efectivo'] || { ingresos: 0, egresos: 0 };
  const otrosMedios = Object.entries(desglose).filter(([medio]) => medio !== 'Efectivo');
  const totalOtrosIngresos = otrosMedios.reduce((sum, [, d]) => sum + d.ingresos, 0);
  const totalOtrosEgresos = otrosMedios.reduce((sum, [, d]) => sum + d.egresos, 0);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
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
          <div class="form-grid" style="margin-top:0.75rem;">
            <label>Efectivo contado
              <input type="number" name="saldo_contado" step="1000" min="0" required />
            </label>
            <label>Observaciones
              <input type="text" name="observaciones_cierre" placeholder="Opcional" />
            </label>
          </div>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-cierre">Cancelar</button>
          <button type="submit" class="btn btn-peligro">Confirmar cierre</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-cierre').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-cierre-caja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const saldoContado = Number(form.get('saldo_contado'));
    const diferencia = saldoContado - saldoEsperadoEfectivo;

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
  label: 'Caja',
  icono: '💰',
  roles: ['propietario', 'administrador', 'recepcionista', 'contador', 'auditor'],
  render,
});
