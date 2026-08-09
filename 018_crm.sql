-- 018_crm.sql
-- Módulo CRM: seguimiento comercial de huéspedes corporativos, agencias y
-- clientes frecuentes. Se apoya en huespedes (numero_documento) cuando el
-- contacto ya es huésped, pero también admite contactos que todavía no lo
-- son (agencias, empresas prospecto).

create table if not exists crm_oportunidades (
  id bigint generated always as identity primary key,
  huesped_documento text references huespedes(numero_documento),
  nombre_contacto text not null,
  empresa text,
  telefono text,
  correo text,
  etapa text not null default 'prospecto' check (etapa in ('prospecto', 'contactado', 'negociacion', 'ganado', 'perdido')),
  valor_estimado numeric not null default 0,
  fecha_proximo_seguimiento date,
  notas text,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists crm_interacciones (
  id bigint generated always as identity primary key,
  oportunidad_id bigint not null references crm_oportunidades(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('llamada', 'correo', 'reunion', 'nota')),
  descripcion text not null,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now()
);

alter table crm_oportunidades enable row level security;
alter table crm_interacciones enable row level security;

create policy "crm_oportunidades_select" on crm_oportunidades for select
  using (tiene_rol(array['propietario', 'administrador']::rol_usuario[]));

create policy "crm_oportunidades_insert" on crm_oportunidades for insert
  with check (tiene_rol(array['propietario', 'administrador']::rol_usuario[]));

create policy "crm_oportunidades_update" on crm_oportunidades for update
  using (tiene_rol(array['propietario', 'administrador']::rol_usuario[]));

create policy "crm_oportunidades_delete" on crm_oportunidades for delete
  using (es_admin());

create policy "crm_interacciones_select" on crm_interacciones for select
  using (tiene_rol(array['propietario', 'administrador']::rol_usuario[]));

create policy "crm_interacciones_insert" on crm_interacciones for insert
  with check (tiene_rol(array['propietario', 'administrador']::rol_usuario[]));

create policy "crm_interacciones_delete" on crm_interacciones for delete
  using (es_admin());
