// caja.js
//
// Módulo: Caja. Apertura y cierre de turno de caja con arqueo, más registro
// de movimientos manuales (ingresos/egresos) del turno abierto.
//
// Los abonos de reservas (reservas_pagos, ya registrados desde Reservas y
// Recepción) NO se duplican aquí — este módulo los LEE directamente de esa
// tabla y los muestra como "ingresos automáticos" del turno abierto.
// caja_movimientos solo guarda lo que no nace de una reserva (gastos
// operativos, propinas, ingresos varios, etc).
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

const ROLES_OPERAN_CAJA = ['propietario', 'administrador', 'recepcionista'];

function puedeOperar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_OPERAN_CAJA.includes(usuario.rol);
}

async function render(container) {
  container.innerHTML = `
    <h2>Caja</h2>
    <div id="caja-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await cargarEstado(container);
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
          <label>Base inicial
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

  const ingresosReservas = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);
  const ingresosReservasEfectivo = (pagos || [])
    .filter((p) => p.metodo_pago === 'Efectivo')
    .reduce((sum, p) => sum + Number(p.monto), 0);

  const ingresosManuales = (movimientos || []).filter((m) => m.tipo === 'ingreso');
  const egresosManuales = (movimientos || []).filter((m) => m.tipo === 'egreso');

  const ingresosManualesEfectivo = ingresosManuales
    .filter((m) => m.metodo_pago === 'Efectivo')
    .reduce((sum, m) => sum + Number(m.monto), 0);
  const egresosManualesEfectivo = egresosManuales
    .filter((m) => m.metodo_pago === 'Efectivo')
    .reduce((sum, m) => sum + Number(m.monto), 0);
  const totalIngresosManuales = ingresosManuales.reduce((sum, m) => sum + Number(m.monto), 0);
  const totalEgresosManuales = egresosManuales.reduce((sum, m) => sum + Number(m.monto), 0);

  const saldoEsperadoEfectivo =
    Number(turno.saldo_inicial) + ingresosReservasEfectivo + ingresosManualesEfectivo - egresosManualesEfectivo;

  wrap.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Base inicial</div>
        <div class="stat-card-valor">${formatCOP(turno.saldo_inicial)}</div>
        <div class="stat-card-subtitulo">Abierta ${formatFechaHora(turno.abierto_en)}</div>
      </div>
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Ingresos del turno</div>
        <div class="stat-card-valor">${formatCOP(ingresosReservas + totalIngresosManuales)}</div>
        <div class="stat-card-subtitulo">Reservas: ${formatCOP(ingresosReservas)} · Manuales: ${formatCOP(totalIngresosManuales)}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Esperado en efectivo</div>
        <div class="stat-card-valor">${formatCOP(saldoEsperadoEfectivo)}</div>
        <div class="stat-card-subtitulo">Egresos: ${formatCOP(totalEgresosManuales)}</div>
      </div>
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
      abrirModalCierre(container, turno, saldoEsperadoEfectivo)
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
    <div class="tabla-scroll">
      <table class="tabla-simple">
        <thead><tr><th>Cerrada</th><th>Base inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead>
        <tbody>
          ${
            (data || [])
              .map(
                (t) => `<tr>
                  <td>${formatFechaHora(t.cerrado_en)}</td>
                  <td>${formatCOP(t.saldo_inicial)}</td>
                  <td>${formatCOP(t.saldo_esperado)}</td>
                  <td>${formatCOP(t.saldo_contado)}</td>
                  <td style="color:${Number(t.diferencia) === 0 ? 'var(--color-verde-oscuro)' : 'var(--color-rojo-oscuro)'}; font-weight:700;">${formatCOP(t.diferencia)}</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin cierres registrados todavía.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
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
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Tarjeta">Tarjeta</option>
              <option value="Otro">Otro</option>
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

async function abrirModalCierre(container, turno, saldoEsperadoEfectivo) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>Cerrar caja</h3>
      <form id="form-cierre-caja">
        <div class="modal-contenido">
          <p class="mensaje-vacio">Esperado en efectivo: <strong class="monto">${formatCOP(saldoEsperadoEfectivo)}</strong></p>
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
      contenidoHTML: `Diferencia: <strong>${formatCOP(diferencia)}</strong>${diferencia !== 0 ? ' — revisa el conteo antes de confirmar.' : ''} ¿Cerrar la caja?`,
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
