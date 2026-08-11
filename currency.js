// currency.js
//
// Formateo de moneda reutilizable. Ningún módulo debe reimplementar esto.
//
// `activarInputDinero` / `valorNumericoInput` son el par para campos de
// dinero que el usuario escribe a mano (abonos, montos, pagos): el input
// debe ser type="text" (no type="number", que no admite "$" ni el punto
// de miles) y se formatea solo mientras se escribe, mostrando "$" y el
// punto que separa miles (ej. "$ 150.000"). Para leer el valor real al
// guardar, siempre se usa `valorNumericoInput(input)`, nunca
// `input.value` directamente (ese trae el texto formateado, con símbolos).

export function formatCOP(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(valor);
}

// Engancha el formateo en vivo a un <input type="text"> de dinero. Se
// puede llamar de nuevo sobre el mismo input sin problema (por ejemplo,
// después de volver a pintar un formulario) — no duplica el listener
// porque cada llamada reemplaza el valor mostrado desde cero.
export function activarInputDinero(input) {
  if (!input) return;
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');

  const formatear = () => {
    const digitos = input.value.replace(/\D/g, '');
    input.value = digitos ? formatCOP(Number(digitos)).replace('COP', '').trim() : '';
  };

  input.addEventListener('input', formatear);
  if (input.value) formatear();
}

// Lee el valor numérico real de un input de dinero ya formateado (quita
// "$", puntos y cualquier otro carácter que no sea dígito).
export function valorNumericoInput(input) {
  if (!input) return 0;
  const digitos = String(input.value || '').replace(/\D/g, '');
  return digitos ? Number(digitos) : 0;
}
