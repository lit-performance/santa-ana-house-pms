-- 019_recepcion_acompanantes.sql
-- Guarda los datos completos de cada acompañante (no solo el nombre) en
-- una columna jsonb: [{ nombre, tipo_documento, numero_documento,
-- nacionalidad, fecha_nacimiento, celular }, ...]. La columna vieja
-- `acompanantes` (texto libre) se deja intacta por compatibilidad, pero
-- recepcion.js ya no le escribe nada nuevo.

alter table recepcion_checkins add column if not exists acompanantes_detalle jsonb;
