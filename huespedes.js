// huespedes.js
//
// Módulo 5: Huéspedes. Ficha persistente por huésped (buscar por nombre,
// documento, teléfono, correo o empresa), con preferencias/alergias/
// observaciones editables y un histórico de estadías calculado a partir de
// `reservas` (frecuencia de visitas, total gastado, última visita).
//
// Nota de alcance: "total gastado" suma `reservas.monto_total` de las
// estadías con estado 'hospedado' o 'check_out' — es un valor de
// referencia hasta que el módulo Caja registre pagos reales.
//
// La ficha de cada huésped se crea/actualiza automáticamente al hacer un
// check-in en Recepción (ver recepcion.js), pero también se puede crear o
// editar manualmente aquí.
//
// Nota de ubicación: vive como subpestaña de "Análisis" (parentId
// grupo-analisis) — es más un histórico/directorio de clientes que una
// pantalla de uso diario, y el check-in ya autocompleta lo esencial de un
// huésped recurrente sin tener que entrar aquí. Sigue siendo visible para
// recepcionista (ver el rol del grupo en placeholders.js) para poder
// buscar o corregir la ficha de alguien sin necesidad de un check-in.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaCorta } from './dates.js';
import { badgeEstadoReserva } from './badges.js';

const ESTADOS_VISITA = ['hospedado', 'check_out'];

async function render(container) {
  container.innerHTML = `
    <h2>Huéspedes</h2>
    <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:1rem; gap:1rem; flex-wrap:wrap;">
      <input type="search" id="buscador-huespedes" placeholder="Buscar por nombre, documento, teléfono, correo o empresa…" style="flex:1; min-width:260px; padding:0.6rem 0.8rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;" />
      <button id="btn-nuevo-huesped" class="btn btn-primario">+ Nuevo huésped</button>
    </div>
    <div id="huespedes-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nuevo-huesped').addEventListener('click', () => abrirModalHuesped(container, null));

  let temporizador;
  container.querySelector('#buscador-huespedes').addEventListener('input', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => cargarHuespedes(container, e.target.value.trim()), 300);
  });

  await cargarHuespedes(container, '');
}

async function cargarHuespedes(container, termino) {
  const wrap = container.querySelector('#huespedes-wrap');
  wrap.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  let query = supabase.from('huespedes').select('*').order('actualizado_en', { ascending: false }).limit(100);

  if (termino) {
    const t = `%${termino}%`;
    query = query.or(`nombre.ilike.${t},numero_documento.ilike.${t},telefono.ilike.${t},correo.ilike.${t},empresa.ilike.${t}`);
  }

  const { data: huespedes, error } = await query;

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando huéspedes: ${error.message}</p>`;
    return;
  }

  if (!huespedes || huespedes.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">No se encontraron huéspedes.</p>';
    return;
  }

  const documentos = huespedes.map((h) => h.numero_documento);
  const { data: estadias, error: errEstadias } = await supabase
    .from('reservas')
    .select('huesped_documento, estado, monto_total, fecha_checkin')
    .in('huesped_documento', documentos)
    .in('estado', ESTADOS_VISITA);

  if (errEstadias) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando historial: ${errEstadias.message}</p>`;
    return;
  }

  const statsPorDocumento = {};
  (estadias || []).forEach((r) => {
    const s = (statsPorDocumento[r.huesped_documento] ||= { visitas: 0, total: 0, ultima: null });
    s.visitas += 1;
    s.total += Number(r.monto_total || 0);
    if (!s.ultima || r.fecha_checkin > s.ultima) s.ultima = r.fecha_checkin;
  });

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Documento</th>
          <th>Teléfono</th>
          <th>Correo</th>
          <th>Empresa</th>
          <th>Visitas</th>
          <th>Total gastado</th>
          <th>Última visita</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${huespedes
          .map((h) => {
            const s = statsPorDocumento[h.numero_documento] || { visitas: 0, total: 0, ultima: null };
            return `
          <tr data-documento="${escaparHTML(h.numero_documento)}">
            <td>${escaparHTML(h.nombre)}</td>
            <td>${escaparHTML(h.numero_documento)}</td>
            <td>${escaparHTML(h.telefono || '—')}</td>
            <td>${escaparHTML(h.correo || '—')}</td>
            <td>${escaparHTML(h.empresa || '—')}</td>
            <td>${s.visitas}</td>
            <td>${formatCOP(s.total)}</td>
            <td>${s.ultima ? formatFechaCorta(s.ultima) : '—'}</td>
            <td><button type="button" class="btn-editar btn-ver-huesped" data-id="${h.id}">Ver / Editar</button></td>
          </tr>
        `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-ver-huesped').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const { data: huesped, error: errHuesped } = await supabase.from('huespedes').select('*').eq('id', id).single();
      if (errHuesped) {
        mostrarToast(`Error: ${errHuesped.message}`, 'error');
        return;
      }
      abrirModalHuesped(container, huesped);
    });
  });
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function abrirModalHuesped(container, huesped) {
  const editando = Boolean(huesped);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>${editando ? `Ficha de ${escaparHTML(huesped.nombre)}` : 'Nuevo huésped'}</h3>
      <form id="form-huesped" class="modal-contenido">
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required value="${editando ? escaparHTML(huesped.nombre) : ''}" />
          </label>
          <label>Tipo de documento
            <input type="text" name="tipo_documento" value="${editando ? escaparHTML(huesped.tipo_documento || '') : ''}" />
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required ${editando ? 'readonly' : ''} value="${editando ? escaparHTML(huesped.numero_documento) : ''}" />
          </label>
          <label>Teléfono
            <input type="text" name="telefono" value="${editando ? escaparHTML(huesped.telefono || '') : ''}" />
          </label>
          <label>Correo
            <input type="email" name="correo" value="${editando ? escaparHTML(huesped.correo || '') : ''}" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" value="${editando ? escaparHTML(huesped.empresa || '') : ''}" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Preferencias
          <textarea name="preferencias" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(huesped.preferencias || '') : ''}</textarea>
        </label>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Alergias
          <textarea name="alergias" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(huesped.alergias || '') : ''}</textarea>
        </label>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(huesped.observaciones || '') : ''}</textarea>
        </label>

        ${editando ? '<div id="historial-wrap" style="margin-top:1.25rem;"><p class="mensaje-vacio">Cargando historial…</p></div>' : ''}

        <div class="modal-acciones" style="margin-top:1.25rem;">
          ${editando ? '<button type="button" class="btn btn-peligro" id="btn-eliminar-huesped" style="margin-right:auto;">Eliminar</button>' : ''}
          <button type="button" class="btn btn-secundario" id="btn-cancelar-huesped">Cerrar</button>
          <button type="submit" class="btn btn-primario">${editando ? 'Guardar cambios' : 'Crear huésped'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-huesped').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  if (editando) {
    cargarHistorial(overlay, huesped.numero_documento);
    overlay.querySelector('#btn-eliminar-huesped').addEventListener('click', async () => {
      const ok = await mostrarConfirmacion({
        titulo: 'Eliminar huésped',
        contenidoHTML: `¿Eliminar la ficha de <strong>${escaparHTML(huesped.nombre)}</strong>? Esto no elimina sus reservas ni check-ins pasados, solo la ficha de preferencias/observaciones.`,
        textoConfirmar: 'Eliminar',
      });
      if (!ok) return;
      const { error } = await supabase.from('huespedes').delete().eq('id', huesped.id);
      if (error) {
        mostrarToast(`Error eliminando: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Huésped eliminado.', 'exito');
      overlay.remove();
      await cargarHuespedes(container, container.querySelector('#buscador-huespedes')?.value.trim() || '');
    });
  }

  overlay.querySelector('#form-huesped').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      nombre: form.get('nombre').trim(),
      tipo_documento: form.get('tipo_documento').trim() || null,
      numero_documento: form.get('numero_documento').trim(),
      telefono: form.get('telefono').trim() || null,
      correo: form.get('correo').trim() || null,
      empresa: form.get('empresa').trim() || null,
      preferencias: form.get('preferencias').trim() || null,
      alergias: form.get('alergias').trim() || null,
      observaciones: form.get('observaciones').trim() || null,
      actualizado_en: new Date().toISOString(),
    };

    const query = editando
      ? supabase.from('huespedes').update(payload).eq('id', huesped.id)
      : supabase.from('huespedes').insert(payload);

    const { error } = await query;
    if (error) {
      mostrarToast(`Error guardando: ${error.message}`, 'error');
      return;
    }
    mostrarToast(editando ? 'Ficha actualizada.' : 'Huésped creado.', 'exito');
    overlay.remove();
    await cargarHuespedes(container, container.querySelector('#buscador-huespedes')?.value.trim() || '');
  });
}

async function cargarHistorial(overlay, documento) {
  const wrap = overlay.querySelector('#historial-wrap');
  const { data: estadias, error } = await supabase
    .from('reservas')
    .select('*, habitaciones(numero, nombre)')
    .eq('huesped_documento', documento)
    .order('fecha_checkin', { ascending: false });

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando historial: ${error.message}</p>`;
    return;
  }

  if (!estadias || estadias.length === 0) {
    wrap.innerHTML = '<h3>Historial de estadías</h3><p class="mensaje-vacio">Sin estadías registradas todavía.</p>';
    return;
  }

  const totalGastado = estadias
    .filter((e) => ESTADOS_VISITA.includes(e.estado))
    .reduce((sum, e) => sum + Number(e.monto_total || 0), 0);
  const visitas = estadias.filter((e) => ESTADOS_VISITA.includes(e.estado)).length;

  wrap.innerHTML = `
    <h3>Historial de estadías — ${visitas} visita${visitas === 1 ? '' : 's'}, total ${formatCOP(totalGastado)}</h3>
    <table class="tabla-simple">
      <thead><tr><th>Check-in</th><th>Check-out</th><th>Habitación</th><th>Estado</th><th>Monto</th></tr></thead>
      <tbody>
        ${estadias
          .map(
            (e) => `
          <tr>
            <td>${formatFechaCorta(e.fecha_checkin)}</td>
            <td>${formatFechaCorta(e.fecha_checkout)}</td>
            <td>${e.habitaciones ? `${e.habitaciones.numero} — ${e.habitaciones.nombre}` : '—'}</td>
            <td>${badgeEstadoReserva(e.estado)}</td>
            <td>${e.monto_total ? formatCOP(e.monto_total) : '—'}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

registerModule({
  id: 'huespedes',
  label: 'Huéspedes',
  icono: '🧳',
  roles: ['propietario', 'administrador', 'recepcionista', 'auditor'],
  parentId: 'grupo-analisis',
  render,
});
