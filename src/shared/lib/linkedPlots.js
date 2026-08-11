/**
 * linkedPlots.js — stacked, time-synchronized Plotly panels.
 *
 * Builds the multi-panel layout used by D01 (x/v/a) and reused by D24 (θ/ω/α):
 * N panels stacked vertically, each its own y-axis, all sharing ONE x-axis so a
 * single scrub line spans every panel. Pass the panels top-to-bottom.
 *
 *   stackedTimeLayout(
 *     [{ title: 'x (m)', color: '#C5B783' }, { title: 'v (m/s)', color: '#5B9BD5' }, ...],
 *     { tMax: 10, scrubT: 4 }
 *   )
 *
 * Assign traces to the returned yaxis ids (bottom→top): 'y', 'y2', 'y3', …
 * Returns a layoutOverrides object for <IntensityPlot>.
 */
export function stackedTimeLayout(panels, { tMax, scrubT, gap = 0.08, xTitle = 'Time (s)' } = {}) {
  const n = panels.length;
  const band = (1 - gap * (n - 1)) / n; // vertical fraction per panel
  const layout = {
    showlegend: false,
    margin: { l: 62, r: 16, t: 10, b: 42 },
    xaxis: { title: { text: xTitle }, anchor: 'y', domain: [0, 1], range: [0, tMax] },
  };
  // panels are given top→bottom, but y-axis ids go bottom→top (y, y2, y3…)
  panels.forEach((p, i) => {
    const fromTop = i;                        // 0 = top panel
    const fromBottom = n - 1 - fromTop;       // 0 = bottom panel → yaxis 'y'
    const y0 = fromBottom * (band + gap);
    const id = fromBottom === 0 ? 'yaxis' : `yaxis${fromBottom + 1}`;
    layout[id] = {
      domain: [y0, y0 + band],
      anchor: 'x',
      title: { text: p.title, font: { color: p.color } },
      zeroline: true,
      zerolinecolor: '#2A3442',
      tickfont: { size: 12 },
    };
  });
  if (scrubT != null) {
    layout.shapes = [{
      type: 'line', xref: 'x', yref: 'paper', x0: scrubT, x1: scrubT, y0: 0, y1: 1,
      line: { color: 'rgba(240,236,227,0.5)', width: 1, dash: 'dot' },
    }];
  }
  return layout;
}

/** yaxis id for the k-th panel counting from the bottom (0 → 'y'). */
export const yAxisId = (kFromBottom) => (kFromBottom === 0 ? 'y' : `y${kFromBottom + 1}`);
