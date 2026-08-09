-- 015_usuarios_correo.sql
-- Columna de referencia (no sincronizada con auth.users, solo para mostrar
-- en el módulo Usuarios de la app quién es cada quién sin tener que entrar
-- a Supabase). Se llena al crear el usuario desde la app; para usuarios ya
-- existentes queda en null hasta que un admin la complete manualmente.
alter table usuarios add column if not exists correo text;
