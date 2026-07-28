// core/router.js
//
// Router central. Solo itera lo que hay en modules-registry — nunca importa
// ni referencia un módulo por nombre. Agregar un módulo nuevo no requiere
// tocar este archivo.

import { getModulesForRole, getModuleById } from './modules-registry.js';

let contenedor = null;
let moduloActivoId = null;

export function initRouter(selectorContenedor) {
  contenedor = document.querySelector(selectorContenedor);
  if (!contenedor) {
    throw new Error(`No se encontró el contenedor "${selectorContenedor}" en el DOM.`);
  }
}

export function renderModulo(id, rol) {
  const modulo = getModuleById(id);
  if (!modulo || !modulo.roles.includes(rol)) {
    contenedor.innerHTML = '<p class="mensaje-vacio">No tienes acceso a este módulo.</p>';
    return;
  }
  moduloActivoId = id;
  contenedor.innerHTML = '';
  modulo.render(contenedor);
}

export function renderPrimerModuloDisponible(rol) {
  const disponibles = getModulesForRole(rol);
  if (disponibles.length === 0) {
    contenedor.innerHTML = '<p class="mensaje-vacio">No tienes módulos asignados. Contacta a un administrador.</p>';
    return;
  }
  renderModulo(disponibles[0].id, rol);
}

export function getModuloActivoId() {
  return moduloActivoId;
}
