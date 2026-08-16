// config-tarifas.js
//
// Subpestaña de Configuración: tarifas (temporada baja, alta y fin de
// semana) por código. Cada habitación en Habitaciones apunta a una de estas.
//
// Nota sobre tarifas libres (nuevo, 117): antes esta pantalla solo
// dejaba editar los precios de tarifas ya existentes (sembradas por
// SQL) — no había forma de crear una tarifa nueva desde la app, ni de
// cambiarle el nombre/código. Ahora:
//   - El código de cada tarifa es editable (antes era texto fijo).
//   - Hay un formulario "+ Nueva tarifa" al final para crear cuantas
//     tarifas libres se necesiten, con nombre y valores 100% a tu
//     gusto (ej. "Arriendo mensual", con el valor mensual en
//     "Temporada baja" y $0 en las demás si no aplican). Una vez
//     creada, aparece en el selector de Tarifa al editar cualquier
//     habitación (Configuración → Habitaciones).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Tarifas</h2>
    <div id="tabla-tarifas-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="nueva-tarifa-wrap" style="margin-top:1.5rem;"></div>
  `;
  await cargarTabla(container);
  cargarFormularioNuevaTarifa(container.querySelector('#nueva-tarifa-wrap'), container);
}

async function cargarTabla(container) {
  const wrap = container.querySelector('#tabla-tarifas-wrap');
  const { data, error } = await supabase.from('tarifas').select('*').order('codigo');
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
    return;
  }
  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr><th>Código / nombre</th><th>Temporada baja</th><th>Temporada alta</th><th>Fin de semana</th><th>IVA %</th><th></th></tr>
      </thead>
      <tbody>
        ${(data || [])
          .map(
            (t) => `
          <tr data-id="${t.id}">
            <td><input type="text" class="input-tarifa" data-campo="codigo" value="${escaparHTML(t.codigo)}" style="width:170px" /></td>
            <td><input type="number" class="input-tarifa" data-campo="precio_temporada_baja" value="${t.precio_temporada_baja}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="precio_temporada_alta" value="${t.precio_temporada_alta}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="precio_fin_semana" value="${t.precio_fin_semana}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="iva_porcentaje" value="${t.iva_porcentaje}" style="width:70px" /></td>
            <td><button type="button" class="btn-editar btn-guardar-tarifa">Guardar</button></td>
          </tr>`
          )
          .join('') || '<tr><td colspan="6" class="mensaje-vacio">Sin tarifas registradas.</td></tr>'}
      </tbody>
    </table>
    <p class="mensaje-vacio">⚠ El IVA de alojamiento en Colombia tiene reglas particulares — confirma el % correcto con tu contador antes de facturar. Para tarifas libres (ej. arriendo mensual sin IVA), deja el % en 0.</p>
  `;

  wrap.querySelectorAll('.btn-guardar-tarifa').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = {};
      fila.querySelectorAll('.input-tarifa').forEach((input) => {
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

function cargarFormularioNuevaTarifa(elemento, container) {
  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>+ Nueva tarifa (libre en nombre y valor)</h3>
      <p class="texto-ayuda">Úsala para casos que no siguen la estructura normal de temporadas, por ejemplo un arriendo mensual: ponle el nombre que quieras y el valor donde corresponda (puedes dejar en 0 los campos que no apliquen).</p>
      <form id="form-nueva-tarifa" class="form-grid">
        <label>Nombre / código
          <input type="text" name="codigo" required placeholder="Ej: Arriendo mensual" />
        </label>
        <label>Temporada baja (o valor único)
          <input type="number" name="precio_temporada_baja" min="0" value="0" required />
        </label>
        <label>Temporada alta
          <input type="number" name="precio_temporada_alta" min="0" value="0" required />
        </label>
        <label>Fin de semana
          <input type="number" name="precio_fin_semana" min="0" value="0" required />
        </label>
        <label>IVA %
          <input type="number" name="iva_porcentaje" min="0" value="0" required />
        </label>
        <button type="submit" class="btn btn-primario">+ Crear tarifa</button>
      </form>
    </div>
  `;

  elemento.querySelector('#form-nueva-tarifa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      codigo: form.get('codigo').trim(),
      precio_temporada_baja: Number(form.get('precio_temporada_baja')) || 0,
      precio_temporada_alta: Number(form.get('precio_temporada_alta')) || 0,
      precio_fin_semana: Number(form.get('precio_fin_semana')) || 0,
      iva_porcentaje: Number(form.get('iva_porcentaje')) || 0,
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
    await cargarTabla(container);
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
