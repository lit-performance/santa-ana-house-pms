# Santa Ana House 21 — PMS

Hotel property management system for Santa Ana House 21. Plain HTML/CSS/JS, ES Modules, no build step, no bundler, no framework. Backend is Supabase (Postgres + Auth + RLS). Hosted on GitHub Pages.

- Repo: `lit-performance/santa-ana-house-pms`, branch `main`.
- All files live at the repo root — no subdirectory structure.
- Every module self-registers by calling `registerModule({ id, label, icono, roles, parentId, render })` from `modules-registry.js`. `roles: []` hides a module from the nav without deleting its code (used for modules that are temporarily disabled on request).

## No direct database access

There is no Supabase/Postgres connection available to an agent working on this project — no credentials, no MCP connector. Any data diagnosis or correction goes through this loop: write the SQL → a human runs it in the Supabase SQL editor → they paste the result back. Never assume a piece of SQL executed, or trust an assumption about current data, without an explicit pasted result confirming it. This applies to migrations too: schema changes are plain SQL handed to a human to run, not something this project applies itself.

## Workflow conventions

- Before editing any file, pull/fetch the latest version first — don't trust a stale local copy.
- Validate every JS edit with `node --check` before considering a change done (works fine against `.js` files directly; no need for an `.mjs` copy trick when running locally with Claude Code, that workaround was only needed in a sandboxed environment without direct repo access).
- After pushing, verify the change actually landed as expected (`git log`, `git status`, re-read the file) rather than assuming the push succeeded.
- When fixing a bug that stems from a repeated pattern (e.g. a date-boundary bug, a missing status filter), grep for the same pattern across the whole codebase rather than patching only the one file that was reported — this project has a history of the same latent bug existing in multiple files (see the timezone fix and the pasadía revenue-undercounting fix below), and "no inconsistencies" is an explicit, standing expectation here.
- Historical changes are marked in code comments with a sequential number and short tag, e.g. `(228 / pasadía)`, `(235 / zona horaria)`, `(236 / pasadía)`. The last number used is **244** (reportes.js, "Ventas por producto"). Keep using the next sequential number for notable fixes so the history stays traceable in `git blame`/comments. (A separate, now-obsolete numbering of `NNN-nombre-CORREGIDO.txt` files was used only for manually uploading files through GitHub's web UI before Claude Code was set up — that convention doesn't apply anymore now that changes go through normal git commits.)

## Database schema facts that aren't obvious from the code

- `reservas.fecha_checkin` / `reservas.fecha_checkout` are plain `date` columns (no time-of-day). `facturas.fecha_emision` is also plain `date`.
- `reservas_pagos.fecha` is **`timestamp with time zone`**, despite the name suggesting a plain date. `caja_movimientos.creado_en`, `ventas_mostrador.creado_en`, `caja_transferencias.creado_en`, `minibar_consumos.creado_en`, and `caja_turnos.abierto_en`/`cerrado_en` are timestamptz too.
- Constraint `checkout_despues_checkin` on `reservas`: `CHECK ((es_pasadia AND fecha_checkout = fecha_checkin) OR (NOT es_pasadia AND fecha_checkout > fecha_checkin))`.
- Constraint `reservas_no_cruce_habitacion` (anti-double-booking): `EXCLUDE USING gist (habitacion_id WITH =, daterange(fecha_checkin, fecha_checkout, '[)') WITH &&) WHERE (estado = ANY (ARRAY['reservada','confirmada','check_in','hospedado']))`. Uses a half-open `[checkin, checkout)` Postgres daterange.
- `recepcion_checkins.cantidad_noches` has no DB-level CHECK constraint (only the `required min="1"` on the UI input) — storing `0` is safe (used for pasadía).
- The live "who is currently checked in" list is driven entirely by `recepcion_checkins.check_out_en IS NULL`, completely independent of the linked reserva's date fields.

## The timezone bug and its fix (`limiteDiaBogota`)

The business is in Bogotá, Colombia (`America/Bogota`, fixed UTC-5, no daylight saving). `dates.js`'s `toISODate()` correctly computes "today" in local time. The bug was server-side: filtering a `timestamp with time zone` column with a plain `'YYYY-MM-DD'` string gets interpreted by Postgres as UTC midnight, not Bogotá midnight — a 5-hour offset that silently moved transactions between 7pm and midnight (Bogotá time) into the next day's totals, and dropped transactions after 7pm from "today" until the next day's report.

Fix: `dates.js` exports `limiteDiaBogota(fechaISO)` → `` `${fechaISO}T00:00:00-05:00` ``. Any `.gte()/.lt()/.lte()/.eq()` filter against a timestamptz column listed above must wrap its boundary argument in `limiteDiaBogota(...)`. Never apply it to a plain `date` column (`fecha_checkin`, `fecha_checkout`, `fecha_emision`, birthdates) — those don't need it and wrapping them would break the comparison.

## The "pasadía" feature (day-use rooms)

A pasadía is a guest who checks in and checks out the same calendar day (no overnight stay) — and critically, the same room must still be independently bookable by a *different*, overnight guest that same night. This is stored as `reservas.es_pasadia = true` with `fecha_checkin = fecha_checkout` (an **empty** Postgres daterange). An empty range never overlaps (`&&`) with anything, including another empty range — so this satisfies the anti-double-booking exclude constraint with zero changes to it, and lets the room turn over same-day without any time-of-day tracking (the system only tracks calendar dates, not hours — staff still need to use judgment about whether the day-use guest has actually left before the overnight guest checks in).

Consequences that recur across the codebase:
- A pasadía never counts as an occupied night anywhere (every occupancy calc uses the half-open-interval check `dia >= checkin && dia < checkout`, which is always false when checkin == checkout).
- A pasadía's revenue (`monto_total`) is easy to accidentally drop from any report that fetches reservas with a range-overlap filter like `.lt('fecha_checkin', finExclusivo).gt('fecha_checkout', inicio)` — an empty range fails `fecha_checkout > inicio` when the pasadía date equals the range's start day. Every report that does this needs a parallel `.eq('es_pasadia', true)` query merged in for revenue purposes (but *not* merged into night-count/occupancy maps). This bug has already been found and fixed in `rendimiento-habitaciones.js`, `estadisticas.js`, and `reportes.js` ("Ocupación por habitación") — check any *new* report that aggregates `reservas` by date range for the same issue.
- Billing: no separate tariff type for pasadía. The UI suggests the normal per-night tariff's `precio_temporada_baja` as the default monto (since nights = 0 would otherwise suggest $0), fully editable by staff.
- Known gap (not yet built): the "Editar check-in" screen (adjusting nights after a guest has already checked in) does not support converting an existing normal stay into a pasadía.

## The `cuentas.js` balance model

`cuentas.js` is the single shared source of truth for "how much does this room owe" — every other module imports from it rather than recomputing. Per room/reserva:
- `montoTotal = montoHabitacion + montoMinibar`
- `saldoPendiente = Math.max(0, montoTotal - totalAbonado)`
- `excedente = Math.max(0, totalAbonado - montoTotal)` — the mirror of saldoPendiente, shows an overpayment instead of hiding it behind a plain "$0".

An `excedente` almost always means a duplicate payment entry or a manual correction that added money instead of reversing a mistaken charge — diagnose by pulling every `reservas_pagos` row for that `reserva_id` and finding the one that doesn't belong, then confirm with whoever manages the front desk before deleting/adjusting anything (money corrections always go through the SQL-write/human-runs/paste-back loop above, never applied directly).

## Reports module (`reportes.js`)

Active again (reactivated — was hidden with `roles: []` for a while). Four exportable-to-CSV reports, roles `['propietario', 'administrador']`:
1. Reservas del período
2. Ocupación por habitación
3. Ventas por producto — combines `ventas_mostrador` (counter sales) + `minibar_consumos` (in-room consumption), grouped by product, date-range filtered with `limiteDiaBogota`.
4. Huéspedes (histórico completo, no date range)
