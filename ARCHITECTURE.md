# Arquitectura — Santa Ana House 21 PMS

## Principio

Mismo espíritu que el CRM de Servicentro B&B (un archivo por módulo,
auto-registro tipo plugin, sin monolito), con UN ajuste importante:

**Todos los archivos viven sueltos en la raíz del repositorio, sin
subcarpetas.** Se subieron inicialmente con `core/`, `modules/` y `assets/`
como en Servicentro B&B, pero al subir la carpeta completa por la interfaz
web de GitHub (arrastrar y soltar), el navegador aplanó todas las rutas y
la app dejó de cargar (`index.html` buscaba `assets/css/styles.css` y
`core/app.js`, que ya no existían ahí). Para que esto no se repita nunca
—sin importar si arrastras una carpeta, archivos sueltos, o usas el botón
"choose your files"— todo el proyecto se aplanó a un solo nivel.

- Cada módulo de negocio vive en su propio archivo `.js`, con nombre único.
- Los módulos se auto-registran en `modules-registry.js` (patrón plugin).
- `router.js` y `ui.js` **nunca** conocen módulos específicos por nombre —
  solo iteran lo que hay en el registro.
- `index.html` no tiene lógica de negocio: solo estructura y el
  `<script type="module">` que carga `app.js`.
- Los archivos SQL numerados (`001_...sql`, `002_...sql`...) también viven
  en la raíz — el orden numérico basta para saber en qué secuencia correrlos
  en el SQL Editor de Supabase; no necesitan carpeta propia.

## Convención de nombres (reemplaza a las subcarpetas)

Como ya no hay carpetas que agrupen módulos relacionados, el **prefijo del
nombre de archivo** cumple ese rol:

- Los archivos de `configuracion` usan el prefijo `config-`:
  `config-habitaciones.js` (principal), `config-tipos.js` y
  `config-tarifas.js` (subpestañas).
- Un módulo nuevo con subpestañas propias sigue el mismo patrón: prefijo del
  módulo + guion + nombre de la subpestaña.

## Cómo agregar un módulo nuevo (paso a paso)

Supongamos que quieres agregar **Dashboard**.

1. **Crea el archivo:** `dashboard.js` (suelto en la raíz).

2. **Escríbelo con esta forma mínima:**

   ```js
   import { registerModule } from './modules-registry.js';
   // import { supabase } from './supabase-client.js';
   // import { formatCOP } from './currency.js';

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

   Si es una subpestaña de otro módulo, agrega `parentId: 'id-del-padre'` y
   nombra el archivo con el prefijo del padre (ej. `dashboard-alertas.js`).

3. **Agrega UNA línea en `app.js`:**

   ```js
   import './dashboard.js';
   ```

4. No hace falta tocar `index.html`.

5. Si necesita tablas nuevas en Supabase, agrega un archivo
   `00X_nombre.sql` (siguiente número disponible) con sus políticas RLS, y
   avisa antes de correrlo en producción.

6. **Al subir el archivo nuevo a GitHub:** "Add file" → "Upload files" →
   arrastra el archivo suelto (o varios) al recuadro. No hace falta crear
   ninguna carpeta.

**Nunca se toca:** `router.js`, `ui.js`, `modules-registry.js`, ni otros
módulos existentes.

## Roles del sistema

`propietario`, `administrador`, `recepcionista`, `auditor`, `housekeeping`,
`bodega`, `contador` — enum `rol_usuario`, definido en `001_usuarios.sql`.

## Reglas de oro

- **No lógica compartida duplicada.** Formateo de moneda (`currency.js`),
  badges de estado (`badges.js`), fechas (`dates.js`) — se importan desde
  ahí, nunca se copian y pegan.
- **No variables globales** salvo las ya definidas: cliente de Supabase
  (`supabase-client.js`) y usuario/perfil autenticado (`auth.js`).
- **Seguridad en la base de datos, no solo en el frontend.** Cada tabla
  nueva necesita RLS. Cambios de estado sensibles y compartidos entre roles
  (ej. estado de una habitación) pasan por funciones `security definer`
  con chequeo de rol adentro, no por `UPDATE` directo — ver
  `cambiar_estado_habitacion()` en `004_habitaciones.sql`.
- **Cada módulo maneja sus propias queries.**

## Estructura real del repositorio

```
santa-ana-house-pms/            (todo suelto, sin subcarpetas)
├── index.html
├── styles.css
├── logo.png                    (pendiente: subir logo real)
├── ARCHITECTURE.md
├── README.md
├── app.js                      # único lugar que importa todos los módulos
├── supabase-client.js
├── auth.js                     # login email/contraseña + perfil (rol)
├── router.js
├── modules-registry.js
├── ui.js                       # pestañas arriba + sub-pestañas, toasts, modal
├── currency.js
├── dates.js
├── badges.js
├── config-habitaciones.js      # módulo Configuración (principal)
├── config-tipos.js             # subpestaña
├── config-tarifas.js           # subpestaña
├── 001_usuarios.sql
├── 002_hotel_config.sql
├── 003_tipos_habitacion_tarifas.sql
├── 004_habitaciones.sql
└── 005_seed_santa_ana_house.sql
```

## Pendientes conocidos antes de producción

- Confirmar con el contador el % de IVA de alojamiento aplicable.
- Confirmar los precios reales de temporada alta.
- Subir `logo.png`.
- Facturación electrónica DIAN e Inteligencia Artificial quedaron fuera de
  esta ronda — cuando lleguemos a esos módulos, solo se deja preparada la
  estructura de datos hasta que se defina proveedor.
