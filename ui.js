// ui.js
//
// Navegación de DOS niveles (idéntico patrón al CRM de Servicentro B&B):
// - Fila principal (#tabs-nav): solo las secciones de primer nivel.
// - Fila de subpestañas (#tabs-nav-sub): cambia según la sección activa —
//   solo muestra las subpestañas de ESE módulo, nunca las de otro. Si una
//   sección no tiene subpestañas propias, esta fila se oculta.
//
// El propio módulo principal aparece como el primer botón de su fila de
// subpestañas (representa su vista "por defecto").

import { getModulesForRole, getSubModulesForRole } from './modules-registry.js';
import { renderModulo } from './router.js';

let rolActual = null;
let navPrincipal = null;
let navSub = null;

export function initTabs({ rol, nombreUsuario, onLogout }) {
  rolActual = rol;
  navPrincipal = document.getElementById('tabs-nav');
  navSub = document.getElementById('tabs-nav-sub');

  const nombreEl = document.getElementById('nombre-usuario-activo');
  const btnSalir = document.getElementById('btn-cerrar-sesion');
  if (nombreEl) nombreEl.textContent = nombreUsuario || '';
  if (btnSalir) btnSalir.addEventListener('click', onLogout);

  const principales = getModulesForRole(rol);
  navPrincipal.innerHTML = '';

  principales.forEach((modulo) => {
    const tab = crearBotonPestana(modulo, () => seleccionarSeccion(modulo));
    navPrincipal.appendChild(tab);
  });

  if (principales.length > 0) seleccionarSeccion(principales[0]);

  return { marcarActivo: (id) => marcarActivoEnFila(navPrincipal, id) };
}

function seleccionarSeccion(modulo) {
  renderModulo(modulo.id, rolActual);
  marcarActivoEnFila(navPrincipal, modulo.id);
  pintarSubNav(modulo);
}

function pintarSubNav(moduloActivo) {
  const subs = getSubModulesForRole(moduloActivo.id, rolActual);

  if (subs.length === 0) {
    navSub.innerHTML = '';
    navSub.classList.add('oculto');
    return;
  }

  navSub.classList.remove('oculto');
  navSub.innerHTML = '';

  const propia = crearBotonPestana(moduloActivo, () => {
    renderModulo(moduloActivo.id, rolActual);
    marcarActivoEnFila(navSub, moduloActivo.id);
  });
  propia.classList.add('activo');
  navSub.appendChild(propia);

  subs.forEach((sub) => {
    const tab = crearBotonPestana(sub, () => {
      renderModulo(sub.id, rolActual);
      marcarActivoEnFila(navSub, sub.id);
    });
    navSub.appendChild(tab);
  });
}

function crearBotonPestana(modulo, alHacerClic) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tab-item';
  tab.dataset.moduleId = modulo.id;
  tab.innerHTML = `<span class="tab-icono">${modulo.icono}</span><span>${modulo.label}</span>`;
  tab.addEventListener('click', alHacerClic);
  return tab;
}

function marcarActivoEnFila(fila, id) {
  fila.querySelectorAll('.tab-item').forEach((el) => {
    el.classList.toggle('activo', el.dataset.moduleId === id);
  });
}

export function mostrarToast(mensaje, tipo = 'info') {
  const contenedor = document.getElementById('toast-container');
  if (!contenedor) {
    console.warn('No existe #toast-container en el DOM; mensaje:', mensaje);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/**
 * Modal de confirmación genérico y reutilizable. Devuelve una Promise<boolean>
 * que resuelve true si el usuario confirma, false si cancela.
 */
export function mostrarConfirmacion({ titulo, contenidoHTML, textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-caja">
        <h3>${titulo}</h3>
        <div class="modal-contenido">${contenidoHTML}</div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="modal-cancelar">${textoCancelar}</button>
          <button type="button" class="btn btn-primario" id="modal-confirmar">${textoConfirmar}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    overlay.querySelector('#modal-cancelar').addEventListener('click', () => cerrar(false));
    overlay.querySelector('#modal-confirmar').addEventListener('click', () => cerrar(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cerrar(false);
    });
  });
}
