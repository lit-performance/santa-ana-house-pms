// modules-registry.js
//
// Registro central de módulos ("patrón plugin"). Cada módulo se auto-registra
// llamando a registerModule() al ser importado por core/app.js.
//
// Este archivo NUNCA debe modificarse para agregar un módulo nuevo — solo lee
// lo que los módulos le entregan. Ver ARCHITECTURE.md para el paso a paso.

const registro = [];

/**
 * @param {Object} mod
 * @param {string} mod.id - identificador único, ej. 'configuracion'
 * @param {string} mod.label - texto visible en la pestaña
 * @param {string} [mod.icono] - emoji o clase de ícono
 * @param {string[]} [mod.roles] - roles que pueden ver este módulo: 'propietario',
 *   'administrador', 'recepcionista', 'auditor', 'housekeeping', 'bodega', 'contador'
 *   (default: todos)
 * @param {string|null} [mod.parentId] - si es una subpestaña de otro módulo (ej. Tarifas dentro de Configuración)
 * @param {(container: HTMLElement) => void} mod.render - pinta el módulo dentro del contenedor
 */
export function registerModule(mod) {
  if (!mod.id || typeof mod.render !== 'function') {
    throw new Error('Un módulo debe tener al menos "id" (string) y "render" (function).');
  }
  if (registro.some((m) => m.id === mod.id)) {
    console.warn(`Módulo duplicado ignorado: ${mod.id}`);
    return;
  }
  registro.push({
    roles: ['propietario', 'administrador', 'recepcionista', 'auditor', 'housekeeping', 'bodega', 'contador'],
    parentId: null,
    icono: '•',
    ...mod,
  });
}

/** Módulos de primer nivel (sin parentId) visibles para un rol dado. */
export function getModulesForRole(rol) {
  return registro.filter((m) => m.parentId === null && m.roles.includes(rol));
}

/** Subpestañas de un módulo, visibles para un rol dado. */
export function getSubModulesForRole(parentId, rol) {
  return registro.filter((m) => m.parentId === parentId && m.roles.includes(rol));
}

/**
 * Todos los módulos (de primer nivel Y subpestañas) visibles para un rol,
 * en una sola lista en orden de registro.
 */
export function getFlatModulesForRole(rol) {
  return registro.filter((m) => m.roles.includes(rol));
}

export function getModuleById(id) {
  return registro.find((m) => m.id === id);
}
