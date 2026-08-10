// crm.js
//
// Módulo: CRM. Seguimiento comercial de huéspedes corporativos, agencias y
// clientes frecuentes: oportunidades con etapa, valor estimado, próximo
// seguimiento, y una bitácora de interacciones (llamadas, correos,
// reuniones, notas) por oportunidad.
//
// Se apoya en la ficha de Huéspedes ya construida: una oportunidad puede
// enlazarse a un huésped existente (por número de documento), pero también
// admite contactos que todavía no son huéspedes (agencias, prospectos).
//
// Oculto temporalmente (roles: []) durante la capacitación del equipo —
// ver nota de cabecera en placeholders.js. El código y los datos siguen
// intactos; reactivar es solo devolverle su lista de roles.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatCOP } from './currency.js';
import { formatFechaCorta, formatFechaHora, toISODate } from './dates.js';

const ETAPAS = ['prospecto', 'contactado', 'negociacion', 'ganado', 'perdido'];
const ETIQUETA_ETAPA = {
  prospecto: '🌱 Prospecto',
  contactado: '📞 Contactado',
  negociacion: '🤝 Negociación',
  ganado: '✅ Ganado',
  perdido: '❌ Perdido',
};
const ETAPAS_ABIERTAS = ['prospecto', 'contactado', 'negociacion'];
const ETIQUETA_TIPO_INTERACCION = {
  llamada: '📞 Llamada',
  correo: '✉️ Correo',
  reunion: '🤝 Reunión',
  nota: '📝 Nota',
};

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>CRM</h2>
    <div id="crm-resumen-wrap" style="margin-bottom:1.5rem;"></div>
    <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:1rem; gap:1rem; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem;">
        Filtrar por etapa
        <select id="filtro-etapa">
          <option value="abiertas">Abiertas (prospecto/contactado/negociación)</option>
          <option value="todas">Todas</option>
          ${ETAPAS.map((e) => `<option value="${e}">${ETIQUETA_ETAPA[e]}</option>`).join('')}
        </select>
      </label>
      <button type="button" id="btn-nueva-oportunidad" class="btn btn-primario">+ Nueva oportunidad</button>
    </div>
    <div id="crm-lista-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nueva-oportunidad').addEventListener('click', () => abrirModalOportunidad(container, null));
  container.querySelector('#filtro-etapa').addEventListener('change', (e) => cargarLista(container, e.target.value));

  await cargarLista(container, 'abiertas');
}

async function cargarLista(container, filtroEtapa) {
  const wrap = container.querySelector('#crm-lista-wrap');
  const resumenWrap = container.querySelector('#crm-resumen-wrap');
  wrap.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  let query = supabase.from('crm_oportunidades').select('*').order('fecha_proximo_seguimiento', { ascending: true, nullsFirst: false });
  if (filtroEtapa === 'abiertas') query = query.in('etapa', ETAPAS_ABIERTAS);
  else if (filtroEtapa !== 'todas') query = query.eq('etapa', filtroEtapa);

  const { data: oportunidades, error } = await query;

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando CRM: ${error.message}</p>`;
    return;
  }

  // --- Resumen (siempre sobre TODAS las oportunidades abiertas, no sobre el filtro actual) ---
  const { data: todasAbiertas } = await supabase.from('crm_oportunidades').select('etapa, valor_estimado, fecha_proximo_seguimiento').in('etapa', ETAPAS_ABIERTAS);
  const hoyISO = toISODate(new Date());
  const totalAbiertas = (todasAbiertas || []).length;
  const valorEstimadoTotal = (todasAbiertas || []).reduce((acc, o) => acc + Number(o.valor_estimado || 0), 0);
  const vencidas = (todasAbiertas || []).filter((o) => o.fecha_proximo_seguimiento && o.fecha_proximo_seguimiento < hoyISO).length;

  resumenWrap.innerHTML = `
    <div class="grid-tres-columnas">
      <div class="stat-card stat-card-azul">
        <div class="stat-card-label">Oportunidades abiertas</div>
        <div class="stat-card-valor">${totalAbiertas}</div>
      </div>
      <div class="stat-card stat-card-verde">
        <div class="stat-card-label">Valor estimado abierto</div>
        <div class="stat-card-valor">${formatCOP(valorEstimadoTotal)}</div>
      </div>
      <div class="stat-card ${vencidas > 0 ? 'stat-card-naranja' : 'stat-card-azul'}">
        <div class="stat-card-label">Seguimientos vencidos</div>
        <div class="stat-card-valor">${vencidas}</div>
      </div>
    </div>
  `;

  if (!oportunidades || oportunidades.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">No hay oportunidades en este filtro.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr><th>Contacto</th><th>Empresa</th><th>Etapa</th><th>Valor estimado</th><th>Próximo seguimiento</th><th></th></tr>
      </thead>
      <tbody>
        ${oportunidades
          .map((o) => {
            const vencida = o.fecha_proximo_seguimiento && o.fecha_proximo_seguimiento < hoyISO && ETAPAS_ABIERTAS.includes(o.etapa);
            return `
          <tr data-id="${o.id}" style="${vencida ? 'background:var(--color-alerta-fondo, #fff8e1);' : ''}">
            <td>${escaparHTML(o.nombre_contacto)}</td>
            <td>${escaparHTML(o.empresa || '—')}</td>
            <td>${ETIQUETA_ETAPA[o.etapa] || o.etapa}</td>
            <td>${formatCOP(o.valor_estimado || 0)}</td>
            <td>${o.fecha_proximo_seguimiento ? formatFechaCorta(o.fecha_proximo_seguimiento) : '—'}${vencida ? ' 🔶' : ''}</td>
            <td><button type="button" class="btn-editar btn-ver-oportunidad" data-id="${o.id}">Ver / Editar</button></td>
          </tr>
        `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-ver-oportunidad').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const { data: oportunidad, error: errOp } = await supabase.from('crm_oportunidades').select('*').eq('id', id).single();
      if (errOp) {
        mostrarToast(`Error: ${errOp.message}`, 'error');
        return;
      }
      abrirModalOportunidad(container, oportunidad);
    });
  });
}

async function abrirModalOportunidad(container, oportunidad) {
  const editando = Boolean(oportunidad);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>${editando ? `Oportunidad: ${escaparHTML(oportunidad.nombre_contacto)}` : 'Nueva oportunidad'}</h3>
      <form id="form-oportunidad" class="modal-contenido">
        <div class="form-grid">
          <label>Nombre del contacto
            <input type="text" name="nombre_contacto" required value="${editando ? escaparHTML(oportunidad.nombre_contacto) : ''}" />
          </label>
          <label>Empresa / Agencia
            <input type="text" name="empresa" value="${editando ? escaparHTML(oportunidad.empresa || '') : ''}" />
          </label>
          <label>Teléfono
            <input type="text" name="telefono" value="${editando ? escaparHTML(oportunidad.telefono || '') : ''}" />
          </label>
          <label>Correo
            <input type="email" name="correo" value="${editando ? escaparHTML(oportunidad.correo || '') : ''}" />
          </label>
          <label>Documento del huésped <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional, si ya es huésped)</span>
            <input type="text" name="huesped_documento" value="${editando ? escaparHTML(oportunidad.huesped_documento || '') : ''}" />
          </label>
          <label>Etapa
            <select name="etapa">
              ${ETAPAS.map((e) => `<option value="${e}" ${editando && oportunidad.etapa === e ? 'selected' : ''}>${ETIQUETA_ETAPA[e]}</option>`).join('')}
            </select>
          </label>
          <label>Valor estimado
            <input type="number" name="valor_estimado" step="1000" value="${editando ? oportunidad.valor_estimado ?? 0 : 0}" />
          </label>
          <label>Próximo seguimiento
            <input type="date" name="fecha_proximo_seguimiento" value="${editando ? oportunidad.fecha_proximo_seguimiento || '' : ''}" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Notas
          <textarea name="notas" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${editando ? escaparHTML(oportunidad.notas || '') : ''}</textarea>
        </label>

        ${editando ? '<div id="interacciones-wrap" style="margin-top:1.25rem;"><p class="mensaje-vacio">Cargando bitácora…</p></div>' : ''}

        <div class="modal-acciones" style="margin-top:1.25rem;">
          ${editando ? '<button type="button" class="btn btn-peligro" id="btn-eliminar-oportunidad" style="margin-right:auto;">Eliminar</button>' : ''}
          <button type="button" class="btn btn-secundario" id="btn-cancelar-oportunidad">Cerrar</button>
          <button type="submit" class="btn btn-primario">${editando ? 'Guardar cambios' : 'Crear oportunidad'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-oportunidad').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  if (editando) {
    cargarInteracciones(overlay, oportunidad.id);
    overlay.querySelector('#btn-eliminar-oportunidad').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la oportunidad de ${oportunidad.nombre_contacto}? Esto también borra su bitácora de interacciones.`)) return;
      const { error } = await supabase.from('crm_oportunidades').delete().eq('id', oportunidad.id);
      if (error) {
        mostrarToast(`Error eliminando: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Oportunidad eliminada.', 'exito');
      overlay.remove();
      await cargarLista(container, container.querySelector('#filtro-etapa').value);
    });
  }

  overlay.querySelector('#form-oportunidad').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      nombre_contacto: form.get('nombre_contacto').trim(),
      empresa: form.get('empresa').trim() || null,
      telefono: form.get('telefono').trim() || null,
      correo: form.get('correo').trim() || null,
      huesped_documento: form.get('huesped_documento').trim() || null,
      etapa: form.get('etapa'),
      valor_estimado: Number(form.get('valor_estimado')) || 0,
      fecha_proximo_seguimiento: form.get('fecha_proximo_seguimiento') || null,
      notas: form.get('notas').trim() || null,
      actualizado_en: new Date().toISOString(),
    };

    const query = editando
      ? supabase.from('crm_oportunidades').update(payload).eq('id', oportunidad.id)
      : supabase.from('crm_oportunidades').insert(payload);

    const { error } = await query;
    if (error) {
      mostrarToast(`Error guardando: ${error.message}`, 'error');
      return;
    }
    mostrarToast(editando ? 'Oportunidad actualizada.' : 'Oportunidad creada.', 'exito');
    overlay.remove();
    await cargarLista(container, container.querySelector('#filtro-etapa').value);
  });
}

async function cargarInteracciones(overlay, oportunidadId) {
  const wrap = overlay.querySelector('#interacciones-wrap');
  const { data: interacciones, error } = await supabase
    .from('crm_interacciones')
    .select('*')
    .eq('oportunidad_id', oportunidadId)
    .order('creado_en', { ascending: false });

  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error cargando bitácora: ${error.message}</p>`;
    return;
  }

  wrap.innerHTML = `
    <h3>Bitácora de seguimiento</h3>
    <div style="max-height:180px; overflow-y:auto; margin-bottom:0.75rem;">
      ${
        (interacciones || [])
          .map(
            (i) => `
        <div style="padding:0.5rem 0; border-bottom:1px solid var(--color-borde);">
          <div style="font-size:0.78rem; color:var(--color-texto-suave);">${ETIQUETA_TIPO_INTERACCION[i.tipo] || i.tipo} — ${formatFechaHora(i.creado_en)}</div>
          <div>${escaparHTML(i.descripcion)}</div>
        </div>
      `
          )
          .join('') || '<p class="mensaje-vacio">Sin interacciones registradas todavía.</p>'
      }
    </div>
    <form id="form-nueva-interaccion" class="form-grid">
      <label>Tipo
        <select name="tipo">
          ${Object.entries(ETIQUETA_TIPO_INTERACCION)
            .map(([valor, etiqueta]) => `<option value="${valor}">${etiqueta}</option>`)
            .join('')}
        </select>
      </label>
      <label>Descripción
        <input type="text" name="descripcion" required placeholder="Ej: Llamé, interesados en 5 habitaciones para congreso en octubre" />
      </label>
      <button type="submit" class="btn btn-secundario btn-chico">+ Agregar al historial</button>
    </form>
  `;

  wrap.querySelector('#form-nueva-interaccion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const { error: errInsert } = await supabase.from('crm_interacciones').insert({
      oportunidad_id: oportunidadId,
      tipo: form.get('tipo'),
      descripcion: form.get('descripcion').trim(),
    });
    if (errInsert) {
      mostrarToast(`Error: ${errInsert.message}`, 'error');
      return;
    }
    mostrarToast('Interacción registrada.', 'exito');
    await cargarInteracciones(overlay, oportunidadId);
  });
}

registerModule({
  id: 'crm',
  label: 'CRM',
  icono: '🤝',
  roles: [],
  parentId: 'grupo-administracion',
  render,
});
