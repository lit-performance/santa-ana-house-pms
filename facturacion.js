// facturacion.js
//
// Módulo: Facturación. Documento equivalente por cada estadía ya con
// check-out hecho. El subtotal se calcula solo (monto de la habitación +
// consumo de minibar de esa reserva, igual que en la liquidación de
// Recepción) — no se edita a mano para que siempre cuadre con lo que
// realmente se cobró. El % de impuesto queda en 0 por defecto y es
// editable por factura (ver nota de alcance en la SQL: pendiente de
// confirmar con el contador si aplica IVA, INC o exención de hospedaje).
//
// "Imprimir" abre una ventana aparte con solo el documento, sin el resto
// de la app, lista para imprimir o guardar como PDF desde el navegador.
//
// Estructura de datos plana a propósito para poder integrar más adelante
// facturación electrónica DIAN (CUFE, resolución, etc.) sin romper nada de
// lo que ya existe.
//
// Oculto temporalmente (roles: []) porque por ahora el hotel no factura —
// ver nota de cabecera en placeholders.js. El código y los datos siguen
// intactos; reactivar es solo devolverle su lista de roles.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaHora } from './dates.js';
import { getUsuarioActual } from './auth.js';

const ROLES_GESTIONAN = ['propietario', 'administrador', 'contador'];

function puedeGestionar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_GESTIONAN.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Facturación</h2>
    <div id="facturacion-nueva-wrap" style="margin-bottom:1.5rem;"></div>
    <div id="facturacion-lista-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await Promise.all([
    cargarFormNuevaFactura(container.querySelector('#facturacion-nueva-wrap')),
    cargarListaFacturas(container.querySelector('#facturacion-lista-wrap')),
  ]);
}

// =========================================================
// Nueva factura
// =========================================================
async function cargarFormNuevaFactura(elemento) {
  if (!puedeGestionar()) {
    elemento.innerHTML = '';
    return;
  }

  const { data: reservas, error: errReservas } = await supabase
    .from('reservas')
    .select('id, huesped_nombre, huesped_documento, fecha_checkin, fecha_checkout, monto_total, habitaciones(numero, nombre)')
    .eq('estado', 'check_out')
    .order('fecha_checkout', { ascending: false })
    .limit(100);

  if (errReservas) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando reservas: ${errReservas.message}</p>`;
    return;
  }

  const reservaIds = (reservas || []).map((r) => r.id);
  const [{ data: facturasExistentes }, { data: minibar }] = await Promise.all([
    reservaIds.length
      ? supabase.from('facturas').select('reserva_id, estado').in('reserva_id', reservaIds)
      : Promise.resolve({ data: [] }),
    reservaIds.length
      ? supabase.from('minibar_consumos').select('reserva_id, monto').in('reserva_id', reservaIds)
      : Promise.resolve({ data: [] }),
  ]);

  const reservasConFacturaEmitida = new Set(
    (facturasExistentes || []).filter((f) => f.estado === 'emitida').map((f) => f.reserva_id)
  );
  const minibarPorReserva = new Map();
  (minibar || []).forEach((m) => {
    minibarPorReserva.set(m.reserva_id, (minibarPorReserva.get(m.reserva_id) || 0) + Number(m.monto));
  });

  const elegibles = (reservas || [])
    .filter((r) => !reservasConFacturaEmitida.has(r.id))
    .map((r) => ({
      ...r,
      montoTotal: Number(r.monto_total || 0) + (minibarPorReserva.get(r.id) || 0),
    }));

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>+ Generar factura</h3>
      ${
        elegibles.length === 0
          ? '<p class="mensaje-vacio">No hay estadías con check-out hecho pendientes de facturar.</p>'
          : `
        <form id="form-nueva-factura" class="form-grid">
          <label>Estadía
            <select name="reserva_id" id="select-reserva-factura" required>
              ${elegibles
                .map(
                  (r) =>
                    `<option value="${r.id}">${escaparHTML(r.huesped_nombre)} — ${r.habitaciones ? escaparHTML(r.habitaciones.numero) : '—'} (${r.fecha_checkin} a ${r.fecha_checkout})</option>`
                )
                .join('')}
            </select>
          </label>
          <label>Subtotal
            <input type="text" id="subtotal-preview" readonly value="${formatCOP(elegibles[0].montoTotal)}" />
          </label>
          <label>% Impuesto
            <input type="number" name="impuesto_porcentaje" min="0" step="0.1" value="0" />
          </label>
          <label>Notas
            <input type="text" name="notas" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-primario">Generar factura</button>
        </form>
      `
      }
    </div>
  `;

  if (elegibles.length === 0) return;

  const selectReserva = elemento.querySelector('#select-reserva-factura');
  const subtotalPreview = elemento.querySelector('#subtotal-preview');
  selectReserva.addEventListener('change', () => {
    const r = elegibles.find((x) => x.id === Number(selectReserva.value));
    subtotalPreview.value = formatCOP(r ? r.montoTotal : 0);
  });

  elemento.querySelector('#form-nueva-factura').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const reserva = elegibles.find((r) => r.id === Number(form.get('reserva_id')));
    if (!reserva) return;

    const impuestoPorcentaje = Number(form.get('impuesto_porcentaje')) || 0;
    const subtotal = reserva.montoTotal;
    const impuestoValor = Math.round((subtotal * impuestoPorcentaje) / 100);
    const total = subtotal + impuestoValor;
    const usuario = getUsuarioActual();

    const { error } = await supabase.from('facturas').insert({
      reserva_id: reserva.id,
      huesped_nombre: reserva.huesped_nombre,
      huesped_documento: reserva.huesped_documento,
      subtotal,
      impuesto_porcentaje: impuestoPorcentaje,
      impuesto_valor: impuestoValor,
      total,
      notas: form.get('notas').trim() || null,
      creado_por: usuario?.id || null,
    });

    if (error) {
      mostrarToast(`Error generando la factura: ${error.message}`, 'error');
      return;
    }

    mostrarToast('Factura generada.', 'exito');
    const wrapNueva = document.querySelector('#facturacion-nueva-wrap');
    const wrapLista = document.querySelector('#facturacion-lista-wrap');
    if (wrapNueva) await cargarFormNuevaFactura(wrapNueva);
    if (wrapLista) await cargarListaFacturas(wrapLista);
  });
}

// =========================================================
// Lista de facturas
// =========================================================
async function cargarListaFacturas(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeGestionar();

  const { data: facturas, error } = await supabase.from('facturas').select('*').order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando facturas: ${error.message}</p>`;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Facturas emitidas</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>#</th>
              <th>Huésped</th>
              <th>Fecha</th>
              <th>Subtotal</th>
              <th>Impuesto</th>
              <th>Total</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              (facturas || [])
                .map(
                  (f) => `
              <tr data-id="${f.id}" style="${f.estado === 'anulada' ? 'opacity:0.55;' : ''}">
                <td>${f.id}</td>
                <td>${escaparHTML(f.huesped_nombre)}</td>
                <td>${f.fecha_emision}</td>
                <td>${formatCOP(f.subtotal)}</td>
                <td>${formatCOP(f.impuesto_valor)} (${f.impuesto_porcentaje}%)</td>
                <td style="font-weight:700;">${formatCOP(f.total)}</td>
                <td>${f.estado === 'anulada' ? '⚪ Anulada' : '🟢 Emitida'}</td>
                <td>
                  <button type="button" class="btn-editar btn-imprimir-factura" data-id="${f.id}">Imprimir</button>
                  ${permitido && f.estado === 'emitida' ? `<button type="button" class="btn-editar btn-anular-factura" data-id="${f.id}">Anular</button>` : ''}
                </td>
              </tr>
            `
                )
                .join('') || '<tr><td colspan="8" class="mensaje-vacio">Sin facturas generadas todavía.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelectorAll('.btn-imprimir-factura').forEach((btn) => {
    btn.addEventListener('click', () => {
      const factura = (facturas || []).find((f) => f.id === Number(btn.dataset.id));
      if (factura) abrirVentanaFactura(factura);
    });
  });

  if (!permitido) return;

  elemento.querySelectorAll('.btn-anular-factura').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Anular factura',
        contenidoHTML: '¿Anular esta factura? Queda marcada como anulada, no se borra.',
        textoConfirmar: 'Anular',
      });
      if (!ok) return;
      const { error } = await supabase.from('facturas').update({ estado: 'anulada' }).eq('id', Number(btn.dataset.id));
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Factura anulada.', 'exito');
      await cargarListaFacturas(elemento);
      const wrapNueva = document.querySelector('#facturacion-nueva-wrap');
      if (wrapNueva) await cargarFormNuevaFactura(wrapNueva);
    });
  });
}

function abrirVentanaFactura(f) {
  const ventana = window.open('', '_blank', 'width=650,height=800');
  if (!ventana) {
    mostrarToast('El navegador bloqueó la ventana emergente. Habilítala para imprimir la factura.', 'error');
    return;
  }
  ventana.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Factura #${f.id} — Santa Ana House 21</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 2rem; color: #1a1a1a; }
        h1 { font-size: 1.3rem; margin-bottom: 0; }
        .subtitulo { color: #666; margin-top: 0.2rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
        td, th { padding: 0.5rem; border-bottom: 1px solid #ddd; text-align: left; }
        .total-row td { font-weight: bold; font-size: 1.1rem; border-top: 2px solid #1a1a1a; }
        .anulada { color: #b00020; font-weight: bold; text-transform: uppercase; margin-top: 1rem; }
      </style>
    </head>
    <body>
      <h1>Santa Ana House 21</h1>
      <p class="subtitulo">Documento equivalente de hospedaje — Factura #${f.id}</p>
      <p>Fecha de emisión: ${f.fecha_emision}</p>
      <p>Huésped: ${escaparHTML(f.huesped_nombre)}${f.huesped_documento ? ` — Doc: ${escaparHTML(f.huesped_documento)}` : ''}</p>
      <table>
        <tr><td>Subtotal</td><td>${formatCOP(f.subtotal)}</td></tr>
        <tr><td>Impuesto (${f.impuesto_porcentaje}%)</td><td>${formatCOP(f.impuesto_valor)}</td></tr>
        <tr class="total-row"><td>Total</td><td>${formatCOP(f.total)}</td></tr>
      </table>
      ${f.notas ? `<p style="margin-top:1rem;">Notas: ${escaparHTML(f.notas)}</p>` : ''}
      ${f.estado === 'anulada' ? '<p class="anulada">Factura anulada</p>' : ''}
      <script>window.onload = () => window.print();</script>
    </body>
    </html>
  `);
  ventana.document.close();
}

registerModule({
  id: 'facturacion',
  label: 'Facturación',
  icono: '🧾',
  roles: [],
  parentId: 'grupo-finanzas',
  render,
});
