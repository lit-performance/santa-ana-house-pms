// config-tarifas.js
//
// Subpestaña de Configuración: tarifas por código. Dos familias
// distintas (ver 121/122):
//
//   - "Tarifas diarias" (A-E, las de siempre): temporada baja, alta y
//     fin de semana, por noche, con IVA %.
//   - "Tarifas por días" (nueva, ej. "Tarifa F"): pensada para estadías
//     negociadas que no siguen el esquema de temporadas — un número de
//     días y un valor convenido/negociado total para esa estadía. No
//     usan las columnas de temporada ni IVA.
//
// Cada habitación en Habitaciones apunta a una tarifa de cualquiera de
// las dos familias (columna tarifa_id, sin distinción — el selector de
// Habitaciones simplemente lista todas).
//
// Nota: esto reemplaza el enfoque anterior de una única "tarifa libre"
// genérica (117) — se reemplazó por esta separación en dos familias
// porque las tarifas por días necesitan campos distintos (número de
// días + valor convenido) en vez de los tres precios por temporada.
//
// Nota (156): se agregó una tercera tarjeta, "🏷 Tipos de habitación"
// (Sencilla, Doble, Triple, Suite...), que antes vivía en su propia
// subpestaña (config-tipos.js). Se trae aquí porque conceptualmente es
// otra forma de "clasificar" una habitación, igual que la tarifa —
// tiene sentido gestionar ambas cosas juntas en un solo lugar. Se
// muestra como una cuadrícula de mini-tarjetas redondeadas con acento
// de color (mismo estilo `.tarjeta-acento-*` ya usado en el resto del
// sistema — ver 113/145), cada una con botones de Editar (vuelve la
// mini-tarjeta un formulario en el sitio) y Eliminar (bloqueado con un
// aviso si alguna habitación todavía tiene ese tipo asignado, para no
// dejar referencias huérfanas). config-tipos.js se dejó oculto
// (roles: []) — su código y los datos siguen intactos, ver su propia
// nota de cabecera.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatCOP } from './currency.js';

const ACENTOS_TIPO = ['azul', 'verde', 'naranja', 'rojo', 'morado'];

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>💲 Tarifas</h2>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <h3>Tarifas diarias</h3>
      <p class="texto-ayuda">Por noche, con temporada baja/alta/fin de semana e IVA.</p>
      <div id="tabla-tarifas-diarias-wrap" class="tabla-scroll">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
    </div>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <h3>Tarifas por días</h3>
      <p class="texto-ayuda">Para estadías negociadas (ej. arriendos por varios días o meses) — número de días contratados y el valor convenido total, sin esquema de temporadas.</p>
      <div id="tabla-tarifas-dias-wrap" class="tabla-scroll">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
      <div id="nueva-tarifa-dias-wrap" style="margin-top:1.25rem;"></div>
    </div>
    <div class="tarjeta">
      <h3>🏷 Tipos de habitación</h3>
      <p class="texto-ayuda">Sencilla, Doble, Triple, Suite… se usan en el selector "Tipo" al crear o editar una habitación en la pestaña Habitaciones.</p>
      <div id="tipos-habitacion-grid-wrap">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
      <div id="nuevo-tipo-wrap" style="margin-top:1.25rem;"></div>
    </div>
  `;
  await cargarTablas(container);
  cargarFormularioNuevaTarifaPorDias(container.querySelector('#nueva-tarifa-dias-wrap'), container);
  await cargarTiposHabitacion(container.querySelector('#tipos-habitacion-grid-wrap'), container);
  cargarFormularioNuevoTipo(container.querySelector('#nuevo-tipo-wrap'), container);
}

async function cargarTablas(container) {
  const { data, error } = await supabase.from('tarifas').select('*').order('codigo');
  if (error) {
    container.querySelector('#tabla-tarifas-diarias-wrap').innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
    container.querySelector('#tabla-tarifas-dias-wrap').innerHTML = '';
    return;
  }

  const todas = data || [];
  pintarTablaDiarias(container.querySelector('#tabla-tarifas-diarias-wrap'), todas.filter((t) => t.tipo !== 'por_dias'), container);
  pintarTablaPorDias(container.querySelector('#tabla-tarifas-dias-wrap'), todas.filter((t) => t.tipo === 'por_dias'), container);
}

function pintarTablaDiarias(wrap, filas, container) {
  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr><th>Código / nombre</th><th>Temporada baja</th><th>Temporada alta</th><th>Fin de semana</th><th>IVA %</th><th></th></tr>
      </thead>
      <tbody>
        ${filas
          .map(
            (t) => `
          <tr data-id="${t.id}">
            <td><input type="text" class="input-tarifa-diaria" data-campo="codigo" value="${escaparHTML(t.codigo)}" style="width:170px" /></td>
            <td><input type="number" class="input-tarifa-diaria" data-campo="precio_temporada_baja" value="${t.precio_temporada_baja}" /></td>
            <td><input type="number" class="input-tarifa-diaria" data-campo="precio_temporada_alta" value="${t.precio_temporada_alta}" /></td>
            <td><input type="number" class="input-tarifa-diaria" data-campo="precio_fin_semana" value="${t.precio_fin_semana}" /></td>
            <td><input type="number" class="input-tarifa-diaria" data-campo="iva_porcentaje" value="${t.iva_porcentaje}" style="width:70px" /></td>
            <td><button type="button" class="btn-editar btn-guardar-tarifa-diaria">Guardar</button></td>
          </tr>`
          )
          .join('') || '<tr><td colspan="6" class="mensaje-vacio">Sin tarifas diarias registradas.</td></tr>'}
      </tbody>
    </table>
    <p class="mensaje-vacio">⚠ El IVA de alojamiento en Colombia tiene reglas particulares — confirma el % correcto con tu contador antes de facturar.</p>
  `;

  wrap.querySelectorAll('.btn-guardar-tarifa-diaria').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = {};
      fila.querySelectorAll('.input-tarifa-diaria').forEach((input) => {
        const campo = input.dataset.campo;
        payload[campo] = campo === 'codigo' ? input.value.trim() : Number(input.value) || 0;
      });
      if (!payload.codigo) {
        mostrarToast('El código/nombre de la tarifa no puede quedar vacío.', 'error');
        return;
      }
      const { error } = await supabase.from('tarifas').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast(`Tarifa "${payload.codigo}" actualizada.`, 'exito');
    });
  });
}

function pintarTablaPorDias(wrap, filas, container) {
  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr><th>Nombre</th><th>Número de días</th><th>Valor convenido</th><th></th></tr>
      </thead>
      <tbody>
        ${filas
          .map(
            (t) => `
          <tr data-id="${t.id}">
            <td><input type="text" class="input-tarifa-dias" data-campo="codigo" value="${escaparHTML(t.codigo)}" style="width:200px" /></td>
            <td><input type="number" class="input-tarifa-dias" data-campo="numero_dias" min="1" value="${t.numero_dias ?? ''}" style="width:100px" /></td>
            <td><input type="number" class="input-tarifa-dias" data-campo="valor_convenido" min="0" value="${t.valor_convenido ?? ''}" style="width:150px" /></td>
            <td><button type="button" class="btn-editar btn-guardar-tarifa-dias">Guardar</button></td>
          </tr>`
          )
          .join('') || '<tr><td colspan="4" class="mensaje-vacio">Sin tarifas por días registradas todavía.</td></tr>'}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.btn-guardar-tarifa-dias').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = {};
      fila.querySelectorAll('.input-tarifa-dias').forEach((input) => {
        const campo = input.dataset.campo;
        payload[campo] = campo === 'codigo' ? input.value.trim() : Number(input.value) || 0;
      });
      if (!payload.codigo) {
        mostrarToast('El nombre de la tarifa no puede quedar vacío.', 'error');
        return;
      }
      const { error } = await supabase.from('tarifas').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast(`Tarifa "${payload.codigo}" actualizada.`, 'exito');
    });
  });
}

function cargarFormularioNuevaTarifaPorDias(elemento, container) {
  elemento.innerHTML = `
    <h4 style="margin-bottom:0.4rem;">+ Nueva tarifa por días</h4>
    <form id="form-nueva-tarifa-dias" class="form-grid">
      <label>Nombre
        <input type="text" name="codigo" required placeholder="Ej: Tarifa F" />
      </label>
      <label>Número de días
        <input type="number" name="numero_dias" min="1" required placeholder="Ej: 30" />
      </label>
      <label>Valor convenido (total de la estadía)
        <input type="number" name="valor_convenido" min="0" required placeholder="Ej: 900000" />
      </label>
      <button type="submit" class="btn btn-primario">+ Crear tarifa</button>
    </form>
  `;

  elemento.querySelector('#form-nueva-tarifa-dias').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      codigo: form.get('codigo').trim(),
      tipo: 'por_dias',
      numero_dias: Number(form.get('numero_dias')) || 0,
      valor_convenido: Number(form.get('valor_convenido')) || 0,
      // Estas tres no aplican a "por días" — quedan en 0 para no
      // interferir con nada que las use por defecto.
      precio_temporada_baja: 0,
      precio_temporada_alta: 0,
      precio_fin_semana: 0,
      iva_porcentaje: 0,
    };
    if (!payload.codigo) {
      mostrarToast('Ponle un nombre a la tarifa.', 'error');
      return;
    }

    const { error } = await supabase.from('tarifas').insert(payload);
    if (error) {
      mostrarToast(`Error creando la tarifa: ${error.message}`, 'error');
      return;
    }

    mostrarToast(`Tarifa "${payload.codigo}" creada — ya aparece en el selector de Tarifa al editar una habitación.`, 'exito');
    e.target.reset();
    await cargarTablas(container);
  });
}

// =========================================================
// Tipos de habitación (156) — mini-tarjetas con acento de color,
// editar en el sitio y eliminar con verificación de uso.
// =========================================================

async function cargarTiposHabitacion(wrap, container) {
  const { data, error } = await supabase.from('tipos_habitacion').select('*').order('nombre');
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
    return;
  }
  pintarTiposHabitacion(wrap, data || [], container);
}

function pintarTiposHabitacion(wrap, tipos, container) {
  if (tipos.length === 0) {
    wrap.innerHTML = '<p class="mensaje-vacio">Sin tipos de habitación registrados todavía.</p>';
    return;
  }

  wrap.innerHTML = `
    <div class="grid-tipos-habitacion">
      ${tipos.map((t, i) => tarjetaTipoHTML(t, ACENTOS_TIPO[i % ACENTOS_TIPO.length])).join('')}
    </div>
  `;

  tipos.forEach((t) => {
    const tarjeta = wrap.querySelector(`[data-tipo-id="${t.id}"]`);
    if (!tarjeta) return;
    const btnEditar = tarjeta.querySelector('.btn-editar-tipo');
    const btnEliminar = tarjeta.querySelector('.btn-eliminar-tipo');
    if (btnEditar) btnEditar.addEventListener('click', () => activarEdicionTipo(tarjeta, t, wrap, container));
    if (btnEliminar) btnEliminar.addEventListener('click', () => eliminarTipoHabitacion(t, wrap, container));
  });
}

function tarjetaTipoHTML(t, acento) {
  return `
    <div class="tarjeta tarjeta-mini tarjeta-acento tarjeta-acento-${acento}" data-tipo-id="${t.id}">
      <div class="tarjeta-tipo-vista">
        <strong>${escaparHTML(t.nombre)}</strong>
        <p class="mensaje-vacio" style="margin:0.3rem 0 0.75rem;">${t.descripcion ? escaparHTML(t.descripcion) : 'Sin descripción'}</p>
        <div class="acciones-tarjeta" style="margin-top:0;">
          <button type="button" class="btn-editar btn-chico btn-editar-tipo">✏️ Editar</button>
          <button type="button" class="btn btn-secundario btn-chico btn-eliminar-tipo">🗑️ Eliminar</button>
        </div>
      </div>
    </div>
  `;
}

function activarEdicionTipo(tarjetaEl, tipo, wrap, container) {
  const vista = tarjetaEl.querySelector('.tarjeta-tipo-vista');
  vista.innerHTML = `
    <form class="form-editar-tipo" style="display:flex; flex-direction:column; gap:0.6rem;">
      <label style="margin:0;">Nombre
        <input type="text" name="nombre" required value="${escaparHTML(tipo.nombre)}" />
      </label>
      <label style="margin:0;">Descripción
        <input type="text" name="descripcion" value="${tipo.descripcion ? escaparHTML(tipo.descripcion) : ''}" placeholder="Opcional" />
      </label>
      <div class="acciones-tarjeta" style="margin-top:0.25rem;">
        <button type="button" class="btn btn-secundario btn-chico btn-cancelar-edicion-tipo">Cancelar</button>
        <button type="submit" class="btn btn-primario btn-chico">Guardar</button>
      </div>
    </form>
  `;

  vista.querySelector('.btn-cancelar-edicion-tipo').addEventListener('click', () => {
    cargarTiposHabitacion(wrap, container);
  });

  vista.querySelector('.form-editar-tipo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nombre = form.get('nombre').trim();
    if (!nombre) {
      mostrarToast('El nombre no puede quedar vacío.', 'error');
      return;
    }
    const { error } = await supabase
      .from('tipos_habitacion')
      .update({ nombre, descripcion: form.get('descripcion').trim() || null })
      .eq('id', tipo.id);
    if (error) {
      mostrarToast(`Error: ${error.message}`, 'error');
      return;
    }
    mostrarToast(`Tipo "${nombre}" actualizado.`, 'exito');
    await cargarTiposHabitacion(wrap, container);
  });
}

async function eliminarTipoHabitacion(tipo, wrap, container) {
  const { count, error: errConteo } = await supabase
    .from('habitaciones')
    .select('id', { count: 'exact', head: true })
    .eq('tipo_id', tipo.id);

  if (errConteo) {
    mostrarToast(`Error verificando uso: ${errConteo.message}`, 'error');
    return;
  }

  if (count > 0) {
    mostrarToast(`No se puede eliminar "${tipo.nombre}": ${count} habitación(es) lo tienen asignado. Cámbiales el tipo primero desde la pestaña Habitaciones.`, 'error');
    return;
  }

  const ok = await mostrarConfirmacion({
    titulo: 'Eliminar tipo de habitación',
    contenidoHTML: `¿Eliminar el tipo <strong>${escaparHTML(tipo.nombre)}</strong>? Ninguna habitación lo tiene asignado actualmente.`,
    textoConfirmar: 'Sí, eliminar',
  });
  if (!ok) return;

  const { error } = await supabase.from('tipos_habitacion').delete().eq('id', tipo.id);
  if (error) {
    mostrarToast(`Error eliminando: ${error.message}`, 'error');
    return;
  }
  mostrarToast(`Tipo "${tipo.nombre}" eliminado.`, 'exito');
  await cargarTiposHabitacion(wrap, container);
}

function cargarFormularioNuevoTipo(elemento, container) {
  elemento.innerHTML = `
    <h4 style="margin-bottom:0.4rem;">+ Nuevo tipo de habitación</h4>
    <form id="form-nuevo-tipo-habitacion" class="form-grid">
      <label>Nombre
        <input type="text" name="nombre" required placeholder="Ej: Suite Junior" />
      </label>
      <label>Descripción
        <input type="text" name="descripcion" placeholder="Opcional" />
      </label>
      <button type="submit" class="btn btn-primario">+ Agregar tipo</button>
    </form>
  `;

  elemento.querySelector('#form-nuevo-tipo-habitacion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nombre = form.get('nombre').trim();
    if (!nombre) {
      mostrarToast('Ponle un nombre al tipo.', 'error');
      return;
    }
    const { error } = await supabase.from('tipos_habitacion').insert({
      nombre,
      descripcion: form.get('descripcion').trim() || null,
    });
    if (error) {
      mostrarToast(`Error creando el tipo: ${error.message}`, 'error');
      return;
    }
    mostrarToast(`Tipo "${nombre}" creado — ya aparece en el selector de Tipo al editar una habitación.`, 'exito');
    e.target.reset();
    await cargarTiposHabitacion(container.querySelector('#tipos-habitacion-grid-wrap'), container);
  });
}

registerModule({
  id: 'config-tarifas',
  label: 'Tarifas',
  icono: '💲',
  roles: ['propietario', 'administrador'],
  parentId: 'configuracion',
  render,
});
