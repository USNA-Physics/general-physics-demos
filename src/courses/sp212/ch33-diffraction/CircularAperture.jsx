import { useState, useMemo, useCallback, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import DisplayOptions from '@shared/components/DisplayOptions';
import IntensityPlot from '@shared/components/IntensityPlot';
import AiryDisk2D from '@shared/components/AiryDisk2D';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { airyIntensity } from '../lib/physics';
import { makeTrace } from '@shared/lib/plotly';

const DEFAULTS = { D: 1.0, lambda: 550, L: 2.0 };
const INITIAL_RANGE = 4 * (1.22 * DEFAULTS.lambda * 1e-9 * DEFAULTS.L) / (DEFAULTS.D * 1e-3);

export default function CircularAperture() {
  const [D, setD] = useState(DEFAULTS.D);
  const [lambda, setLambda] = useState(DEFAULTS.lambda);
  const [L, setL] = useState(DEFAULTS.L);
  const [lockAxis, setLockAxis] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [gamma, setGamma] = useState(0.5);
  const lockedRange = useRef(INITIAL_RANGE);

  const reset = () => { setD(DEFAULTS.D); setLambda(DEFAULTS.lambda); setL(DEFAULTS.L); };

  const D_m = D * 1e-3;
  const lambda_m = lambda * 1e-9;

  const r1 = (1.22 * lambda_m * L) / D_m;
  const theta1 = (1.22 * lambda_m) / D_m;

  const autoRMax = 4 * r1;

  const handleLockAxis = (locked) => {
    if (locked) lockedRange.current = autoRMax;
    setLockAxis(locked);
  };

  const rMax = lockAxis && lockedRange.current ? lockedRange.current : autoRMax;
  const dataRMax = Math.max(rMax, autoRMax);
  const nPts = 2000;

  const { xData, yData } = useMemo(() => {
    const xs = [];
    const ys = [];
    for (let i = 0; i < nPts; i++) {
      const r = -dataRMax + (2 * dataRMax * i) / (nPts - 1);
      xs.push(r * 1e3);
      ys.push(airyIntensity(r, D_m, lambda_m, L));
    }
    return { xData: xs, yData: ys };
  }, [D_m, lambda_m, L, dataRMax]);

  const traces = useMemo(() => {
    if (logScale) {
      const yLog = yData.map(v => v > 0 ? Math.log10(v) : -6);
      return [makeTrace(xData, yLog, lambda, { fill: 'none' })];
    }
    return [makeTrace(xData, yData, lambda)];
  }, [xData, yData, lambda, logScale]);

  const shapes = useMemo(() => {
    const pos = r1 * 1e3;
    return [1, -1].map(sign => ({
      type: 'line',
      x0: sign * pos, x1: sign * pos,
      y0: logScale ? -6 : 0, y1: logScale ? 0.05 : 1.05,
      line: { color: '#C5B783', width: 1, dash: 'dash' },
    }));
  }, [r1, logScale]);

  const xAxisRange = lockAxis && lockedRange.current
    ? [-lockedRange.current * 1e3, lockedRange.current * 1e3]
    : undefined;

  const intensityFn2D = useCallback(
    (r) => airyIntensity(r, D_m, lambda_m, L),
    [D_m, lambda_m, L]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Aperture diameter (D)" value={D} min={0.05} max={5.0} step={0.05} unit="mm" onChange={setD} />
        <Slider label="Wavelength (λ)" value={lambda} min={380} max={780} step={1} unit="nm" onChange={setLambda} />
        <Slider label="Screen distance (L)" value={L} min={0.5} max={10.0} step={0.1} unit="m" onChange={setL} />
        <div className="mt-4 space-y-1">
          <Readout label="First ring angle θ₁" value={(theta1 * 1e3).toFixed(3)} unit="mrad" />
          <Readout label="First ring radius r₁" value={(r1 * 1e3).toFixed(2)} unit="mm" />
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
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4" style={{ height: 380 }}>
          <IntensityPlot
            traces={traces}
            layoutOverrides={{
              xaxis: {
                title: { text: 'Radial Position r (mm)' },
                ...(xAxisRange && { range: xAxisRange }),
              },
              ...(logScale && {
                yaxis: { title: { text: 'log₁₀ Intensity' }, range: [-6, 0.05] },
              }),
              shapes,
            }}
          />
        </div>

        <div className="flex justify-center">
          <AiryDisk2D
            intensityFn={intensityFn2D}
            rMax={rMax}
            wavelengthNm={lambda}
            gamma={gamma}
            size={400}
          />
        </div>

        <InfoPanel
          title="Circular Aperture — Airy Pattern"
          description="Diffraction through a circular aperture produces the Airy pattern: a bright central disk surrounded by concentric dark and bright rings. The first dark ring defines the angular resolution limit."
          equation={String.raw`I(\theta) = I_0 \left[\frac{2\,J_1(u)}{u}\right]^2, \quad u = \frac{\pi D \sin\theta}{\lambda}`}
        />
      </div>
    </div>
  );
}
