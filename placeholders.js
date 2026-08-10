// placeholders.js
//
// Pestañas "próximamente" para mostrarle al cliente el alcance completo
// del software (los 24 módulos acordados) mientras se construyen uno por
// uno. Cada entrada de este archivo es temporal: cuando un módulo se
// construya de verdad, se quita su registerModule() de aquí y se crea su
// propio archivo dedicado (housekeeping.js, caja.js, indicadores.js,
// minibar.js, inventario.js, proveedores.js, usuarios.js, compras.js,
// facturacion.js, contabilidad.js, reportes.js, estadisticas.js, crm.js,
// auditoria.js, etc.), igual que los módulos que ya están listos.
//
// Los módulos pendientes que no se usan a diario están agrupados en 3
// pestañas contenedoras (Inventario, Análisis, Administración) usando el
// mismo mecanismo parentId que ya usa Configuración con sus subpestañas
// — así el menú principal no crece sin control. Housekeeping y Caja ya
// tienen su propio archivo y quedan sueltas arriba porque el staff las
// usa todos los días.
//
// Nota sobre `esGrupoGenerico: true`: marca a estos 3 grupos como
// "contenedores sin contenido propio" (su render es el resumen genérico
// vistaGrupo de abajo) — es lo que le dice a ui.js que, al entrar por la
// pestaña principal, debe saltar directo a la primera subpestaña real en
// vez de mostrar el resumen genérico. Un módulo con contenido propio de
// verdad (como Configuración) NO debe llevar esta propiedad — ver la
// nota en ui.js.
//
// Cambios de reorganización (capacitación / demo al cliente):
//   - "Finanzas" se eliminó como pestaña: Facturación queda oculta (no se
//     va a facturar por ahora) y Contabilidad se movió como subpestaña de
//     Análisis (ver contabilidad.js).
//   - "Administración" queda oculta (roles: []) — sus únicos módulos
//     reales que seguían activos (IA, Mantenimiento, CRM) se ocultaron
//     también, y Usuarios/Documentos se movieron como subpestañas de
//     Configuración. Se deja registrada (no se borra) para poder
//     reactivarla fácil si se necesita más adelante.
//   - IA, Mantenimiento, CRM, Gastos y Facturación quedan ocultos con
//     `roles: []` (nadie los ve, pero el código/los datos siguen intactos
//     — reversible con solo devolverles roles).
//   - Auditoría ya no es un placeholder: se construyó de verdad (ver
//     auditoria.js), así que se quitó de MODULOS_PENDIENTES.
//
// No tocan la base de datos — son solo vista, sin tablas ni RLS propias
// (excepto lo que ya haya hecho el módulo real correspondiente).

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
    esGrupoGenerico: true,
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
    id: 'grupo-analisis',
    label: 'Análisis',
    icono: '📈',
    // 'recepcionista' se agregó para que siga viendo Huéspedes (el resto
    // de subpestañas de este grupo tienen su propio rol y no incluyen
    // recepcionista, así que a ella solo le aparece Huéspedes aquí).
    roles: ['propietario', 'administrador', 'auditor', 'recepcionista', 'contador'],
    esGrupoGenerico: true,
    titulo: 'Análisis',
    descripcion: 'Huéspedes, reportes, indicadores, contabilidad, estadísticas históricas y auditoría del sistema.',
    hijos: [
      { icono: '🧳', label: 'Huéspedes', resumen: 'Ficha por huésped con historial de estadías, preferencias, alergias y observaciones.' },
      { icono: '📈', label: 'Reportes', resumen: 'Listados de Reservas, Ocupación por habitación y Huéspedes, exportables a CSV/Excel.' },
      { icono: '📌', label: 'Indicadores', resumen: 'Ocupación, ingresos efectivo/digital y comparativos por período.' },
      { icono: '📊', label: 'Contabilidad', resumen: 'Consolidado de ingresos y egresos por rango de fechas, exportable a CSV para el contador.' },
      { icono: '📉', label: 'Estadísticas', resumen: 'Tendencias mensuales de ingresos y ocupación, más ranking de habitaciones más rentables.' },
      { icono: '🔍', label: 'Auditoría', resumen: 'Bitácora de aperturas/cierres de caja, movimientos, transferencias, ventas de mostrador y pagos — con quién y cuándo.' },
    ],
  },
  {
    id: 'grupo-administracion',
    label: 'Administración',
    icono: '⚙️',
    // Oculta temporalmente (ver nota de cabecera): sus módulos reales
    // (IA, Mantenimiento, CRM) están ocultos y Usuarios/Documentos se
    // movieron a Configuración, así que hoy no tendría nada que mostrar.
    roles: [],
    esGrupoGenerico: true,
    titulo: 'Administración',
    descripcion: 'Mantenimiento, CRM e inteligencia artificial.',
    hijos: [
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
    esGrupoGenerico: grupo.esGrupoGenerico,
    render: vistaGrupo(grupo),
  });
});

// --- Módulos "próximamente" ---
// IA, Mantenimiento y Gastos quedan con roles: [] (ocultos temporalmente,
// ver nota de cabecera) en vez de borrarse — así es trivial reactivarlos
// más adelante devolviéndoles su lista de roles.
const MODULOS_PENDIENTES = [
  {
    id: 'gastos',
    label: 'Gastos',
    icono: '💸',
    roles: [],
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
    id: 'mantenimiento',
    label: 'Mantenimiento',
    icono: '🔧',
    roles: [],
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
    parentId: 'configuracion',
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
    roles: [],
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
