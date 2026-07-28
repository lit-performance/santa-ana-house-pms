// placeholders.js
//
// Pestañas "próximamente" para mostrarle al cliente el alcance completo
// del software (los 24 módulos acordados) mientras se construyen uno por
// uno. Cada entrada de este archivo es temporal: cuando un módulo se
// construya de verdad, se quita su registerModule() de aquí y se crea su
// propio archivo dedicado (housekeeping.js, caja.js, etc.), igual que los
// módulos que ya están listos (Dashboard, Configuración, Reservas,
// Recepción, Huéspedes, Housekeeping, Caja).
//
// Los módulos pendientes que no se usan a diario están agrupados en 4
// pestañas contenedoras (Inventario, Finanzas, Análisis, Administración)
// usando el mismo mecanismo parentId que ya usa Configuración con sus
// subpestañas — así el menú principal no crece sin control. Housekeeping y
// Caja ya tienen su propio archivo y quedan sueltas arriba porque el staff
// las usa todos los días.
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
    descripcion: 'Minibar, existencias, compras a proveedores y el directorio de proveedores del hotel.',
    hijos: [
      { icono: '🥤', label: 'Minibar', resumen: 'Control de consumo y cargo a la cuenta del huésped.' },
      { icono: '📦', label: 'Inventario', resumen: 'Insumos y suministros del hotel, existencias mínimas.' },
      { icono: '🛒', label: 'Compras', resumen: 'Órdenes de compra y seguimiento de pedidos.' },
      { icono: '🚚', label: 'Proveedores', resumen: 'Directorio y condiciones comerciales.' },
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
      { icono: '📌', label: 'Indicadores', resumen: 'Ocupación, ADR, RevPAR y comparativos.' },
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
      { icono: '👤', label: 'Usuarios', resumen: 'Cuentas del staff y sus roles.' },
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

// --- Módulos "próximamente" (Caja ya se construyó — ver caja.js) ---
const MODULOS_PENDIENTES = [
  {
    id: 'minibar',
    label: 'Minibar',
    icono: '🥤',
    roles: ['propietario', 'administrador', 'recepcionista', 'bodega'],
    parentId: 'grupo-inventario',
    titulo: 'Minibar',
    descripcion: 'Control de consumo del minibar por habitación y su cargo a la cuenta del huésped.',
    features: [
      'Catálogo de productos con precio (ya tenemos la lista de precios real de Santa Ana)',
      'Inventario estándar por habitación (ya tenemos el checklist real por repisa/nevera)',
      'Registro de consumo en cada check-out',
      'Cargo automático al total de la estadía',
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icono: '📦',
    roles: ['propietario', 'administrador', 'bodega'],
    parentId: 'grupo-inventario',
    titulo: 'Inventario',
    descripcion: 'Control de insumos y suministros del hotel (lencería, aseo, papelería, amenities).',
    features: [
      'Existencias actuales por insumo',
      'Existencias mínimas y alertas de reposición',
      'Movimientos de entrada y salida',
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    icono: '🛒',
    roles: ['propietario', 'administrador', 'bodega'],
    parentId: 'grupo-inventario',
    titulo: 'Compras',
    descripcion: 'Órdenes de compra a proveedores y seguimiento de la mercancía pedida.',
    features: [
      'Órdenes de compra por proveedor',
      'Estado del pedido: solicitado, en camino, recibido',
      'Vínculo con Inventario al recibir mercancía',
    ],
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    icono: '🚚',
    roles: ['propietario', 'administrador', 'bodega', 'contador'],
    parentId: 'grupo-inventario',
    titulo: 'Proveedores',
    descripcion: 'Directorio de proveedores del hotel con su historial comercial.',
    features: [
      'Datos de contacto y condiciones comerciales',
      'Historial de compras por proveedor',
      'Vínculo con el módulo de Compras',
    ],
  },
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
      'Mismo patrón de "lectura entre módulos" que ya usa el Dashboard',
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
    descripcion: 'Reportes operativos exportables (ocupación, ingresos, gastos, huéspedes).',
    features: [
      'Reportes por rango de fechas',
      'Exportación a Excel y PDF',
    ],
  },
  {
    id: 'indicadores',
    label: 'Indicadores',
    icono: '📌',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-analisis',
    titulo: 'Indicadores',
    descripcion: 'KPIs clave del negocio hotelero.',
    features: [
      'Ocupación %, ADR (tarifa promedio), RevPAR',
      'Comparativos por período',
    ],
  },
  {
    id: 'estadisticas',
    label: 'Estadísticas',
    icono: '📉',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-analisis',
    titulo: 'Estadísticas',
    descripcion: 'Tendencias históricas de ocupación, ingresos y comportamiento de huéspedes.',
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
    id: 'usuarios',
    label: 'Usuarios',
    icono: '👤',
    roles: ['propietario', 'administrador'],
    parentId: 'grupo-administracion',
    titulo: 'Usuarios',
    descripcion: 'Gestión de las cuentas del staff y sus roles dentro del sistema.',
    features: [
      'Alta/baja de usuarios y asignación de rol',
      'Interfaz sobre la tabla usuarios ya existente (hoy se gestiona por Supabase directamente)',
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
