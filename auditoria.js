// auditoria.js
//
// Módulo: Auditoría. Bitácora unificada de TODO movimiento de dinero y
// de cuenta en el sistema — pensada para el propietario (o quien haga
// auditoría) revise quién hizo qué y cuándo, sin tener que entrar módulo
// por módulo.
//
// No crea tablas nuevas: solo consulta y normaliza en un mismo formato
// {fecha, tipo, usuarioId, descripcion, monto, signo} las 6 fuentes de
// verdad que ya existen:
//   - caja_turnos      → dos eventos por fila: apertura (abierto_en) y,
//                         si ya se cerró, cierre (cerrado_en).
//   - caja_movimientos → ingresos/egresos manuales de un turno.
//   - caja_transferencias → movimientos entre cuentas (Efectivo, Nequi, etc).
//   - ventas_mostrador → ventas de inventario de bodega a clientes finales.
//   - reservas_pagos   → pagos de huéspedes (check-in, abonos, liquidación).
//
// El rango de fechas se aplica por evento (fecha real de cada fila), no
// por turno, para no perder nada que haya ocurrido con la caja cerrada
// (mismo criterio que ya usan indicadores.js y contabilidad.js).
//
// CORRECCIÓN DE TRANSACCIONES (ver 105) — pedido real: "puse un pago con
// método X y necesito corregirlo a Y". Antes esta bitácora era 100%
// solo-lectura y no había forma de corregir NADA desde la app (solo con
// SQL directo). Ahora, solo para propietario/administrador, las filas de
// tipo "Ingreso manual", "Egreso manual" y "Pago de reserva" tienen
// botones "✏️ Editar" (corrige método de pago y monto) y "🗑 Eliminar"
// — van directo a la tabla de origen (caja_movimientos o reservas_pagos)
// por su id real. A propósito NO se habilitó para aperturas/cierres de
// caja, transferencias entre cuentas ni ventas de mostrador — son casos
// más delicados (transferencias no tienen "método de pago" como tal, y
// una venta de mostrador también mueve inventario, que esto no revierte)
// y quedan fuera de esta primera versión para no arriesgar datos.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora, toISODate, addDays } from './dates.js';
import { getUsuarioActual } from './auth.js';

const ETIQUETA_TIPO = {
  apertura: { label: '🔓 Apertura de caja', color: 'var(--color-azul-oscuro, #1565c0)' },
  cierre: { label: '🔒 Cierre de caja', color: 'var(--color-texto-suave, #555)' },
  movimiento_ingreso: { label: '⬆️ Ingreso manual', color: 'var(--color-verde-oscuro, #2e7d32)' },
  movimiento_egreso: { label: '⬇️ Egreso manual', color: 'var(--color-rojo-oscuro, #c62828)' },
  transferencia: { label: '🔁 Transferencia entre cuentas', color: 'var(--color-naranja-oscuro, #e65100)' },
  venta_mostrador: { label: '🛍️ Venta de mostrador', color: 'var(--color-verde-oscuro, #2e7d32)' },
  pago_reserva: { label: '🧾 Pago de reserva', color: 'var(--color-verde-oscuro, #2e7d32)' },
};

// Tablas de origen que sí se pueden corregir desde aquí (ver nota de
// cabecera) — solo las que tienen forma sencilla {id, metodo_pago, monto}.
const TABLAS_EDITABLES = { movimiento_ingreso: 'caja_movimientos', movimiento_egreso: 'caja_movimientos', pago_reserva: 'reservas_pagos' };
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];
const ROLES_CORRIGEN = ['propietario', 'administrador'];

function puedeCorregir() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_CORRIGEN.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function obtenerNombresUsuarios(ids) {
  const idsUnicos = [...new Set((ids || []).filter(Boolean))];
  if (idsUnicos.length === 0) return new Map();
  const { data } = await supabase.from('usuarios').select('id, nombre').in('id', idsUnicos);
  return new Map((data || []).map((u) => [u.id, u.nombre]));
}

function primerDiaDelMes() {
  const hoy = new Date();
  return toISODate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  container.innerHTML = `
    <h2>Auditoría</h2>
    <p style="color:var(--color-texto-suave); margin-bottom:1.25rem;">Bitácora de todo movimiento de dinero: aperturas y cierres de caja, ingresos/egresos manuales, transferencias entre cuentas, ventas de mostrador y pagos de huéspedes — con quién y cuándo.</p>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <form id="form-filtro-auditoria" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${primerDiaDelMes()}" />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" />
        </label>
        <label>Tipo de evento
          <select name="tipo_evento">
            <option value="todos">Todos</option>
            ${Object.entries(ETIQUETA_TIPO)
              .map(([valor, info]) => `<option value="${valor}">${info.label}</option>`)
              .join('')}
          </select>
        </label>
        <button type="submit" class="btn btn-primario">Consultar</button>
      </form>
    </div>
    <div id="auditoria-resultado-wrap">
      <p class="mensaje-vacio">Elige un rango y dale a Consultar.</p>
    </div>
  `;

  container.querySelector('#form-filtro-auditoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await generarBitacora(
      container.querySelector('#auditoria-resultado-wrap'),
      form.get('fecha_inicio'),
      form.get('fecha_fin'),
      form.get('tipo_evento')
    );
  });

  await generarBitacora(container.querySelector('#auditoria-resultado-wrap'), primerDiaDelMes(), hoyISO, 'todos');
}

async function generarBitacora(elemento, fechaInicio, fechaFin, tipoEvento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando bitácora…</p>';

  const desde = `${fechaInicio}T00:00:00`;
  const hasta = `${fechaFin}T23:59:59`;
  const finExclusivoFecha = toISODate(addDays(new Date(`${fechaFin}T00:00:00`), 1));

  const [
    { data: turnosAbiertos, error: errAbiertos },
    { data: turnosCerrados, error: errCerrados },
    { data: movimientos, error: errMov },
    { data: transferencias, error: errTrans },
    { data: ventasMostrador, error: errVentas },
    { data: pagosReserva, error: errPagos },
  ] = await Promise.all([
    supabase.from('caja_turnos').select('id, abierto_en, abierto_por, saldo_inicial, observaciones_apertura').gte('abierto_en', desde).lte('abierto_en', hasta),
    supabase
      .from('caja_turnos')
      .select('id, cerrado_en, cerrado_por, saldo_esperado, saldo_contado, diferencia, observaciones_cierre')
      .eq('estado', 'cerrada')
      .gte('cerrado_en', desde)
      .lte('cerrado_en', hasta),
    supabase.from('caja_movimientos').select('id, tipo, categoria, monto, metodo_pago, descripcion, registrado_por, creado_en').gte('creado_en', desde).lte('creado_en', hasta),
    supabase.from('caja_transferencias').select('id, cuenta_origen, cuenta_destino, monto, motivo, registrado_por, creado_en').gte('creado_en', desde).lte('creado_en', hasta),
    supabase
      .from('ventas_mostrador')
      .select('id, cantidad, precio_unitario, monto, metodo_pago, cliente_nombre, comentarios, registrado_por, creado_en, minibar_productos(nombre)')
      .gte('creado_en', desde)
      .lte('creado_en', hasta),
    supabase
      .from('reservas_pagos')
      .select('id, reserva_id, monto, metodo_pago, comentarios, fecha, reservas(huesped_nombre, habitaciones(numero))')
      .gte('fecha', fechaInicio)
      .lt('fecha', finExclusivoFecha),
  ]);

  const error = errAbiertos || errCerrados || errMov || errTrans || errVentas || errPagos;
  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando la bitácora: ${error.message}</p>`;
    return;
  }

  // --- Normalizar todo a un mismo formato de evento ---
  const eventos = [];

  (turnosAbiertos || []).forEach((t) => {
    eventos.push({
      fecha: t.abierto_en,
      tipo: 'apertura',
      usuarioId: t.abierto_por,
      descripcion: `Apertura de caja (turno #${t.id})${t.observaciones_apertura ? ` — ${t.observaciones_apertura}` : ''}`,
      monto: Number(t.saldo_inicial || 0),
      signo: 0,
    });
  });

  (turnosCerrados || []).forEach((t) => {
    const diferencia = Number(t.diferencia || 0);
    eventos.push({
      fecha: t.cerrado_en,
      tipo: 'cierre',
      usuarioId: t.cerrado_por,
      descripcion: `Cierre de caja (turno #${t.id}) — contado ${formatCOP(t.saldo_contado)} vs. esperado ${formatCOP(t.saldo_esperado)}${diferencia !== 0 ? `, diferencia ${formatCOP(diferencia)}` : ', sin diferencia'}${t.observaciones_cierre ? `. ${t.observaciones_cierre}` : ''}`,
      monto: diferencia,
      signo: 0,
    });
  });

  (movimientos || []).forEach((m) => {
    const esIngreso = m.tipo === 'ingreso';
    eventos.push({
      id: m.id,
      tabla: 'caja_movimientos',
      fecha: m.creado_en,
      tipo: esIngreso ? 'movimiento_ingreso' : 'movimiento_egreso',
      usuarioId: m.registrado_por,
      descripcion: `${m.categoria ? `${m.categoria} — ` : ''}${m.descripcion || 'Sin descripción'} (${m.metodo_pago})`,
      metodoPago: m.metodo_pago,
      monto: Number(m.monto),
      signo: esIngreso ? 1 : -1,
    });
  });

  (transferencias || []).forEach((t) => {
    eventos.push({
      fecha: t.creado_en,
      tipo: 'transferencia',
      usuarioId: t.registrado_por,
      descripcion: `${escaparHTML(t.cuenta_origen)} → ${escaparHTML(t.cuenta_destino)}${t.motivo ? ` — ${t.motivo}` : ''}`,
      monto: Number(t.monto),
      signo: 0,
    });
  });

  (ventasMostrador || []).forEach((v) => {
    const producto = v.minibar_productos?.nombre || 'Producto';
    eventos.push({
      fecha: v.creado_en,
      tipo: 'venta_mostrador',
      usuarioId: v.registrado_por,
      descripcion: `${v.cantidad} × ${escaparHTML(producto)}${v.cliente_nombre ? ` — cliente: ${escaparHTML(v.cliente_nombre)}` : ''} (${v.metodo_pago})`,
      monto: Number(v.monto),
      signo: 1,
    });
  });

  (pagosReserva || []).forEach((p) => {
    const huesped = p.reservas?.huesped_nombre || 'Huésped';
    const habitacion = p.reservas?.habitaciones?.numero;
    eventos.push({
      id: p.id,
      tabla: 'reservas_pagos',
      fecha: p.fecha,
      tipo: 'pago_reserva',
      usuarioId: null,
      descripcion: `${escaparHTML(huesped)}${habitacion ? ` (hab. ${escaparHTML(habitacion)})` : ''} — ${p.comentarios || 'Pago de reserva'} (${p.metodo_pago})`,
      metodoPago: p.metodo_pago,
      monto: Number(p.monto),
      signo: 1,
    });
  });

  const eventosFiltrados = (tipoEvento === 'todos' ? eventos : eventos.filter((ev) => ev.tipo === tipoEvento)).sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );

  const nombresUsuarios = await obtenerNombresUsuarios(eventosFiltrados.map((ev) => ev.usuarioId));
  const permiteCorregir = puedeCorregir();

  // --- Resumen ---
  const totalIngresos = eventosFiltrados.filter((ev) => ev.signo === 1).reduce((sum, ev) => sum + ev.monto, 0);
  const totalEgresos = eventosFiltrados.filter((ev) => ev.signo === -1).reduce((sum, ev) => sum + ev.monto, 0);
  const totalTransferido = eventosFiltrados.filter((ev) => ev.tipo === 'transferencia').reduce((sum, ev) => sum + ev.monto, 0);

  elemento.innerHTML = `
    <div class="grid-tres-columnas" style="margin-bottom:1.5rem;">
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Eventos en el rango</div>
        <div class="stat-card-valor">${eventosFiltrados.length}</div>
      </div>
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Total ingresos</div>
        <div class="stat-card-valor">${formatCOP(totalIngresos)}</div>
      </div>
      <div class="stat-card stat-card-naranja">
        <div class="stat-card-label">Total transferido entre cuentas</div>
        <div class="stat-card-valor">${formatCOP(totalTransferido)}</div>
      </div>
    </div>
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:1rem;">
        <h3 style="margin:0;">Bitácora (${fechaInicio} a ${fechaFin})</h3>
        <button type="button" id="btn-exportar-auditoria" class="btn btn-secundario btn-chico">Descargar CSV</button>
      </div>
      ${permiteCorregir ? '<p class="mensaje-vacio" style="margin-top:-0.5rem; margin-bottom:0.75rem; font-size:0.78rem;">Las filas de Ingreso/Egreso manual y Pago de reserva se pueden corregir (método de pago y monto) o eliminar directo desde aquí.</p>' : ''}
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr><th>Fecha y hora</th><th>Tipo</th><th>Usuario</th><th>Descripción</th><th style="text-align:right;">Monto</th>${permiteCorregir ? '<th></th>' : ''}</tr>
          </thead>
          <tbody>
            ${
              eventosFiltrados
                .map((ev) => {
                  const info = ETIQUETA_TIPO[ev.tipo];
                  const nombreUsuario = nombresUsuarios.get(ev.usuarioId) || (ev.usuarioId ? '—' : 'Sistema (huésped)');
                  const colorMonto = ev.signo === 1 ? 'var(--color-verde-oscuro, #2e7d32)' : ev.signo === -1 ? 'var(--color-rojo-oscuro, #c62828)' : 'inherit';
                  const prefijo = ev.signo === 1 ? '+' : ev.signo === -1 ? '−' : '';
                  const editable = permiteCorregir && ev.tabla;
                  return `
                <tr data-id="${ev.id ?? ''}" data-tabla="${ev.tabla ?? ''}" data-metodo="${escaparHTML(ev.metodoPago || '')}" data-monto="${ev.monto}">
                  <td style="white-space:nowrap;">${formatFechaHora(ev.fecha)}</td>
                  <td><span style="color:${info.color}; font-weight:600;">${info.label}</span></td>
                  <td>${escaparHTML(nombreUsuario)}</td>
                  <td>${ev.descripcion}</td>
                  <td style="text-align:right; color:${colorMonto}; font-weight:600;">${prefijo}${formatCOP(Math.abs(ev.monto))}</td>
                  ${
                    permiteCorregir
                      ? `<td style="white-space:nowrap;">${
                          editable
                            ? '<button type="button" class="btn-editar btn-editar-transaccion">✏️ Editar</button> <button type="button" class="btn-editar btn-eliminar-transaccion">🗑</button>'
                            : ''
                        }</td>`
                      : ''
                  }
                </tr>
              `;
                })
                .join('') || `<tr><td colspan="${permiteCorregir ? 6 : 5}" class="mensaje-vacio">No hay eventos en este rango con ese filtro.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-auditoria').addEventListener('click', () => {
    const filas = [['Fecha y hora', 'Tipo', 'Usuario', 'Descripción', 'Monto']];
    eventosFiltrados.forEach((ev) => {
      const info = ETIQUETA_TIPO[ev.tipo];
      const nombreUsuario = nombresUsuarios.get(ev.usuarioId) || (ev.usuarioId ? '—' : 'Sistema (huésped)');
      const prefijo = ev.signo === 1 ? '+' : ev.signo === -1 ? '-' : '';
      filas.push([formatFechaHora(ev.fecha), info.label.replace(/^[^\s]+\s/, ''), nombreUsuario, ev.descripcion.replace(/<[^>]*>/g, ''), `${prefijo}${ev.monto}`]);
    });
    const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `auditoria_${fechaInicio}_a_${fechaFin}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  });

  if (!permiteCorregir) return;

  const recargar = () => generarBitacora(elemento, fechaInicio, fechaFin, tipoEvento);

  elemento.querySelectorAll('.btn-editar-transaccion').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const fila = e.target.closest('tr');
      abrirModalEditarTransaccion(
        {
          id: Number(fila.dataset.id),
          tabla: fila.dataset.tabla,
          metodoPago: fila.dataset.metodo,
          monto: Number(fila.dataset.monto),
        },
        recargar
      );
    });
  });

  elemento.querySelectorAll('.btn-eliminar-transaccion').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const tabla = fila.dataset.tabla;

      const ok = await mostrarConfirmacion({
        titulo: 'Eliminar transacción',
        contenidoHTML: '¿Eliminar esta transacción? Esta acción no se puede deshacer.',
        textoConfirmar: 'Eliminar',
      });
      if (!ok) return;

      const { error: errDelete } = await supabase.from(tabla).delete().eq('id', id);
      if (errDelete) {
        mostrarToast(`Error eliminando: ${errDelete.message}`, 'error');
        return;
      }
      mostrarToast('Transacción eliminada.', 'exito');
      await recargar();
    });
  });
}

// Modal simple para corregir método de pago y monto de una transacción
// (caja_movimientos o reservas_pagos, ver TABLAS_EDITABLES). No toca
// ningún otro campo (categoría, descripción, fecha) a propósito, para
// mantener el riesgo de esta corrección al mínimo.
function abrirModalEditarTransaccion(ev, recargar) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>Corregir transacción</h3>
      <div class="modal-contenido">
        <form id="form-editar-transaccion" class="form-grid">
          <label>Método de pago
            <select name="metodo_pago" required>
              ${METODOS_PAGO.map((m) => `<option value="${m}" ${ev.metodoPago === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label>Monto
            <input type="number" name="monto" min="0" step="1" value="${ev.monto}" required />
          </label>
        </form>
      </div>
      <div class="modal-acciones">
        <button type="button" class="btn btn-secundario" id="btn-cancelar-editar-transaccion">Cancelar</button>
        <button type="submit" form="form-editar-transaccion" class="btn btn-primario">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-editar-transaccion').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-editar-transaccion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      metodo_pago: form.get('metodo_pago'),
      monto: Number(form.get('monto')),
    };

    const { error } = await supabase.from(ev.tabla).update(payload).eq('id', ev.id);
    overlay.remove();

    if (error) {
      mostrarToast(`Error corrigiendo la transacción: ${error.message}`, 'error');
      return;
    }

    mostrarToast('Transacción corregida.', 'exito');
    await recargar();
  });
}

registerModule({
  id: 'auditoria',
  label: 'Auditoría',
  icono: '🔍',
  roles: ['propietario', 'administrador', 'auditor'],
  parentId: 'grupo-analisis',
  render,
});
