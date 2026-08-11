import Plotly from 'plotly.js-basic-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { mergeLayout, plotConfig } from '@shared/lib/plotly';
import { useTheme } from '../ThemeContext';

const Plot = createPlotlyComponent(Plotly);

/**
 * Wrapper around react-plotly.js with USNA theme-aware defaults.
 */
export default function IntensityPlot({ traces, layoutOverrides, style }) {
  const { dark } = useTheme();

  return (
    <Plot
      data={traces}
      layout={mergeLayout(layoutOverrides, { dark })}
      config={plotConfig}
      useResizeHandler
      style={{ width: '100%', height: '100%', ...style }}
    />
  );
}
