// app.js
//
// Único punto de entrada de JS y única "lista central" de módulos: cada
// módulo nuevo se agrega aquí con una línea de import (ver ARCHITECTURE.md).

import { iniciarSesion, cerrarSesion, restaurarSesion } from './auth.js';
import { initRouter, renderPrimerModuloDisponible } from './router.js';
import { initTabs } from './ui.js';

// --- Módulos registrados (agregar una línea por módulo nuevo, en el
// orden en que deben aparecer las pestañas) ---
import './dashboard.js';
import './config-habitaciones.js';
import './config-tipos.js';
import './config-tarifas.js';
import './reservas.js';
// import './recepcion.js';
// import './huespedes.js';
// import './housekeeping.js';
// import './caja.js';

const pantallaLogin = document.getElementById('pantalla-login');
const pantallaApp = document.getElementById('pantalla-app');
const formLogin = document.getElementById('form-login');
const errorLogin = document.getElementById('error-login');
const btnLogin = document.getElementById('btn-login');

initRouter('#main-content');

async function mostrarApp(usuario) {
  pantallaLogin.classList.add('oculto');
  pantallaApp.classList.remove('oculto');
  initTabs({
    rol: usuario.rol,
    nombreUsuario: usuario.nombre,
    onLogout: async () => {
      await cerrarSesion();
      location.reload();
    },
  });
  renderPrimerModuloDisponible(usuario.rol);
}

function mostrarLogin(mensajeError) {
  pantallaApp.classList.add('oculto');
  pantallaLogin.classList.remove('oculto');
  if (mensajeError) {
    errorLogin.textContent = mensajeError;
    errorLogin.classList.remove('oculto');
  } else {
    errorLogin.classList.add('oculto');
  }
}

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorLogin.classList.add('oculto');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  btnLogin.disabled = true;
  btnLogin.textContent = 'Ingresando…';
  try {
    const usuario = await iniciarSesion(email, password);
    await mostrarApp(usuario);
  } catch (err) {
    mostrarLogin(err.message || 'Correo o contraseña incorrectos.');
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Ingresar';
  }
});

// Al cargar la página, si ya hay una sesión activa (recargó la pestaña), la
// restauramos sin pedir login de nuevo.
(async function bootstrap() {
  try {
    const usuario = await restaurarSesion();
    if (usuario) await mostrarApp(usuario);
    else mostrarLogin();
  } catch {
    mostrarLogin();
  }
})();
