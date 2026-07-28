-- 001_usuarios.sql
-- Perfiles de usuario del staff. id = mismo id que auth.users (Supabase
-- Auth, email + contraseña). Se cargan manualmente después de crear cada
-- cuenta en Authentication → Users (ver README.md).

create type rol_usuario as enum (
  'propietario',
  'administrador',
  'recepcionista',
  'auditor',
  'housekeeping',
  'bodega',
  'contador'
);

create table if not exists usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol rol_usuario not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

alter table usuarios enable row level security;

-- Helpers reutilizables en las políticas de esta y otras tablas. security
-- definer para evitar recursión al consultar la propia tabla usuarios desde
-- sus políticas.
create or replace function es_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid() and rol in ('propietario', 'administrador') and activo
  );
$$;

create or replace function tiene_rol(roles rol_usuario[])
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid() and rol = any(roles) and activo
  );
$$;

-- Cada usuario puede leer su propia fila (para saber su rol al iniciar sesión).
create policy "usuarios_select_propio"
  on usuarios for select
  using (id = auth.uid());

-- Propietario y administrador pueden ver y gestionar todos los usuarios.
create policy "usuarios_select_admin"
  on usuarios for select
  using (es_admin());

create policy "usuarios_insert_admin"
  on usuarios for insert
  with check (es_admin());

create policy "usuarios_update_admin"
  on usuarios for update
  using (es_admin());

-- NOTA: para crear el primer usuario (propietario):
-- 1. Authentication → Users → Add user (correo + contraseña temporal).
-- 2. Copiar su id (uuid) de esa pantalla.
-- 3. Ejecutar aquí en el SQL Editor:
--    insert into usuarios (id, nombre, rol) values ('<uuid-aqui>', 'Tu Nombre', 'propietario');
