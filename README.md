# Santa Ana House 21 — PMS

Sistema de gestión hotelera (PMS) interno para Santa Ana House 21.

- **Stack:** HTML/CSS/JS vanilla con ES Modules nativos (sin build, sin frameworks).
- **Base de datos y auth:** Supabase (Postgres + RLS + email/contraseña).
- **Estructura:** TODOS los archivos van sueltos en la raíz del repositorio,
  sin subcarpetas (ver [ARCHITECTURE.md](ARCHITECTURE.md) — es una decisión
  a propósito: al subir archivos manualmente por la interfaz web de GitHub,
  arrastrar una carpeta puede aplanar las rutas y romper la app. Con todo en
  la raíz, ese problema no puede volver a pasar).

## Cómo correr localmente

Como usa ES Modules nativos, no puedes abrir `index.html` directo con
`file://` (los navegadores bloquean `import` en ese contexto). Sirve la
carpeta con cualquier servidor estático simple, por ejemplo:

```
npx serve .
# o
python3 -m http.server 8080
```

## Cómo subir archivos nuevos a GitHub (interfaz web)

1. En el repo, "Add file" → "Upload files".
2. Arrastra los archivos **sueltos** (no una carpeta) al recuadro, o usa
   "choose your files" y selecciónalos todos a la vez.
3. Como todo vive en la raíz, no importa el método que uses — nunca se
   generan subcarpetas por accidente.

## Configuración pendiente antes de usar

1. Ejecutar los archivos `00X_*.sql` en orden (001 → 005) en el SQL Editor
   de Supabase (Project → SQL Editor → New query, pegar y correr uno por uno).
2. Crear cada usuario del staff:
   - Authentication → Users → "Add user" (correo + contraseña temporal).
   - Copiar su `id` (uuid) de esa pantalla.
   - En SQL Editor:
     ```sql
     insert into usuarios (id, nombre, rol) values ('<uuid-aqui>', 'Nombre', 'rol')
     on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol;
     ```
     Roles válidos: `propietario`, `administrador`, `recepcionista`, `auditor`,
     `housekeeping`, `bodega`, `contador`.
3. Confirmar con el contador el % de IVA real para alojamiento —
   `tarifas.iva_porcentaje` quedó en 19% por defecto.
4. Confirmar los precios reales de temporada alta — quedaron iguales a
   temporada baja como valor inicial, ajustables desde Configuración → Tarifas.
5. Subir `logo.png` (archivo suelto en la raíz) con el logo real del hotel.
6. Activar GitHub Pages: Settings → Pages → Source: Deploy from a branch →
   main → / (root). El repo debe ser público (el plan gratuito no permite
   Pages en repos privados) — no hay datos sensibles en el código, los datos
   de huéspedes viven en Supabase protegidos por RLS.

## Estado del proyecto

**Ya construido:** esqueleto base (login, navegación, sistema de diseño,
capa de datos) + módulo de Configuración (Habitaciones, Tipos de
habitación, Tarifas), con las 16 habitaciones reales del hotel ya
cargadas por seed SQL.

**Pendiente:** Dashboard, Reservas, Recepción, Huéspedes, Housekeeping,
Caja, y el resto del alcance de 24 módulos.
