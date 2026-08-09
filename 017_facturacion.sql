-- 017_facturacion.sql
-- Facturas / documento equivalente por estadía. Sin IVA por defecto (a
-- confirmar con el contador si aplica IVA, INC o exención de hospedaje) —
-- el % de impuesto queda editable por factura, en 0 por defecto. Estructura
-- plana a propósito para poder agregarle más adelante los campos de
-- facturación electrónica DIAN (CUFE, resolución, etc.) sin romper nada.

create table if not exists facturas (
  id bigint generated always as identity primary key,
  reserva_id bigint references reservas(id),
  huesped_nombre text not null,
  huesped_documento text,
  fecha_emision date not null default current_date,
  subtotal numeric not null default 0,
  impuesto_porcentaje numeric not null default 0,
  impuesto_valor numeric not null default 0,
  total numeric not null default 0,
  estado text not null default 'emitida' check (estado in ('emitida', 'anulada')),
  notas text,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now()
);

alter table facturas enable row level security;

create policy "facturas_select" on facturas
  for select using (tiene_rol(array['propietario','administrador','contador']::rol_usuario[]));

create policy "facturas_insert" on facturas
  for insert with check (tiene_rol(array['propietario','administrador','contador']::rol_usuario[]));

create policy "facturas_update" on facturas
  for update using (tiene_rol(array['propietario','administrador','contador']::rol_usuario[]));

create policy "facturas_delete" on facturas
  for delete using (es_admin());
