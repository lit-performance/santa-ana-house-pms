// gastos.js
//
// Módulo: Gastos. Registro rápido de gastos operativos del hotel (agua,
// luz, gas, aseo, mantenimiento, insumos, etc.) — pagables desde
// cualquier cuenta/medio de pago, igual que un movimiento de Caja.
//
// Deliberadamente NO crea una tabla nueva: cada gasto se guarda como un
// `caja_movimientos` normal con tipo='egreso' y una categoría de la lista
// fija de abajo. Esto es a propósito — así el gasto queda automáticamente
// reflejado en TODO lo que ya lee caja_movimientos sin tocar esos
// archivos: el resumen del día y el desglose por medio de pago en
// "Registro diario" (caja.js), Indicadores, Contabilidad y Auditoría.
//
// Nota IMPORTANTE (ya no hay que "abrir caja" para registrar un gasto):
// desde el rediseño de Registro diario, el turno del día se administra
// solo por dentro (ver `obtenerOCrearTurnoDeHoy` en caja.js, importada
// aquí) — nunca hay que pedirle a la recepcionista que abra nada antes de
// poder registrar un gasto, se resuelve automático al guardar.
//
// Nota sobre "Monto" (corrige un bug real de capacitación): antes el
// campo era type="number" con step="1000" y min="1" — eso hace que el
// navegador exija que el valor sea EXACTAMENTE 1 más un múltiplo de 1000
// (1, 1001, 2001, 3001…), así que al escribir un monto normal como
// "20000" el navegador lo rechazaba con un mensaje confuso. Ahora el
// campo es de texto con formato "$" y punto de miles en vivo (igual que
// el resto del sistema, ver currency.js) y acepta cualquier monto.
//
// Nota sobre "Link del comprobante (Drive)": campo opcional para pegar el
// link donde quedó alojada la factura/soporte del gasto. No se creó una
// columna nueva en la base de datos — se guarda como parte del texto de
// `descripcion` (junto con proveedor y notas), y en el historial se
// muestra como un enlace clicable "🔗 Ver soporte" en vez del link
// completo.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatCOP, activarInputDinero, valorNumericoInput } from './currency.js';
import { formatFechaHora, toISODate } from './dates.js';
import { getUsuarioActual } from './auth.js';
import { obtenerOCrearTurnoDeHoy } from './caja.js';

const ROLES_OPERAN = ['propietario', 'administrador', 'recepcionista'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];
const CATEGORIAS_GASTOS = ['Agua', 'Luz', 'Gas', 'Internet', 'Aseo', 'Mantenimiento', 'Insumos', 'Nómina', 'Otro'];

function puedeOperar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_OPERAN.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// Igual que escaparHTML, pero convierte cualquier URL http(s) suelta en
// el texto en un enlace clicable "🔗 Ver soporte" — así el link de Drive
// pegado al registrar el gasto queda usable desde el historial.
function linkificarDescripcion(texto) {
  const escapado = escaparHTML(texto || '');
  return escapado.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">🔗 Ver soporte</a>');
}

function primerDiaDelMes() {
  const hoy = new Date();
  return toISODate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

async function render(container) {
  const hoyISO = toISODate(new Date());
  container.innerHTML = `
    <h2>Gastos</h2>
    <p style="color:var(--color-texto-suave); margin-bottom:1.25rem;">Registro de gastos operativos del hotel — agua, luz, gas, aseo, mantenimiento y demás. Cada gasto se paga desde la cuenta que elijas y queda reflejado de inmediato en Registro diario, Indicadores, Contabilidad y Auditoría.</p>
    <div id="gastos-form-wrap" style="margin-bottom:1.5rem;"></div>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <form id="form-filtro-gastos" class="form-grid">
        <label>Desde
          <input type="date" name="fecha_inicio" value="${primerDiaDelMes()}" />
        </label>
        <label>Hasta
          <input type="date" name="fecha_fin" value="${hoyISO}" />
        </label>
        <button type="submit" class="btn btn-primario">Consultar</button>
      </form>
    </div>
    <div id="gastos-lista-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#form-filtro-gastos').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await cargarListaGastos(container.querySelector('#gastos-lista-wrap'), form.get('fecha_inicio'), form.get('fecha_fin'));
  });

  await Promise.all([
    cargarFormNuevoGasto(container.querySelector('#gastos-form-wrap'), container),
    cargarListaGastos(container.querySelector('#gastos-lista-wrap'), primerDiaDelMes(), hoyISO),
  ]);
}

async function cargarFormNuevoGasto(elemento, container) {
  if (!puedeOperar()) {
    elemento.innerHTML = '';
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3 style="margin-top:0;">+ Registrar gasto</h3>
      <form id="form-nuevo-gasto" class="form-grid">
        <label>Categoría
          <select name="categoria" required>
            ${CATEGORIAS_GASTOS.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </label>
        <label>Monto
          <input type="text" name="monto" id="input-monto-gasto" placeholder="$0" required />
        </label>
        <label>Pagado desde
          <select name="metodo_pago" required>
            ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </label>
        <label>Proveedor / a quién se pagó <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
          <input type="text" name="proveedor" placeholder="Opcional" />
        </label>
        <label>Link del comprobante (Drive) <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
          <input type="url" name="link_drive" placeholder="https://drive.google.com/..." />
        </label>
      </form>
      <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:0.75rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
        Notas
        <textarea form="form-nuevo-gasto" name="notas" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;" placeholder="Opcional"></textarea>
      </label>
      <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.75rem;">
        <button type="submit" form="form-nuevo-gasto" class="btn btn-primario">Registrar gasto</button>
      </div>
    </div>
  `;

  const inputMonto = elemento.querySelector('#input-monto-gasto');
  activarInputDinero(inputMonto);

  elemento.querySelector('#form-nuevo-gasto').addEventListener('submit', async (e) => {
    e.preventDefault();

    const montoValor = valorNumericoInput(inputMonto);
    if (montoValor <= 0) {
      mostrarToast('Ingresa un monto válido para el gasto.', 'error');
      return;
    }

    let turno;
    try {
      turno = await obtenerOCrearTurnoDeHoy();
    } catch (errTurno) {
      mostrarToast(`No se pudo registrar el gasto: ${errTurno.message}`, 'error');
      return;
    }

    const form = new FormData(e.target);
    const usuario = getUsuarioActual();
    const proveedor = form.get('proveedor').trim();
    const notas = form.get('notas').trim();
    const linkDrive = form.get('link_drive').trim();
    const descripcionPartes = [
      proveedor ? `Pagado a: ${proveedor}` : null,
      notas || null,
      linkDrive ? `Soporte: ${linkDrive}` : null,
    ].filter(Boolean);

    const { error } = await supabase.from('caja_movimientos').insert({
      turno_id: turno.id,
      tipo: 'egreso',
      categoria: form.get('categoria'),
      monto: montoValor,
      metodo_pago: form.get('metodo_pago'),
      descripcion: descripcionPartes.length ? descripcionPartes.join(' — ') : null,
      registrado_por: usuario?.id || null,
    });

    if (error) {
      mostrarToast(`Error registrando el gasto: ${error.message}`, 'error');
      return;
    }

    mostrarToast('Gasto registrado.', 'exito');
    e.target.reset();
    activarInputDinero(inputMonto);
    const wrapLista = document.querySelector('#gastos-lista-wrap');
    if (wrapLista) {
      const formFiltro = container.querySelector('#form-filtro-gastos');
      const fd = new FormData(formFiltro);
      await cargarListaGastos(wrapLista, fd.get('fecha_inicio'), fd.get('fecha_fin'));
    }
  });
}

async function cargarListaGastos(elemento, fechaInicioISO, fechaFinISO) {
  if (!fechaInicioISO || !fechaFinISO || fechaFinISO < fechaInicioISO) {
    elemento.innerHTML = '<p class="mensaje-vacio">Revisa el rango de fechas.</p>';
    return;
  }

  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const desde = `${fechaInicioISO}T00:00:00`;
  const hasta = `${fechaFinISO}T23:59:59`;

  const { data: gastos, error } = await supabase
    .from('caja_movimientos')
    .select('id, categoria, monto, metodo_pago, descripcion, creado_en')
    .eq('tipo', 'egreso')
    .in('categoria', CATEGORIAS_GASTOS)
    .gte('creado_en', desde)
    .lte('creado_en', hasta)
    .order('creado_en', { ascending: false });

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando gastos: ${error.message}</p>`;
    return;
  }

  const total = (gastos || []).reduce((sum, g) => sum + Number(g.monto), 0);
  const porCategoria = new Map();
  (gastos || []).forEach((g) => {
    porCategoria.set(g.categoria, (porCategoria.get(g.categoria) || 0) + Number(g.monto));
  });

  elemento.innerHTML = `
    <div class="grid-tres-columnas" style="margin-bottom:1.25rem;">
      <div class="stat-card stat-card-rojo">
        <div class="stat-card-label">Total gastado en el rango</div>
        <div class="stat-card-valor">${formatCOP(total)}</div>
        <div class="stat-card-subtitulo">${(gastos || []).length} gasto(s) registrados</div>
      </div>
      <div class="stat-card stat-card-naranja" style="grid-column: span 2;">
        <div class="stat-card-label">Por categoría</div>
        <div style="font-size:0.85rem; margin-top:0.3rem; line-height:1.6;">
          ${
            Array.from(porCategoria.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, monto]) => `<span style="margin-right:1rem;"><strong>${escaparHTML(cat)}:</strong> ${formatCOP(monto)}</span>`)
              .join('') || '<span class="mensaje-vacio">Sin gastos en el rango.</span>'
          }
        </div>
      </div>
    </div>
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.75rem;">
        <h3 style="margin:0;">Historial de gastos</h3>
        <button type="button" id="btn-exportar-gastos" class="btn btn-secundario btn-chico">⬇ Excel</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead><tr><th>Fecha</th><th>Categoría</th><th>Monto</th><th>Pagado desde</th><th>Detalle</th></tr></thead>
          <tbody>
            ${
              (gastos || [])
                .map(
                  (g) => `<tr>
                <td>${formatFechaHora(g.creado_en)}</td>
                <td>${escaparHTML(g.categoria)}</td>
                <td class="monto">${formatCOP(g.monto)}</td>
                <td>${escaparHTML(g.metodo_pago || '—')}</td>
                <td>${g.descripcion ? linkificarDescripcion(g.descripcion) : '—'}</td>
              </tr>`
                )
                .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin gastos registrados en este rango.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  elemento.querySelector('#btn-exportar-gastos').addEventListener('click', () => {
    const filas = [
      ['Gastos — Santa Ana House 21'],
      ['Rango', `${fechaInicioISO} a ${fechaFinISO}`],
      ['Total', total],
      [],
      ['Fecha', 'Categoría', 'Monto', 'Pagado desde', 'Detalle'],
      ...(gastos || []).map((g) => [formatFechaHora(g.creado_en), g.categoria, g.monto, g.metodo_pago || '', g.descripcion || '']),
    ];
    const csv = filas.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `gastos_${fechaInicioISO}_a_${fechaFinISO}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  });
}

registerModule({
  id: 'gastos',
  label: 'Gastos',
  icono: '💸',
  roles: ['propietario', 'administrador', 'recepcionista', 'contador', 'auditor'],
  parentId: 'caja',
  render,
});
