-- 003_tipos_habitacion_tarifas.sql

create table if not exists tipos_habitacion (
  id serial primary key,
  nombre text not null unique,
  descripcion text
);

alter table tipos_habitacion enable row level security;

create policy "tipos_habitacion_select_staff"
  on tipos_habitacion for select
  using (tiene_rol(array['propietario','administrador','recepcionista','auditor','housekeeping','bodega','contador']::rol_usuario[]));

create policy "tipos_habitacion_insert_admin"
  on tipos_habitacion for insert
  with check (es_admin());

create policy "tipos_habitacion_update_admin"
  on tipos_habitacion for update
  using (es_admin());

create policy "tipos_habitacion_delete_admin"
  on tipos_habitacion for delete
  using (es_admin());

-- Tipos base. "Permite agregar nuevos tipos sin modificar el sistema" (Módulo 2)
-- — se agregan filas nuevas desde Configuración → Tipos de habitación, nunca
-- hace falta tocar código.
insert into tipos_habitacion (nombre) values
  ('Sencilla'), ('Doble'), ('Triple'), ('Suite')
on conflict (nombre) do nothing;

create table if not exists tarifas (
  id serial primary key,
  codigo text not null unique,
  nombre text,
  precio_temporada_baja numeric(12,2) not null,
  precio_temporada_alta numeric(12,2) not null,
  precio_fin_semana numeric(12,2) not null,
  -- ⚠ 19% es un valor por defecto. El IVA de alojamiento en Colombia tiene
  -- reglas particulares (posibles exenciones para turistas extranjeros,
  -- etc.) — confirmar el % correcto con el contador antes de facturar.
  iva_porcentaje numeric(5,2) not null default 19,
  activo boolean not null default true
);

alter table tarifas enable row level security;

create policy "tarifas_select_staff"
  on tarifas for select
  using (tiene_rol(array['propietario','administrador','recepcionista','auditor','housekeeping','bodega','contador']::rol_usuario[]));

create policy "tarifas_insert_admin"
  on tarifas for insert
  with check (es_admin());

create policy "tarifas_update_admin"
  on tarifas for update
  using (es_admin());

create policy "tarifas_delete_admin"
  on tarifas for delete
  using (es_admin());
