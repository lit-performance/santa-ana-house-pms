-- 004_habitaciones.sql

create type estado_habitacion as enum (
  'disponible',
  'ocupada',
  'limpieza',
  'inspeccion',
  'mantenimiento',
  'bloqueada',
  'fuera_servicio'
);

create table if not exists habitaciones (
  id serial primary key,
  numero text not null unique,
  nombre text not null,
  tipo_id int references tipos_habitacion(id),
  piso int,
  capacidad int not null default 2,
  estado estado_habitacion not null default 'disponible',
  tarifa_id int references tarifas(id),
  caracteristicas text[],
  fotos text[],
  activo boolean not null default true
);

alter table habitaciones enable row level security;

create policy "habitaciones_select_staff"
  on habitaciones for select
  using (tiene_rol(array['propietario','administrador','recepcionista','auditor','housekeeping','bodega','contador']::rol_usuario[]));

create policy "habitaciones_insert_admin"
  on habitaciones for insert
  with check (es_admin());

-- Solo administración edita la fila completa (tarifa, tipo, capacidad, etc).
create policy "habitaciones_update_admin"
  on habitaciones for update
  using (es_admin());

create policy "habitaciones_delete_admin"
  on habitaciones for delete
  using (es_admin());

-- Recepción y Housekeeping cambian el ESTADO a través de esta función, no
-- editando la fila directamente — así queda un único punto de entrada
-- auditable y no pueden tocar tarifa/tipo/capacidad por error ni por bug de
-- frontend. (Módulo 6: Housekeeping, Módulo 3: Reservas/Recepción.)
create or replace function cambiar_estado_habitacion(p_habitacion_id int, p_estado estado_habitacion)
returns void
language plpgsql
security definer
as $$
begin
  if not tiene_rol(array['propietario','administrador','recepcionista','housekeeping']::rol_usuario[]) then
    raise exception 'No tienes permiso para cambiar el estado de la habitación';
  end if;
  update habitaciones set estado = p_estado where id = p_habitacion_id;
end;
$$;
