// core/auth.js
//
// Autenticación con email + contraseña (Supabase Auth). Único lugar que
// conoce la sesión activa y el perfil (rol) del usuario — otros módulos
// importan getUsuarioActual() en vez de consultar auth.users directamente.

import { supabase } from './supabase-client.js';

let usuarioActual = null; // { id, nombre, rol, activo }

export async function iniciarSesion(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return cargarPerfil(data.user.id);
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
  usuarioActual = null;
}

export async function restaurarSesion() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return cargarPerfil(data.session.user.id);
}

async function cargarPerfil(userId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, rol, activo')
    .eq('id', userId)
    .single();

  if (error || !data) {
    await supabase.auth.signOut();
    throw new Error(
      'Tu cuenta no tiene un perfil asignado en el sistema. Pide a un administrador que te registre.'
    );
  }

  if (!data.activo) {
    await supabase.auth.signOut();
    throw new Error('Tu cuenta está desactivada. Contacta a un administrador.');
  }

  usuarioActual = data;
  return usuarioActual;
}

export function getUsuarioActual() {
  return usuarioActual;
}
