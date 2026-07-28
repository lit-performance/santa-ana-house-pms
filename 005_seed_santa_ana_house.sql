-- 005_seed_santa_ana_house.sql
-- Datos iniciales reales de Santa Ana House 21: 5 tarifas y 16 habitaciones.
--
-- ⚠ precio_temporada_alta se dejó igual a precio_temporada_baja como valor
-- inicial (solo se definieron precio base y precio fin de semana) —
-- ajustable después desde Configuración → Tarifas.

insert into tarifas (codigo, nombre, precio_temporada_baja, precio_temporada_alta, precio_fin_semana) values
  ('A', 'Tarifa A', 120000, 120000, 140000),
  ('B', 'Tarifa B', 140000, 140000, 160000),
  ('C', 'Tarifa C', 110000, 110000, 130000),
  ('D', 'Tarifa D', 130000, 130000, 150000),
  ('E', 'Tarifa E',  90000,  90000, 110000)
on conflict (codigo) do nothing;

-- tipo_id: 'Doble' para habitaciones de 1 cama (king o doble, capacidad 2),
-- 'Triple' para habitaciones de 2 camas (capacidad 4). Ninguna habitación
-- actual es 'Sencilla' o 'Suite' — esos tipos quedan disponibles para uso
-- futuro sin necesidad de tocar código (ver Configuración → Tipos de habitación).
insert into habitaciones (numero, nombre, tipo_id, piso, capacidad, tarifa_id, caracteristicas)
select
  v.numero,
  'Habitación ' || v.numero,
  t.id,
  v.piso,
  v.capacidad,
  tar.id,
  v.caracteristicas
from (values
  ('301', 3, 2, 'A', array['Cama king']),
  ('302', 3, 2, 'A', array['Cama king']),
  ('303', 3, 2, 'A', array['Cama king']),
  ('304', 3, 4, 'B', array['Dos camas king']),
  ('305', 3, 4, 'B', array['Dos camas king']),
  ('306', 3, 2, 'A', array['Cama king']),
  ('401', 4, 2, 'A', array['Cama king']),
  ('402', 4, 2, 'A', array['Cama king']),
  ('403', 4, 2, 'A', array['Cama king']),
  ('404', 4, 2, 'A', array['Cama king']),
  ('405', 4, 2, 'A', array['Cama king']),
  ('406', 4, 2, 'A', array['Cama king']),
  ('407', 4, 2, 'A', array['Cama king']),
  ('408', 4, 2, 'C', array['Cama doble']),
  ('201', 2, 4, 'D', array['Dos camas dobles']),
  ('202', 2, 2, 'E', array['Cama doble'])
) as v(numero, piso, capacidad, tarifa_codigo, caracteristicas)
join tarifas tar on tar.codigo = v.tarifa_codigo
join tipos_habitacion t on t.nombre = (case when v.capacidad >= 4 then 'Triple' else 'Doble' end)
on conflict (numero) do nothing;
