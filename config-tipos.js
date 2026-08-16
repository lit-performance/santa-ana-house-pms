// config-tipos.js
//
// Subpestaña de Configuración: tipos de habitación (Sencilla, Doble, Triple,
// Suite...). Permite agregar nuevos sin tocar el resto del sistema.
//
// Oculto temporalmente (roles: []) desde 156 — su gestión (crear, editar,
// eliminar) se fusionó dentro de config-tarifas.js ("🏷 Tipos de
// habitación", con mini-tarjetas de color), porque son dos formas de
// clasificar una habitación que tenía sentido tener juntas. El código y
// los datos de este archivo siguen intactos; reactivarlo es solo
// devolverle su lista de roles más abajo — aunque si se reactiva, quedará
// duplicando la gestión que ahora vive en config-tarifas.js (esta pantalla
// no tiene editar/eliminar, solo alta).

import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast } from './ui.js';

async function render(container) {
  container.innerHTML = `
    <h2>Tipos de habitación</h2>
    <div class="tarjeta">
      <form id="form-nuevo-tipo" class="form-grid">
        <label>Nombre
          <input type="text" name="nombre" required placeholder="Ej. Suite Junior" />
        </label>
        <label>Descripción
          <input type="text" name="descripcion" placeholder="Opcional" />
        </label>
        <button type="submit" class="btn btn-primario">+ Agregar tipo</button>
      </form>
    </div>
    <div id="tabla-tipos-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#form-nuevo-tipo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const { error } = await supabase.from('tipos_habitacion').insert({
      nombre: form.get('nombre').trim(),
      descripcion: form.get('descripcion').trim() || null,
    });
    if (error) {
      mostrarToast(`Error: ${error.message}`, 'error');
      return;
    }
    mostrarToast('Tipo agregado.', 'exito');
    e.target.reset();
    await cargarTabla(container);
  });

  await cargarTabla(container);
}

async function cargarTabla(container) {
  const wrap = container.querySelector('#tabla-tipos-wrap');
  const { data, error } = await supabase.from('tipos_habitacion').select('*').order('nombre');
  if (error) {
    wrap.innerHTML = `<p class="mensaje-vacio">Error: ${error.message}</p>`;
    return;
  }
  wrap.innerHTML = `
    <table class="tabla-simple">
      <thead><tr><th>Nombre</th><th>Descripción</th></tr></thead>
      <tbody>
        ${data.map((t) => `<tr><td>${t.nombre}</td><td>${t.descripcion || '—'}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

registerModule({
  id: 'config-tipos',
  label: 'Tipos de habitación',
  icono: '🏷',
  roles: [],
  parentId: 'configuracion',
  render,
});
