// proveedores.js
//
// Módulo: Proveedores. Directorio de proveedores del hotel (datos de
// contacto y condiciones de pago) usado para hacer pedidos de reabastecimiento
// de bodega desde el módulo Inventario.

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { getUsuarioActual } from './auth.js';

const ROLES_EDITAN = ['propietario', 'administrador', 'bodega'];

function puedeEditar() {
  const usuario = getUsuarioActual();
  return Boolean(usuario) && ROLES_EDITAN.includes(usuario.rol);
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Proveedores</h2>
    <div id="proveedores-wrap">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;
  await cargarProveedores(container.querySelector('#proveedores-wrap'));
}

async function cargarProveedores(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';
  const permitido = puedeEditar();

  const { data: proveedores, error } = await supabase
    .from('proveedores')
    .select('*')
    .order('activo', { ascending: false })
    .order('nombre_comercial');

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando proveedores: ${error.message}</p>`;
    return;
  }

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Directorio de proveedores</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Nombre comercial</th>
              <th>Razón social</th>
              <th>NIT</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th>Correo</th>
              <th>Ciudad</th>
              <th>Condiciones de pago</th>
              <th>Activo</th>
              ${permitido ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${
              (proveedores || [])
                .map(
                  (p) => `
              <tr data-id="${p.id}">
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="nombre_comercial" value="${escaparHTML(p.nombre_comercial)}" style="width:140px" />` : escaparHTML(p.nombre_comercial)}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="razon_social" value="${escaparHTML(p.razon_social || '')}" style="width:140px" />` : escaparHTML(p.razon_social || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="nit" value="${escaparHTML(p.nit || '')}" style="width:100px" />` : escaparHTML(p.nit || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="contacto_nombre" value="${escaparHTML(p.contacto_nombre || '')}" style="width:120px" />` : escaparHTML(p.contacto_nombre || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="telefono" value="${escaparHTML(p.telefono || '')}" style="width:110px" />` : escaparHTML(p.telefono || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="correo" value="${escaparHTML(p.correo || '')}" style="width:150px" />` : escaparHTML(p.correo || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="ciudad" value="${escaparHTML(p.ciudad || '')}" style="width:100px" />` : escaparHTML(p.ciudad || '—')}</td>
                <td>${permitido ? `<input type="text" class="input-prov" data-campo="condiciones_pago" value="${escaparHTML(p.condiciones_pago || '')}" style="width:140px" />` : escaparHTML(p.condiciones_pago || '—')}</td>
                <td>${permitido ? `<input type="checkbox" class="input-prov" data-campo="activo" ${p.activo ? 'checked' : ''} />` : p.activo ? '✅' : '🚫'}</td>
                ${permitido ? `<td><button type="button" class="btn-editar btn-guardar-proveedor">Guardar</button> <button type="button" class="btn-editar btn-eliminar-proveedor">Eliminar</button></td>` : ''}
              </tr>
            `
                )
                .join('') ||
              `<tr><td colspan="${permitido ? 10 : 9}" class="mensaje-vacio">Sin proveedores registrados todavía.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${
        permitido
          ? `
        <h3 style="margin-top:1.5rem;">+ Nuevo proveedor</h3>
        <form id="form-nuevo-proveedor" class="form-grid">
          <label>Nombre comercial
            <input type="text" name="nombre_comercial" required />
          </label>
          <label>Razón social
            <input type="text" name="razon_social" placeholder="Opcional" />
          </label>
          <label>NIT
            <input type="text" name="nit" placeholder="Opcional" />
          </label>
          <label>Nombre de contacto
            <input type="text" name="contacto_nombre" placeholder="Opcional" />
          </label>
          <label>Teléfono
            <input type="text" name="telefono" placeholder="Opcional" />
          </label>
          <label>Correo
            <input type="email" name="correo" placeholder="Opcional" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" placeholder="Opcional" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" placeholder="Opcional" />
          </label>
          <label>Condiciones de pago
            <input type="text" name="condiciones_pago" placeholder="Ej: Contado, crédito 30 días" />
          </label>
          <label>Notas
            <input type="text" name="notas" placeholder="Opcional" />
          </label>
          <button type="submit" class="btn btn-secundario btn-chico">+ Agregar proveedor</button>
        </form>
      `
          : ''
      }
    </div>
  `;

  if (!permitido) return;

  elemento.querySelectorAll('.btn-guardar-proveedor').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const payload = {};
      fila.querySelectorAll('.input-prov').forEach((input) => {
        const campo = input.dataset.campo;
        if (input.type === 'checkbox') {
          payload[campo] = input.checked;
        } else {
          payload[campo] = input.value.trim() || null;
        }
      });
      const { error } = await supabase.from('proveedores').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Proveedor actualizado.', 'exito');
    });
  });

  elemento.querySelectorAll('.btn-eliminar-proveedor').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = Number(fila.dataset.id);
      const ok = await mostrarConfirmacion({
        titulo: 'Eliminar proveedor',
        contenidoHTML: '¿Eliminar este proveedor? Esta acción no se puede deshacer.',
        textoConfirmar: 'Eliminar',
      });
      if (!ok) return;
      const { error } = await supabase.from('proveedores').delete().eq('id', id);
      if (error) {
        mostrarToast(`Error eliminando: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Proveedor eliminado.', 'exito');
      await cargarProveedores(elemento);
    });
  });

  elemento.querySelector('#form-nuevo-proveedor').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const { error } = await supabase.from('proveedores').insert({
      nombre_comercial: form.get('nombre_comercial').trim(),
      razon_social: form.get('razon_social').trim() || null,
      nit: form.get('nit').trim() || null,
      contacto_nombre: form.get('contacto_nombre').trim() || null,
      telefono: form.get('telefono').trim() || null,
      correo: form.get('correo').trim() || null,
      direccion: form.get('direccion').trim() || null,
      ciudad: form.get('ciudad').trim() || null,
      condiciones_pago: form.get('condiciones_pago').trim() || null,
      notas: form.get('notas').trim() || null,
    });
    if (error) {
      mostrarToast(`Error creando proveedor: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Proveedor agregado.', 'exito');
    await cargarProveedores(elemento);
  });
}

registerModule({
  id: 'proveedores',
  label: 'Proveedores',
  icono: '🚚',
  roles: ['propietario', 'administrador', 'bodega', 'contador'],
  parentId: 'grupo-inventario',
  render,
});
