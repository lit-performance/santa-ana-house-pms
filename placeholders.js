// placeholders.js
//
// Pestañas "próximamente" para mostrarle al cliente el alcance completo
// del software (los 24 módulos acordados) mientras se construyen uno por
// uno. Cada entrada de este archivo es temporal: cuando un módulo se
// construya de verdad, se quita su registerModule() de aquí y se crea su
// propio archivo dedicado (housekeeping.js, caja.js, indicadores.js,
// minibar.js, inventario.js, proveedores.js, usuarios.js, compras.js,
// facturacion.js, contabilidad.js, reportes.js, estadisticas.js, crm.js,
// etc.), igual que los módulos que ya están listos (Dashboard,
// Configuración, Reservas, Recepción, Huéspedes, Housekeeping, Caja,
// Indicadores, Minibar, Inventario, Proveedores, Usuarios, Compras,
// Facturación, Contabilidad, Reportes, Estadísticas, CRM).
//
// Los módulos pendientes que no se usan a diario están agrupados en 4
// pestañas contenedoras (Inventario, Finanzas, Análisis, Administración)
// usando el mismo mecanismo parentId que ya usa Configuración con sus
// subpestañas — así el menú principal no crece sin control. Housekeeping y
// Caja ya tienen su propio archivo y quedan sueltas arriba porque el staff
// las usa todos los días. Indicadores, Minibar, Inventario, Proveedores,
// Usuarios, Compras, Facturación, Contabilidad, Reportes, Estadísticas,
// Huéspedes y CRM también tienen su propio archivo, pero siguen viviendo
// como subpestañas de "Análisis", "Inventario", "Finanzas" y
// "Administración" respectivamente.
//
// Nota sobre el render de cada grupo (vistaGrupo): ya NO se usa como
// contenido por defecto al entrar al grupo (ver ui.js — ahora se entra
// directo a la primera subpestaña real), pero se deja registrado por si
// alguna vez se necesita un resumen del grupo; hoy no es alcanzable desde
// la navegación normal.
//
// No tocan la base de datos — son solo vista, sin tablas ni RLS propias.

import { registerModule } from './modules-registry.js';

function vistaProximamente({ titulo, descripcion, features }) {
  return async function render(container) {
    container.innerHTML = `
      <h2>${titulo}</h2>
      <div class="tarjeta">
        <span class="badge badge-pendiente">Próximamente</span>
        <p style="margin-top:1rem;">${descripcion}</p>
        <p style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-texto-suave); margin-bottom:0.4rem;">Incluirá</p>
        <ul style="margin:0; padding-left:1.2rem; font-size:0.92rem; line-height:1.6;">
          ${features.map((f) => `<li>${f}</li>`).join('')}
        </ul>
      </div>
    `;
  };
}

function vistaGrupo({ titulo, descripcion, hijos }) {
  return async function render(container) {
    container.innerHTML = `
      <h2>${titulo}</h2>
      <p style="color:var(--color-texto-suave); margin-bottom:1.25rem;">${descripcion}</p>
      <div class="grid-dos-columnas">
        ${hijos
          .map(
            (h) => `
          <div class="tarjeta">
            <h3>${h.icono} ${h.label}</h3>
            <p class="mensaje-vacio">${h.resumen}</p>
          </div>
        `
          )
          .join('')}
      </div>
      <p class="mensaje-vacio" style="margin-top:1rem;">Usa las subpestañas de arriba para ver el detalle de cada una.</p>
    `;
  };
}

// --- Pestañas contenedoras (agrupan las subpestañas de abajo) ---
const GRUPOS = [
  {
    id: 'grupo-inventario',
    label: 'Inventario',
    icono: '📦',
    roles: ['propietario', 'administrador', 'recepcionista', 'bodega', 'contador'],
    titulo: 'Inventario',
    descripcion: 'Minibar, existencias en bodega y por habitación, órdenes de compra y el directorio de proveedores del hotel.',
    hijos: [
      { icono: '🥤', label: 'Minibar', resumen: 'Catálogo real de Santa Ana, consumo por habitación y cargo automático al check-out.' },
      { icono: '📦', label: 'Inventario', resumen: 'Existencias en bodega (precio de costo, mínimos y recompra) e inventario físico de cada minibar de habitación.' },
      { icono: '🛒', label: 'Compras', resumen: 'Órdenes de compra a proveedores con seguimiento de estado y suma automática a bodega al recibir.' },
      { icono: '🚚', label: 'Proveedores', resumen: 'Directorio con datos de contacto y condiciones comerciales.' },
    ],
  },
  {
    id: 'grupo-finanzas',
    label: 'Finanzas',
    icono: '🏦',
    roles: ['propietario', 'administrador', 'contador'],
    titulo: 'Finanzas',
    descripcion: 'Facturación, contabilidad y gastos operativos. Caja queda aparte porque Recepción la usa todos los días.',
    hijos: [
      { icono: '🧾', label: 'Facturación', resumen: 'Documento equivalente por estadía, generado desde el check-out, con impuesto editable por factura.' },
      { icono: '📊', label: 'Contabilidad', resumen: 'Consolidado de ingresos y egresos por rango de fechas, exportable a CSV para el contador.' },
      { icono: '💸', label: 'Gastos', resumen: 'Registro y categorización de gastos operativos.' },
    ],
  },
  {
    id: 'grupo-analisis',
    label: 'Análisis',
    icono: '📈',
    // 'recepcionista' se agregó para que siga viendo Huéspedes (el resto
    // de subpestañas de este grupo — Reportes, Indicadores, Estadísticas,
    // Auditoría — tienen su propio rol y no incluyen recepcionista, así
    // que a ella solo le aparece Huéspedes dentro de Análisis).
    roles: ['propietario', 'administrador', 'auditor', 'recepcionista'],
    titulo: 'Análisis',
    descripcion: 'Huéspedes, reportes, indicadores, estadísticas históricas y auditoría del sistema.',
    hijos: [
      { icono: '🧳', label: 'Huéspedes', resumen: 'Ficha por huésped con historial de estadías, preferencias, alergias y observaciones.' },
      { icono: '📈', label: 'Reportes', resumen: 'Listados de Reservas, Ocupación por habitación y Huéspedes, exportables a CSV/Excel.' },
      { icono: '📌', label: 'Indicadores', resumen: 'Ocupación, ingresos efectivo/digital y comparativos por período.' },
      { icono: '📉', label: 'Estadísticas', resumen: 'Tendencias mensuales de ingresos y ocupación, más ranking de habitaciones más rentables.' },
      { icono: '🔍', label: 'Auditoría', resumen: 'Bitácora de quién hizo qué y cuándo.' },
    ],
  },
  {
    id: 'grupo-administracion',
    label: 'Administración',
    icono: '⚙️',
    roles: ['propietario', 'administrador', 'housekeeping'],
    titulo: 'Administración',
    descripcion: 'Usuarios, documentos legales, mantenimiento, CRM e inteligencia artificial.',
    hijos: [
      { icono: '👤', label: 'Usuarios', resumen: 'Alta/baja de cuentas del staff y su rol, desde la app.' },
      { icono: '📁', label: 'Documentos', resumen: 'RNT, pólizas, contratos, permisos.' },
      { icono: '🔧', label: 'Mantenimiento', resumen: 'Órdenes de mantenimiento preventivo y correctivo.' },
      { icono: '🤝', label: 'CRM', resumen: 'Oportunidades comerciales con etapa, valor estimado, próximo seguimiento y bitácora de interacciones.' },
      { icono: '🤖', label: 'IA', resumen: 'Recomendaciones y automatización de tareas repetitivas.' },
    ],
  },
];

GRUPOS.forEach((grupo) => {
  registerModule({
    id: grupo.id,
    label: grupo.label,
    icono: grupo.icono,
    roles: grupo.roles,
    render: vistaGrupo(grupo),
  });
});

// --- Módulos "próximamente" (Caja, Indicadores, Minibar, Inventario,
// Proveedores, Usuarios, Compras, Facturación, Contabilidad, Reportes,
// Estadísticas, Huéspedes y CRM ya se construyeron — ver caja.js,
// indicadores.js, minibar.js, inventario.js, proveedores.js, usuarios.js,
// compras.js, facturacion.js, contabilidad.js, reportes.js,
// estadisticas.js, huespedes.js y crm.js) ---
const MODULOS_PENDIENTES = [
  {
    id: 'gastos',
    label: 'Gastos',
    icono: '💸',
    roles: ['propietario', 'administrador', 'contador'],
    parentId: 'grupo-finanzas',
    titulo: 'Gastos',
    descripcion: 'Registro de los gastos operativos del hotel, categorizados para reportes y contabilidad.',
    features: [
      'Registro de gastos por categoría',
      'Adjuntar soporte/factura',
      'Se sumará a Contabilidad igual que Compras',
    ],
  },
  {
    id: 'auditoria',
    label: 'Auditoría',
    icono: '🔍',
    roles: ['propietario', 'administrador', 'auditor'],
    parentId: 'grupo-analisis',
    titulo: 'Auditoría',
    descripcion: 'Registro de quién hizo qué y cuándo sobre las acciones sensibles del sistema (cambios de estado, ediciones, eliminaciones).',
    features: [
      'Bitácora de acciones por usuario',
      'Filtro por módulo, usuario y fecha',
    ],
  },
  {
    id: 'mantenimiento',
    label: 'Mantenimiento',
    icono: '🔧',
    roles: ['propietario', 'administrador', 'housekeeping'],
    parentId: 'grupo-administracion',
    titulo: 'Mantenimiento',
    descripcion: 'Órdenes de mantenimiento preventivo y correctivo por habitación o área común.',
    features: [
      'Órdenes de trabajo con prioridad y responsable',
      'Vínculo con el estado "mantenimiento" de habitaciones',
    ],
  },
  {
    id: 'documentos',
    label: 'Documentos',
    icono: '📁',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-administracion',
    titulo: 'Documentos',
    descripcion: 'Almacenamiento de documentos legales y operativos del hotel.',
    features: [
      'RNT, pólizas, contratos, permisos',
      'Alertas de documentos próximos a vencer',
    ],
  },
  {
    id: 'ia',
    label: 'IA',
    icono: '🤖',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-administracion',
    titulo: 'Inteligencia Artificial',
    descripcion: 'Asistente para recomendaciones y automatización de tareas repetitivas dentro del sistema.',
    features: [
      'Sugerencias de tarifas según ocupación',
      'Resúmenes automáticos de reportes',
    ],
  },
];

MODULOS_PENDIENTES.forEach((modulo) => {
  registerModule({
    id: modulo.id,
    label: modulo.label,
    icono: modulo.icono,
    roles: modulo.roles,
    parentId: modulo.parentId,
    render: vistaProximamente(modulo),
  });
});
