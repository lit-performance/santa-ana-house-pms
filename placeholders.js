// placeholders.js
//
// Pestañas "próximamente" para mostrarle al cliente el alcance completo
// del software (los 24 módulos acordados) mientras se construyen uno por
// uno. Cada entrada de este archivo es temporal: cuando un módulo se
// construya de verdad, se quita su registerModule() de aquí y se crea su
// propio archivo dedicado (housekeeping.js, caja.js, etc.), igual que los
// módulos que ya están listos (Dashboard, Configuración, Reservas,
// Recepción, Huéspedes).
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

const MODULOS_PENDIENTES = [
  {
    id: 'housekeeping',
    label: 'Housekeeping',
    icono: '🧹',
    roles: ['propietario', 'administrador', 'housekeeping'],
    titulo: 'Housekeeping',
    descripcion: 'Control del estado de limpieza de cada habitación, coordinado con Recepción y el estado de habitaciones ya existente.',
    features: [
      'Cambio de estado por habitación: disponible, en limpieza, inspección, mantenimiento, bloqueada, fuera de servicio',
      'Hora de inicio/fin de limpieza y empleado asignado',
      'Observaciones y fotografía de la habitación',
      'Reutiliza la misma función cambiar_estado_habitacion() ya construida',
    ],
  },
  {
    id: 'minibar',
    label: 'Minibar',
    icono: '🥤',
    roles: ['propietario', 'administrador', 'recepcionista', 'bodega'],
    titulo: 'Minibar',
    descripcion: 'Control de consumo del minibar por habitación y su cargo a la cuenta del huésped.',
    features: [
      'Inventario de minibar por habitación',
      'Registro de consumo en cada check-out',
      'Cargo automático al total de la estadía',
      'Alertas de reposición',
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icono: '📦',
    roles: ['propietario', 'administrador', 'bodega'],
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
    titulo: 'Proveedores',
    descripcion: 'Directorio de proveedores del hotel con su historial comercial.',
    features: [
      'Datos de contacto y condiciones comerciales',
      'Historial de compras por proveedor',
      'Vínculo con el módulo de Compras',
    ],
  },
  {
    id: 'gastos',
    label: 'Gastos',
    icono: '💸',
    roles: ['propietario', 'administrador', 'contador'],
    titulo: 'Gastos',
    descripcion: 'Registro de los gastos operativos del hotel, categorizados para reportes y contabilidad.',
    features: [
      'Registro de gastos por categoría',
      'Adjuntar soporte/factura',
      'Vínculo con Caja y Contabilidad',
    ],
  },
  {
    id: 'caja',
    label: 'Caja',
    icono: '💰',
    roles: ['propietario', 'administrador', 'recepcionista'],
    titulo: 'Caja',
    descripcion: 'Apertura, movimientos y cierre de caja del turno, con arqueo automático.',
    features: [
      'Apertura de caja con base inicial',
      'Movimientos: ingresos, egresos, pagos y abonos de reservas',
      'Cierre con arqueo y diferencias',
      'Cierres diario, semanal, mensual y anual',
    ],
  },
  {
    id: 'facturacion',
    label: 'Facturación',
    icono: '🧾',
    roles: ['propietario', 'administrador', 'contador'],
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
    titulo: 'Contabilidad',
    descripcion: 'Consolidación de ingresos y gastos del hotel para el contador.',
    features: [
      'Resumen de ingresos (Caja, Facturación) y gastos (Gastos, Compras)',
      'Exportable para el contador',
      'Mismo patrón de "lectura entre módulos" que ya usa el Dashboard',
    ],
  },
  {
    id: 'reportes',
    label: 'Reportes',
    icono: '📈',
    roles: ['propietario', 'administrador', 'auditor'],
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
    titulo: 'Indicadores',
    descripcion: 'KPIs clave del negocio hotelero.',
    features: [
      'Ocupación %, ADR (tarifa promedio), RevPAR',
      'Comparativos por período',
    ],
  },
  {
    id: 'auditoria',
    label: 'Auditoría',
    icono: '🔍',
    roles: ['propietario', 'administrador', 'auditor'],
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
    titulo: 'Documentos',
    descripcion: 'Almacenamiento de documentos legales y operativos del hotel.',
    features: [
      'RNT, pólizas, contratos, permisos',
      'Alertas de documentos próximos a vencer',
    ],
  },
  {
    id: 'estadisticas',
    label: 'Estadísticas',
    icono: '📉',
    roles: ['propietario', 'administrador'],
    titulo: 'Estadísticas',
    descripcion: 'Tendencias históricas de ocupación, ingresos y comportamiento de huéspedes.',
    features: [
      'Gráficas de ocupación e ingresos en el tiempo',
      'Estacionalidad y comparativos año a año',
    ],
  },
  {
    id: 'ia',
    label: 'IA',
    icono: '🤖',
    roles: ['propietario', 'administrador'],
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
    render: vistaProximamente(modulo),
  });
});
