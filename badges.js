# Santa Ana House 21 — PMS

Sistema de gestión hotelera (PMS) interno para Santa Ana House 21.

- **Stack:** HTML/CSS/JS vanilla con ES Modules nativos (sin build, sin frameworks).
- **Base de datos y auth:** Supabase (Postgres + RLS + email/contraseña).
- **Arquitectura:** un archivo por módulo de negocio, patrón de registro tipo
  "plugin" — igual al usado en el CRM de Servicentro B&B. Ver
  [ARCHITECTURE.md](ARCHITECTURE.md) antes de tocar código.

## Cómo correr localmente

Como usa ES Modules nativos, no puedes abrir `index.html` directo con
`file://` (los navegadores bloquean `import` en ese contexto). Sirve la
carpeta con cualquier servidor estático simple, por ejemplo:

```
npx serve .
# o
python3 -m http.server 8080
```

## Configuración pendiente antes de usar

1. Ejecutar los archivos de `sql/` en orden (001 → 005) en el SQL Editor de
   Supabase (Project → SQL Editor → New query, pegar y correr uno por uno).
2. Crear el primer usuario (propietario):
   - Ve a Authentication → Users en el dashboard de Supabase → "Add user" →
     crea el usuario con su correo y una contraseña temporal.
   - Copia su `id` (uuid) de esa misma pantalla.
   - En SQL Editor, ejecuta:
     ```sql
     insert into usuarios (id, nombre, rol) values ('<uuid-aqui>', 'Tu Nombre', 'propietario');
     ```
3. Repite el paso 2 para cada persona del staff, usando el `rol` que le
   corresponda: `propietario`, `administrador`, `recepcionista`, `auditor`,
   `housekeeping`, `bodega`, `contador`.
4. Confirmar con el contador el % de IVA real para alojamiento antes de
   facturar — `tarifas.iva_porcentaje` quedó en 19% por defecto (ver nota en
   `sql/003_tipos_habitacion_tarifas.sql`).
5. Confirmar los precios reales de temporada alta — quedaron iguales a
   temporada baja como valor inicial (ver
   `sql/005_seed_santa_ana_house.sql`), ajustables desde Configuración →
   Tarifas una vez esté cargado el sistema.
6. Reemplazar `assets/img/logo.png` con el logo real del hotel (por ahora no
   existe el archivo; el `<img>` se oculta solo si no lo encuentra).

## Estado del proyecto

**Ya construido:** esqueleto base (login, navegación, sistema de diseño,
capa de datos) + módulo de Configuración (Habitaciones, Tipos de
habitación, Tarifas), con las 16 habitaciones reales del hotel ya
cargadas por seed SQL.

**Pendiente:** Dashboard, Reservas, Recepción, Huéspedes, Housekeeping,
Caja, y el resto del alcance de 24 módulos — se construyen en rondas
siguientes sobre esta misma base, sin tocar `core/`.
