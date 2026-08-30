// recepcion.js
//
// Módulo 4: Recepción. Pantalla de manejo diario de la recepcionista — y
// también la pantalla de "inicio" del sistema (se fusionó aquí el antiguo
// módulo Dashboard/Inicio, que quedó redundante como pestaña aparte).
// Al entrar se ve de un vistazo: cuántas llegadas y salidas hay hoy,
// cuántas habitaciones están ocupadas, cuánto saldo pendiente hay en total,
// y un resumen rápido del estado del resto de habitaciones (libres, en
// limpieza, fuera de servicio). Debajo, una tarjeta de "Llegadas de hoy"
// (reservas sin check-in todavía, con botón para iniciar el check-in ya
// precargado) y la tabla de habitaciones en uso con badge "Sale hoy" y
// saldo pendiente resaltado, ordenada para que lo más urgente (sale hoy +
// debe plata) aparezca primero.
//
// "+ Nuevo Check-in" abre un formulario completo (reemplaza el contenido del
// contenedor, no un modal — son demasiados campos para un modal chico) con
// todos los datos que pide el Módulo 4, acompañantes con datos completos,
// pago al check-in (que alimenta Caja automático), firma digital (canvas)
// y consentimiento Habeas Data.
//
// Nota IMPORTANTE sobre "¿El huésped paga la estadía ahora?" (antes era un
// simple desplegable, y no quedaba claro si se estaba cobrando o no): ahora
// son tres tarjetas grandes y explícitas — Pendiente / Abono parcial / Pago
// total — NINGUNA queda marcada por defecto, así que es obligatorio elegir
// una a propósito (no se puede dejar "sin querer" en la opción por
// defecto). Y antes de guardar el check-in de verdad, se abre una tarjeta
// de confirmación (mismo patrón que la liquidación del check-out) que
// resume en un solo vistazo: cuánto vale la estadía, cuánto se abonó
// antes, qué se está cobrando ahora, con qué método, y cuánto queda
// pendiente para el check-out — con dos botones, "Volver a editar" (por si
// algo no cuadra) y "Confirmar y registrar check-in" (que es el único que
// de verdad guarda todo en la base de datos). Esto es a propósito: ya no
// hay forma de terminar un check-in sin que quede clarísimo, para la
// recepcionista y para quien revise después, si el huésped pagó, abonó, o
// quedó debiendo todo.
//
// Nota sobre "Ver disponibilidad" en la tarjeta Estadía: abre una mini
// versión del calendario de Reservas (próximos 10 días x habitaciones) para
// decidir dónde alojar sin salir del check-in. Solo la columna de HOY es
// clicable para elegir habitación (el check-in es para hoy); las demás
// columnas son solo para ver si la habitación se queda libre durante toda
// la estadía. Usa las mismas reglas de bloqueo que el calendario de
// Reservas (ver reservas.js) para que ambas pantallas digan lo mismo.
//
// Nota de alcance: "Fotografía del documento" queda como un campo de URL
// (para pegar un link si ya la subieron a otro lado) — la carga de
// archivos requiere configurar Supabase Storage, pendiente para una
// ronda futura.
//
// Nota importante: TODO check-in (venga de una reserva o sea walk-in)
// queda vinculado a una fila en `reservas` con estado 'hospedado', y
// además guarda/actualiza la ficha del huésped en `huespedes` (por
// numero_documento). Esto es lo que hace que el calendario de Reservas
// y el módulo Huéspedes reflejen la ocupación e historial real sin
// importar por dónde entró el huésped.
//
// Nota sobre acompañantes: si el huésped trae acompañante(s), se piden
// TODOS sus datos (no solo el nombre) — nombre, tipo y número de
// documento, nacionalidad, fecha de nacimiento y celular — igual de
// completos que los del huésped principal. Se guardan en la columna
// jsonb `acompanantes_detalle` de recepcion_checkins (uno o varios
// bloques, se pueden agregar más con "+ Agregar otro acompañante"). Si el
// acompañante trae número de documento, también queda (o se actualiza) en
// el listado general de huespedes, igual que el huésped principal — sin
// documento no hay con qué identificarlo ahí, así que en ese caso solo
// queda guardado dentro del check-in.
//
// Nota sobre acompañante menor de edad: si la fecha de nacimiento indica
// que el acompañante es menor de 18 años, aparece una alerta recordando
// pedir el registro civil de nacimiento (para verificar que el adulto es
// su padre/madre) o la autorización notarial correspondiente si viaja con
// otra persona, más una casilla para que la recepcionista confirme que
// verificó el documento. Esto es un recordatorio operativo — no bloquea
// el check-in, queda guardado dentro del acompañante (verificado_menor)
// como bitácora.
//
// Nota sobre métodos de pago: la lista completa vive en METODOS_PAGO —
// Efectivo, Nequi, Daviplata, QR, Transferencia Bancaria, Datáfono,
// Llave. Caja consolida cada uno como si fuera una cuenta aparte (ver
// caja.js), así que agregar/quitar un método aquí también cambia lo que
// se ve ahí.
//
// Nota sobre campos obligatorios en Estadía: habitación, tarifa, cantidad
// de noches, método de pago y "¿El huésped paga la estadía ahora?" son
// obligatorios — y si la opción elegida es Abono parcial o Pago total, el
// monto a cobrar también. Esto es a propósito: evita check-ins a medio
// llenar que después generan dudas en Caja o en Reservas sobre cuánto se
// cobró o a qué tarifa.
//
// Nota sobre el pago al check-in: lo que se cobre (parcial o total) NO se
// guarda en una columna suelta — se inserta directo en `reservas_pagos`
// (la misma tabla de abonos que ya usan Reservas y la liquidación del
// check-out), así el pago aparece automático en Caja ("Ingresos por
// reservas"), Indicadores y Contabilidad sin ningún paso manual extra.
// Elegir "Pago total" cobra automático el valor completo que falte de la
// estadía (estimado menos lo ya abonado antes) — deja la habitación
// saldada, y solo quedaría pendiente el consumo de minibar, que se
// liquida en el check-out.
//
// Nota (171) sobre "Monto total estimado" (noches × tarifa) en un WALK-IN
// (check-in sin reserva previa — `reservaIdSeleccionada` vacío): antes
// este campo era solo una ayuda visual para la recepcionista y NUNCA se
// guardaba en ningún lado — la reserva que este mismo check-in crea sola
// por detrás (ver `ejecutarRegistroCheckin`) se insertaba sin
// `monto_total`. El pago de la habitación sí quedaba bien guardado en
// reservas_pagos, pero como no había contra qué restarlo, cuentas.js
// calculaba montoHabitacion = $0 para CUALQUIER walk-in — y ese pago de
// la habitación, completo, aparecía como "excedente" en la liquidación
// del check-out (ver caso real: habitación 304 / Michel Lopez, 18-ago-26 —
// monto total mostrado $16.000 = exactamente el minibar, habitación en
// $0, pago anticipado de $150.000 completo marcado como sobrepago). Ahora
// SÍ se guarda como `monto_total` de la reserva nueva, con el mismo
// cálculo que ya se mostraba (noches × tarifa) — null si no hay tarifa
// elegida, igual que antes en ese caso. Un check-in que SÍ viene de una
// reserva ya existente (`reservaIdSeleccionada` con valor) no toca esto —
// esa reserva ya trae su `monto_total` de cuando se creó en Reservas.
//
// Nota (192 / H24): "Monto total estimado" (noches × tarifa) ignoraba por
// completo las tarifas "por días" (tipo 'por_dias', ver config-tarifas.js)
// — esas guardan su precio real en `valor_convenido` (un total fijo para
// toda la estadía, ej. $1.600.000 por 30 días) y dejan `precio_temporada_baja`
// en 0 a propósito, porque no aplica. Como este archivo siempre hacía
// `noches * precio_temporada_baja` sin revisar el tipo de tarifa, cualquier
// tarifa "por días" (ej. Tarifa F) siempre daba $0 — bug real, reproducido
// en vivo el 29 de agosto de 2026. Ahora, dondequiera que se sugiere o
// calcula un monto a partir de una tarifa, primero se revisa si
// `tarifa.tipo === 'por_dias'`: si es así, se usa `valor_convenido` tal
// cual (precio de paquete fijo, sin importar cuántas noches se elijan);
// si no, sigue siendo noches × precio por noche, igual que siempre.
//
// Nota (200 / auditoría H13): los dos consumos de minibar que se
// agregan/editan directo desde la ventana de liquidación (sin pasar por
// el flujo de 2 pasos de consumo-minibar.js) aceptaban cantidad
// negativa sin avisar (`Number(input.value) || 1` solo atajaba
// 0/vacío/NaN). Ahora se valida explícito, igual que consumo-minibar.js.
//
// Nota sobre "adicionar días a la estadía": si un huésped que ya tenía su
// reserva hecha (por ejemplo 2 noches) decide en el check-in quedarse más
// días, la recepcionista solo tiene que aumentar el campo "Cantidad de
// noches" de la tarjeta Estadía — al guardar, la reserva vinculada
// extiende su fecha_checkout sola (contando desde hoy), siempre que
// ninguna otra reserva de esa misma habitación se cruce con la fecha
// nueva (si se cruza, se avisa y el check-in continúa con la fecha
// original). Lo mismo aplica editando un check-in ya en curso desde
// "✏️ Editar" en la tabla de habitaciones en uso — ahí la fecha nueva se
// cuenta desde el check-in ORIGINAL de la reserva, no desde el día en que
// se edita.
//
// Nota sobre liquidación al check-out: el botón "Check-out" ya NO libera
// la habitación directo — abre un modal que muestra el saldo pendiente
// (monto de la habitación + consumo de minibar − abonos ya registrados en
// reservas_pagos, calculado con el helper compartido cuentas.js) y permite
// registrar el pago final antes de liberar la habitación. Si queda saldo
// pendiente después del pago, se pide confirmación explícita antes de
// continuar — el checkout no se bloquea, pero no se puede hacer "sin
// darse cuenta" de que quedó plata por cobrar. Ese pago final se registra
// en reservas_pagos igual que un abono normal, así que aparece automático
// en Caja e Indicadores. El modal es ancho (ver modal-caja-super-ancha en
// styles.css) para ver el detalle de minibar con más espacio, cada línea
// de consumo se puede editar (cambiar cantidad) o quitar sin salir de
// ahí, y antes de poder confirmar el check-out hay que marcar la casilla
// "Revisé el consumo de minibar" — el botón "Confirmar y hacer check-out"
// no deja avanzar si esa casilla no está marcada (validación nativa del
// navegador), así siempre hay un paso explícito de revisar el minibar
// antes de cerrar la cuenta.
//
// Nota (172) — Método de pago obligatorio en el check-out: si se va a
// registrar un pago (el campo "Pago que recibes ahora" queda en más de
// $0), ahora es obligatorio elegir explícitamente a qué cuenta va ese
// pago — el select ya no arranca en "Efectivo" por defecto, arranca
// vacío ("— Elige a qué cuenta va este pago —") y si se intenta
// confirmar sin elegir, se bloquea con un aviso. Antes, un <select> sin
// ninguna opción marcada como `selected` caía solo en la primera de
// METODOS_PAGO (Efectivo) por comportamiento normal del navegador, sin
// que la recepcionista lo hubiera elegido a propósito — eso por sí solo
// no había causado el problema real que se encontró (habitación 406,
// Viviana Tovar: por el mismo bug del monto_total en null que arregla
// esta misma versión, el saldo se mostró en $0 y el pago del minibar por
// transferencia — "Cuenta Jorge" — nunca llegó a escribirse en el campo
// de monto, así que ni siquiera se insertó en reservas_pagos, quedando
// solo como una nota de texto en comentarios) — pero sí es un hueco real
// aparte: con el monto ya arreglado, cualquier pago que SÍ se escriba
// aquí en adelante queda obligado a decir a qué cuenta fue, para que
// nunca quede "huérfano" ese dato.
//
// Nota (165) sobre "excedente" en la tabla de habitaciones en uso: si a
// una habitación le registraron más pagos de los que debía (por ejemplo,
// un pago duplicado o una corrección hecha agregando plata de más en vez
// de anular el pago original), el saldo pendiente se queda en $0 (nunca
// muestra negativo, ver nota 164 en cuentas.js) pero debajo aparece en
// morado "↑ excedente $X" para que quede visible que hay plata de más
// registrada — así la recepcionista o quien revise sabe que ahí hay algo
// que aclarar (¿hay que devolver esa plata?, ¿fue un error de digitación
// en el monto?) en vez de que quede escondido detrás de un saldo en $0
// que parece perfectamente normal.
//
// Nota sobre "➕ Consumo" en la tabla de habitaciones en uso: agrega un
// consumo de mostrador (minibar/servicios) a una habitación ocupada en
// cualquier momento de la estadía (no solo al check-out) — útil cuando el
// huésped pide algo al entrar o durante su estadía y la recepcionista lo
// quiere dejar registrado de una vez, sin esperar al checkout. Usa el
// mismo catálogo y la misma lógica de descuento de inventario que el
// resto del sistema (ver minibar.js / inventario.js), así que aparece
// automático en el saldo pendiente de esa habitación y en la liquidación
// del check-out cuando llegue el momento.
//
// Nota sobre "✏️ Editar" en la tabla de habitaciones en uso: abre un
// modal para corregir un check-in ya registrado (typo en el nombre,
// documento mal digitado, cambio de tarifa, cambio de habitación, etc).
// Lo que SÍ se puede editar: todos los datos del huésped, acompañantes,
// tarifa, cantidad de noches (incluida su extensión de la reserva, ver
// nota arriba), método de pago y depósito. Lo que NO se edita desde aquí:
// la firma digital y el consentimiento de Habeas Data (quedan tal como se
// capturaron en el momento del check-in — no tiene sentido "re-firmar"
// retroactivamente), y los pagos ya registrados en Caja (esos se corrigen
// desde Caja o desde el propio módulo Reservas, nunca reescribiendo el
// check-in). Si se cambia la habitación, el cambio se sincroniza con la
// reserva vinculada y con el estado de AMBAS habitaciones (la anterior
// pasa a limpieza, la nueva a ocupada) para que Reservas y Housekeeping no
// queden desincronizados.
//
// Nota sobre "Pago que recibes ahora" y el minibar: cada vez que se
// agrega, edita o quita un consumo dentro del modal de liquidación, el
// campo "Pago que recibes ahora" se vuelve a calcular y se fuerza su
// valor al nuevo saldo pendiente (a menos que la recepcionista ya lo haya
// editado a mano, en cuyo caso se respeta lo que escribió) — así nunca
// queda un consumo de minibar agregado sin que el monto a cobrar lo
// refleje. Los campos de dinero (pago al check-in, pago del check-out) se
// muestran con "$" y punto de miles mientras se escribe (ver
// currency.js); el valor real que se guarda siempre se lee con
// `valorNumericoInput`, nunca directo del campo.
//
// Nota sobre comentarios del check-out: el modal de liquidación tiene su
// propio campo de comentarios (aparte de las "Observaciones" del
// check-in), para anotar algo puntual del momento de la salida (ej. "dejó
// olvidada una chaqueta", "pidió factura por correo"). Se guarda siempre
// en recepcion_checkins.observaciones_checkout (ver sql/021), tenga o no
// un pago asociado, y si hubo pago también queda anexado al comentario de
// ese abono en reservas_pagos para que aparezca en el detalle de Caja.
//
// Nota sobre el resumen visual de la liquidación (tarjeta Estadía): se
// arma en vivo con lo que la recepcionista va llenando (habitación,
// tarifa, noches, tipo de pago, monto a cobrar, saldo) usando cajones de
// color para que sea imposible perderse — azul para el estimado total,
// verde para lo que se cobra ahora, rojo (o verde si queda en cero) para
// el saldo pendiente. Si el check-in está vinculado a una reserva con
// abono previo (de Reservas o de un check-in vinculado automáticamente),
// muestra un cajón morado con "Ya abonado antes" — y el saldo pendiente
// descuenta ese abono además de lo que se cobre ahora. Esta tarjeta es
// solo una vista en vivo mientras se llena el formulario; la tarjeta de
// confirmación que se abre al enviar (ver nota de cabecera) es la que
// resume TODO de forma definitiva antes de guardar.
//
// Nota sobre el cruce con Housekeeping al elegir habitación en el
// check-in: el desplegable de Habitación solo deja elegir habitaciones
// cuyo estado sea 'disponible' — las demás (ocupada, limpieza,
// inspección, mantenimiento, bloqueada, fuera de servicio) aparecen
// deshabilitadas con su estado entre paréntesis. Justo antes de guardar,
// se vuelve a confirmar el estado contra la base de datos (por si cambió
// mientras se llenaba el formulario) y se bloquea el check-in si ya no
// está disponible. Así Recepción nunca puede hospedar a alguien en una
// habitación que Housekeeping tiene marcada como no disponible.
//
// Nota IMPORTANTE sobre vincular la reserva automáticamente (corrige un
// bug real detectado en capacitación): al salir del campo Número de
// documento, además de autocompletar los datos, ahora también se busca
// si ese documento tiene una reserva pendiente (reservada o confirmada,
// la misma lista de "Vincular a una reserva" de arriba) y, si hay UNA
// sola coincidencia y todavía no se había elegido ninguna a mano, se
// vincula sola. Antes esto había que hacerlo a mano en el desplegable —
// si a alguien se le olvidaba, el check-in creaba una reserva nueva desde
// cero (walk-in) en vez de usar la que ya existía, y el abono que ya se
// había pagado al reservar quedaba huérfano: nunca aparecía al liquidar
// el check-out. Si hay más de una reserva pendiente con el mismo
// documento, no se elige ninguna sola — hay que seleccionarla a mano para
// no adivinar cuál es.
//
// Nota (209 / auditoría H26): en "Editar check-in", cuando se cambia de
// habitación y el check-in tiene una reserva vinculada, ANTES de tocar
// cualquier tabla se valida que la nueva habitación no tenga otra reserva
// activa que se cruce con las fechas ACTUALES de esta estadía (aparte del
// chequeo, ya existente, de si se puede extender la fecha de salida al
// cambiar la cantidad de noches). Si hay cruce, se bloquea TODO el cambio
// de habitación (se guarda el resto de los cambios igual) y se avisa por
// qué. Antes, si había cruce, solo se mostraba un aviso de "no se pudo
// extender la estadía" pero la habitación se movía de todas formas en
// recepcion_checkins, en reservas, y los estados físicos de ambas
// habitaciones se actualizaban igual — podía terminar doble-reservando un
// cuarto ya ocupado por otro huésped.
//
// Nota (213 / auditoría H28): la disponibilidad de habitación ahora
// también está blindada a nivel de base de datos con un EXCLUDE
// constraint ("reservas_no_cruce_habitacion", ver sql/212) — así se
// cierra de raíz la condición de carrera que un simple SELECT-antes-de-
// guardar no puede evitar del todo (dos guardados casi simultáneos). Si
// ese constraint bloquea un guardado, Postgres devuelve el código
// 23P01 — ver `mensajeErrorReserva` más abajo, que lo traduce a un aviso
// legible en vez del mensaje técnico crudo.
//
// Nota (213 / auditoría H30): el check-out anticipado (el huésped sale
// antes de la fecha de salida que tenía reservada) acorta fecha_checkout
// pero antes NO tocaba el monto a cobrar ni lo avisaba en la
// liquidación — se cobraba la estadía completa en silencio. Ahora, si la
// liquidación detecta salida anticipada, muestra un aviso y sugiere un
// monto de habitación prorrateado (noches realmente usadas × tarifa,
// para tarifas por noche; el mismo monto original para tarifas "por
// días", que son un total fijo) — pero el campo queda EDITABLE, porque
// puede que se negocie otra cosa con el huésped en vez de prorratear.
import { registerModule } from './modules-registry.js';
import { supabase } from './supabase-client.js';
import { mostrarToast, mostrarConfirmacion } from './ui.js';
import { formatFechaHora, formatFechaCorta, toISODate, addDays, calcularEdad } from './dates.js';
import { formatCOP, activarInputDinero, valorNumericoInput } from './currency.js';
import { calcularHabitacionesEnUso } from './cuentas.js';
import { getUsuarioActual } from './auth.js';
import { ajustarInventarioHabitacion } from './inventario.js';
import { mostrarResumenCheckout } from './resumen-checkout.js';
import { abrirModalRegistrarConsumo } from './consumo-minibar.js';

const TIPOS_DOCUMENTO = ['Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'Tarjeta de identidad', 'PEP', 'Otro'];
const METODOS_PAGO = ['Efectivo', 'Nequi', 'Daviplata', 'QR', 'Transferencia Bancaria', 'Datáfono', 'Llave'];

// Estados de reserva que "ocupan" la habitación, usados para detectar
// cruces de fechas al extender una estadía (mismo criterio que reservas.js).
const ESTADOS_RESERVA_ACTIVOS = ['reservada', 'confirmada', 'check_in', 'hospedado'];

// Mismas reglas de bloqueo que reservas.js, para que "Ver disponibilidad"
// diga exactamente lo mismo que el calendario de Reservas.
const ESTADOS_BLOQUEO_INDEFINIDO = ['mantenimiento', 'bloqueada', 'fuera_servicio'];
const ESTADOS_BLOQUEO_HOY = ['ocupada', 'limpieza', 'inspeccion'];
const ETIQUETA_ESTADO_HABITACION = {
  ocupada: '🔴 Ocupada',
  limpieza: '🧹 Limpieza',
  inspeccion: '🔍 Inspección',
  mantenimiento: '🔧 Mantenim.',
  bloqueada: '🚫 Bloqueada',
  fuera_servicio: '⛔ Fuera serv.',
};
const DIAS_VISIBLES_DISPONIBILIDAD = 10;

// Colores/etiquetas del resumen visual de liquidación (tarjeta Estadía) Y
// de la tarjeta de confirmación final del check-in.
const ETIQUETA_ESTADO_PAGO = {
  pendiente: {
    texto: '🕒 Pendiente — sin pago todavía',
    color: '#8a6d00',
    fondo: 'var(--color-alerta-fondo, #fff8e1)',
    borde: '#e8c547',
    titulo: '🕒 Sin pago por ahora',
    detalle: 'El huésped NO paga nada en este momento — el valor completo de la estadía queda pendiente para cobrarse en el check-out.',
  },
  parcial: {
    texto: '🔷 Parcial — abono ahora',
    color: '#0b5fae',
    fondo: '#eaf3ff',
    borde: '#8ec1f5',
    titulo: '🔷 Abono parcial',
    detalle: 'El huésped abona una parte ahora. El resto de la estadía queda pendiente y se cobra en el check-out.',
  },
  anticipado: {
    texto: '✅ Anticipado — pago completo',
    color: 'var(--color-verde-oscuro, #1b7a3d)',
    fondo: '#eafbea',
    borde: '#8fd3a4',
    titulo: '✅ Pago total (anticipado)',
    detalle: 'El huésped paga ahora el valor completo de la estadía — la habitación queda saldada. Solo quedaría pendiente lo que consuma de minibar, que se liquida en el check-out.',
  },
};

async function render(container) {
  await vistaLista(container);
}

async function vistaLista(container) {
  container.innerHTML = `
    <h2>Recepción — Hoy</h2>
    <div id="resumen-hoy-wrap" style="margin-bottom:1.25rem;">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
    <div class="acciones-tarjeta" style="justify-content:flex-start; margin-bottom:1.25rem;">
      <button id="btn-nuevo-checkin" class="btn btn-primario">+ Nuevo Check-in (walk-in)</button>
    </div>
    <div id="llegadas-hoy-wrap" style="margin-bottom:1.25rem;"></div>
    <div id="checkins-wrap" class="tabla-scroll">
      <p class="mensaje-vacio">Cargando…</p>
    </div>
  `;

  container.querySelector('#btn-nuevo-checkin').addEventListener('click', () => vistaFormulario(container));

  await cargarVistaHoy(container);
}

async function cargarVistaHoy(container) {
  const wrapResumen = container.querySelector('#resumen-hoy-wrap');
  const wrapLlegadas = container.querySelector('#llegadas-hoy-wrap');
  const wrapCheckins = container.querySelector('#checkins-wrap');

  let items = [];
  try {
    items = await calcularHabitacionesEnUso();
  } catch (error) {
    wrapResumen.innerHTML = '';
    wrapLlegadas.innerHTML = '';
    wrapCheckins.innerHTML = `<p class="mensaje-vacio">Error cargando huéspedes: ${error.message}</p>`;
    return;
  }

  const hoyISO = toISODate(new Date());

  const { data: llegadasHoy, error: errLlegadas } = await supabase
    .from('reservas')
    .select('id, habitacion_id, huesped_nombre, huesped_telefono, huesped_documento, fecha_checkin, fecha_checkout, tarifa_id, habitaciones(numero, nombre)')
    .eq('fecha_checkin', hoyISO)
    .in('estado', ['reservada', 'confirmada'])
    .order('id');

  const reservaIds = items.map((i) => i.reservaId).filter((id) => id !== null);
  const { data: reservasActivas, error: errReservasActivas } = reservaIds.length
    ? await supabase.from('reservas').select('id, fecha_checkout').in('id', reservaIds)
    : { data: [], error: null };

  // --- Estado general de habitaciones (lo relevante que traía la antigua
  // pestaña "Inicio"): útil para saber de un vistazo dónde ubicar un
  // walk-in sin tener que abrir otra pantalla. ---
  const { data: habitacionesEstado, error: errHabEstado } = await supabase.from('habitaciones').select('estado');

  if (errLlegadas || errReservasActivas) {
    wrapCheckins.innerHTML = `<p class="mensaje-vacio">Error cargando el resumen de hoy: ${(errLlegadas || errReservasActivas).message}</p>`;
    return;
  }

  const checkoutPorReserva = new Map((reservasActivas || []).map((r) => [r.id, r.fecha_checkout]));
  const itemsConSaleHoy = items.map((i) => ({
    ...i,
    saleHoy: i.reservaId ? checkoutPorReserva.get(i.reservaId) === hoyISO : false,
  }));

  const salidasHoy = itemsConSaleHoy.filter((i) => i.saleHoy).length;
  const saldoTotalPendiente = itemsConSaleHoy.reduce((acc, i) => acc + Math.max(0, i.saldoPendiente), 0);

  const contarHabitaciones = (estado) => (habitacionesEstado || []).filter((h) => h.estado === estado).length;
  const libres = contarHabitaciones('disponible');
  const enLimpieza = contarHabitaciones('limpieza');
  const fueraServicio = contarHabitaciones('fuera_servicio') + contarHabitaciones('mantenimiento') + contarHabitaciones('bloqueada');

  // --- Resumen del día (4 tarjetas rápidas + línea de estado general) ---
  wrapResumen.innerHTML = `
    <div class="grid-dos-columnas" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Llegadas hoy</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${(llegadasHoy || []).length}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Salidas hoy</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${salidasHoy}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Habitaciones ocupadas</p>
        <p style="font-size:1.8rem; font-weight:700; margin:0.2rem 0 0;">${itemsConSaleHoy.length}</p>
      </div>
      <div class="tarjeta" style="text-align:center;">
        <p class="mensaje-vacio" style="margin:0;">Saldo pendiente total</p>
        <p style="font-size:1.5rem; font-weight:700; margin:0.2rem 0 0; color:${saldoTotalPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'};">${formatCOP(saldoTotalPendiente)}</p>
      </div>
    </div>
    ${
      errHabEstado
        ? ''
        : `<p style="margin:0.75rem 0 0; font-size:0.85rem; color:var(--color-texto-suave);">🏠 Libres: <strong>${libres}</strong> &nbsp;·&nbsp; 🧹 En limpieza: <strong>${enLimpieza}</strong> &nbsp;·&nbsp; ⛔ Fuera de servicio: <strong>${fueraServicio}</strong></p>`
    }
  `;

  // --- Llegadas de hoy (reservas sin check-in todavía) ---
  if ((llegadasHoy || []).length === 0) {
    wrapLlegadas.innerHTML = '';
  } else {
    wrapLlegadas.innerHTML = `
      <div class="tarjeta">
        <h3>🛬 Llegadas de hoy (${llegadasHoy.length})</h3>
        <div class="tabla-scroll">
          <table class="tabla-simple">
            <thead>
              <tr>
                <th>Habitación</th>
                <th>Huésped</th>
                <th>Teléfono</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${llegadasHoy
                .map(
                  (r) => `
                <tr>
                  <td>${r.habitaciones ? `${escaparHTML(r.habitaciones.numero)} — ${escaparHTML(r.habitaciones.nombre)}` : '—'}</td>
                  <td>${escaparHTML(r.huesped_nombre)}</td>
                  <td>${escaparHTML(r.huesped_telefono || '—')}</td>
                  <td><button type="button" class="btn-editar btn-iniciar-checkin" data-reserva-id="${r.id}">Iniciar check-in</button></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wrapLlegadas.querySelectorAll('.btn-iniciar-checkin').forEach((btn) => {
      btn.addEventListener('click', () => vistaFormulario(container, Number(btn.dataset.reservaId)));
    });
  }

  // --- Habitaciones en uso, ordenadas por urgencia: sale hoy + debe plata
  // primero, luego sale hoy, luego debe plata, luego el resto. ---
  const itemsOrdenados = [...itemsConSaleHoy].sort((a, b) => {
    const score = (i) => (i.saleHoy && i.saldoPendiente > 0 ? 3 : i.saleHoy ? 2 : i.saldoPendiente > 0 ? 1 : 0);
    return score(b) - score(a);
  });

  if (itemsOrdenados.length === 0) {
    wrapCheckins.innerHTML = '<p class="mensaje-vacio">No hay huéspedes hospedados actualmente.</p>';
    return;
  }

  wrapCheckins.innerHTML = `
    <table class="tabla-simple">
      <thead>
        <tr>
          <th>Habitación</th>
          <th>Huésped</th>
          <th>Documento</th>
          <th>Hora ingreso</th>
          <th>Noches</th>
          <th>Sale hoy</th>
          <th>Saldo pendiente</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${itemsOrdenados
          .map(
            (i) => `
          <tr data-checkin-id="${i.checkinId}" style="${i.saleHoy ? 'background:var(--color-alerta-fondo, #fff8e1);' : ''}">
            <td>${i.habitacionLabel}</td>
            <td>${escaparHTML(i.huespedNombre)}</td>
            <td>${i.tipoDocumento || '—'} ${i.numeroDocumento || ''}</td>
            <td>${formatFechaHora(i.horaIngreso)}</td>
            <td>${i.cantidadNoches ?? '—'}</td>
            <td>${i.saleHoy ? '🔶 Sí' : '—'}</td>
            <td style="color:${i.saldoPendiente > 0 ? 'var(--color-rojo-oscuro)' : 'var(--color-verde-oscuro)'}; font-weight:700;">
              ${formatCOP(i.saldoPendiente)}
              ${i.montoMinibar > 0 ? `<div style="font-size:0.72rem; font-weight:500; color:var(--color-texto-suave);">🥤 incluye ${formatCOP(i.montoMinibar)} de minibar</div>` : ''}
              ${i.excedente > 0 ? `<div style="font-size:0.72rem; font-weight:700; color:#6a3fb5;">↑ excedente ${formatCOP(i.excedente)}</div>` : ''}
            </td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn-editar btn-editar-checkin" data-checkin-id="${i.checkinId}">✏️ Editar</button>
              <button type="button" class="btn-editar btn-agregar-consumo" data-checkin-id="${i.checkinId}">➕ Consumo</button>
              <button type="button" class="btn-editar btn-checkout" data-checkin-id="${i.checkinId}">Check-out</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  wrapCheckins.querySelectorAll('.btn-checkout').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = itemsOrdenados.find((i) => i.checkinId === Number(btn.dataset.checkinId));
      if (item) abrirModalLiquidacion(container, item);
    });
  });

  wrapCheckins.querySelectorAll('.btn-editar-checkin').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = itemsOrdenados.find((i) => i.checkinId === Number(btn.dataset.checkinId));
      if (item) abrirModalEditarCheckin(container, item);
    });
  });

  wrapCheckins.querySelectorAll('.btn-agregar-consumo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = itemsOrdenados.find((i) => i.checkinId === Number(btn.dataset.checkinId));
      if (item) abrirModalAgregarConsumoRapido(container, item);
    });
  });
}

// --- "➕ Consumo": agregar un consumo de mostrador a una habitación
// ocupada en cualquier momento de la estadía, sin pasar por el checkout.
// Nota (155): usa la misma tarjeta emergente de consumo-minibar.js que
// Minibar → "Registrar consumo" — ya no es un formulario de una sola
// línea con producto y cantidad=1 precargados por defecto; ahora permite
// una o varias líneas, sin nada preseleccionado, y pide confirmar un
// resumen antes de guardar. ---
function abrirModalAgregarConsumoRapido(container, item) {
  if (!item.reservaId) {
    mostrarToast('Este check-in no tiene una reserva vinculada; no se puede agregar consumo desde aquí.', 'error');
    return;
  }

  abrirModalRegistrarConsumo({
    habitacionId: item.habitacionId,
    reservaId: item.reservaId,
    habitacionLabel: item.habitacionLabel,
    huespedNombre: item.huespedNombre,
    onGuardado: async () => {
      mostrarToast(`Consumo agregado a ${item.habitacionLabel}.`, 'exito');
      await vistaLista(container);
    },
  });
}

async function abrirModalLiquidacion(container, item) {
  // --- Consumos de minibar de esta reserva, en detalle (no solo el total
  // que ya trae `item` desde cuentas.js) + catálogo de productos activos,
  // para poder agregar un consumo de último momento sin salir de aquí.
  // (213 / auditoría H30) También se trae la reserva vinculada (fechas +
  // tarifa) para poder detectar si esta salida es ANTES de la fecha de
  // checkout que tenía reservada, y sugerir un monto de habitación
  // ajustado — ver nota de cabecera. ---
  const [{ data: consumosIniciales, error: errConsumos }, { data: productos, error: errProductos }, { data: reservaVinculadaLiquidacion }] =
    await Promise.all([
      item.reservaId
        ? supabase
            .from('minibar_consumos')
            .select('*, minibar_productos(nombre)')
            .eq('reserva_id', item.reservaId)
            .order('creado_en', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from('minibar_productos').select('*').eq('activo', true).order('categoria').order('nombre'),
      item.reservaId
        ? supabase
            .from('reservas')
            .select('fecha_checkin, fecha_checkout, tarifas(tipo, precio_temporada_baja, valor_convenido)')
            .eq('id', item.reservaId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (errConsumos || errProductos) {
    mostrarToast(`Error cargando el detalle de minibar: ${(errConsumos || errProductos).message}`, 'error');
    return;
  }

  let consumos = consumosIniciales || [];
  const categorias = [...new Set((productos || []).map((p) => p.categoria))];
  let montoEditadoManualmente = false;
  let editandoConsumoId = null;
  let minibarConfirmado = false;

  // (213 / H30) Salida anticipada: hoy es antes de la fecha de checkout
  // que tenía reservada esta estadía. Tarifa por noche → se sugiere
  // prorratear (noches realmente usadas × precio); tarifa "por días"
  // (tipo 'por_dias') → el total es fijo por contrato, no depende de las
  // noches, así que se sugiere el monto original. En ambos casos el
  // campo queda editable más abajo.
  const hoyISOLiquidacion = toISODate(new Date());
  const tarifaLiquidacion = reservaVinculadaLiquidacion?.tarifas || null;
  const esSalidaAnticipada = Boolean(
    reservaVinculadaLiquidacion?.fecha_checkout && hoyISOLiquidacion < reservaVinculadaLiquidacion.fecha_checkout
  );
  let montoHabitacionSugerido = item.montoHabitacion;
  if (esSalidaAnticipada && tarifaLiquidacion && tarifaLiquidacion.tipo !== 'por_dias' && reservaVinculadaLiquidacion.fecha_checkin) {
    const nochesReales = Math.max(
      1,
      Math.round((new Date(`${hoyISOLiquidacion}T00:00:00`) - new Date(`${reservaVinculadaLiquidacion.fecha_checkin}T00:00:00`)) / 86400000)
    );
    montoHabitacionSugerido = nochesReales * Number(tarifaLiquidacion.precio_temporada_baja);
  }
  let montoHabitacionActual = montoHabitacionSugerido;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-super-ancha">
      <h3>🧾 Liquidar y hacer check-out</h3>
      <form id="form-liquidacion">
        <div class="modal-contenido">
          <p class="mensaje-vacio">${escaparHTML(item.huespedNombre)} — ${item.habitacionLabel}</p>
          <div id="liquidacion-cuerpo"></div>
        </div>
        <div class="modal-acciones">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-liquidacion">Cancelar</button>
          <button type="submit" class="btn btn-primario">Confirmar y hacer check-out</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const cuerpo = overlay.querySelector('#liquidacion-cuerpo');
  const inputPago = () => overlay.querySelector('input[name="pago_final"]');

  function montoMinibarActual() {
    return consumos.reduce((sum, c) => sum + Number(c.monto), 0);
  }
  function montoTotalActual() {
    // (213 / H30) montoHabitacionActual, no item.montoHabitacion — puede
    // haberse ajustado por salida anticipada.
    return montoHabitacionActual + montoMinibarActual();
  }
  function saldoActual() {
    return Math.max(0, montoTotalActual() - item.totalAbonado);
  }

  function pintarLiquidacion() {
    // Antes de reescribir el HTML, se guarda lo que la recepcionista ya
    // haya tocado (método de pago, monto editado a mano) para no perderlo
    // al repintar después de agregar/editar/quitar un consumo.
    const metodoPrevio = overlay.querySelector('select[name="metodo_pago"]')?.value;
    const pagoPrevioNumerico = inputPago() ? valorNumericoInput(inputPago()) : null;
    const comentarioPrevio = overlay.querySelector('textarea[name="comentarios_checkout"]')?.value;

    const montoMinibar = montoMinibarActual();
    const montoTotal = montoTotalActual();
    const saldo = saldoActual();

    cuerpo.innerHTML = `
      <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:0.5rem;">
        ${cajonMonto(`Habitación (${item.cantidadNoches ?? '—'} noches)`, formatCOP(montoHabitacionActual), '#0b5fae', '#eaf3ff', '#8ec1f5')}
        ${cajonMonto('Monto total', formatCOP(montoTotal), '#1a5276', '#eaf2f8', '#a9c8e0')}
        ${cajonMonto('Abonado hasta ahora', formatCOP(item.totalAbonado), 'var(--color-verde-oscuro, #1b7a3d)', '#eafbea', '#8fd3a4')}
        ${cajonMonto('Saldo pendiente', formatCOP(saldo), saldo > 0 ? 'var(--color-rojo-oscuro, #b3261e)' : 'var(--color-verde-oscuro, #1b7a3d)', saldo > 0 ? '#fdeceb' : '#eafbea', saldo > 0 ? '#f0a8a0' : '#8fd3a4')}
      </div>

      ${
        esSalidaAnticipada
          ? `
      <div class="tarjeta" style="margin-top:0.85rem; background:#fff8e1; border:1.5px solid #e8c547;">
        <p style="margin:0 0 0.5rem; font-weight:600;">⚠️ Salida anticipada: la reserva estaba hasta ${formatFechaCorta(
          reservaVinculadaLiquidacion.fecha_checkout
        )}, hoy sale antes.</p>
        <label>Monto de habitación a cobrar
          <input type="text" id="input-monto-habitacion-liquidacion" placeholder="$0" />
        </label>
        <p class="mensaje-vacio" style="font-size:0.78rem; margin-top:0.3rem;">
          ${
            tarifaLiquidacion && tarifaLiquidacion.tipo === 'por_dias'
              ? 'Esta tarifa es "por días" (monto fijo, no depende de las noches) — se sugiere el monto original, pero ajústalo si se negoció algo distinto con el huésped.'
              : `Sugerido prorrateado por las noches realmente usadas: <strong>${formatCOP(
                  montoHabitacionSugerido
                )}</strong> — confírmalo o ajústalo a mano (por ejemplo si se negoció otra cosa) antes de continuar.`
          }
        </p>
      </div>
      `
          : ''
      }

      <div class="tarjeta" style="margin-top:1rem; background:var(--color-fondo-suave, #f8f9fb); border:1.5px solid #cfe0ee;">
        <div class="acciones-tarjeta" style="justify-content:space-between; margin-top:0; margin-bottom:0.5rem;">
          <h3 style="margin:0;">🥤 Consumo de minibar</h3>
          <strong style="font-size:1.15rem; color:#0b5fae;">${formatCOP(montoMinibar)}</strong>
        </div>
        ${
          consumos.length === 0
            ? '<p class="mensaje-vacio">Sin consumo de minibar registrado.</p>'
            : `
          <div class="tabla-scroll">
            <table class="tabla-simple">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th><th style="text-align:right;">Acciones</th></tr></thead>
              <tbody>
                ${consumos
                  .map((c) => {
                    const enEdicion = editandoConsumoId === c.id;
                    return `
                  <tr>
                    <td>${c.minibar_productos ? escaparHTML(c.minibar_productos.nombre) : '—'}</td>
                    <td>${enEdicion ? `<input type="number" min="1" class="input-editar-cantidad-consumo" data-id="${c.id}" value="${c.cantidad}" style="width:64px;" />` : c.cantidad}</td>
                    <td class="monto">${enEdicion ? '—' : formatCOP(c.monto)}</td>
                    <td style="white-space:nowrap; text-align:right;">
                      ${
                        enEdicion
                          ? `<button type="button" class="btn-editar btn-guardar-edicion-consumo" data-id="${c.id}">💾 Guardar</button>
                             <button type="button" class="btn-editar btn-cancelar-edicion-consumo" data-id="${c.id}">Cancelar</button>`
                          : `<button type="button" class="btn-editar btn-editar-consumo-liquidacion" data-id="${c.id}">✏️ Editar</button>
                             <button type="button" class="btn-editar btn-quitar-consumo-liquidacion" data-id="${c.id}">🗑 Quitar</button>`
                      }
                    </td>
                  </tr>
                `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
        ${
          item.reservaId
            ? `
          <div class="form-grid" style="margin-top:0.75rem;">
            <label>Producto
              <select id="select-producto-liquidacion">
                ${categorias
                  .map(
                    (cat) => `
                  <optgroup label="${escaparHTML(cat)}">
                    ${(productos || [])
                      .filter((p) => p.categoria === cat)
                      .map((p) => `<option value="${p.id}">${escaparHTML(p.nombre)} — ${formatCOP(p.precio)}</option>`)
                      .join('')}
                  </optgroup>
                `
                  )
                  .join('')}
              </select>
            </label>
            <label>Cantidad
              <input type="number" id="input-cantidad-liquidacion" min="1" value="1" />
            </label>
            <button type="button" id="btn-agregar-consumo-liquidacion" class="btn btn-secundario btn-chico">+ Agregar consumo</button>
          </div>
        `
            : '<p class="mensaje-vacio" style="margin-top:0.5rem;">Este check-in no tiene reserva vinculada; no se puede agregar consumo desde aquí.</p>'
        }
      </div>

      <label style="display:flex; align-items:flex-start; gap:0.6rem; margin-top:1rem; padding:0.85rem 1rem; background:var(--color-alerta-fondo, #fff8e1); border:1.5px solid #e8c547; border-radius:10px; font-size:0.88rem;">
        <input type="checkbox" id="check-confirmo-minibar" style="width:auto; margin-top:0.2rem;" ${minibarConfirmado ? 'checked' : ''} required />
        <span>✅ Revisé el consumo de minibar de arriba (<strong>${formatCOP(montoMinibar)}</strong>) y estoy de acuerdo con el total antes de continuar con el check-out.</span>
      </label>

      <div class="form-grid" style="margin-top:1rem;">
        <label>Pago que recibes ahora
          <input type="text" name="pago_final" placeholder="$0" />
        </label>
        <label>Método de pago
          <select name="metodo_pago">
            <option value="" ${!metodoPrevio ? 'selected' : ''}>— Elige a qué cuenta va este pago —</option>
            ${METODOS_PAGO.map((m) => `<option value="${m}" ${metodoPrevio === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="mensaje-vacio" style="margin-top:0.3rem; font-size:0.78rem;">Este monto ya incluye el consumo de minibar de arriba. Si agregas, editas o quitas un consumo, se vuelve a calcular solo.</p>
      <p class="mensaje-vacio" style="margin-top:0.5rem; font-size:0.78rem;">Si el pago es menor al saldo pendiente, te pedimos confirmar antes de liberar la habitación — el checkout no se bloquea, pero el saldo queda registrado como pendiente de cobro.</p>

      <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
        Comentarios del check-out (opcional)
        <textarea name="comentarios_checkout" rows="2" placeholder="Ej: dejó olvidada una chaqueta, pidió factura por correo…" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit; text-transform:none;">${comentarioPrevio || ''}</textarea>
      </label>
    `;

    // Campo de dinero con formato "$" y punto de miles en vivo. El valor
    // se fuerza explícitamente al saldo recién calculado (a menos que la
    // recepcionista ya lo haya editado a mano) para que quede garantizado
    // que refleja cualquier cambio en el minibar, sin depender de cómo
    // cada navegador procese el HTML.
    activarInputDinero(inputPago());
    if (!montoEditadoManualmente) {
      inputPago().value = saldo || '';
      activarInputDinero(inputPago());
    } else if (pagoPrevioNumerico !== null) {
      inputPago().value = pagoPrevioNumerico || '';
      activarInputDinero(inputPago());
    }

    inputPago().addEventListener('input', () => {
      montoEditadoManualmente = true;
    });

    // (213 / H30) Campo editable de monto de habitación, solo visible en
    // salida anticipada. Se actualiza en 'change' (al salir del campo, no
    // en cada tecla) y se repinta para que Monto total/Saldo pendiente y
    // el pago sugerido reflejen el ajuste.
    const inputMontoHab = cuerpo.querySelector('#input-monto-habitacion-liquidacion');
    if (inputMontoHab) {
      inputMontoHab.value = montoHabitacionActual || '';
      activarInputDinero(inputMontoHab);
      inputMontoHab.addEventListener('change', () => {
        montoHabitacionActual = valorNumericoInput(inputMontoHab) || 0;
        pintarLiquidacion();
      });
    }

    const checkConfirmo = cuerpo.querySelector('#check-confirmo-minibar');
    checkConfirmo.addEventListener('change', () => {
      minibarConfirmado = checkConfirmo.checked;
    });

    cuerpo.querySelectorAll('.btn-quitar-consumo-liquidacion').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const consumoId = Number(btn.dataset.id);
        const consumo = consumos.find((c) => c.id === consumoId);
        if (!consumo) return;

        const { error } = await supabase.from('minibar_consumos').delete().eq('id', consumoId);
        if (error) {
          mostrarToast(`Error quitando el consumo: ${error.message}`, 'error');
          return;
        }

        try {
          const usuario = getUsuarioActual();
          await ajustarInventarioHabitacion(item.habitacionId, consumo.producto_id, consumo.cantidad, usuario?.id || null, 'ajuste_habitacion');
        } catch (errInv) {
          mostrarToast('Consumo quitado, pero no se pudo revertir el inventario de la habitación.', 'error');
        }

        consumos = consumos.filter((c) => c.id !== consumoId);
        montoEditadoManualmente = false;
        minibarConfirmado = false;
        mostrarToast('Consumo quitado de la liquidación. El monto a cobrar se actualizó.', 'exito');
        pintarLiquidacion();
      });
    });

    cuerpo.querySelectorAll('.btn-editar-consumo-liquidacion').forEach((btn) => {
      btn.addEventListener('click', () => {
        editandoConsumoId = Number(btn.dataset.id);
        pintarLiquidacion();
      });
    });

    cuerpo.querySelectorAll('.btn-cancelar-edicion-consumo').forEach((btn) => {
      btn.addEventListener('click', () => {
        editandoConsumoId = null;
        pintarLiquidacion();
      });
    });

    cuerpo.querySelectorAll('.btn-guardar-edicion-consumo').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const consumoId = Number(btn.dataset.id);
        const consumo = consumos.find((c) => c.id === consumoId);
        if (!consumo) return;
        const input = cuerpo.querySelector(`.input-editar-cantidad-consumo[data-id="${consumoId}"]`);
        const nuevaCantidad = Number(input.value);
        // (200 / auditoría H13) Antes `Number(input.value) || 1` dejaba
        // pasar cualquier negativo sin avisar (solo 0/vacío/NaN caían al
        // valor por defecto) — mismo patrón de validación explícita que
        // ya usa consumo-minibar.js.
        if (!nuevaCantidad || nuevaCantidad <= 0) {
          mostrarToast('Ingresa una cantidad válida.', 'error');
          return;
        }
        const deltaCantidad = nuevaCantidad - consumo.cantidad;

        if (deltaCantidad === 0) {
          editandoConsumoId = null;
          pintarLiquidacion();
          return;
        }

        const nuevoMonto = Number(consumo.precio_unitario) * nuevaCantidad;
        const { error } = await supabase.from('minibar_consumos').update({ cantidad: nuevaCantidad, monto: nuevoMonto }).eq('id', consumoId);
        if (error) {
          mostrarToast(`Error editando el consumo: ${error.message}`, 'error');
          return;
        }

        try {
          const usuario = getUsuarioActual();
          // deltaCantidad positivo = se consumió más (resta del
          // inventario de la habitación); negativo = se devuelve.
          await ajustarInventarioHabitacion(item.habitacionId, consumo.producto_id, -deltaCantidad, usuario?.id || null, 'ajuste_habitacion');
        } catch (errInv) {
          mostrarToast('Consumo editado, pero no se pudo ajustar el inventario de la habitación.', 'error');
        }

        consumo.cantidad = nuevaCantidad;
        consumo.monto = nuevoMonto;
        editandoConsumoId = null;
        montoEditadoManualmente = false;
        minibarConfirmado = false;
        mostrarToast('Consumo actualizado. El monto a cobrar se actualizó.', 'exito');
        pintarLiquidacion();
      });
    });

    const btnAgregar = cuerpo.querySelector('#btn-agregar-consumo-liquidacion');
    if (btnAgregar) {
      btnAgregar.addEventListener('click', async () => {
        const selectProducto = cuerpo.querySelector('#select-producto-liquidacion');
        const inputCantidad = cuerpo.querySelector('#input-cantidad-liquidacion');
        const productoId = Number(selectProducto.value);
        const cantidad = Number(inputCantidad.value);
        // (200 / auditoría H13) Misma corrección que en "Guardar" edición.
        if (!cantidad || cantidad <= 0) {
          mostrarToast('Ingresa una cantidad válida.', 'error');
          return;
        }
        const producto = (productos || []).find((p) => p.id === productoId);
        if (!producto) return;

        const usuario = getUsuarioActual();
        const { data: nuevoConsumo, error } = await supabase
          .from('minibar_consumos')
          .insert({
            reserva_id: item.reservaId,
            habitacion_id: item.habitacionId,
            producto_id: productoId,
            cantidad,
            precio_unitario: producto.precio,
            monto: producto.precio * cantidad,
            registrado_por: usuario?.id || null,
          })
          .select('*, minibar_productos(nombre)')
          .single();

        if (error) {
          mostrarToast(`Error agregando el consumo: ${error.message}`, 'error');
          return;
        }

        try {
          await ajustarInventarioHabitacion(item.habitacionId, productoId, -cantidad, usuario?.id || null, 'consumo');
        } catch (errInv) {
          mostrarToast('Consumo agregado, pero no se pudo actualizar el inventario de la habitación.', 'error');
        }

        consumos = [nuevoConsumo, ...consumos];
        montoEditadoManualmente = false;
        minibarConfirmado = false;
        mostrarToast('Consumo agregado. El monto a cobrar se actualizó para incluirlo.', 'exito');
        pintarLiquidacion();
      });
    }
  }

  pintarLiquidacion();

  overlay.querySelector('#btn-cancelar-liquidacion').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#form-liquidacion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const pagoFinal = valorNumericoInput(inputPago());
    const metodoPago = form.get('metodo_pago');
    const comentarioCheckout = form.get('comentarios_checkout')?.trim() || null;
    const saldoRestante = saldoActual() - pagoFinal;

    // (172) Si se va a registrar un pago, obligar a elegir a qué cuenta
    // va — ver nota de cabecera "Método de pago obligatorio en el
    // check-out". Sin esto, un <select> sin nada marcado explícito cae en
    // "Efectivo" (la primera opción de METODOS_PAGO) por defecto del
    // navegador, sin que la recepcionista lo haya elegido a propósito.
    if (pagoFinal > 0 && !metodoPago) {
      mostrarToast('Elige a qué cuenta va este pago antes de confirmar el check-out.', 'error');
      return;
    }

    // (213 / auditoría H30) Si se ajustó el monto de habitación (salida
    // anticipada), se persiste en reservas.monto_total — así Indicadores,
    // el resumen de checkout y cualquier consulta futura ven el monto
    // real que se cobró, no el original de la reserva.
    if (item.reservaId && montoHabitacionActual !== item.montoHabitacion) {
      const { error: errMontoHab } = await supabase.from('reservas').update({ monto_total: montoHabitacionActual }).eq('id', item.reservaId);
      if (errMontoHab) {
        mostrarToast(`No se pudo guardar el monto de habitación ajustado: ${errMontoHab.message}`, 'error');
        return;
      }
    }

    if (saldoRestante > 0) {
      const ok = await mostrarConfirmacion({
        titulo: 'Saldo pendiente al hacer check-out',
        contenidoHTML: `Después de este pago queda un saldo pendiente de <strong>${formatCOP(saldoRestante)}</strong> para <strong>${escaparHTML(item.huespedNombre)}</strong>. ¿Confirmas el check-out de todas formas? El saldo queda registrado como pendiente de cobro.`,
        textoConfirmar: 'Sí, hacer check-out con saldo pendiente',
      });
      if (!ok) return;
    }

    if (pagoFinal > 0) {
      if (!item.reservaId) {
        mostrarToast('No hay una reserva vinculada a este check-in; no se pudo registrar el pago. Se hará el check-out sin registrarlo.', 'error');
      } else {
        const { error: errPago } = await supabase.from('reservas_pagos').insert({
          reserva_id: item.reservaId,
          monto: pagoFinal,
          metodo_pago: metodoPago,
          comentarios: comentarioCheckout ? `Pago de liquidación al check-out. ${comentarioCheckout}` : 'Pago de liquidación al check-out.',
        });
        if (errPago) {
          mostrarToast(`Error registrando el pago: ${errPago.message}`, 'error');
          return;
        }
      }
    }

    const checkoutOk = await ejecutarCheckout(container, item, comentarioCheckout);
    overlay.remove();

    // Apenas se confirma el check-out, se abre la tarjeta-resumen con
    // todo el detalle del servicio (habitación, minibar, historial
    // completo de pagos) — visual, descargable y también consultable
    // luego desde el listado de Checkouts en Indicadores.
    if (checkoutOk) {
      await mostrarResumenCheckout(item.checkinId);
    }
  });
}

async function ejecutarCheckout(container, item, comentarioCheckout) {
  const { error: errCheckin } = await supabase
    .from('recepcion_checkins')
    .update({ check_out_en: new Date().toISOString(), observaciones_checkout: comentarioCheckout || null })
    .eq('id', item.checkinId);

  if (errCheckin) {
    mostrarToast(`Error en check-out: ${errCheckin.message}`, 'error');
    return false;
  }

  const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
    p_habitacion_id: item.habitacionId,
    p_estado: 'limpieza',
  });
  if (errEstado) {
    mostrarToast(`Check-out guardado, pero no se pudo actualizar el estado de la habitación: ${errEstado.message}`, 'error');
  }

  if (item.reservaId) {
    // Si el check-out se hace ANTES de la fecha de salida que tenía la
    // reserva (el huésped se fue antes de lo esperado), se acorta
    // fecha_checkout a hoy — si no, el calendario de Reservas seguía
    // mostrando esos días futuros como ocupados aunque la habitación ya
    // esté libre. Si el check-out es en la fecha esperada (o después),
    // no se toca la fecha.
    //
    // La tabla exige fecha_checkout > fecha_checkin (constraint
    // "checkout_despues_checkin") — por eso nunca se acorta por debajo de
    // checkin + 1 día, incluso si el walk-in entró y salió el mismo día.
    const hoyISO = toISODate(new Date());
    const { data: reservaActual } = await supabase.from('reservas').select('fecha_checkin, fecha_checkout').eq('id', item.reservaId).maybeSingle();

    const payloadReserva = { estado: 'check_out' };
    if (reservaActual) {
      const pisoMinimo = toISODate(addDays(reservaActual.fecha_checkin, 1));
      const nuevaFecha = hoyISO > pisoMinimo ? hoyISO : pisoMinimo;
      if (nuevaFecha < reservaActual.fecha_checkout) {
        payloadReserva.fecha_checkout = nuevaFecha;
      }
    }

    await supabase.from('reservas').update(payloadReserva).eq('id', item.reservaId);
  }

  mostrarToast('Check-out registrado. La habitación quedó en limpieza.', 'exito');
  await vistaLista(container);
  return true;
}

// --- "✏️ Editar" un check-in ya registrado ---
async function abrirModalEditarCheckin(container, item) {
  const [{ data: checkin, error: errCheckin }, { data: habitaciones }, { data: tarifas }] = await Promise.all([
    supabase.from('recepcion_checkins').select('*').eq('id', item.checkinId).single(),
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
  ]);

  if (errCheckin) {
    mostrarToast(`Error cargando el check-in: ${errCheckin.message}`, 'error');
    return;
  }

  const acompanantesExistentes = Array.isArray(checkin.acompanantes_detalle) ? checkin.acompanantes_detalle : [];
  const habitacionOriginalId = checkin.habitacion_id;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>✏️ Editar check-in — ${escaparHTML(checkin.nombre)}</h3>
      <form id="form-editar-checkin" class="modal-contenido">
        <p class="mensaje-vacio">Si cambias de habitación aquí, la reserva vinculada y el estado de ambas habitaciones se actualizan solos. La firma digital, el Habeas Data y los pagos ya registrados no se tocan desde este formulario.</p>

        <h4>Datos del huésped</h4>
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required value="${escaparHTML(checkin.nombre)}" />
          </label>
          <label>Tipo de documento
            <select name="tipo_documento">
              ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}" ${checkin.tipo_documento === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required value="${escaparHTML(checkin.numero_documento)}" />
          </label>
          <label>Nacionalidad
            <input type="text" name="nacionalidad" value="${escaparHTML(checkin.nacionalidad || '')}" />
          </label>
          <label>Fecha de nacimiento
            <input type="date" name="fecha_nacimiento" value="${checkin.fecha_nacimiento || ''}" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" value="${escaparHTML(checkin.direccion || '')}" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" value="${escaparHTML(checkin.ciudad || '')}" />
          </label>
          <label>Departamento
            <input type="text" name="departamento" value="${escaparHTML(checkin.departamento || '')}" />
          </label>
          <label>País
            <input type="text" name="pais" value="${escaparHTML(checkin.pais || '')}" />
          </label>
          <label>Correo
            <input type="email" name="correo" value="${escaparHTML(checkin.correo || '')}" />
          </label>
          <label>Celular
            <input type="text" name="celular" value="${escaparHTML(checkin.celular || '')}" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" value="${escaparHTML(checkin.empresa || '')}" />
          </label>
          <label>Placa del vehículo
            <input type="text" name="placa_vehiculo" value="${escaparHTML(checkin.placa_vehiculo || '')}" />
          </label>
          <label>Foto del documento (URL)
            <input type="url" name="foto_documento_url" value="${escaparHTML(checkin.foto_documento_url || '')}" />
          </label>
        </div>
        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;">${escaparHTML(checkin.observaciones || '')}</textarea>
        </label>

        <h4 style="margin-top:1.25rem;">Acompañantes</h4>
        <div id="acompanantes-editar-lista"></div>
        <button type="button" id="btn-agregar-acompanante-editar" class="btn btn-secundario btn-chico">+ Agregar acompañante</button>

        <h4 style="margin-top:1.25rem;">Estadía</h4>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" id="select-habitacion-editar" required>
              ${(habitaciones || [])
                .map((h) => {
                  const esLaActual = h.id === checkin.habitacion_id;
                  const bloqueada = h.estado !== 'disponible' && !esLaActual;
                  return `<option value="${h.id}" ${esLaActual ? 'selected' : ''} ${bloqueada ? 'disabled' : ''}>${h.numero} — ${h.nombre}${bloqueada ? ` (${ETIQUETA_ESTADO_HABITACION[h.estado] || h.estado})` : ''}</option>`;
                })
                .join('')}
            </select>
          </label>
          <label>Tarifa
            <select name="tarifa_id" required>
              <option value="">—</option>
              ${(tarifas || [])
                .map((t) => `<option value="${t.id}" ${checkin.tarifa_id === t.id ? 'selected' : ''}>${t.codigo} / ${formatCOP(t.tipo === 'por_dias' ? t.valor_convenido : t.precio_temporada_baja)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Cantidad de noches
            <input type="number" name="cantidad_noches" id="input-noches-editar" min="1" required value="${checkin.cantidad_noches || 1}" />
          </label>
          <label>Método de pago
            <select name="metodo_pago" required>
              <option value="" ${!checkin.metodo_pago ? 'selected' : ''}>— Elige a qué cuenta va —</option>
              ${METODOS_PAGO.map((m) => `<option value="${m}" ${checkin.metodo_pago === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label>Depósito de garantía
            <input type="number" name="deposito" step="1000" value="${checkin.deposito ?? ''}" />
          </label>
        </div>
        <p class="mensaje-vacio" style="margin-top:0.4rem; font-size:0.78rem;">💡 Si el huésped decide quedarse más noches, solo aumenta "Cantidad de noches" — la reserva vinculada extiende su fecha de salida sola (contando desde el check-in original), siempre que la habitación siga libre esos días.</p>

        <!-- (Nota 181) Si "Cantidad de noches" cambia frente al valor con el
        que se abrió este modal, la fecha de salida de la reserva vinculada
        se extiende (o se acorta) sola — pero el monto total de esa reserva
        NO se toca automáticamente (para no pisar totales con descuento).
        Este cajón obliga a confirmar/ajustar el monto a mano antes de
        guardar, para que la estadía nunca quede con más noches pero el
        mismo cobro de antes. Oculto mientras las noches no cambian. -->
        <div id="wrap-monto-extendido-editar" class="oculto" style="margin-top:0.85rem; background:var(--color-fondo-suave, #f8f9fb); border:1px solid var(--color-borde, #ddd); border-radius:8px; padding:0.75rem 0.9rem;">
          <label>Nuevo monto total de la estadía (cambiaron las noches)
            <input type="text" id="input-monto-extendido-editar" placeholder="$0" />
          </label>
          <p class="mensaje-vacio" style="font-size:0.78rem; margin-top:0.3rem;">Sugerido con la tarifa actual: <strong id="monto-sugerido-extendido-editar">$0</strong> — confírmalo o ajústalo a mano (por ejemplo, si hay un descuento) antes de guardar. Este es el monto total de toda la reserva, no solo las noches nuevas.</p>
        </div>

        <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">No editables desde aquí: firma digital, consentimiento Habeas Data y pagos ya registrados (se corrigen en Caja o Reservas).</p>

        <div class="modal-acciones" style="margin-top:1.25rem;">
          <button type="button" class="btn btn-secundario" id="btn-cancelar-editar-checkin">Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cambios</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // --- Acompañantes: misma plantilla que el check-in nuevo, pero
  // precargada con lo que ya había guardado. ---
  const listaAcompEditar = overlay.querySelector('#acompanantes-editar-lista');
  let contadorAcompEditar = 0;

  function agregarBloqueAcompEditar(datos) {
    contadorAcompEditar += 1;
    const envoltorio = document.createElement('div');
    envoltorio.innerHTML = filaAcompanante(contadorAcompEditar);
    const bloque = envoltorio.firstElementChild;
    if (datos) {
      const setCampo = (nombreCampo, valor) => {
        const el = bloque.querySelector(`[name="${nombreCampo}"]`);
        if (el && valor) el.value = valor;
      };
      setCampo('acomp_nombre', datos.nombre);
      setCampo('acomp_tipo_documento', datos.tipo_documento);
      setCampo('acomp_numero_documento', datos.numero_documento);
      setCampo('acomp_nacionalidad', datos.nacionalidad);
      setCampo('acomp_fecha_nacimiento', datos.fecha_nacimiento);
      setCampo('acomp_celular', datos.celular);
      const checkVerificado = bloque.querySelector('.check-verificacion-menor');
      if (checkVerificado && datos.verificado_menor) checkVerificado.checked = true;
    }
    bloque.querySelector('.btn-quitar-acompanante').addEventListener('click', () => bloque.remove());
    wireAlertaMenorAcompanante(bloque);
    listaAcompEditar.appendChild(bloque);
  }

  if (acompanantesExistentes.length) {
    acompanantesExistentes.forEach((a) => agregarBloqueAcompEditar(a));
  }
  overlay.querySelector('#btn-agregar-acompanante-editar').addEventListener('click', () => agregarBloqueAcompEditar(null));

  overlay.querySelector('#btn-cancelar-editar-checkin').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // --- (Nota 181) Candado de "extender noches" — ver comentario del cajón
  // en el HTML. cantidadNochesInicial es el valor con el que se abrió el
  // modal (lo que ya estaba guardado); si la recepcionista lo cambia, se
  // exige confirmar el nuevo monto total antes de dejar guardar. ---
  const cantidadNochesInicialEditar = checkin.cantidad_noches || 1;
  const inputNochesEditar = overlay.querySelector('#input-noches-editar');
  const selectTarifaEditar = overlay.querySelector('select[name="tarifa_id"]');
  const wrapMontoExtendidoEditar = overlay.querySelector('#wrap-monto-extendido-editar');
  const inputMontoExtendidoEditar = overlay.querySelector('#input-monto-extendido-editar');
  const spanMontoSugeridoEditar = overlay.querySelector('#monto-sugerido-extendido-editar');
  activarInputDinero(inputMontoExtendidoEditar);

  function nochesCambiaronEditar() {
    return !!checkin.reserva_id && (Number(inputNochesEditar.value) || 0) !== cantidadNochesInicialEditar;
  }

  function actualizarCandadoMontoExtendidoEditar() {
    const cambiaron = nochesCambiaronEditar();
    wrapMontoExtendidoEditar.classList.toggle('oculto', !cambiaron);
    inputMontoExtendidoEditar.required = cambiaron;
    if (cambiaron) {
      const tarifaSel = (tarifas || []).find((t) => t.id === Number(selectTarifaEditar.value));
      const nochesSel = Number(inputNochesEditar.value) || 0;
      const sugerido = !tarifaSel
        ? 0
        : tarifaSel.tipo === 'por_dias'
        ? Number(tarifaSel.valor_convenido)
        : nochesSel > 0
        ? nochesSel * Number(tarifaSel.precio_temporada_baja)
        : 0;
      spanMontoSugeridoEditar.textContent = formatCOP(sugerido);
    }
  }

  inputNochesEditar.addEventListener('input', actualizarCandadoMontoExtendidoEditar);
  selectTarifaEditar.addEventListener('change', actualizarCandadoMontoExtendidoEditar);

  overlay.querySelector('#form-editar-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);

    // Se valida ANTES de tocar la base de datos (ni el update del check-in,
    // ni el de la reserva vinculada) para que nunca quede a medias: si
    // cambiaron las noches y falta el monto confirmado, no se guarda nada.
    if (nochesCambiaronEditar() && !valorNumericoInput(inputMontoExtendidoEditar)) {
      mostrarToast('Cambiaron las noches de la estadía — confirma el nuevo monto total de la reserva antes de guardar.', 'error');
      return;
    }
    const montoTotalActualizadoEditar = nochesCambiaronEditar() ? valorNumericoInput(inputMontoExtendidoEditar) : null;

    const nuevaHabitacionId = Number(form.get('habitacion_id'));
    const habitacionCambio = nuevaHabitacionId !== habitacionOriginalId;

    // (209 / auditoría H26) Si cambia de habitación y hay una reserva
    // vinculada, se valida ANTES de tocar cualquier tabla que la nueva
    // habitación no tenga otra reserva activa que se cruce con las fechas
    // ACTUALES de esta estadía (no las que se vayan a extender — ese es
    // el chequeo aparte, más abajo, que ya existía). Si hay cruce, se
    // bloquea TODO el cambio de habitación: habitacionFinalId se queda en
    // la original y las secciones de abajo usan esta variable en vez de
    // nuevaHabitacionId para que nada — ni recepcion_checkins, ni
    // reservas, ni el estado físico de las habitaciones — se mueva.
    let habitacionFinalId = nuevaHabitacionId;
    let crucePorCambioHabitacion = null;

    if (habitacionCambio && checkin.reserva_id) {
      const { data: reservaActualParaCruce } = await supabase
        .from('reservas')
        .select('fecha_checkin, fecha_checkout')
        .eq('id', checkin.reserva_id)
        .maybeSingle();

      if (reservaActualParaCruce?.fecha_checkin && reservaActualParaCruce?.fecha_checkout) {
        const { data: crucesCambioHabitacion } = await supabase
          .from('reservas')
          .select('id, huesped_nombre, fecha_checkin, fecha_checkout')
          .eq('habitacion_id', nuevaHabitacionId)
          .in('estado', ESTADOS_RESERVA_ACTIVOS)
          .neq('id', checkin.reserva_id)
          .lt('fecha_checkin', reservaActualParaCruce.fecha_checkout)
          .gt('fecha_checkout', reservaActualParaCruce.fecha_checkin);

        if (crucesCambioHabitacion && crucesCambioHabitacion.length > 0) {
          habitacionFinalId = habitacionOriginalId;
          crucePorCambioHabitacion = crucesCambioHabitacion[0];
        }
      }
    }

    if (crucePorCambioHabitacion) {
      mostrarToast(
        `No se cambió de habitación: ya tiene otra reserva activa (${crucePorCambioHabitacion.huesped_nombre}) que se cruza con las fechas de esta estadía. Se guardó el resto de los cambios igual.`,
        'error'
      );
    } else if (habitacionCambio) {
      const nuevaHabitacion = (habitaciones || []).find((h) => h.id === nuevaHabitacionId);
      if (nuevaHabitacion && nuevaHabitacion.estado !== 'disponible') {
        const ok = await mostrarConfirmacion({
          titulo: 'Habitación no disponible',
          contenidoHTML: `La habitación <strong>${nuevaHabitacion.numero} — ${nuevaHabitacion.nombre}</strong> figura como "${ETIQUETA_ESTADO_HABITACION[nuevaHabitacion.estado] || nuevaHabitacion.estado}", no disponible. ¿Confirmas que quieres mover al huésped ahí de todas formas?`,
          textoConfirmar: 'Sí, mover de todas formas',
        });
        if (!ok) return;
      }
    }

    // (209 / H26) A partir de aquí, todo lo que antes usaba
    // nuevaHabitacionId para GUARDAR (no para decidir qué mostrar arriba)
    // usa habitacionFinalId, que ya refleja si el cambio de habitación se
    // bloqueó por cruce.
    const cambioHabitacionAplicado = habitacionFinalId !== habitacionOriginalId;

    const bloquesAcomp = Array.from(listaAcompEditar.querySelectorAll('.bloque-acompanante'));
    let acompanantesDetalle = bloquesAcomp
      .map((bloque) => ({
        nombre: bloque.querySelector('[name="acomp_nombre"]').value.trim(),
        tipo_documento: bloque.querySelector('[name="acomp_tipo_documento"]').value,
        numero_documento: bloque.querySelector('[name="acomp_numero_documento"]').value.trim() || null,
        nacionalidad: bloque.querySelector('[name="acomp_nacionalidad"]').value.trim() || null,
        fecha_nacimiento: bloque.querySelector('[name="acomp_fecha_nacimiento"]').value || null,
        celular: bloque.querySelector('[name="acomp_celular"]').value.trim() || null,
        verificado_menor: bloque.querySelector('.check-verificacion-menor')?.checked || false,
      }))
      .filter((a) => a.nombre);
    if (acompanantesDetalle.length === 0) acompanantesDetalle = null;

    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;

    const payload = {
      nombre,
      tipo_documento: form.get('tipo_documento'),
      numero_documento: documento,
      nacionalidad: form.get('nacionalidad').trim() || null,
      fecha_nacimiento: form.get('fecha_nacimiento') || null,
      direccion: form.get('direccion').trim() || null,
      ciudad: form.get('ciudad').trim() || null,
      departamento: form.get('departamento').trim() || null,
      pais: form.get('pais').trim() || null,
      correo: form.get('correo').trim() || null,
      celular,
      empresa: form.get('empresa').trim() || null,
      placa_vehiculo: form.get('placa_vehiculo').trim() || null,
      foto_documento_url: form.get('foto_documento_url').trim() || null,
      observaciones: form.get('observaciones').trim() || null,
      acompanantes_detalle: acompanantesDetalle,
      habitacion_id: habitacionFinalId,
      tarifa_id: form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null,
      cantidad_noches: form.get('cantidad_noches') ? Number(form.get('cantidad_noches')) : 1,
      metodo_pago: form.get('metodo_pago'),
      deposito: form.get('deposito') ? Number(form.get('deposito')) : null,
    };

    const { error: errUpdate } = await supabase.from('recepcion_checkins').update(payload).eq('id', checkin.id);
    if (errUpdate) {
      mostrarToast(`Error guardando cambios: ${errUpdate.message}`, 'error');
      return;
    }

    // --- Mantener sincronizada la reserva vinculada (huésped + habitación
    // + fecha de salida si la cantidad de noches cambió, ver nota de
    // cabecera "adicionar días a la estadía") ---
    if (checkin.reserva_id) {
      const nuevaCantidadNoches = payload.cantidad_noches;
      const payloadReservaSync = {
        huesped_nombre: nombre,
        huesped_documento: documento,
        huesped_telefono: celular,
        habitacion_id: habitacionFinalId,
      };

      const { data: reservaVinculadaActual } = await supabase
        .from('reservas')
        .select('fecha_checkin')
        .eq('id', checkin.reserva_id)
        .maybeSingle();

      if (reservaVinculadaActual?.fecha_checkin) {
        const nuevaFechaCheckoutISO = toISODate(addDays(reservaVinculadaActual.fecha_checkin, nuevaCantidadNoches > 0 ? nuevaCantidadNoches : 1));
        const { data: crucesEdicion } = await supabase
          .from('reservas')
          .select('id, huesped_nombre, fecha_checkin, fecha_checkout')
          .eq('habitacion_id', habitacionFinalId)
          .in('estado', ESTADOS_RESERVA_ACTIVOS)
          .neq('id', checkin.reserva_id)
          .lt('fecha_checkin', nuevaFechaCheckoutISO)
          .gt('fecha_checkout', reservaVinculadaActual.fecha_checkin);

        if (!crucesEdicion || crucesEdicion.length === 0) {
          payloadReservaSync.fecha_checkout = nuevaFechaCheckoutISO;
          // (181) Solo se toca monto_total si de verdad se pudo extender la
          // fecha — si hubo cruce y la estadía se queda como estaba, el
          // monto confirmado tampoco aplica.
          if (montoTotalActualizadoEditar != null) {
            payloadReservaSync.monto_total = montoTotalActualizadoEditar;
          }
        } else {
          mostrarToast(
            `No se pudo extender la estadía hasta ${nuevaFechaCheckoutISO}: la habitación ya tiene otra reserva (${crucesEdicion[0].huesped_nombre}) que se cruza. Se guardó el resto de los cambios igual.`,
            'error'
          );
        }
      }

      const { error: errReserva } = await supabase.from('reservas').update(payloadReservaSync).eq('id', checkin.reserva_id);
      if (errReserva) {
        // (213 / H28) Si el error es 23P01, es el EXCLUDE constraint de
        // la base de datos atrapando una carrera real — ver comentario
        // de mensajeErrorReserva.
        mostrarToast(`Check-in actualizado, pero no se pudo sincronizar la reserva vinculada: ${mensajeErrorReserva(errReserva)}`, 'error');
      }
    }

    // --- Cambio de habitación: liberar la anterior, ocupar la nueva ---
    // (209 / H26) cambioHabitacionAplicado, no habitacionCambio: si el
    // cambio se bloqueó arriba por cruce de reservas, no se toca el
    // estado físico de ninguna habitación.
    if (cambioHabitacionAplicado) {
      await supabase.rpc('cambiar_estado_habitacion', { p_habitacion_id: habitacionOriginalId, p_estado: 'limpieza' });
      await supabase.rpc('cambiar_estado_habitacion', { p_habitacion_id: habitacionFinalId, p_estado: 'ocupada' });
    }

    // --- Ficha de huésped (histórico), igual que en el check-in nuevo ---
    const { error: errHuesped } = await supabase.from('huespedes').upsert(
      {
        numero_documento: documento,
        tipo_documento: form.get('tipo_documento'),
        nombre,
        telefono: celular,
        correo: form.get('correo').trim() || null,
        empresa: form.get('empresa').trim() || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (errHuesped) {
      mostrarToast(`Cambios guardados, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
    }

    await alimentarHuespedesConAcompanantes(acompanantesDetalle);

    mostrarToast('Check-in actualizado.', 'exito');
    overlay.remove();
    await vistaLista(container);
  });
}

function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// (213 / auditoría H28) Desde que existe el EXCLUDE constraint
// "reservas_no_cruce_habitacion" en la base de datos (ver sql/212), un
// error de carrera real (dos guardados casi al mismo tiempo que
// terminan cruzando fechas en la misma habitación) llega como código
// Postgres 23P01 — con un mensaje técnico feo ("conflicting key value
// violates exclusion constraint..."). Se traduce a un aviso legible;
// cualquier otro código de error se muestra tal cual.
function mensajeErrorReserva(error) {
  if (error?.code === '23P01') {
    return 'esa habitación ya tiene otra reserva que se cruza en esas fechas (lo detectó la base de datos justo al guardar — probablemente alguien más la ocupó en el mismo instante). Refresca y elige otra habitación o fecha.';
  }
  return error?.message || 'error desconocido';
}

// (213 / auditoría H29) calcularEdad se movió a dates.js — reintroducía
// aquí el mismo bug de zona horaria que dates.js ya había corregido en
// otras funciones. Ver el comentario junto a su definición allá.

// Muestra/oculta la alerta de menor de edad de un bloque de acompañante
// según su fecha de nacimiento, cada vez que esta cambia.
function wireAlertaMenorAcompanante(bloque) {
  const inputFecha = bloque.querySelector('.input-fecha-nacimiento-acomp');
  const alerta = bloque.querySelector('.alerta-menor-acompanante');
  if (!inputFecha || !alerta) return;

  function actualizar() {
    const edad = calcularEdad(inputFecha.value);
    alerta.classList.toggle('oculto', !(edad !== null && edad < 18));
  }

  inputFecha.addEventListener('change', actualizar);
  actualizar();
}

function filaAcompanante(indice) {
  return `
    <div class="bloque-acompanante tarjeta" style="margin-bottom:0.75rem;">
      <div class="acciones-tarjeta" style="justify-content:space-between; margin-bottom:0.5rem;">
        <strong style="font-size:0.85rem;">Acompañante ${indice}</strong>
        <button type="button" class="btn btn-secundario btn-chico btn-quitar-acompanante">Quitar</button>
      </div>
      <div class="form-grid">
        <label>Nombre completo
          <input type="text" name="acomp_nombre" required />
        </label>
        <label>Tipo de documento
          <select name="acomp_tipo_documento">
            ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </label>
        <label>Número de documento
          <input type="text" name="acomp_numero_documento" />
        </label>
        <label>Nacionalidad
          <input type="text" name="acomp_nacionalidad" />
        </label>
        <label>Fecha de nacimiento
          <input type="date" name="acomp_fecha_nacimiento" class="input-fecha-nacimiento-acomp" />
        </label>
        <label>Celular
          <input type="text" name="acomp_celular" />
        </label>
      </div>
      <div class="alerta-menor-acompanante oculto" style="margin-top:0.6rem; background:var(--color-alerta-fondo, #fff8e1); border:1px solid #e8c547; border-radius:8px; padding:0.65rem 0.85rem;">
        <p style="margin:0; font-size:0.82rem; color:#8a6d00; font-weight:600;">⚠️ Este acompañante es menor de edad.</p>
        <p style="margin:0.3rem 0 0; font-size:0.8rem; color:#8a6d00;">Solicita el registro civil de nacimiento para verificar que el adulto responsable es su padre/madre, o la autorización notarial correspondiente si viaja con otra persona.</p>
        <label style="display:flex; align-items:center; gap:0.4rem; margin-top:0.5rem; font-size:0.82rem; color:#8a6d00;">
          <input type="checkbox" class="check-verificacion-menor" style="width:auto;" />
          Verifiqué el documento (registro civil / autorización notarial)
        </label>
      </div>
    </div>
  `;
}

// --- Helpers del resumen visual de liquidación (tarjeta Estadía) ---
function filaResumen(label, valor, opts = {}) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.45rem 0.1rem; border-bottom:1px dashed var(--color-borde, #ddd);">
      <span style="font-size:0.82rem; color:var(--color-texto-suave, #666);">${label}</span>
      <span style="font-weight:${opts.negrita ? 700 : 500}; font-size:${opts.grande ? '1.05rem' : '0.92rem'};">${escaparHTML(String(valor))}</span>
    </div>
  `;
}

function cajonMonto(label, montoTexto, color, fondo, borde) {
  return `
    <div style="background:${fondo}; border:1.5px solid ${borde}; border-radius:10px; padding:0.7rem 1rem; margin-top:0.6rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
      <span style="font-weight:700; color:${color}; font-size:0.85rem;">${label}</span>
      <span style="font-weight:800; font-size:1.3rem; color:${color};">${montoTexto}</span>
    </div>
  `;
}

// --- Autocompletar datos de un huésped que ya existe en el sistema ---
// Busca primero en su check-in más reciente (recepcion_checkins, tiene el
// set completo de campos) y si no aparece, en la ficha básica de
// huespedes (solo contacto). Devuelve null si no encuentra nada.
async function buscarHuespedPorDocumento(documento) {
  if (!documento) return null;

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .eq('numero_documento', documento)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase.from('huespedes').select('*').eq('numero_documento', documento).maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

async function buscarHuespedPorNombre(nombre) {
  if (!nombre || nombre.trim().length < 3) return null;
  const valor = nombre.trim();

  const { data: checkinPrevio } = await supabase
    .from('recepcion_checkins')
    .select('*')
    .ilike('nombre', valor)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (checkinPrevio) return { origen: 'checkin', datos: checkinPrevio };

  const { data: huesped } = await supabase
    .from('huespedes')
    .select('*')
    .ilike('nombre', valor)
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (huesped) return { origen: 'huesped', datos: huesped };

  return null;
}

// Da de alta (o actualiza) en el listado general de huespedes a cada
// acompañante que traiga número de documento — sin documento no hay con
// qué identificarlo ahí, así que esos quedan solo dentro del check-in.
async function alimentarHuespedesConAcompanantes(acompanantesDetalle) {
  if (!Array.isArray(acompanantesDetalle) || acompanantesDetalle.length === 0) return;

  for (const acomp of acompanantesDetalle) {
    if (!acomp.numero_documento) continue;
    const { error } = await supabase.from('huespedes').upsert(
      {
        numero_documento: acomp.numero_documento,
        tipo_documento: acomp.tipo_documento || null,
        nombre: acomp.nombre,
        telefono: acomp.celular || null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'numero_documento' }
    );
    if (error) {
      mostrarToast(`No se pudo agregar a ${acomp.nombre} al listado de huéspedes: ${error.message}`, 'error');
    }
  }
}

// --- "Ver disponibilidad": mini calendario (10 días) para elegir
// habitación desde dentro del check-in, sin salir a la pestaña Reservas. ---
async function abrirModalDisponibilidad(selectHabitacion) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyISO = toISODate(hoy);
  const fechas = Array.from({ length: DIAS_VISIBLES_DISPONIBILIDAD }, (_, i) => addDays(hoy, i));
  const rangoFinISO = toISODate(addDays(hoy, DIAS_VISIBLES_DISPONIBILIDAD));

  const [{ data: habitaciones, error: errHab }, { data: reservas, error: errRes }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('reservas').select('*').lte('fecha_checkin', rangoFinISO).gt('fecha_checkout', hoyISO),
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  if (errHab || errRes) {
    overlay.innerHTML = `
      <div class="modal-caja modal-caja-ancha">
        <h3>Disponibilidad de habitaciones</h3>
        <p class="mensaje-vacio">Error cargando disponibilidad: ${(errHab || errRes).message}</p>
        <div class="modal-acciones"><button type="button" class="btn btn-secundario" id="btn-cerrar-disponibilidad">Cerrar</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-cerrar-disponibilidad').addEventListener('click', () => overlay.remove());
    return;
  }

  const encabezados = fechas
    .map((f) => {
      const iso = toISODate(f);
      const esHoy = iso === hoyISO;
      const label = f.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' });
      return `<th class="${esHoy ? 'celda-columna-hoy' : ''}">${label}${esHoy ? ' (hoy)' : ''}</th>`;
    })
    .join('');

  const filas = (habitaciones || [])
    .map((h) => {
      const bloqueoIndefinido = ESTADOS_BLOQUEO_INDEFINIDO.includes(h.estado);
      const bloqueoHoy = ESTADOS_BLOQUEO_HOY.includes(h.estado);
      const celdas = fechas
        .map((f) => {
          const iso = toISODate(f);
          const esHoy = iso === hoyISO;
          const reserva = (reservas || []).find(
            (r) => r.habitacion_id === h.id && iso >= r.fecha_checkin && iso < r.fecha_checkout
          );
          if (reserva) {
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-reserva-ocupada" title="${escaparHTML(reserva.huesped_nombre)}">${escaparHTML(reserva.huesped_nombre)}</div></td>`;
          }
          if (bloqueoIndefinido || (esHoy && bloqueoHoy)) {
            return `<td class="${esHoy ? 'celda-columna-hoy' : ''}"><div class="celda-habitacion-bloqueada ${h.estado}" title="Habitación en estado: ${h.estado}">${ETIQUETA_ESTADO_HABITACION[h.estado]}</div></td>`;
          }
          // Disponible: solo la columna de HOY es clicable para elegir
          // habitación (el check-in es para hoy); las demás columnas son
          // solo informativas, para ver si se queda libre toda la estadía.
          if (esHoy) {
            return `<td class="celda-columna-hoy"><div class="celda-reserva-vacia btn-elegir-habitacion" data-habitacion-id="${h.id}" title="Elegir esta habitación">✅ Libre</div></td>`;
          }
          return `<td><div class="celda-reserva-vacia" style="cursor:default;">Libre</div></td>`;
        })
        .join('');
      return `<tr><td class="celda-habitacion">${h.numero} — ${h.nombre}</td>${celdas}</tr>`;
    })
    .join('');

  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>Disponibilidad de habitaciones</h3>
      <p class="mensaje-vacio">Clic en "✅ Libre" de la columna de hoy para elegir esa habitación. Las columnas futuras son solo para ver si se mantiene libre durante la estadía.</p>
      <div class="tabla-scroll" style="max-height:60vh;">
        <table class="tabla-calendario-reservas">
          <thead><tr><th>Habitación</th>${encabezados}</tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="modal-acciones" style="margin-top:1rem;">
        <button type="button" class="btn btn-secundario" id="btn-cerrar-disponibilidad">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-cerrar-disponibilidad').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll('.btn-elegir-habitacion').forEach((el) => {
    el.addEventListener('click', () => {
      selectHabitacion.value = el.dataset.habitacionId;
      overlay.remove();
      mostrarToast('Habitación seleccionada.', 'exito');
    });
  });
}

// --- Tarjeta de confirmación final del check-in (mismo patrón que la
// liquidación del check-out): resume TODO antes de guardar de verdad —
// cuánto vale la estadía, cuánto se abonó antes, qué se cobra ahora, con
// qué método, y cuánto queda pendiente para el check-out. Solo el botón
// "Confirmar y registrar check-in" escribe en la base de datos; "Volver a
// editar" simplemente cierra la tarjeta y deja el formulario intacto. ---
function abrirModalConfirmarCheckin(datos) {
  const info = ETIQUETA_ESTADO_PAGO[datos.estadoPagoCheckin] || ETIQUETA_ESTADO_PAGO.pendiente;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-caja modal-caja-ancha">
      <h3>🧾 Confirmar check-in — ${escaparHTML(datos.huespedNombre)}</h3>
      <div class="modal-contenido">
        <p class="mensaje-vacio" style="margin-top:-0.5rem;">Revisa la liquidación antes de guardar — este es el único paso que registra el check-in de verdad.</p>
        ${filaResumen('Habitación', datos.habitacionTexto, { negrita: true })}
        ${filaResumen('Tarifa', datos.tarifaCodigo, {})}
        ${filaResumen('Noches', datos.cantidadNoches || '—', {})}
        ${cajonMonto('Monto estimado de la estadía', formatCOP(datos.montoEstimado), '#0b5fae', '#eaf3ff', '#8ec1f5')}
        ${
          datos.montoTotalConfirmadoVinculada != null
            ? cajonMonto('Nuevo monto total confirmado (cambiaron las noches)', formatCOP(datos.montoTotalConfirmadoVinculada), '#6a3fb5', '#f3edfb', '#c6acec')
            : ''
        }
        ${datos.abonoPrevioActual > 0 ? cajonMonto('Ya abonado antes (reserva / check-in previo)', formatCOP(datos.abonoPrevioActual), '#6a3fb5', '#f3edfb', '#c6acec') : ''}

        <div style="margin-top:1rem; padding:0.9rem 1rem; border-radius:10px; background:${info.fondo}; border:1.5px solid ${info.borde};">
          <p style="margin:0; font-weight:700; color:${info.color};">${info.titulo}</p>
          <p style="margin:0.35rem 0 0; font-size:0.85rem; color:${info.color};">${info.detalle}</p>
        </div>

        ${datos.estadoPagoCheckin !== 'pendiente' ? cajonMonto('Se cobra ahora', formatCOP(datos.montoPagoCheckin), 'var(--color-verde-oscuro, #1b7a3d)', '#eafbea', '#8fd3a4') : ''}
        ${datos.estadoPagoCheckin !== 'pendiente' ? filaResumen('Método de pago', datos.metodoPago, {}) : ''}
        ${cajonMonto(
          'Saldo que queda pendiente para el check-out',
          formatCOP(datos.saldoDespues),
          datos.saldoDespues > 0 ? 'var(--color-rojo-oscuro, #b3261e)' : 'var(--color-verde-oscuro, #1b7a3d)',
          datos.saldoDespues > 0 ? '#fdeceb' : '#eafbea',
          datos.saldoDespues > 0 ? '#f0a8a0' : '#8fd3a4'
        )}
        <p class="mensaje-vacio" style="margin-top:0.75rem; font-size:0.78rem;">Este saldo no incluye lo que el huésped consuma de minibar durante la estadía — eso se suma aparte y se liquida en el check-out.</p>
      </div>
      <div class="modal-acciones">
        <button type="button" class="btn btn-secundario" id="btn-volver-editar-checkin">Volver a editar</button>
        <button type="button" class="btn btn-primario" id="btn-confirmar-registro-checkin">Confirmar y registrar check-in</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-volver-editar-checkin').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#btn-confirmar-registro-checkin').addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-confirmar-registro-checkin');
    btn.disabled = true;
    btn.textContent = 'Registrando…';
    await datos.onConfirmar();
    overlay.remove();
  });
}

// Ejecuta de verdad el registro del check-in (todos los inserts/updates) —
// solo se llama desde el botón "Confirmar y registrar check-in" de la
// tarjeta de confirmación de arriba, nunca directo desde el submit del
// formulario.
async function ejecutarRegistroCheckin(p) {
  const {
    container,
    form,
    habitacionId,
    hoyISO,
    reservaIdSeleccionada,
    tarifaId,
    cantidadNoches,
    nombre,
    documento,
    celular,
    estadoPagoCheckin,
    montoPagoCheckin,
    montoEstimado,
    montoTotalConfirmadoVinculada,
    acompanantesDetalle,
    hayFirma,
    canvas,
  } = p;

  // --- Vincular o crear la reserva asociada ---
  let reservaIdFinal = null;

  if (reservaIdSeleccionada) {
    reservaIdFinal = Number(reservaIdSeleccionada);

    // Si el check-in trae más (o menos) noches que las que tenía la
    // reserva original, actualizamos también fecha_checkout — esto es lo
    // que permite "adicionar días a la estadía" con solo cambiar el campo
    // Cantidad de noches de arriba: el check-in cuenta desde hoy, así que
    // la nueva salida es hoy + esas noches. Antes de guardar, se verifica
    // que ninguna OTRA reserva activa de esa misma habitación se cruce
    // con la fecha nueva — si hay cruce, se avisa y no se extiende la
    // fecha (el resto del check-in sigue igual).
    const nuevaFechaCheckoutISO = toISODate(addDays(hoyISO, cantidadNoches > 0 ? cantidadNoches : 1));
    const { data: cruces } = await supabase
      .from('reservas')
      .select('id, huesped_nombre, fecha_checkin, fecha_checkout')
      .eq('habitacion_id', habitacionId)
      .in('estado', ESTADOS_RESERVA_ACTIVOS)
      .neq('id', reservaIdFinal)
      .lt('fecha_checkin', nuevaFechaCheckoutISO)
      .gt('fecha_checkout', hoyISO);

    const payloadReservaVinculada = { estado: 'hospedado' };
    if (!cruces || cruces.length === 0) {
      payloadReservaVinculada.fecha_checkout = nuevaFechaCheckoutISO;
      // (181) El monto solo se toca si de verdad se pudo extender la
      // fecha, y solo con lo que la recepcionista confirmó a mano en el
      // formulario (nunca con montoEstimado en silencio — puede haber
      // descuento).
      if (montoTotalConfirmadoVinculada != null) {
        payloadReservaVinculada.monto_total = montoTotalConfirmadoVinculada;
      }
    } else {
      mostrarToast(
        `No se pudo extender la estadía hasta ${nuevaFechaCheckoutISO}: la habitación ya tiene otra reserva (${cruces[0].huesped_nombre}) que se cruza. El check-in continúa con la fecha original de la reserva.`,
        'error'
      );
    }

    const { error: errReservaUpd } = await supabase.from('reservas').update(payloadReservaVinculada).eq('id', reservaIdFinal);
    if (errReservaUpd) {
      // (213 / H28) Ver mensajeErrorReserva — 23P01 = EXCLUDE constraint.
      mostrarToast(`No se pudo actualizar la reserva vinculada: ${mensajeErrorReserva(errReservaUpd)}`, 'error');
    }
  } else {
    const { data: nuevaReserva, error: errReservaNueva } = await supabase
      .from('reservas')
      .insert({
        habitacion_id: habitacionId,
        huesped_nombre: nombre,
        huesped_telefono: celular,
        huesped_documento: documento,
        fecha_checkin: hoyISO,
        fecha_checkout: toISODate(addDays(hoyISO, cantidadNoches > 0 ? cantidadNoches : 1)),
        estado: 'hospedado',
        tarifa_id: tarifaId,
        // (171) Antes este insert NO traía monto_total — quedaba en null,
        // así que cuentas.js calculaba montoHabitacion = 0 para CUALQUIER
        // walk-in, sin importar que sí se le hubiera cobrado la habitación
        // (el pago se guarda bien en reservas_pagos, pero no había contra
        // qué restarlo). Cualquier pago de la habitación aparecía entonces
        // como "excedente" de punta a punta, aunque nadie pagó de más. Se
        // arregla guardando aquí el mismo monto que ya se le muestra a la
        // recepcionista como "Monto estimado estadía" (noches × tarifa) —
        // null si no hay tarifa elegida, igual que antes en ese caso.
        monto_total: montoEstimado > 0 ? montoEstimado : null,
        comentarios: 'Creada automáticamente desde Recepción (walk-in).',
      })
      .select('id')
      .single();

    if (errReservaNueva) {
      // (213 / H28) Ver mensajeErrorReserva — 23P01 = EXCLUDE constraint
      // (dos walk-in casi al mismo tiempo eligiendo la misma habitación).
      mostrarToast(`Check-in continuará, pero no se pudo crear la reserva asociada: ${mensajeErrorReserva(errReservaNueva)}`, 'error');
    } else {
      reservaIdFinal = nuevaReserva.id;
    }
  }

  // --- Pago al check-in: si hay monto, se inserta en reservas_pagos
  // (misma tabla que lee Caja automático) — no hay campo suelto. ---
  if ((estadoPagoCheckin === 'parcial' || estadoPagoCheckin === 'anticipado') && montoPagoCheckin > 0) {
    if (!reservaIdFinal) {
      mostrarToast('No hay una reserva vinculada; no se pudo registrar el pago en Caja.', 'error');
    } else {
      const { error: errPagoInicial } = await supabase.from('reservas_pagos').insert({
        reserva_id: reservaIdFinal,
        monto: montoPagoCheckin,
        metodo_pago: form.get('metodo_pago'),
        comentarios: estadoPagoCheckin === 'anticipado' ? 'Pago anticipado registrado en el check-in.' : 'Abono parcial registrado en el check-in.',
      });
      if (errPagoInicial) {
        mostrarToast(`Check-in continuará, pero no se pudo registrar el pago en Caja: ${errPagoInicial.message}`, 'error');
      }
    }
  }

  // --- Ficha de huésped (histórico) ---
  // Guarda o actualiza los datos de contacto en `huespedes` (por
  // numero_documento) sin pisar preferencias/alergias/observaciones si ya
  // existían — eso se edita solo desde el módulo Huéspedes.
  const { error: errHuesped } = await supabase.from('huespedes').upsert(
    {
      numero_documento: documento,
      tipo_documento: form.get('tipo_documento'),
      nombre,
      telefono: celular,
      correo: form.get('correo').trim() || null,
      empresa: form.get('empresa').trim() || null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'numero_documento' }
  );
  if (errHuesped) {
    mostrarToast(`Check-in guardado, pero no se pudo actualizar la ficha del huésped: ${errHuesped.message}`, 'error');
  }

  // --- Acompañantes con documento también quedan en el listado general
  // de huespedes, igual que el huésped principal. ---
  await alimentarHuespedesConAcompanantes(acompanantesDetalle);

  const payload = {
    reserva_id: reservaIdFinal,
    habitacion_id: habitacionId,
    nombre,
    tipo_documento: form.get('tipo_documento'),
    numero_documento: documento,
    nacionalidad: form.get('nacionalidad').trim() || null,
    fecha_nacimiento: form.get('fecha_nacimiento') || null,
    direccion: form.get('direccion').trim() || null,
    ciudad: form.get('ciudad').trim() || null,
    departamento: form.get('departamento').trim() || null,
    pais: form.get('pais').trim() || null,
    correo: form.get('correo').trim() || null,
    celular,
    empresa: form.get('empresa').trim() || null,
    placa_vehiculo: form.get('placa_vehiculo').trim() || null,
    acompanantes_detalle: acompanantesDetalle,
    foto_documento_url: form.get('foto_documento_url').trim() || null,
    firma_digital: hayFirma ? canvas.toDataURL('image/png') : null,
    consentimiento_habeas_data: true,
    observaciones: form.get('observaciones').trim() || null,
    tarifa_id: tarifaId,
    cantidad_noches: cantidadNoches,
    metodo_pago: form.get('metodo_pago'),
    deposito: form.get('deposito') ? Number(form.get('deposito')) : null,
  };

  const { error: errInsert } = await supabase.from('recepcion_checkins').insert(payload);
  if (errInsert) {
    mostrarToast(`Error registrando check-in: ${errInsert.message}`, 'error');
    return;
  }

  const { error: errEstado } = await supabase.rpc('cambiar_estado_habitacion', {
    p_habitacion_id: habitacionId,
    p_estado: 'ocupada',
  });
  if (errEstado) {
    mostrarToast(`Check-in guardado, pero no se pudo marcar la habitación como ocupada: ${errEstado.message}`, 'error');
  }

  mostrarToast('Check-in registrado.', 'exito');
  await vistaLista(container);
}

async function vistaFormulario(container, reservaIdPreseleccionada) {
  const [{ data: habitaciones }, { data: tarifas }, { data: reservas }] = await Promise.all([
    supabase.from('habitaciones').select('id, numero, nombre, estado').order('numero'),
    supabase.from('tarifas').select('*').order('codigo'),
    supabase
      .from('reservas')
      .select('id, habitacion_id, huesped_nombre, huesped_telefono, huesped_documento, fecha_checkin, fecha_checkout, tarifa_id, estado')
      .in('estado', ['reservada', 'confirmada'])
      .order('fecha_checkin'),
  ]);

  container.innerHTML = `
    <h2>Nuevo Check-in</h2>
    <form id="form-checkin">
      <div class="tarjeta">
        <h3>Vincular a una reserva (opcional)</h3>
        <div class="form-grid">
          <label>Reserva
            <select id="select-reserva">
              <option value="">— Walk-in / sin reserva —</option>
              ${(reservas || [])
                .map((r) => `<option value="${r.id}">${escaparHTML(r.huesped_nombre)} — ${r.fecha_checkin} a ${r.fecha_checkout}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <p class="mensaje-vacio" id="hint-reserva-vinculada" style="margin-top:0.5rem; font-size:0.78rem;">Si el documento que escribas abajo coincide con una sola reserva pendiente, se vincula aquí solo.</p>
      </div>

      <div class="tarjeta">
        <h3>Datos del huésped</h3>
        <p class="mensaje-vacio" style="margin-bottom:0.75rem;">Si ya se hospedó antes, escribe su número de documento (o su nombre) y sale del campo — te autocompletamos lo que ya tenemos de él.</p>
        <div class="form-grid">
          <label>Nombre completo
            <input type="text" name="nombre" required />
          </label>
          <label>Tipo de documento
            <select name="tipo_documento">
              ${TIPOS_DOCUMENTO.map((t) => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </label>
          <label>Número de documento
            <input type="text" name="numero_documento" required />
          </label>
          <label>Nacionalidad
            <input type="text" name="nacionalidad" />
          </label>
          <label>Fecha de nacimiento
            <input type="date" name="fecha_nacimiento" />
          </label>
          <label>Dirección
            <input type="text" name="direccion" />
          </label>
          <label>Ciudad
            <input type="text" name="ciudad" />
          </label>
          <label>Departamento
            <input type="text" name="departamento" />
          </label>
          <label>País
            <input type="text" name="pais" value="Colombia" />
          </label>
          <label>Correo
            <input type="email" name="correo" />
          </label>
          <label>Celular
            <input type="text" name="celular" />
          </label>
          <label>Empresa
            <input type="text" name="empresa" />
          </label>
          <label>Placa del vehículo
            <input type="text" name="placa_vehiculo" />
          </label>
          <label>Foto del documento (URL, opcional)
            <input type="url" name="foto_documento_url" placeholder="https://..." />
          </label>
        </div>

        <label style="display:flex; align-items:center; gap:0.5rem; margin-top:1.25rem; font-size:0.9rem;">
          <input type="checkbox" id="check-tiene-acompanante" style="width:auto;" />
          ¿Trae acompañante(s)?
        </label>
        <div id="acompanantes-wrap" class="oculto" style="margin-top:0.75rem;">
          <p class="mensaje-vacio" style="margin-bottom:0.5rem;">Se piden los mismos datos del huésped principal para cada acompañante. Si trae número de documento, también queda en el listado general de huéspedes.</p>
          <div id="acompanantes-lista"></div>
          <button type="button" id="btn-agregar-acompanante" class="btn btn-secundario btn-chico">+ Agregar otro acompañante</button>
        </div>

        <label style="display:flex; flex-direction:column; gap:0.3rem; margin-top:1.25rem; font-size:0.78rem; text-transform:uppercase; color:var(--color-texto-suave);">
          Observaciones
          <textarea name="observaciones" rows="2" style="padding:0.6rem; border:1px solid var(--color-borde); border-radius:6px; font-family:inherit;"></textarea>
        </label>
      </div>

      <div class="tarjeta">
        <h3>Estadía</h3>
        <div class="form-grid">
          <label>Habitación
            <select name="habitacion_id" id="select-habitacion" required>
              <option value="">—</option>
              ${(habitaciones || [])
                .map((h) => {
                  const bloqueada = h.estado !== 'disponible';
                  return `<option value="${h.id}" ${bloqueada ? 'disabled' : ''}>${h.numero} — ${h.nombre}${bloqueada ? ` (${ETIQUETA_ESTADO_HABITACION[h.estado] || h.estado})` : ''}</option>`;
                })
                .join('')}
            </select>
          </label>
          <p class="mensaje-vacio" style="grid-column:1 / -1; font-size:0.78rem; margin:0.2rem 0 0;">Solo se pueden elegir habitaciones que figuren "disponible" ahora mismo. Usa "Ver disponibilidad" si necesitas ver otra opción, o corrige el estado desde Housekeeping.</p>
          <label>Tarifa
            <select name="tarifa_id" id="select-tarifa" required>
              <option value="">—</option>
              ${(tarifas || []).map((t) => `<option value="${t.id}">${t.codigo} / ${formatCOP(t.tipo === 'por_dias' ? t.valor_convenido : t.precio_temporada_baja)}</option>`).join('')}
            </select>
          </label>
          <label>Cantidad de noches
            <input type="number" name="cantidad_noches" id="input-noches" min="1" value="1" required />
          </label>
          <label>Método de pago
            <select name="metodo_pago" id="select-metodo-pago-estadia" required>
              <option value="">— Elige a qué cuenta va —</option>
              ${METODOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </label>
          <label>Depósito de garantía (opcional)
            <input type="number" name="deposito" step="1000" />
          </label>
        </div>
        <p class="mensaje-vacio" style="margin-top:0.4rem; font-size:0.78rem;">💡 Si el huésped ya tenía su reserva hecha y decide quedarse más días, solo aumenta "Cantidad de noches" — la reserva vinculada se extiende sola (contando desde hoy), siempre que la habitación siga libre esos días.</p>

        <!-- (Nota 181) Igual que en "Editar check-in": si las noches cambian
        frente a lo que ya tenía la reserva vinculada, la fecha de salida se
        extiende sola pero el monto NO se recalcula solo — se exige
        confirmarlo/ajustarlo a mano (por descuentos, por ejemplo). Oculto
        para walk-ins sin reserva y mientras las noches no cambian. -->
        <div id="wrap-monto-extendido-checkin" class="oculto" style="margin-top:0.6rem; background:var(--color-fondo-suave, #f8f9fb); border:1px solid var(--color-borde, #ddd); border-radius:8px; padding:0.75rem 0.9rem;">
          <label>Nuevo monto total de la estadía (cambiaron las noches)
            <input type="text" id="input-monto-extendido-checkin" placeholder="$0" />
          </label>
          <p class="mensaje-vacio" style="font-size:0.78rem; margin-top:0.3rem;">Sugerido con la tarifa actual: <strong id="monto-sugerido-extendido-checkin">$0</strong> — confírmalo o ajústalo a mano antes de continuar. Es el monto total de toda la reserva, no solo las noches nuevas.</p>
        </div>

        <div class="acciones-tarjeta" style="justify-content:flex-start; margin-top:0.5rem;">
          <button type="button" id="btn-ver-disponibilidad" class="btn btn-secundario btn-chico">📅 Ver disponibilidad</button>
        </div>

        <div class="tarjeta" style="margin-top:0.75rem; background:var(--color-fondo-suave, #f8f9fb);">
          <h3 style="margin-top:0;">💳 ¿El huésped paga la estadía ahora?</h3>
          <p class="mensaje-vacio" style="margin-top:-0.3rem; margin-bottom:0.75rem;">Es obligatorio elegir una opción para poder registrar el check-in — no queda ninguna marcada por defecto.</p>
          <div id="opciones-pago-checkin" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:0.75rem;">
            <label class="opcion-pago-checkin" data-valor="pendiente" style="display:flex; flex-direction:column; gap:0.35rem; padding:0.9rem 1rem; border:2px solid var(--color-borde); border-radius:10px; cursor:pointer;">
              <span style="display:flex; align-items:center; gap:0.5rem; font-weight:700;"><input type="radio" name="estado_pago_checkin" value="pendiente" required style="width:auto;" /> 🕒 Pendiente</span>
              <span style="font-size:0.8rem; color:var(--color-texto-suave);">No paga nada ahora — todo queda para el check-out.</span>
            </label>
            <label class="opcion-pago-checkin" data-valor="parcial" style="display:flex; flex-direction:column; gap:0.35rem; padding:0.9rem 1rem; border:2px solid var(--color-borde); border-radius:10px; cursor:pointer;">
              <span style="display:flex; align-items:center; gap:0.5rem; font-weight:700;"><input type="radio" name="estado_pago_checkin" value="parcial" required style="width:auto;" /> 🔷 Abono parcial</span>
              <span style="font-size:0.8rem; color:var(--color-texto-suave);">Paga una parte ahora, el resto queda para el check-out.</span>
            </label>
            <label class="opcion-pago-checkin" data-valor="anticipado" style="display:flex; flex-direction:column; gap:0.35rem; padding:0.9rem 1rem; border:2px solid var(--color-borde); border-radius:10px; cursor:pointer;">
              <span style="display:flex; align-items:center; gap:0.5rem; font-weight:700;"><input type="radio" name="estado_pago_checkin" value="anticipado" required style="width:auto;" /> ✅ Pago total (anticipado)</span>
              <span style="font-size:0.8rem; color:var(--color-texto-suave);">Paga el valor completo ahora — la habitación queda saldada.</span>
            </label>
          </div>
          <label id="wrap-monto-pago-checkin" class="oculto" style="margin-top:0.85rem; display:block;">Monto a cobrar ahora
            <input type="text" name="monto_pago_checkin" id="input-monto-pago" placeholder="$0" />
          </label>
        </div>

        <div id="resumen-liquidacion-wrap" style="margin-top:1.25rem;"></div>
      </div>

      <div class="tarjeta">
        <h3>Firma digital</h3>
        <canvas id="canvas-firma" width="500" height="150" style="border:1px solid var(--color-borde); border-radius:6px; width:100%; max-width:500px; touch-action:none; cursor:crosshair;"></canvas>
        <div class="acciones-tarjeta">
          <button type="button" id="btn-limpiar-firma" class="btn btn-secundario btn-chico">Limpiar firma</button>
        </div>
        <label style="display:flex; align-items:center; gap:0.5rem; margin-top:0.75rem; font-size:0.9rem;">
          <input type="checkbox" name="consentimiento_habeas_data" id="check-habeas" required style="width:auto;" />
          El huésped autoriza el tratamiento de sus datos personales conforme a la Ley 1581 de 2012 (Habeas Data).
        </label>
      </div>

      <div class="modal-acciones" style="margin-top:1rem;">
        <button type="button" id="btn-cancelar-checkin" class="btn btn-secundario">Cancelar</button>
        <button type="submit" class="btn btn-primario">Revisar y registrar Check-in</button>
      </div>
    </form>
  `;

  // --- Firma digital (canvas) ---
  const canvas = container.querySelector('#canvas-firma');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';
  let dibujando = false;

  function posicionRelativa(evento) {
    const rect = canvas.getBoundingClientRect();
    const punto = evento.touches ? evento.touches[0] : evento;
    return {
      x: ((punto.clientX - rect.left) / rect.width) * canvas.width,
      y: ((punto.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function empezarTrazo(e) {
    dibujando = true;
    const p = posicionRelativa(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  }
  function trazar(e) {
    if (!dibujando) return;
    const p = posicionRelativa(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  }
  function terminarTrazo() {
    dibujando = false;
  }

  canvas.addEventListener('mousedown', empezarTrazo);
  canvas.addEventListener('mousemove', trazar);
  window.addEventListener('mouseup', terminarTrazo);
  canvas.addEventListener('touchstart', empezarTrazo);
  canvas.addEventListener('touchmove', trazar);
  canvas.addEventListener('touchend', terminarTrazo);

  container.querySelector('#btn-limpiar-firma').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // --- Ver disponibilidad ---
  container.querySelector('#btn-ver-disponibilidad').addEventListener('click', () => {
    abrirModalDisponibilidad(container.querySelector('#select-habitacion'));
  });

  // --- Acompañantes: toggle + bloques dinámicos con datos completos ---
  const checkAcompanante = container.querySelector('#check-tiene-acompanante');
  const wrapAcompanantes = container.querySelector('#acompanantes-wrap');
  const listaAcompanantes = container.querySelector('#acompanantes-lista');
  let contadorAcompanantes = 0;

  function agregarBloqueAcompanante() {
    contadorAcompanantes += 1;
    const envoltorio = document.createElement('div');
    envoltorio.innerHTML = filaAcompanante(contadorAcompanantes);
    const bloque = envoltorio.firstElementChild;
    bloque.querySelector('.btn-quitar-acompanante').addEventListener('click', () => bloque.remove());
    wireAlertaMenorAcompanante(bloque);
    listaAcompanantes.appendChild(bloque);
  }

  checkAcompanante.addEventListener('change', () => {
    wrapAcompanantes.classList.toggle('oculto', !checkAcompanante.checked);
    if (checkAcompanante.checked && listaAcompanantes.children.length === 0) {
      agregarBloqueAcompanante();
    }
  });

  container.querySelector('#btn-agregar-acompanante').addEventListener('click', agregarBloqueAcompanante);

  // --- Autocompletar datos si el huésped ya existe en el sistema ---
  const inputNombreHuesped = container.querySelector('input[name="nombre"]');
  const inputDocumentoHuesped = container.querySelector('input[name="numero_documento"]');

  function precargarDatosHuesped(resultado) {
    if (!resultado) return;
    const d = resultado.datos;

    const setVal = (selector, valor) => {
      const el = container.querySelector(selector);
      if (el && valor !== undefined && valor !== null && valor !== '') el.value = valor;
    };

    setVal('input[name="nombre"]', d.nombre);
    if (d.tipo_documento) setVal('select[name="tipo_documento"]', d.tipo_documento);
    setVal('input[name="numero_documento"]', d.numero_documento);
    setVal('input[name="celular"]', d.celular || d.telefono);
    setVal('input[name="correo"]', d.correo);
    setVal('input[name="empresa"]', d.empresa);

    // Estos campos solo existen en un check-in anterior (la ficha básica
    // de huespedes solo guarda datos de contacto), así que solo se
    // rellenan cuando la coincidencia viene de recepcion_checkins.
    if (resultado.origen === 'checkin') {
      setVal('input[name="nacionalidad"]', d.nacionalidad);
      setVal('input[name="fecha_nacimiento"]', d.fecha_nacimiento);
      setVal('input[name="direccion"]', d.direccion);
      setVal('input[name="ciudad"]', d.ciudad);
      setVal('input[name="departamento"]', d.departamento);
      setVal('input[name="pais"]', d.pais);
      setVal('input[name="placa_vehiculo"]', d.placa_vehiculo);
    }

    mostrarToast(`Encontramos a ${d.nombre} en el sistema — se autocompletaron sus datos.`, 'exito');
  }

  inputDocumentoHuesped.addEventListener('blur', async () => {
    const valor = inputDocumentoHuesped.value.trim();
    if (!valor) return;
    const resultado = await buscarHuespedPorDocumento(valor);
    precargarDatosHuesped(resultado);

    // Si este documento ya tiene una reserva pendiente (reservada o
    // confirmada) y todavía no se ha elegido ninguna a mano, se vincula
    // sola — esto es lo que evita que el abono ya pagado al reservar (o
    // el que se cobre aquí mismo en el check-in) se pierda al llegar al
    // check-out. Si hay más de una coincidencia, no se elige ninguna sola.
    const selectReserva = container.querySelector('#select-reserva');
    if (selectReserva && !selectReserva.value) {
      const coincidencias = (reservas || []).filter((r) => r.huesped_documento === valor);
      if (coincidencias.length === 1) {
        selectReserva.value = String(coincidencias[0].id);
        await aplicarReserva(coincidencias[0]);
        mostrarToast('Este documento ya tenía una reserva pendiente — se vinculó sola (incluye el abono que ya se haya pagado).', 'exito');
      }
    }
  });

  inputNombreHuesped.addEventListener('blur', async () => {
    if (inputDocumentoHuesped.value.trim()) return;
    const valor = inputNombreHuesped.value.trim();
    if (!valor) return;
    const resultado = await buscarHuespedPorNombre(valor);
    precargarDatosHuesped(resultado);
  });

  // --- Monto estimado de la estadía (noches × tarifa) + pago al check-in ---
  const selectTarifaEstadia = container.querySelector('#select-tarifa');
  const inputNochesEstadia = container.querySelector('#input-noches');
  const radiosEstadoPago = container.querySelectorAll('input[name="estado_pago_checkin"]');
  const wrapMontoPago = container.querySelector('#wrap-monto-pago-checkin');
  const inputMontoPago = container.querySelector('#input-monto-pago');

  // Campo de dinero con formato "$" y punto de miles en vivo.
  activarInputDinero(inputMontoPago);

  function estadoPagoActual() {
    const marcado = container.querySelector('input[name="estado_pago_checkin"]:checked');
    return marcado ? marcado.value : '';
  }

  // Suma de lo que ya se haya pagado (reservas_pagos) para la reserva
  // vinculada — de la reserva original o de un check-in anterior. Se
  // vuelve a calcular cada vez que se vincula/cambia de reserva en
  // aplicarReserva(); en 0 si es un walk-in sin reserva.
  let abonoPrevioActual = 0;

  // (Nota 181) Noches que ya tenía la reserva vinculada al elegirla — null
  // para walk-ins sin reserva. Si "Cantidad de noches" termina siendo
  // distinta a esto, se exige confirmar el nuevo monto total antes de
  // registrar el check-in (ver wrapMontoExtendidoCheckin más abajo).
  let nochesOriginalesVinculada = null;
  const wrapMontoExtendidoCheckin = container.querySelector('#wrap-monto-extendido-checkin');
  const inputMontoExtendidoCheckin = container.querySelector('#input-monto-extendido-checkin');
  const spanMontoSugeridoExtendidoCheckin = container.querySelector('#monto-sugerido-extendido-checkin');
  activarInputDinero(inputMontoExtendidoCheckin);

  function nochesCambiaronVinculada() {
    return nochesOriginalesVinculada != null && (Number(inputNochesEstadia.value) || 0) !== nochesOriginalesVinculada;
  }

  function actualizarCandadoMontoExtendidoCheckin() {
    const cambiaron = nochesCambiaronVinculada();
    wrapMontoExtendidoCheckin.classList.toggle('oculto', !cambiaron);
    inputMontoExtendidoCheckin.required = cambiaron;
    if (cambiaron) {
      spanMontoSugeridoExtendidoCheckin.textContent = formatCOP(calcularMontoEstimado());
    }
  }

  function calcularMontoEstimado() {
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifaEstadia.value));
    if (!tarifa) return 0;
    if (tarifa.tipo === 'por_dias') return Number(tarifa.valor_convenido);
    const noches = Number(inputNochesEstadia.value) || 0;
    if (noches <= 0) return 0;
    return noches * Number(tarifa.precio_temporada_baja);
  }

  // Arma la tarjeta-recibo con lo que la recepcionista lleva llenado hasta
  // ahora — se repinta completa cada vez que cambia algo relevante. Es
  // solo una vista en vivo; la tarjeta de confirmación al enviar el
  // formulario es la que resume todo de forma definitiva.
  function pintarResumenLiquidacion() {
    const wrap = container.querySelector('#resumen-liquidacion-wrap');
    if (!wrap) return;

    const habitacionSel = container.querySelector('#select-habitacion');
    const habitacionTexto = habitacionSel && habitacionSel.value ? habitacionSel.selectedOptions[0].textContent : 'Sin elegir';
    const tarifa = (tarifas || []).find((t) => t.id === Number(selectTarifaEstadia.value));
    const noches = Number(inputNochesEstadia.value) || 0;
    const montoEstimado = calcularMontoEstimado();
    const estadoPago = estadoPagoActual();
    const metodoPagoSel = container.querySelector('#select-metodo-pago-estadia');
    const metodoPago = metodoPagoSel ? metodoPagoSel.value : '—';
    const montoACobrar = estadoPago === 'parcial' || estadoPago === 'anticipado' ? valorNumericoInput(inputMontoPago) : 0;
    const saldo = Math.max(0, montoEstimado - abonoPrevioActual - montoACobrar);
    const info = ETIQUETA_ESTADO_PAGO[estadoPago] || ETIQUETA_ESTADO_PAGO.pendiente;

    wrap.innerHTML = `
      <div class="tarjeta" style="background:var(--color-fondo-suave, #f8f9fb); border:2px solid var(--color-borde, #ddd);">
        <h3 style="margin-top:0;">🧾 Resumen en vivo</h3>
        ${filaResumen('Habitación', habitacionTexto, { negrita: true })}
        ${filaResumen('Tarifa', tarifa ? tarifa.codigo : 'Sin elegir', {})}
        ${filaResumen('Cantidad de noches', noches || '—', {})}
        ${cajonMonto('Monto estimado estadía', formatCOP(montoEstimado), '#0b5fae', '#eaf3ff', '#8ec1f5')}
        ${abonoPrevioActual > 0 ? cajonMonto('Ya abonado antes (reserva / check-in)', formatCOP(abonoPrevioActual), '#6a3fb5', '#f3edfb', '#c6acec') : ''}
        ${
          // (Nota 186) Aviso en vivo — antes de siquiera llegar al botón de
          // enviar — cuando la reserva vinculada ya viene pagada por
          // completo y de todas formas se está por cobrar algo más ahora.
          // Es justo el patrón del caso real: pagó completo al reservar y
          // en el check-in se volvió a registrar el mismo pago sin
          // notarlo. Ver también el candado en el submit más abajo.
          montoEstimado > 0 && abonoPrevioActual >= montoEstimado && montoACobrar > 0
            ? `<div style="margin-top:0.75rem; padding:0.6rem 0.85rem; border-radius:8px; background:#fdeceb; border:1px solid #f0a8a0; color:#8a271f; font-weight:600; font-size:0.82rem;">⚠️ Esta reserva ya aparece pagada por completo (${formatCOP(abonoPrevioActual)}). Revisa que el cobro de ahora sea algo nuevo de verdad (una noche extra, por ejemplo) y no el mismo pago registrado dos veces.</div>`
            : ''
        }
        <div style="margin-top:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
          <span style="font-size:0.82rem; color:var(--color-texto-suave, #666);">¿Paga ahora?</span>
          <span style="display:inline-block; padding:0.3rem 0.7rem; border-radius:999px; background:${info.fondo}; color:${info.color}; font-weight:700; font-size:0.8rem; border:1px solid ${info.borde};">${estadoPago ? info.texto : '⚠️ Falta elegir arriba'}</span>
        </div>
        ${filaResumen('Método de pago', metodoPago, {})}
        ${cajonMonto('Monto a cobrar ahora', formatCOP(montoACobrar), 'var(--color-verde-oscuro, #1b7a3d)', '#eafbea', '#8fd3a4')}
        ${cajonMonto(
          'Saldo pendiente después de este pago',
          formatCOP(saldo),
          saldo > 0 ? 'var(--color-rojo-oscuro, #b3261e)' : 'var(--color-verde-oscuro, #1b7a3d)',
          saldo > 0 ? '#fdeceb' : '#eafbea',
          saldo > 0 ? '#f0a8a0' : '#8fd3a4'
        )}
      </div>
    `;
  }

  function actualizarHintMonto() {
    const estimado = calcularMontoEstimado();
    if (estadoPagoActual() === 'anticipado') {
      inputMontoPago.value = Math.max(0, estimado - abonoPrevioActual);
      activarInputDinero(inputMontoPago);
    }
    actualizarCandadoMontoExtendidoCheckin();
    pintarResumenLiquidacion();
  }

  function actualizarVisibilidadPago() {
    const estado = estadoPagoActual();
    const mostrar = estado === 'parcial' || estado === 'anticipado';
    wrapMontoPago.classList.toggle('oculto', !mostrar);
    inputMontoPago.required = mostrar;
    if (estado === 'anticipado') {
      inputMontoPago.value = Math.max(0, calcularMontoEstimado() - abonoPrevioActual);
      activarInputDinero(inputMontoPago);
    } else if (estado === 'pendiente') {
      inputMontoPago.value = '';
    }
    // Resalta visualmente la tarjeta de pago elegida, para que sea
    // imposible confundir cuál quedó marcada.
    container.querySelectorAll('.opcion-pago-checkin').forEach((lbl) => {
      const elegida = lbl.dataset.valor === estado;
      lbl.style.borderColor = elegida ? 'var(--color-azul)' : 'var(--color-borde)';
      lbl.style.background = elegida ? 'rgba(30, 78, 140, 0.06)' : 'transparent';
    });
    pintarResumenLiquidacion();
  }

  selectTarifaEstadia.addEventListener('change', actualizarHintMonto);
  inputNochesEstadia.addEventListener('input', actualizarHintMonto);
  radiosEstadoPago.forEach((radio) => radio.addEventListener('change', actualizarVisibilidadPago));
  inputMontoPago.addEventListener('input', pintarResumenLiquidacion);
  container.querySelector('#select-habitacion').addEventListener('change', pintarResumenLiquidacion);
  const selectMetodoPagoEstadia = container.querySelector('#select-metodo-pago-estadia');
  if (selectMetodoPagoEstadia) selectMetodoPagoEstadia.addEventListener('change', pintarResumenLiquidacion);

  // --- Vincular reserva: precarga campos (compartido entre el selector
  // manual, la vinculación automática por documento y la preselección que
  // llega desde "Llegadas de hoy") + trae el abono que ya se haya pagado
  // por esa reserva, para que se refleje en el resumen y no se pierda al
  // liquidar el check-out. ---
  async function aplicarReserva(reserva) {
    if (!reserva) return;
    container.querySelector('input[name="nombre"]').value = reserva.huesped_nombre || '';
    container.querySelector('input[name="numero_documento"]').value = reserva.huesped_documento || '';
    container.querySelector('input[name="celular"]').value = reserva.huesped_telefono || '';
    container.querySelector('#select-habitacion').value = reserva.habitacion_id;
    if (reserva.tarifa_id) container.querySelector('#select-tarifa').value = reserva.tarifa_id;

    const noches = Math.round((new Date(reserva.fecha_checkout) - new Date(reserva.fecha_checkin)) / 86400000);
    container.querySelector('#input-noches').value = noches > 0 ? noches : '';
    nochesOriginalesVinculada = noches > 0 ? noches : null;
    inputMontoExtendidoCheckin.value = '';

    const { data: pagosPrevios, error: errPagosPrevios } = await supabase.from('reservas_pagos').select('monto').eq('reserva_id', reserva.id);
    if (errPagosPrevios) {
      mostrarToast(`No se pudo consultar el abono previo de esta reserva: ${errPagosPrevios.message}`, 'error');
      abonoPrevioActual = 0;
    } else {
      abonoPrevioActual = (pagosPrevios || []).reduce((sum, p) => sum + Number(p.monto || 0), 0);
    }

    actualizarHintMonto();
  }

  container.querySelector('#select-reserva').addEventListener('change', async (e) => {
    const reservaId = e.target.value;
    if (!reservaId) {
      abonoPrevioActual = 0;
      nochesOriginalesVinculada = null;
      actualizarCandadoMontoExtendidoCheckin();
      pintarResumenLiquidacion();
      return;
    }
    await aplicarReserva((reservas || []).find((r) => String(r.id) === reservaId));
  });

  if (reservaIdPreseleccionada) {
    const selectReserva = container.querySelector('#select-reserva');
    selectReserva.value = String(reservaIdPreseleccionada);
    await aplicarReserva((reservas || []).find((r) => r.id === reservaIdPreseleccionada));
  }

  actualizarHintMonto();

  container.querySelector('#btn-cancelar-checkin').addEventListener('click', () => vistaLista(container));

  container.querySelector('#form-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!container.querySelector('#check-habeas').checked) {
      mostrarToast('Debes marcar el consentimiento de Habeas Data para continuar.', 'error');
      return;
    }

    const tipoPagoMarcado = container.querySelector('input[name="estado_pago_checkin"]:checked');
    if (!tipoPagoMarcado) {
      mostrarToast('Elige si el huésped paga ahora (Parcial/Total) o si queda Pendiente, antes de continuar — es obligatorio.', 'error');
      return;
    }

    // (Nota 181) Si se vinculó una reserva y las noches cambiaron frente a
    // las que ya tenía, no se deja continuar sin confirmar el nuevo monto
    // total — se valida aquí, antes de tocar la base de datos.
    if (nochesCambiaronVinculada() && !valorNumericoInput(inputMontoExtendidoCheckin)) {
      mostrarToast('Cambiaron las noches frente a la reserva original — confirma el nuevo monto total de la estadía antes de continuar.', 'error');
      return;
    }
    const montoTotalConfirmadoVinculada = nochesCambiaronVinculada() ? valorNumericoInput(inputMontoExtendidoCheckin) : null;

    const form = new FormData(e.target);
    const reservaIdSeleccionada = container.querySelector('#select-reserva').value || null;
    const hayFirma = ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v !== 0);

    const habitacionId = Number(form.get('habitacion_id'));
    const hoyISO = toISODate(new Date());

    // Verificación de último momento contra la base de datos: aunque el
    // desplegable ya deshabilita las habitaciones que no están
    // "disponible", el estado pudo cambiar mientras se llenaba el
    // formulario (por ejemplo, Housekeeping la marcó ocupada o en
    // mantenimiento justo ahora). Sin este chequeo, un check-in podía
    // colarse en una habitación bloqueada — Recepción y Housekeeping
    // quedaban desincronizados.
    const { data: habitacionActual, error: errHabActual } = await supabase
      .from('habitaciones')
      .select('estado, numero, nombre')
      .eq('id', habitacionId)
      .single();

    if (errHabActual) {
      mostrarToast(`No se pudo confirmar el estado de la habitación: ${errHabActual.message}`, 'error');
      return;
    }

    if (habitacionActual.estado !== 'disponible') {
      mostrarToast(
        `${habitacionActual.numero} — ${habitacionActual.nombre} ya no está disponible (${ETIQUETA_ESTADO_HABITACION[habitacionActual.estado] || habitacionActual.estado}). Elige otra habitación o corrige su estado desde Housekeeping antes de continuar.`,
        'error'
      );
      return;
    }

    const tarifaId = form.get('tarifa_id') ? Number(form.get('tarifa_id')) : null;
    const tarifa = (tarifas || []).find((t) => t.id === tarifaId);
    const cantidadNoches = form.get('cantidad_noches') ? Number(form.get('cantidad_noches')) : 1;
    const nombre = form.get('nombre').trim();
    const documento = form.get('numero_documento').trim();
    const celular = form.get('celular').trim() || null;
    const estadoPagoCheckin = tipoPagoMarcado.value;
    const montoPagoCheckin = valorNumericoInput(inputMontoPago);
    const montoEstimado = calcularMontoEstimado();
    const metodoPago = form.get('metodo_pago');
    const habitacionTexto = container.querySelector('#select-habitacion').selectedOptions[0]?.textContent || habitacionActual.numero;
    const saldoDespues = Math.max(0, montoEstimado - abonoPrevioActual - montoPagoCheckin);

    // (Nota 186) Candado contra pago duplicado — caso real: Alexa Rojas,
    // 405. Pagó completo al crear la reserva; en el check-in, sin darse
    // cuenta de que ya estaba pagada, se registró el mismo pago otra vez
    // (mismo monto, mismo método, mismo día) — el checkout mostró un
    // "excedente" de $104.000 que en realidad nunca existió. No se
    // bloquea del todo porque SÍ puede ser un cobro nuevo legítimo (una
    // noche extra, por ejemplo) — se exige confirmar explícitamente.
    if (estadoPagoCheckin !== 'pendiente' && montoPagoCheckin > 0 && montoEstimado > 0 && abonoPrevioActual >= montoEstimado) {
      const confirmarPagoAdicional = await mostrarConfirmacion({
        titulo: '¿Seguro que es un cobro nuevo?',
        contenidoHTML: `Esta reserva ya aparece pagada por completo (<strong>${formatCOP(abonoPrevioActual)}</strong> abonados, para un estimado de <strong>${formatCOP(montoEstimado)}</strong>). Vas a registrar <strong>${formatCOP(montoPagoCheckin)}</strong> más ahora.<br><br>Confirma que el huésped SÍ está pagando algo adicional — y no que este pago ya se había registrado antes al hacer la reserva.`,
        textoConfirmar: 'Sí, es un cobro nuevo, continuar',
      });
      if (!confirmarPagoAdicional) return;
    }

    // --- Acompañantes: recolectar los bloques (si el checkbox está
    // marcado) y descartar cualquier bloque que haya quedado sin nombre. ---
    let acompanantesDetalle = null;
    if (checkAcompanante.checked) {
      const bloques = Array.from(listaAcompanantes.querySelectorAll('.bloque-acompanante'));
      acompanantesDetalle = bloques
        .map((bloque) => ({
          nombre: bloque.querySelector('[name="acomp_nombre"]').value.trim(),
          tipo_documento: bloque.querySelector('[name="acomp_tipo_documento"]').value,
          numero_documento: bloque.querySelector('[name="acomp_numero_documento"]').value.trim() || null,
          nacionalidad: bloque.querySelector('[name="acomp_nacionalidad"]').value.trim() || null,
          fecha_nacimiento: bloque.querySelector('[name="acomp_fecha_nacimiento"]').value || null,
          celular: bloque.querySelector('[name="acomp_celular"]').value.trim() || null,
          verificado_menor: bloque.querySelector('.check-verificacion-menor')?.checked || false,
        }))
        .filter((a) => a.nombre);
      if (acompanantesDetalle.length === 0) acompanantesDetalle = null;
    }

    // Nada se ha guardado todavía — se abre la tarjeta de confirmación con
    // todo lo que se va a registrar, y solo si la recepcionista confirma
    // ahí se ejecuta el registro real (ejecutarRegistroCheckin).
    abrirModalConfirmarCheckin({
      huespedNombre: nombre,
      habitacionTexto,
      tarifaCodigo: tarifa ? tarifa.codigo : '—',
      cantidadNoches,
      montoEstimado,
      montoTotalConfirmadoVinculada,
      abonoPrevioActual,
      estadoPagoCheckin,
      montoPagoCheckin,
      metodoPago,
      saldoDespues,
      onConfirmar: () =>
        ejecutarRegistroCheckin({
          container,
          form,
          habitacionId,
          hoyISO,
          reservaIdSeleccionada,
          tarifaId,
          cantidadNoches,
          nombre,
          documento,
          celular,
          estadoPagoCheckin,
          montoPagoCheckin,
          montoEstimado,
          montoTotalConfirmadoVinculada,
          acompanantesDetalle,
          hayFirma,
          canvas,
        }),
    });
  });
}

registerModule({
  id: 'recepcion',
  label: 'Recepción',
  icono: '🛎',
  roles: ['propietario', 'administrador', 'recepcionista'],
  render,
});
