// usuarios.js
//
// Módulo: Usuarios. Alta/baja de cuentas del staff y su rol, desde la app
// (antes solo se podía hacer directo en Supabase).
//
// Detalle importante: crear una cuenta nueva llama a supabase.auth.signUp(),
// que por defecto REEMPLAZA la sesión activa del cliente que lo llama (te
// dejaría logueada como el usuario nuevo en vez de como admin). Para
// evitarlo, este módulo usa un SEGUNDO cliente de Supabase, aparte del
// `supabase` que usa el resto de la app, configurado con
// `persistSession: false` — así el signUp() de la cuenta nueva nunca toca
// la sesión ni el localStorage del admin que la está creando.
//
// "Baja" no borra la cuenta de Supabase Auth (borrar usuarios de Auth
// requiere la service_role key, que nunca debe vivir en código de cliente
// por seguridad). En vez de eso, se marca `activo = false` en la tabla
// `usuarios` — auth.js ya rechaza el login de cualquier cuenta inactiva.
//
// Cambiar la contraseña de un usuario YA EXISTENTE tampoco se puede hacer
// de forma segura desde aquí (mismo motivo: requiere service_role). Para
// eso, usa el correo de recuperación de contraseña (ya configurado) o el
// truco de SQL Editor con crypt()/gen_salt('bf') sobre auth.users.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { getUsuarioActual } from './auth.js';

// Mismos URL/key que supabase-client.js — duplicados a propósito para que
// este cliente sea independiente (ver nota arriba). No es una credencial
// nueva ni más sensible: es la misma anon key pública que ya usa la app.
const SUPABASE_URL = 'https://bhtmiqtwbzuezbqsrhej.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9XKSyYxpCkuIDF8WfW-92A_PHNPoO8r';
const supabaseAuxiliar = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const ROLES = ['propietario', 'administrador', 'recepcionista', 'auditor', 'housekeeping', 'bodega', 'contador'];

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

async function render(container) {
  container.innerHTML = `
    <h2>Usuarios</h2>
    <div id="usuarios-lista-wrap" style="margin-bottom:1.5rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div id="usuarios-nuevo-wrap"></div>
  `;
  await Promise.all([
    cargarListaUsuarios(container.querySelector('#usuarios-lista-wrap')),
    cargarFormNuevo(container.querySelector('#usuarios-nuevo-wrap'), container),
  ]);
}

async function cargarListaUsuarios(elemento) {
  elemento.innerHTML = '<p class="mensaje-vacio">Cargando…</p>';

  const { data: usuarios, error } = await supabase
    .from('usuarios')
    .select('*')
    .order('activo', { ascending: false })
    .order('nombre');

  if (error) {
    elemento.innerHTML = `<p class="mensaje-vacio">Error cargando usuarios: ${error.message}</p>`;
    return;
  }

  const yo = getUsuarioActual();

  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>Staff con acceso al sistema</h3>
      <div class="tabla-scroll">
        <table class="tabla-simple">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo (referencia)</th>
              <th>Rol</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${(usuarios || [])
              .map(
                (u) => `
              <tr data-id="${u.id}">
                <td><input type="text" class="input-usuario" data-campo="nombre" value="${escaparHTML(u.nombre)}" style="width:160px" /></td>
                <td><input type="email" class="input-usuario" data-campo="correo" value="${escaparHTML(u.correo || '')}" placeholder="Opcional" style="width:190px" /></td>
                <td>
                  <select class="input-usuario" data-campo="rol">
                    ${ROLES.map((r) => `<option value="${r}" ${u.rol === r ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td><input type="checkbox" class="input-usuario" data-campo="activo" ${u.activo ? 'checked' : ''} ${u.id === yo?.id ? 'disabled title="No puedes desactivar tu propia cuenta"' : ''} /></td>
                <td><button type="button" class="btn-editar btn-guardar-usuario">Guardar</button></td>
              </tr>
            `
              )
              .join('') || '<tr><td colspan="5" class="mensaje-vacio">Sin usuarios registrados.</td></tr>'}
          </tbody>
        </table>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">Desactivar una cuenta le impide iniciar sesión de inmediato (no borra su historial). Cambiar contraseñas de cuentas existentes se hace por el correo de recuperación o directo en Supabase — ver nota en el código de este módulo.</p>
    </div>
  `;

  elemento.querySelectorAll('.btn-guardar-usuario').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const fila = e.target.closest('tr');
      const id = fila.dataset.id;
      const payload = {};
      fila.querySelectorAll('.input-usuario').forEach((input) => {
        const campo = input.dataset.campo;
        if (input.type === 'checkbox') {
          payload[campo] = input.checked;
        } else {
          payload[campo] = input.value.trim() || null;
        }
      });

      if (id === yo?.id && payload.activo === false) {
        mostrarToast('No puedes desactivar tu propia cuenta.', 'error');
        return;
      }

      const { error } = await supabase.from('usuarios').update(payload).eq('id', id);
      if (error) {
        mostrarToast(`Error: ${error.message}`, 'error');
        return;
      }
      mostrarToast('Usuario actualizado.', 'exito');
      await cargarListaUsuarios(elemento);
    });
  });
}

async function cargarFormNuevo(elemento) {
  elemento.innerHTML = `
    <div class="tarjeta">
      <h3>+ Nuevo usuario</h3>
      <form id="form-nuevo-usuario" class="form-grid">
        <label>Nombre completo
          <input type="text" name="nombre" required />
        </label>
        <label>Correo
          <input type="email" name="correo" required />
        </label>
        <label>Contraseña temporal
          <input type="text" name="password" required minlength="6" placeholder="Mínimo 6 caracteres" />
        </label>
        <label>Rol
          <select name="rol" required>
            ${ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </label>
        <button type="submit" class="btn btn-primario">Crear usuario</button>
      </form>
      <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">Si en Supabase tienes activa la confirmación por correo (Authentication → Providers → Email → "Confirm email"), la persona debe confirmar su correo antes de poder iniciar sesión. Para uso interno del staff puedes desactivar esa opción.</p>
    </div>
  `;

  elemento.querySelector('#form-nuevo-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nombre = form.get('nombre').trim();
    const correo = form.get('correo').trim();
    const password = form.get('password');
    const rol = form.get('rol');

    const { data, error: errSignUp } = await supabaseAuxiliar.auth.signUp({ email: correo, password });
    if (errSignUp) {
      mostrarToast(`Error creando la cuenta: ${errSignUp.message}`, 'error');
      return;
    }
    if (!data.user) {
      mostrarToast('No se pudo crear la cuenta (respuesta inesperada de Supabase).', 'error');
      return;
    }

    const { error: errPerfil } = await supabase.from('usuarios').insert({
      id: data.user.id,
      nombre,
      correo,
      rol,
    });
    if (errPerfil) {
      mostrarToast(`Cuenta creada en Auth, pero no se pudo crear el perfil: ${errPerfil.message}`, 'error');
      return;
    }

    mostrarToast('Usuario creado.', 'exito');
    e.target.reset();
    const wrapLista = document.querySelector('#usuarios-lista-wrap');
    if (wrapLista) await cargarListaUsuarios(wrapLista);
  });
}

registerModule({
  id: 'usuarios',
  label: 'Usuarios',
  icono: '👤',
  roles: ['propietario', 'administrador'],
  parentId: 'grupo-administracion',
  render,
});
