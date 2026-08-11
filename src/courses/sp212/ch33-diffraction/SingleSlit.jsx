import { useState, useMemo, useCallback, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import DisplayOptions from '@shared/components/DisplayOptions';
import IntensityPlot from '@shared/components/IntensityPlot';
import ScreenStrip from '@shared/components/ScreenStrip';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { singleSlitIntensity } from '../lib/physics';
import { makeTrace } from '@shared/lib/plotly';

const DEFAULTS = { a: 0.10, lambda: 550, L: 2.0 };
const INITIAL_RANGE = 4 * (DEFAULTS.lambda * 1e-9 * DEFAULTS.L) / (DEFAULTS.a * 1e-3);

export default function SingleSlit() {
  const [a, setA] = useState(DEFAULTS.a);
  const [lambda, setLambda] = useState(DEFAULTS.lambda);
  const [L, setL] = useState(DEFAULTS.L);
  const [lockAxis, setLockAxis] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [gamma, setGamma] = useState(0.5);
  const lockedRange = useRef(INITIAL_RANGE);

  const reset = () => { setA(DEFAULTS.a); setLambda(DEFAULTS.lambda); setL(DEFAULTS.L); };

  const a_m = a * 1e-3;
  const lambda_m = lambda * 1e-9;

  const y1 = (lambda_m * L) / a_m;
  const theta1 = lambda_m / a_m;

  const autoXMax = 4 * y1;

  const handleLockAxis = (locked) => {
    if (locked) lockedRange.current = autoXMax;
    setLockAxis(locked);
  };

  const xMax = lockAxis && lockedRange.current ? lockedRange.current : autoXMax;
  const dataXMax = Math.max(xMax, autoXMax);
  const nPts = 2000;

  const { xData, yData } = useMemo(() => {
    const xs = [];
    const ys = [];
    for (let i = 0; i < nPts; i++) {
      const y = -dataXMax + (2 * dataXMax * i) / (nPts - 1);
      xs.push(y * 1e3);
      ys.push(singleSlitIntensity(y, a_m, lambda_m, L));
    }
    return { xData: xs, yData: ys };
  }, [a_m, lambda_m, L, dataXMax]);

  const traces = useMemo(() => {
    if (logScale) {
      const yLog = yData.map(v => v > 0 ? Math.log10(v) : -6);
      return [makeTrace(xData, yLog, lambda, { fill: 'none' })];
    }
    return [makeTrace(xData, yData, lambda)];
  }, [xData, yData, lambda, logScale]);

  const shapes = useMemo(() => {
    const s = [];
    for (let m = 1; m <= 3; m++) {
      const pos = m * y1 * 1e3;
      for (const sign of [1, -1]) {
        s.push({
          type: 'line',
          x0: sign * pos, x1: sign * pos,
          y0: logScale ? -6 : 0, y1: logScale ? 0.05 : 1.05,
          line: { color: '#C5B783', width: 1, dash: 'dash' },
        });
      }
    }
    return s;
  }, [y1, logScale]);

  const xAxisRange = lockAxis && lockedRange.current
    ? [-lockedRange.current * 1e3, lockedRange.current * 1e3]
    : undefined;

  const intensityFn = useCallback(
    (y) => singleSlitIntensity(y, a_m, lambda_m, L),
    [a_m, lambda_m, L]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Slit width (a)" value={a} min={0.01} max={1.0} step={0.01} unit="mm" onChange={setA} />
        <Slider label="Wavelength (λ)" value={lambda} min={380} max={780} step={1} unit="nm" onChange={setLambda} />
        <Slider label="Screen distance (L)" value={L} min={0.5} max={10.0} step={0.1} unit="m" onChange={setL} />
        <div className="mt-4 space-y-1">
          <Readout label="Central max half-width" value={(y1 * 1e3).toFixed(2)} unit="mm" />
          <Readout label="First min angle θ₁" value={(theta1 * 1e3).toFixed(3)} unit="mrad" />
        </div>
        <DisplayOptions
          lockAxis={lockAxis}
          onLockAxisChange={handleLockAxis}
          logScale={logScale}
          onLogScaleChange={setLogScale}
          gamma={gamma}
          onGammaChange={setGamma}
        />
      </ControlPanel>

      <div className="flex-1 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4" style={{ height: 420 }}>
          <IntensityPlot
            traces={traces}
            layoutOverrides={{
              xaxis: {
                title: { text: 'Screen Position y (mm)' },
                ...(xAxisRange && { range: xAxisRange }),
              },
              ...(logScale && {
                yaxis: { title: { text: 'log₁₀ Intensity' }, range: [-6, 0.05] },
              }),
              shapes,
            }}
          />
        </div>

        <ScreenStrip
          intensityFn={intensityFn}
          xRange={[-xMax, xMax]}
          wavelengthNm={lambda}
          gamma={gamma}
          height={60}
        />

        <InfoPanel
          title="Single-Slit Fraunhofer Diffraction"
          description="Light passing through a narrow slit produces a central bright fringe flanked by progressively weaker secondary maxima. Minima occur where the path difference across the slit equals a whole number of wavelengths."
          equation={String.raw`I(\theta) = I_0 \left[\frac{\sin\beta}{\beta}\right]^2, \quad \beta = \frac{\pi a \sin\theta}{\lambda}`}
        />
      </div>
    </div>
  );
}
