import { useState, useEffect, useRef } from 'react';
import Plotly from 'plotly.js-basic-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { mergeLayout, plotConfig } from '@shared/lib/plotly';
import { touchBusy } from '@shared/lib/touchActivity';
import { useTheme } from '../ThemeContext';

const Plot = createPlotlyComponent(Plotly);

/**
 * Wrapper around react-plotly.js with USNA theme-aware defaults.
 *
 * Touch-safe by default: chart repaints are DEFERRED while a touch is in flight.
 * A Plotly relayout landing between a tap's pointerup and its click drops the tap
 * on iOS, so a demo that re-renders the chart at frame rate would make buttons
 * (and the nav above them) need a second tap. Holding the update for ~450ms
 * around a touch prevents that; the chart catches up the moment the tap settles.
 * Mouse/pen never mark touch activity, so desktop is a straight pass-through.
 *
 * For smooth animation, prefer moving markers/lines imperatively via `onReady`
 * (which hands back the Plotly graph div) + `restyleLive`/`relayoutLive`, with
 * STABLE `traces`/`layoutOverrides` (memoized on physics params, not the clock)
 * so react-plotly's shallow-equality check skips the full relayout. The deferral
 * here is the safety net; the imperative path is the fast path.
 * See CONTRIBUTING.md → "Animating charts (Plotly)".
 */
export default function IntensityPlot({ traces, layoutOverrides, style, onReady }) {
  const { dark } = useTheme();

  // What we actually hand to <Plot>. While a touch is active we hold the latest
  // incoming props and flush them after the tap resolves.
  const [shown, setShown] = useState({ traces, layoutOverrides });
  const pendingRef = useRef(null);
  useEffect(() => {
    if (!touchBusy()) { setShown({ traces, layoutOverrides }); return undefined; }
    pendingRef.current = { traces, layoutOverrides };
    const id = setTimeout(() => {
      if (pendingRef.current) { setShown(pendingRef.current); pendingRef.current = null; }
    }, 450);
    return () => clearTimeout(id);
  }, [traces, layoutOverrides]);

  return (
    <Plot
      data={shown.traces}
      layout={mergeLayout(shown.layoutOverrides, { dark })}
      config={plotConfig}
      useResizeHandler
      style={{ width: '100%', height: '100%', ...style }}
      onInitialized={onReady ? (_fig, graphDiv) => onReady(graphDiv) : undefined}
    />
  );
}
