// proveedores.js
//
// Módulo: Proveedores. Directorio de proveedores del hotel (datos de
// contacto y condiciones de pago) usado para hacer pedidos de reabastecimiento
// de bodega desde el módulo Inventario.
//
// Nota (142): rediseño completo del directorio, mismo patrón que ya se
// usa en Bodega (inventario.js, ver 128):
//  1. La tabla tenía 9-10 columnas TODAS con inputs editables siempre
//     visibles — obligaba a scroll horizontal para ver el directorio
//     completo, y no distinguía "viendo" de "editando". Ahora es de
//     SOLO LECTURA y muestra solo lo esencial para identificar de un
//     vistazo (Nombre comercial, Contacto, Teléfono, Ciudad, Activo) —
//     cabe sin scroll horizontal en la mayoría de pantallas.
//  2. "👁️ Ver" abre una tarjeta emergente con todos los datos (razón
//     social, NIT, correo, dirección, condiciones de pago, notas), con
//     botón "✏️ Editar" que cambia esa misma tarjeta a formulario
//     completo, y "🗑 Eliminar" con confirmación.
//  3. "+ Nuevo proveedor" ya no es un formulario fijo en la hoja — es un
//     botón que abre una tarjeta emergente con todos los campos.
//
// Nota (143): `abrirModalProveedorNuevo` ahora se EXPORTA y, al crear el
// proveedor, pasa el registro recién creado (id + nombre_comercial) a
// `onCreado(nuevoProveedor)` en vez de llamarlo sin argumentos — así
// inventario.js también puede reutilizar esta misma tarjeta emergente
// desde "Registrar compra" (botón "➕" junto al selector de Proveedor,
// para cuando el proveedor de esa compra todavía no está en el
// directorio) sin duplicar el formulario. El uso interno de este mismo
// archivo (botón "+ Nuevo proveedor" del directorio) sigue funcionando
// igual, solo ignora ese argumento.

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

// =========================================================
// Directorio — tabla de solo lectura con las columnas esenciales; el
// detalle completo y la edición viven en la tarjeta emergente que abre
// "👁️ Ver" (ver `abrirModalDetalleProveedor`).
// =========================================================
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

  const porId = new Map((proveedores || []).map((p) => [p.id, p]));

  elemento.innerHTML = `
    <div class="tarjeta">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.25rem;">
        <h3 style="margin:0;">🚚 Directorio de proveedores</h3>
        ${permitido ? '<button type="button" id="btn-nuevo-proveedor" class="btn btn-primario btn-chico">+ Nuevo proveedor</button>' : ''}
      </div>
      <p class="texto-ayuda">Dale "👁️ Ver" a un proveedor para ver todos sus datos (razón social, NIT, correo, dirección, condiciones de pago, notas) y editarlo ahí.</p>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Nombre comercial</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th>Ciudad</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              (proveedores || [])
                .map(
                  (p) => `
              <tr data-id="${p.id}" style="${p.activo ? '' : 'opacity:0.6;'}">
                <td>${escaparHTML(p.nombre_comercial)}</td>
                <td>${escaparHTML(p.contacto_nombre || '—')}</td>
                <td>${escaparHTML(p.telefono || '—')}</td>
                <td>${escaparHTML(p.ciudad || '—')}</td>
                <td>${p.activo ? '✅' : '🚫 Inactivo'}</td>
                <td><button type="button" class="btn-editar btn-ver-proveedor">👁️ Ver</button></td>
              </tr>
            `
                )
                .join('') || `<tr><td colspan="6" class="mensaje-vacio">Sin proveedores registrados todavía.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (permitido) {
    const btnNuevo = elemento.querySelector('#btn-nuevo-proveedor');
    if (btnNuevo) {
      btnNuevo.addEventListener('click', () => {
        abrirModalProveedorNuevo({ onCreado: () => cargarProveedores(elemento) });
      });
    }
  }

  // Un solo listener delegado, asignado con `onclick` (no
  // addEventListener) para que cada recarga de esta tarjeta REEMPLACE
  // el listener anterior en vez de acumularlo (mismo patrón que Bodega
  // en inventario.js).
  elemento.onclick = (e) => {
    const btnVer = e.target.closest('.btn-ver-proveedor');
    if (btnVer) {
      const fila = btnVer.closest('tr');
      const p = porId.get(Number(fila.dataset.id));
      if (p) abrirModalDetalleProveedor(p, elemento, permitido);
    }
  };
}

// Tarjeta emergente de detalle de un proveedor: vista completa (todos
// los campos) y, si el usuario puede gestionar, un botón "✏️ Editar"
// que cambia la misma tarjeta a un formulario de edición completo, y
// "🗑 Eliminar" con confirmación. Al guardar o eliminar, cierra y
// recarga el directorio.
function abrirModalDetalleProveedor(p, elemento, permitido) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  function pintarVista() {
    overlay.innerHTML = `
      <div class="modal-caja">
        <h3>${escaparHTML(p.nombre_comercial)}</h3>
        <p class="mensaje-vacio" style="margin-top:-0.5rem;">${p.activo ? '✅ Activo' : '🚫 Inactivo'}</p>
        <div class="modal-contenido" style="display:grid; grid-template-columns:1fr 1fr; gap:0.9rem 1.5rem;">
          <div><span class="texto-ayuda">Razón social</span><br /><strong>${escaparHTML(p.razon_social || '—')}</strong></div>
          <div><span class="texto-ayuda">NIT</span><br /><strong>${escaparHTML(p.nit || '—')}</strong></div>
          <div><span class="texto-ayuda">Contacto</span><br /><strong>${escaparHTML(p.contacto_nombre || '—')}</strong></div>
          <div><span class="texto-ayuda">Teléfono</span><br /><strong>${escaparHTML(p.telefono || '—')}</strong></div>
          <div><span class="texto-ayuda">Correo</span><br /><strong>${escaparHTML(p.correo || '—')}</strong></div>
          <div><span class="texto-ayuda">Ciudad</span><br /><strong>${escaparHTML(p.ciudad || '—')}</strong></div>
          <div style="grid-column:1 / -1;"><span class="texto-ayuda">Dirección</span><br />${escaparHTML(p.direccion || '—')}</div>
          <div style="grid-column:1 / -1;"><span class="texto-ayuda">Condiciones de pago</span><br />${escaparHTML(p.condiciones_pago || '—')}</div>
          <div style="grid-column:1 / -1;"><span class="texto-ayuda">Notas</span><br />${escaparHTML(p.notas || '—')}</div>
        </div>
        <div class="modal-acciones" style="margin-top:1.25rem; justify-content:space-between;">
          <div>${permitido ? '<button type="button" class="btn btn-secundario" id="btn-eliminar-detalle-proveedor" style="color:var(--color-rojo-oscuro, #c0392b);">🗑 Eliminar</button>' : ''}</div>
          <div style="display:flex; gap:0.5rem;">
            <button type="button" class="btn btn-secundario" id="btn-cerrar-detalle-proveedor">Cerrar</button>
            ${permitido ? '<button type="button" class="btn btn-primario" id="btn-editar-detalle-proveedor">✏️ Editar</button>' : ''}
          </div>
        </div>
      </div>
    `;
    overlay.querySelector('#btn-cerrar-detalle-proveedor').addEventListener('click', () => overlay.remove());

    const btnEditar = overlay.querySelector('#btn-editar-detalle-proveedor');
    if (btnEditar) btnEditar.addEventListener('click', pintarEdicion);

    const btnEliminar = overlay.querySelector('#btn-eliminar-detalle-proveedor');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', async () => {
        const ok = await mostrarConfirmacion({
          titulo: 'Eliminar proveedor',
          contenidoHTML: `¿Eliminar a <strong>${escaparHTML(p.nombre_comercial)}</strong>? Esta acción no se puede deshacer.`,
          textoConfirmar: 'Eliminar',
        });
        if (!ok) return;
        const { error } = await supabase.from('proveedores').delete().eq('id', p.id);
        if (error) {
          mostrarToast(`Error eliminando: ${error.message}`, 'error');
          return;
        }
        mostrarToast('Proveedor eliminado.', 'exito');
        overlay.remove();
        await cargarProveedores(elemento);
      });
    }
  }

  function pintarEdicion() {
    overlay.innerHTML = `
      <div class="modal-caja">
        <h3>Editar — ${escaparHTML(p.nombre_comercial)}</h3>
        <form id="form-editar-proveedor">
          <div class="form-grid">
            <label>Nombre comercial
              <input type="text" name="nombre_comercial" value="${escaparHTML(p.nombre_comercial)}" required />
            </label>
            <label>Razón social
              <input type="text" name="razon_social" value="${escaparHTML(p.razon_social || '')}" placeholder="Opcional" />
            </label>
            <label>NIT
              <input type="text" name="nit" value="${escaparHTML(p.nit || '')}" placeholder="Opcional" />
            </label>
            <label>Nombre de contacto
              <input type="text" name="contacto_nombre" value="${escaparHTML(p.contacto_nombre || '')}" placeholder="Opcional" />
            </label>
            <label>Teléfono
              <input type="text" name="telefono" value="${escaparHTML(p.telefono || '')}" placeholder="Opcional" />
            </label>
            <label>Correo
              <input type="email" name="correo" value="${escaparHTML(p.correo || '')}" placeholder="Opcional" />
            </label>
            <label>Dirección
              <input type="text" name="direccion" value="${escaparHTML(p.direccion || '')}" placeholder="Opcional" />
            </label>
            <label>Ciudad
              <input type="text" name="ciudad" value="${escaparHTML(p.ciudad || '')}" placeholder="Opcional" />
            </label>
            <label>Condiciones de pago
              <input type="text" name="condiciones_pago" value="${escaparHTML(p.condiciones_pago || '')}" placeholder="Ej: Contado, crédito 30 días" />
            </label>
            <label>Notas
              <input type="text" name="notas" value="${escaparHTML(p.notas || '')}" placeholder="Opcional" />
            </label>
            <label style="flex-direction:row; align-items:center; gap:0.5rem; display:flex;">
              <input type="checkbox" name="activo" ${p.activo ? 'checked' : ''} style="width:auto;" /> Activo
            </label>
          </div>
          <div class="modal-acciones" style="margin-top:1.25rem;">
            <button type="button" class="btn btn-secundario" id="btn-cancelar-edicion-proveedor">Cancelar</button>
            <button type="submit" class="btn btn-primario">Guardar</button>
          </div>
        </form>
      </div>
    `;
    overlay.querySelector('#btn-cancelar-edicion-proveedor').addEventListener('click', pintarVista);
    overlay.querySelector('#form-editar-proveedor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const nombreComercial = form.get('nombre_comercial').trim();
      if (!nombreComercial) {
        mostrarToast('El nombre comercial es obligatorio.', 'error');
        return;
      }
      const payload = {
        nombre_comercial: nombreComercial,
        razon_social: form.get('razon_social').trim() || null,
        nit: form.get('nit').trim() || null,
        contacto_nombre: form.get('contacto_nombre').trim() || null,
        telefono: form.get('telefono').trim() || null,
        correo: form.get('correo').trim() || null,
        direccion: form.get('direccion').trim() || null,
        ciudad: form.get('ciudad').trim() || null,
        condiciones_pago: form.get('condiciones_pago').trim() || null,
        notas: form.get('notas').trim() || null,
        activo: form.get('activo') === 'on',
      };
      const { error } = await supabase.from('proveedores').update(payload).eq('id', p.id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Proveedor actualizado.', 'exito');
      overlay.remove();
      await cargarProveedores(elemento);
    });
  }

  pintarVista();
}

// Tarjeta emergente para dar de alta un proveedor nuevo, con TODOS los
// campos — reemplaza al formulario largo que antes vivía debajo de la
// tabla en la misma hoja (ver nota 142 al inicio del archivo). Exportada
// (143) para que inventario.js también la reutilice desde "Registrar
// compra". Al crear el proveedor, `onCreado` recibe el registro recién
// creado ({ id, nombre_comercial }) para que quien la llamó pueda, por
// ejemplo, seleccionarlo automáticamente en un <select>.
export function abrirModalProveedorNuevo({ onCreado }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja">
      <h3>➕ Nuevo proveedor</h3>
      <form id="form-nuevo-proveedor" class="modal-contenido">
        <div class="form-grid">
          <label>Nombre comercial
            <input type="text" name="nombre_comercial" required />
          </label>
          <label>Razón social <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="razon_social" placeholder="Opcional" />
          </label>
          <label>NIT <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="nit" placeholder="Opcional" />
          </label>
          <label>Nombre de contacto <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="contacto_nombre" placeholder="Opcional" />
          </label>
          <label>Teléfono <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="telefono" placeholder="Opcional" />
          </label>
          <label>Correo <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="email" name="correo" placeholder="Opcional" />
          </label>
          <label>Dirección <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="direccion" placeholder="Opcional" />
          </label>
          <label>Ciudad <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="ciudad" placeholder="Opcional" />
          </label>
          <label>Condiciones de pago <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="condiciones_pago" placeholder="Ej: Contado, crédito 30 días" />
          </label>
          <label>Notas <span class="mensaje-vacio" style="font-size:0.7rem;">(opcional)</span>
            <input type="text" name="notas" placeholder="Opcional" />
          </label>
        </div>
        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-proveedor-nuevo">Cancelar</button>
          <button type="submit" class="btn btn-primario">Crear proveedor</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cancelar-proveedor-nuevo').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-nuevo-proveedor').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nombreComercial = form.get('nombre_comercial').trim();
    if (!nombreComercial) {
      mostrarToast('El nombre comercial es obligatorio.', 'error');
      return;
    }

    const { data: nuevoProveedor, error } = await supabase
      .from('proveedores')
      .insert({
        nombre_comercial: nombreComercial,
        razon_social: form.get('razon_social').trim() || null,
        nit: form.get('nit').trim() || null,
        contacto_nombre: form.get('contacto_nombre').trim() || null,
        telefono: form.get('telefono').trim() || null,
        correo: form.get('correo').trim() || null,
        direccion: form.get('direccion').trim() || null,
        ciudad: form.get('ciudad').trim() || null,
        condiciones_pago: form.get('condiciones_pago').trim() || null,
        notas: form.get('notas').trim() || null,
      })
      .select('id, nombre_comercial')
      .single();
    if (error) {
      mostrarToast(`Error creando proveedor: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Proveedor agregado.', 'exito');
    overlay.remove();
    onCreado(nuevoProveedor);
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
