// modules/configuracion/tarifas.js
//
// Subpestaña de Configuración: tarifas (temporada baja, alta y fin de
// semana) por código. Cada habitación en Habitaciones apunta a una de estas.

import { registerModule } from '../../core/modules-registry.js';
import { supabase } from '../../core/supabase-client.js';
import { mostrarToast } from '../../core/ui.js';

async function render(container) {
  container.innerHTML = `
    <h2>Tarifas</h2>
    <div id="tabla-tarifas-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await cargarTabla(container);
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
        <tr><th>Código</th><th>Temporada baja</th><th>Temporada alta</th><th>Fin de semana</th><th>IVA %</th><th></th></tr>
      </thead>
      <tbody>
        ${data
          .map(
            (t) => `
          <tr data-id="${t.id}">
            <td>${t.codigo}</td>
            <td><input type="number" class="input-tarifa" data-campo="precio_temporada_baja" value="${t.precio_temporada_baja}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="precio_temporada_alta" value="${t.precio_temporada_alta}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="precio_fin_semana" value="${t.precio_fin_semana}" /></td>
            <td><input type="number" class="input-tarifa" data-campo="iva_porcentaje" value="${t.iva_porcentaje}" style="width:70px" /></td>
            <td><button type="button" class="btn-editar btn-guardar-tarifa">Guardar</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <p class="mensaje-vacio">⚠ El IVA de alojamiento en Colombia tiene reglas particulares — confirma el % correcto con tu contador antes de facturar.</p>
  `;

  wrap.querySelectorAll('.btn-guardar-tarifa').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = {};
      fila.querySelectorAll('.input-tarifa').forEach((input) => {
        payload[input.dataset.campo] = Number(input.value);
      });
      const { error } = await supabase.from('tarifas').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast(`Tarifa ${fila.children[0].textContent} actualizada.`, 'exito');
    });
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
