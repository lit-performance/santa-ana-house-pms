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

// (213 / auditoría H29) Edad en años cumplidos a partir de una fecha
// 'YYYY-MM-DD'. Devuelve null si no hay fecha (para no marcar como
// "menor" a alguien sin dato). Antes vivía duplicada dentro de
// recepcion.js con `new Date(fechaISO)` directo sobre la fecha de
// nacimiento — mismo bug de zona horaria que corrige `formatFechaCorta`
// de arriba (ver nota 106): esa medianoche UTC cae en la tarde del día
// ANTERIOR en hora de Colombia, así que el cumpleaños calculaba un día
// antes de la fecha real — una ventana de 1 día donde un acompañante que
// cumple 18 justo hoy podía calcular como si ya los tuviera, silenciando
// la alerta legal de menor de edad. Se centraliza aquí, con el mismo
// parche "T00:00:00" que ya usa `addDays`, para que no se vuelva a
// reintroducir sola en otro archivo.
export function calcularEdad(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date();
  const nacimiento = new Date(`${fechaISO}T00:00:00`);
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mesDiff = hoy.getMonth() - nacimiento.getMonth();
  if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;
  return edad;
}
