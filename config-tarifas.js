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

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';
import { formatCOP } from './currency.js';

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Tarifas</h2>
    <div class="tarjeta" style="margin-bottom:1.5rem;">
      <h3>Tarifas diarias</h3>
      <p class="texto-ayuda">Por noche, con temporada baja/alta/fin de semana e IVA.</p>
      <div id="tabla-tarifas-diarias-wrap" class="tabla-scroll">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
    </div>
    <div class="tarjeta">
      <h3>Tarifas por días</h3>
      <p class="texto-ayuda">Para estadías negociadas (ej. arriendos por varios días o meses) — número de días contratados y el valor convenido total, sin esquema de temporadas.</p>
      <div id="tabla-tarifas-dias-wrap" class="tabla-scroll">
        <p class="mensaje-vacio">Cargando…</p>
      </div>
      <div id="nueva-tarifa-dias-wrap" style="margin-top:1.25rem;"></div>
    </div>
  `;
  await cargarTablas(container);
  cargarFormularioNuevaTarifaPorDias(container.querySelector('#nueva-tarifa-dias-wrap'), container);
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

registerModule({
  id: 'config-tarifas',
  label: 'Tarifas',
  icono: '💲',
  roles: ['propietario', 'administrador'],
  parentId: 'configuracion',
  render,
});
