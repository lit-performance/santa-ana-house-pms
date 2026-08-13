// dates.js
//
// Formateo y aritmética de fechas reutilizable.

export function formatFechaCorta(fechaISO) {
  if (!fechaISO) return '—';
  // CORRECCIÓN (ver 106): si `fechaISO` es una fecha simple sin hora
  // ("2026-08-01"), hacer `new Date("2026-08-01")` directo hace que
  // JavaScript la interprete como medianoche UTC — y como Colombia está
  // 5 horas detrás de UTC, esa medianoche cae en la tarde del día
  // ANTERIOR en hora local, así que se mostraba la fecha un día antes
  // de la real (ej. un consumo del 1 de agosto aparecía como "31 de
  // jul"). Igual que ya hace `addDays` más abajo, si el texto no trae
  // hora (largo 10, "YYYY-MM-DD") le agregamos "T00:00:00" para que se
  // interprete en hora LOCAL, no en UTC. Si ya viene con hora completa
  // (por ejemplo de una columna `creado_en`), se deja igual.
  const d = fechaISO.length <= 10 ? new Date(`${fechaISO}T00:00:00`) : new Date(fechaISO);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatFechaHora(fechaISO) {
  if (!fechaISO) return '—';
  const d = new Date(fechaISO);
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Devuelve 'YYYY-MM-DD' a partir de un objeto Date, en hora local (no UTC),
// para usar directo en <input type="date"> y en comparaciones con columnas
// `date` de Postgres.
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Suma (o resta, con n negativo) n días a una fecha. Acepta Date o string 'YYYY-MM-DD'.
export function addDays(fecha, n) {
  const d = typeof fecha === 'string' ? new Date(fecha + 'T00:00:00') : new Date(fecha);
  d.setDate(d.getDate() + n);
  return d;
}
