-- 016_compras.sql
-- Órdenes de compra a proveedores. Al marcar una orden como "recibido" el
-- módulo Compras suma automáticamente las cantidades a inventario_bodega
-- (mismo mecanismo que la "Registrar compra" rápida de Inventario) y deja
-- el rastro en inventario_movimientos.

create table if not exists ordenes_compra (
  id bigint generated always as identity primary key,
  proveedor_id bigint references proveedores(id),
  estado text not null default 'solicitado' check (estado in ('solicitado', 'en_camino', 'recibido', 'cancelado')),
  fecha_pedido date not null default current_date,
  fecha_recibido timestamptz,
  notas text,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now()
);

create table if not exists ordenes_compra_items (
  id bigint generated always as identity primary key,
  orden_id bigint not null references ordenes_compra(id) on delete cascade,
  producto_id bigint not null references minibar_productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_costo_unitario numeric not null default 0
);

alter table ordenes_compra enable row level security;
alter table ordenes_compra_items enable row level security;

create policy "ordenes_compra_select" on ordenes_compra
  for select using (tiene_rol(array['propietario','administrador','bodega','contador']::rol_usuario[]));

create policy "ordenes_compra_insert" on ordenes_compra
  for insert with check (tiene_rol(array['propietario','administrador','bodega']::rol_usuario[]));

create policy "ordenes_compra_update" on ordenes_compra
  for update using (tiene_rol(array['propietario','administrador','bodega']::rol_usuario[]));

create policy "ordenes_compra_delete" on ordenes_compra
  for delete using (es_admin());

create policy "ordenes_compra_items_select" on ordenes_compra_items
  for select using (tiene_rol(array['propietario','administrador','bodega','contador']::rol_usuario[]));

create policy "ordenes_compra_items_insert" on ordenes_compra_items
  for insert with check (tiene_rol(array['propietario','administrador','bodega']::rol_usuario[]));

create policy "ordenes_compra_items_update" on ordenes_compra_items
  for update using (tiene_rol(array['propietario','administrador','bodega']::rol_usuario[]));

create policy "ordenes_compra_items_delete" on ordenes_compra_items
  for delete using (tiene_rol(array['propietario','administrador','bodega']::rol_usuario[]));
