-- 020_caja_metodos_pago.sql
-- Desglose por medio de pago (Efectivo, Nequi, Daviplata, QR, Transferencia
-- Bancaria, Datáfono, Llave) en el cierre de turno. Se guarda como jsonb
-- (una fila por método: { ingresos, egresos }) para no tener que agregar
-- una columna nueva cada vez que aparezca un medio de pago distinto.
--
-- Las columnas viejas (total_ingresos_efectivo/digital,
-- total_egresos_efectivo/digital) se SIGUEN llenando por compatibilidad:
-- "efectivo" = método Efectivo, "digital" = suma de todos los demás
-- métodos. Los cierres hechos antes de este cambio no tendrán
-- desglose_metodos (quedará null) — caja.js ya maneja ese caso.

alter table caja_turnos add column if not exists desglose_metodos jsonb;
