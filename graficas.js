// graficas.js
//
// Módulo compartido (217 / fortalecimiento de Indicadores): envoltorios
// delgados sobre Chart.js para las gráficas de la app — anillo de
// progreso, línea comparativa y barras horizontales. Se centralizan aquí
// para no repetir configuración de Chart.js en cada módulo que necesite
// una gráfica, y para que todas respeten la misma paleta de colores del
// sistema (ver variables --color-* en styles.css).
//
// Chart.js se importa como ESM directo desde CDN (mismo patrón que
// supabase-js en usuarios.js: `from '.../+esm'`) — este proyecto no tiene
// bundler, así que no se puede hacer `npm install chart.js`; se trae ya
// compilado y listo para usar con <canvas>.
//
// Decisión (217): antes las gráficas de indicadores.js/estadisticas.js
// eran CSS puro a propósito, "para no depender de internet el día de la
// demo" (ver nota anterior en esos archivos). A pedido explícito de
// Elssy, en la entrega final se prioriza una presentación más pulida
// (tooltips, tipografía, curvas) sobre esa independencia de internet —
// characterization que ya no aplica: el sistema corre en producción con
// internet disponible, no en una demo aislada.
//
// Nota sobre reutilización de instancias: cada `crear*` recibe un
// <canvas>. Si ese mismo elemento ya tenía una gráfica dibujada (poco
// común, porque los módulos que llaman esto reemplazan el HTML — y por
// tanto el <canvas> — antes de volver a pintar), se destruye la anterior
// primero. Chart.js lanza error si se crea una segunda instancia sobre el
// mismo <canvas> sin destruir la primera.

import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm';

Chart.register(...registerables);

// Exportada: Chart.js dibuja sobre un <canvas> (contexto 2D), que a
// diferencia del CSS normal NO resuelve `var(--color-x)` como fillStyle/
// strokeStyle — hay que resolver la variable a un color real (hex/rgb)
// antes de pasarlo. Los módulos que llaman crearAnillo/crearLineaComparativa/
// crearBarrasHorizontales deben usar esta función para cualquier color que
// venga de las variables de styles.css.
export function leerColor(variable, alterno) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return valor || alterno;
}

function destruirSiExiste(canvas) {
  if (canvas._chartInstance) {
    canvas._chartInstance.destroy();
    canvas._chartInstance = null;
  }
}

/**
 * Anillo de progreso (doughnut de 2 segmentos, con el % escrito en el
 * centro) — para KPIs de ocupación. El valor del centro se muestra sin
 * recortar; el dibujo del anillo sí se recorta a [0, 100] por seguridad.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ porcentaje: number, colorPrincipal?: string, colorFondo?: string, etiqueta?: string }} opciones
 */
export function crearAnillo(canvas, { porcentaje, colorPrincipal, colorFondo, etiqueta }) {
  destruirSiExiste(canvas);
  const pctDibujo = Math.max(0, Math.min(100, porcentaje));
  const color = colorPrincipal || leerColor('--color-azul', '#1e4e8c');
  const fondo = colorFondo || leerColor('--color-borde', '#e0e0e0');

  const pluginTextoCentro = {
    id: 'texto-centro-anillo',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.font = '700 1.3rem system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${porcentaje.toFixed(0)}%`, cx, cy);
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: [etiqueta || 'Ocupación', ''],
      datasets: [{ data: [pctDibujo, 100 - pctDibujo], backgroundColor: [color, fondo], borderWidth: 0 }],
    },
    options: {
      cutout: '72%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
    plugins: [pluginTextoCentro],
  });
  canvas._chartInstance = chart;
  return chart;
}

/**
 * Línea comparativa — hasta N series, SIEMPRE un solo eje Y (nunca doble
 * eje, ver guía de gráficas). Pensada para "este mes vs mismo corte del
 * mes anterior", pero sirve para cualquier comparación de series por
 * día/categoría con la misma unidad.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], series: {label: string, data: number[], color: string}[], formatoValor?: (v:number)=>string }} opciones
 */
export function crearLineaComparativa(canvas, { labels, series, formatoValor }) {
  destruirSiExiste(canvas);
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        tension: 0.25,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: series.length > 1, position: 'bottom' },
        tooltip: {
          callbacks: formatoValor ? { label: (ctx) => `${ctx.dataset.label}: ${formatoValor(ctx.parsed.y)}` } : undefined,
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => (formatoValor ? formatoValor(v) : v) } },
      },
    },
  });
  canvas._chartInstance = chart;
  return chart;
}

/**
 * Barras horizontales — para rankings con nombres largos (Top 10
 * productos, habitaciones más rentables). Una sola serie; si se pasa
 * `datosSecundarios`, se agrega como línea extra en el tooltip (por
 * ejemplo, unidades vendidas junto al monto en $).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], datos: number[], color?: string, formatoValor?: (v:number)=>string, datosSecundarios?: number[], etiquetaSecundaria?: string }} opciones
 */
export function crearBarrasHorizontales(canvas, { labels, datos, color, formatoValor, datosSecundarios, etiquetaSecundaria }) {
  destruirSiExiste(canvas);
  const colorBarra = color || leerColor('--color-azul', '#1e4e8c');

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: datos, backgroundColor: colorBarra, borderRadius: 4, maxBarThickness: 26 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const base = formatoValor ? formatoValor(ctx.parsed.x) : `${ctx.parsed.x}`;
              if (datosSecundarios && datosSecundarios[ctx.dataIndex] !== undefined) {
                return `${base} · ${etiquetaSecundaria || ''}: ${datosSecundarios[ctx.dataIndex]}`;
              }
              return base;
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => (formatoValor ? formatoValor(v) : v) } },
      },
    },
  });
  canvas._chartInstance = chart;
  return chart;
}
