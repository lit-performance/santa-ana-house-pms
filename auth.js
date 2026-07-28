// core/helpers/currency.js
//
// Formateo de moneda reutilizable. Ningún módulo debe reimplementar esto.

export function formatCOP(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(valor);
}
