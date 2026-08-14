/**
 * plotly.js — Shared Plotly layout, config, and trace helpers.
 */
import Plotly from 'plotly.js-basic-dist-min';
import { wavelengthToRGB } from './color';
import { touchBusy } from './touchActivity';

/**
 * Imperative, per-frame chart updates for animated demos.
 *
 * Animating by handing react-plotly new `data`/`layout` objects each frame forces
 * a full `Plotly.react()` relayout ~20x/sec, which thrashes layout and (on mobile)
 * drops taps. Instead, render <Plot> once with static curves and move the live
 * marker(s)/time-line with these — they touch only the named attributes and don't
 * recompute the layout. `gd` is the graph div from IntensityPlot's `onReady`.
 * See CONTRIBUTING.md → "Animating charts (Plotly)".
 */
// While a touch is in flight we skip the repaint so it can't drop the tap's
// click; the next animation frame after the touch settles catches the chart up.
export function restyleLive(gd, update, traceIndices) {
  if (touchBusy() || !gd || !gd.data) return;
  Plotly.restyle(gd, update, traceIndices);
}
export function relayoutLive(gd, update) {
  if (touchBusy() || !gd || !gd.layout) return;
  Plotly.relayout(gd, update);
}

const darkLayout = {
  paper_bgcolor: '#0D1321',
  plot_bgcolor: '#0D1321',
  font: { family: 'Inter, system-ui, sans-serif', color: '#F0ECE3', size: 14 },
  xaxis: {
    gridcolor: '#1A2332',
    zerolinecolor: '#2A3442',
    title: { font: { size: 16 } },
    tickfont: { size: 13 },
  },
  yaxis: {
    gridcolor: '#1A2332',
    zerolinecolor: '#2A3442',
    title: { text: 'Normalized Intensity', font: { size: 16 } },
    tickfont: { size: 13 },
    range: [0, 1.05],
  },
  margin: { l: 65, r: 20, t: 40, b: 55 },
  showlegend: false,
};

const lightLayout = {
  paper_bgcolor: '#FFFFFF',
  plot_bgcolor: '#FFFFFF',
  font: { family: 'Inter, system-ui, sans-serif', color: '#1A1A2E', size: 14 },
  xaxis: {
    gridcolor: '#E0DDD6',
    zerolinecolor: '#C8C4BC',
    title: { font: { size: 16 } },
    tickfont: { size: 13 },
  },
  yaxis: {
    gridcolor: '#E0DDD6',
    zerolinecolor: '#C8C4BC',
    title: { text: 'Normalized Intensity', font: { size: 16 } },
    tickfont: { size: 13 },
    range: [0, 1.05],
  },
  margin: { l: 65, r: 20, t: 40, b: 55 },
  showlegend: false,
};

// Keep a backward-compatible export for any code that references it directly
export const baseLayout = darkLayout;

export const plotConfig = {
  responsive: true,
  displayModeBar: false,
  staticPlot: false,
};

export function makeTrace(x, y, wavelengthNm, options = {}) {
  const rgb = wavelengthToRGB(wavelengthNm);
  const color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  return {
    x, y,
    type: 'scatter',
    mode: 'lines',
    line: { color, width: 2.5, ...options.line },
    fill: options.fill ?? 'tozeroy',
    fillcolor: options.fillcolor ?? `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`,
    ...options,
  };
}

export function mergeLayout(overrides = {}, { dark = true } = {}) {
  const base = dark ? darkLayout : lightLayout;
  const merged = { ...base };
  for (const key of Object.keys(overrides)) {
    if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key]) && base[key]) {
      merged[key] = { ...base[key], ...overrides[key] };
    } else {
      merged[key] = overrides[key];
    }
  }
  return merged;
}
