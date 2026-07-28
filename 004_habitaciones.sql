# Arquitectura — Santa Ana House 21 PMS

## Principio

Misma arquitectura que el CRM de Servicentro B&B, a propósito, para evitar
un monolito:

- Cada módulo de negocio vive en su propio archivo `.js`.
- Los módulos se auto-registran en `core/modules-registry.js` (patrón plugin).
- `core/router.js` y `core/ui.js` **nunca** conocen módulos específicos por
  nombre — solo iteran lo que hay en el registro.
- `index.html` no tiene lógica de negocio: solo estructura (pantalla de
  login, header con pestañas, `#main-content`) y el
  `<script type="module">` que carga `core/app.js`.

## Cómo agregar un módulo nuevo (paso a paso)

Supongamos que quieres agregar **Dashboard**.

1. **Crea el archivo del módulo:** `modules/dashboard/dashboard.js`

2. **Escribe el módulo con esta forma mínima:**

   ```js
   import { registerModule } from '../../core/modules-registry.js';
   // import { supabase } from '../../core/supabase-client.js';
   // import { formatCOP } from '../../core/helpers/currency.js';

   function render(container) {
     container.innerHTML = `<h2>Inicio</h2>`;
     // Tu lógica de consultas a Supabase y pintado del DOM va aquí.
   }

   registerModule({
     id: 'dashboard',
     label: 'Inicio',
     icono: '🏠',
     roles: ['propietario', 'administrador'],
     render,
   });
   ```

   Si es una **subpestaña** de otro módulo (como Tipos de habitación y
   Tarifas dentro de Configuración), agrega `parentId: 'id-del-modulo-padre'`
   — ver `modules/configuracion/tipos.js` y `tarifas.js` como ejemplo real.

3. **Agrega UNA línea en `core/app.js`:**

   ```js
   import '../modules/dashboard/dashboard.js';
   ```

4. No hace falta tocar `index.html` — `app.js` es el único
   `<script type="module">` cargado, y él importa el módulo nuevo.

5. Si el módulo necesita tablas nuevas en Supabase, agrega un archivo SQL en
   `sql/00X_nombre.sql` con sus políticas RLS.

**Nunca se toca:** `core/router.js`, `core/ui.js`,
`core/modules-registry.js`, ni otros módulos existentes.

## Roles del sistema

`propietario`, `administrador`, `recepcionista`, `auditor`, `housekeeping`,
`bodega`, `contador` — enum `rol_usuario`, definido en `sql/001_usuarios.sql`.

## Reglas de oro

- **No lógica compartida duplicada.** Formateo de moneda, badges de estado,
  fechas → van en `core/helpers/`, se importan desde ahí. Nunca se copia y
  pega.
- **No variables globales** salvo las ya definidas: cliente de Supabase
  (`core/supabase-client.js`) y usuario/perfil autenticado (`core/auth.js`).
- **Seguridad en la base de datos, no solo en el frontend.** Cada tabla
  nueva necesita RLS. Ocultar un botón no es control de acceso. Cambios de
  estado sensibles y compartidos entre roles (ej. estado de una habitación)
  pasan por funciones `security definer` con chequeo de rol adentro, no por
  `UPDATE` directo a la tabla — ver `cambiar_estado_habitacion()` en
  `sql/004_habitaciones.sql`.
- **Cada módulo maneja sus propias queries.** Ningún módulo debe leer datos
  de la tabla de otro módulo directamente salvo que sea explícitamente su
  responsabilidad.

## Estructura de carpetas

```
santa-ana-house-pms/
├── index.html
├── ARCHITECTURE.md
├── README.md
├── assets/css/styles.css
├── assets/img/logo.png        (pendiente: subir logo real)
├── core/
│   ├── app.js                # único lugar que importa todos los módulos
│   ├── supabase-client.js
│   ├── auth.js                # login email/contraseña + perfil (rol)
│   ├── router.js
│   ├── modules-registry.js
│   ├── ui.js                  # pestañas arriba + sub-pestañas, toasts, modal
│   └── helpers/
│       ├── currency.js
│       ├── dates.js
│       └── badges.js
├── modules/
│   └── configuracion/
│       ├── habitaciones.js    # módulo principal (parentId: null)
│       ├── tipos.js           # subpestaña (parentId: 'configuracion')
│       └── tarifas.js         # subpestaña (parentId: 'configuracion')
└── sql/
    ├── 001_usuarios.sql
    ├── 002_hotel_config.sql
    ├── 003_tipos_habitacion_tarifas.sql
    ├── 004_habitaciones.sql
    └── 005_seed_santa_ana_house.sql
```

## Pendientes conocidos antes de producción

- Cargar el usuario propietario y el resto del staff en `usuarios` (ver
  `README.md`).
- Confirmar con el contador el % de IVA de alojamiento aplicable
  (`tarifas.iva_porcentaje` quedó en 19% como placeholder).
- Confirmar los precios reales de temporada alta (quedaron iguales a
  temporada baja en el seed inicial).
- Subir `assets/img/logo.png`.
- Facturación electrónica DIAN e Inteligencia Artificial quedaron fuera de
  esta ronda — cuando lleguemos a esos módulos, solo se deja preparada la
  estructura de datos (sin integración real) hasta que se defina proveedor.
