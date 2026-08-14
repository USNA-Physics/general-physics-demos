import Plotly from 'plotly.js-basic-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { mergeLayout, plotConfig } from '@shared/lib/plotly';
import { useTheme } from '../ThemeContext';

const Plot = createPlotlyComponent(Plotly);

/**
 * Wrapper around react-plotly.js with USNA theme-aware defaults.
 *
 * `onReady(graphDiv)` hands back the underlying Plotly graph div so animated
 * demos can move markers/lines imperatively (Plotly.restyle/relayout) instead of
 * re-rendering the whole chart every frame. Pass STABLE `traces`/`layoutOverrides`
 * references (memoized on the physics params, not on the animation clock) so
 * react-plotly's shallow-equality check skips a full relayout while playing.
 * See CONTRIBUTING.md → "Animating charts (Plotly)".
 */
export default function IntensityPlot({ traces, layoutOverrides, style, onReady }) {
  const { dark } = useTheme();

  return (
    <Plot
      data={traces}
      layout={mergeLayout(layoutOverrides, { dark })}
      config={plotConfig}
      useResizeHandler
      style={{ width: '100%', height: '100%', ...style }}
      onInitialized={onReady ? (_fig, graphDiv) => onReady(graphDiv) : undefined}
    />
  );
}
