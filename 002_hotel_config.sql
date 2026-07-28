-- 002_hotel_config.sql
-- Fila única con los datos generales del hotel (Módulo 2: Configuración).

create table if not exists hotel_config (
  id int primary key default 1,
  nombre text not null,
  nit text,
  rnt_numero text,
  rnt_vencimiento date,
  direccion text,
  ciudad text,
  telefono text,
  moneda text not null default 'COP',
  constraint hotel_config_singleton check (id = 1)
);

alter table hotel_config enable row level security;

create policy "hotel_config_select_staff"
  on hotel_config for select
  using (tiene_rol(array['propietario','administrador','recepcionista','auditor','housekeeping','bodega','contador']::rol_usuario[]));

create policy "hotel_config_insert_admin"
  on hotel_config for insert
  with check (es_admin());

create policy "hotel_config_update_admin"
  on hotel_config for update
  using (es_admin());

insert into hotel_config (id, nombre, moneda)
values (1, 'Santa Ana House 21', 'COP')
on conflict (id) do nothing;
