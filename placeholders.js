// placeholders.js
//
// Pestañas "próximamente" para mostrarle al cliente el alcance completo
// del software (los 24 módulos acordados) mientras se construyen uno por
// uno. Cada entrada de este archivo es temporal: cuando un módulo se
// construya de verdad, se quita su registerModule() de aquí y se crea su
// propio archivo dedicado (housekeeping.js, caja.js, indicadores.js,
// minibar.js, inventario.js, proveedores.js, usuarios.js, compras.js,
// etc.), igual que los módulos que ya están listos (Dashboard,
// Configuración, Reservas, Recepción, Huéspedes, Housekeeping, Caja,
// Indicadores, Minibar, Inventario, Proveedores, Usuarios, Compras).
//
// Los módulos pendientes que no se usan a diario están agrupados en 4
// pestañas contenedoras (Inventario, Finanzas, Análisis, Administración)
// usando el mismo mecanismo parentId que ya usa Configuración con sus
// subpestañas — así el menú principal no crece sin control. Housekeeping y
// Caja ya tienen su propio archivo y quedan sueltas arriba porque el staff
// las usa todos los días. Indicadores, Minibar, Inventario, Proveedores,
// Usuarios y Compras también tienen su propio archivo, pero siguen viviendo
// como subpestañas de "Análisis", "Inventario" y "Administración"
// respectivamente (mismo lugar que ya tenían como placeholder).
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
      { icono: '🧾', label: 'Facturación', resumen: 'Facturas o documentos equivalentes por cada estadía.' },
      { icono: '📊', label: 'Contabilidad', resumen: 'Consolidado de ingresos y gastos para el contador.' },
      { icono: '💸', label: 'Gastos', resumen: 'Registro y categorización de gastos operativos.' },
    ],
  },
  {
    id: 'grupo-analisis',
    label: 'Análisis',
    icono: '📈',
    roles: ['propietario', 'administrador', 'auditor'],
    titulo: 'Análisis',
    descripcion: 'Reportes, indicadores, estadísticas históricas y auditoría del sistema.',
    hijos: [
      { icono: '📈', label: 'Reportes', resumen: 'Reportes operativos exportables a Excel/PDF.' },
      { icono: '📌', label: 'Indicadores', resumen: 'Ocupación, ingresos efectivo/digital y comparativos por período.' },
      { icono: '📉', label: 'Estadísticas', resumen: 'Tendencias históricas de ocupación e ingresos.' },
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
      { icono: '🤝', label: 'CRM', resumen: 'Seguimiento comercial de huéspedes frecuentes y agencias.' },
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
// Proveedores, Usuarios y Compras ya se construyeron — ver caja.js,
// indicadores.js, minibar.js, inventario.js, proveedores.js, usuarios.js y
// compras.js) ---
const MODULOS_PENDIENTES = [
  {
    id: 'facturacion',
    label: 'Facturación',
    icono: '🧾',
    roles: ['propietario', 'administrador', 'contador'],
    parentId: 'grupo-finanzas',
    titulo: 'Facturación',
    descripcion: 'Generación de facturas o documentos equivalentes por cada estadía.',
    features: [
      'Factura generada a partir de la reserva/check-out',
      'Cálculo de IVA (a confirmar % con el contador)',
      'Estructura de datos lista para integrar facturación electrónica DIAN más adelante',
    ],
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    icono: '📊',
    roles: ['propietario', 'administrador', 'contador'],
    parentId: 'grupo-finanzas',
    titulo: 'Contabilidad',
    descripcion: 'Consolidación de ingresos y gastos del hotel para el contador.',
    features: [
      'Resumen de ingresos (Caja, Facturación) y gastos (Gastos, Compras)',
      'Exportable para el contador',
      'Mismo patrón de "lectura entre módulos" que ya usa el Dashboard e Indicadores',
    ],
  },
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
      'Vínculo con Caja y Contabilidad',
    ],
  },
  {
    id: 'reportes',
    label: 'Reportes',
    icono: '📈',
    roles: ['propietario', 'administrador', 'auditor'],
    parentId: 'grupo-analisis',
    titulo: 'Reportes',
    descripcion: 'Reportes operativos exportables (ocupación, ingresos, gastos, huéspedes) a partir de los mismos datos que ya muestra Indicadores.',
    features: [
      'Reportes por rango de fechas',
      'Exportación a Excel y PDF',
    ],
  },
  {
    id: 'estadisticas',
    label: 'Estadísticas',
    icono: '📉',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-analisis',
    titulo: 'Estadísticas',
    descripcion: 'Tendencias históricas de ocupación, ingresos y comportamiento de huéspedes, con gráficas sobre los mismos datos de Indicadores.',
    features: [
      'Gráficas de ocupación e ingresos en el tiempo',
      'Estacionalidad y comparativos año a año',
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
    id: 'crm',
    label: 'CRM',
    icono: '🤝',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-administracion',
    titulo: 'CRM',
    descripcion: 'Seguimiento comercial de huéspedes corporativos, agencias y clientes frecuentes.',
    features: [
      'Oportunidades y seguimiento comercial',
      'Se apoya en la ficha de Huéspedes ya construida',
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
