import { useState, useMemo, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import DisplayOptions from '@shared/components/DisplayOptions';
import IntensityPlot from '@shared/components/IntensityPlot';
import StatusBadge from '@shared/components/StatusBadge';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { airyIntensity } from '../lib/physics';
import { makeTrace } from '@shared/lib/plotly';
import { setupCanvas } from '@shared/lib/canvas';
import { wavelengthToRGB } from '@shared/lib/color';

const DEFAULTS = {
  D: 2.0, lambda: 550, sepRatio: 1.0,
  R: 1000, s: 0.5,
};
const INITIAL_RANGE = 6 * (1.22 * DEFAULTS.lambda * 1e-9 * 2.0) / (DEFAULTS.D * 1e-3);

export default function Rayleigh() {
  const [D, setD] = useState(DEFAULTS.D);
  const [lambda, setLambda] = useState(DEFAULTS.lambda);

  const [inputMode, setInputMode] = useState('angle');
  const [sepRatio, setSepRatio] = useState(DEFAULTS.sepRatio);
  const [R, setR] = useState(DEFAULTS.R);
  const [s, setS] = useState(DEFAULTS.s);

  const [lockAxis, setLockAxis] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [gamma, setGamma] = useState(0.5);
  const lockedRange = useRef(INITIAL_RANGE);

  const reset = () => {
    setD(DEFAULTS.D); setLambda(DEFAULTS.lambda);
    setSepRatio(DEFAULTS.sepRatio); setR(DEFAULTS.R); setS(DEFAULTS.s);
  };

  const D_m = D * 1e-3;
  const lambda_m = lambda * 1e-9;
  const thetaC = (1.22 * lambda_m) / D_m;

  let deltaTheta;
  if (inputMode === 'angle') {
    deltaTheta = sepRatio * thetaC;
  } else {
    deltaTheta = s / R;
  }
  const effectiveRatio = deltaTheta / thetaC;

  const L = 2.0;
  const sep = deltaTheta * L;

  const autoRMax = 6 * (1.22 * lambda_m * L) / D_m;

  const handleLockAxis = (locked) => {
    if (locked) lockedRange.current = autoRMax;
    setLockAxis(locked);
  };

  const rMax = lockAxis && lockedRange.current ? lockedRange.current : autoRMax;
  const nPts = 2000;

  const { xData, y1, y2, ySum } = useMemo(() => {
    const xs = [];
    const a1 = [];
    const a2 = [];
    const sm = [];
    for (let i = 0; i < nPts; i++) {
      const r = -rMax + (2 * rMax * i) / (nPts - 1);
      xs.push(r * 1e3);
      const i1 = airyIntensity(r - sep / 2, D_m, lambda_m, L);
      const i2 = airyIntensity(r + sep / 2, D_m, lambda_m, L);
      a1.push(i1);
      a2.push(i2);
      sm.push(i1 + i2);
    }
    const maxS = Math.max(...sm);
    return {
      xData: xs,
      y1: a1.map(v => v / maxS),
      y2: a2.map(v => v / maxS),
      ySum: sm.map(v => v / maxS),
    };
  }, [D_m, lambda_m, L, sep, rMax]);

  const dipDepth = useMemo(() => {
    const centerIdx = Math.floor(nPts / 2);
    const searchRange = Math.floor(nPts * 0.15);
    let minVal = 1;
    for (let i = centerIdx - searchRange; i <= centerIdx + searchRange; i++) {
      if (i >= 0 && i < nPts && ySum[i] < minVal) minVal = ySum[i];
    }
    return minVal;
  }, [ySum]);

  const traces = useMemo(() => {
    if (logScale) {
      const toLog = (arr) => arr.map(v => v > 0 ? Math.log10(v) : -6);
      return [
        makeTrace(xData, toLog(ySum), lambda, { fill: 'none', line: { width: 3 } }),
        makeTrace(xData, toLog(y1), lambda, { fill: 'none', line: { width: 1.5, dash: 'dash' }, fillcolor: 'transparent' }),
        makeTrace(xData, toLog(y2), lambda, { fill: 'none', line: { width: 1.5, dash: 'dash' }, fillcolor: 'transparent' }),
      ];
    }
    return [
      makeTrace(xData, ySum, lambda, { fill: 'tozeroy', line: { width: 3 } }),
      makeTrace(xData, y1, lambda, { fill: 'none', line: { width: 1.5, dash: 'dash' }, fillcolor: 'transparent' }),
      makeTrace(xData, y2, lambda, { fill: 'none', line: { width: 1.5, dash: 'dash' }, fillcolor: 'transparent' }),
    ];
  }, [xData, ySum, y1, y2, lambda, logScale]);

  const xAxisRange = lockAxis && lockedRange.current
    ? [-lockedRange.current * 1e3, lockedRange.current * 1e3]
    : undefined;

  let status, statusLabel;
  if (effectiveRatio < 0.95) {
    status = 'unresolved'; statusLabel = 'Unresolved';
  } else if (effectiveRatio <= 1.05) {
    status = 'rayleigh'; statusLabel = 'Rayleigh Limit';
  } else {
    status = 'resolved'; statusLabel = 'Well Resolved';
  }

  // 2D canvas
  const canvasRef = useRef(null);
  const size = 400;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const timer = setTimeout(() => {
      const ctx = setupCanvas(canvas, size, size);
      const { r: cr, g: cg, b: cb } = wavelengthToRGB(lambda);
      const dpr = window.devicePixelRatio || 1;
      const pxSize = Math.round(size * dpr);
      const imageData = ctx.createImageData(pxSize, pxSize);
      const data = imageData.data;
      const half = pxSize / 2;

      for (let py = 0; py < pxSize; py++) {
        for (let px = 0; px < pxSize; px++) {
          const xPhys = ((px - half) / half) * rMax;
          const yPhys = ((py - half) / half) * rMax;
          const r1d = Math.sqrt((xPhys - sep / 2) ** 2 + yPhys ** 2);
          const r2d = Math.sqrt((xPhys + sep / 2) ** 2 + yPhys ** 2);
          const i1 = airyIntensity(r1d, D_m, lambda_m, L);
          const i2 = airyIntensity(r2d, D_m, lambda_m, L);
          const raw = Math.min(1, i1 + i2);
          const I = Math.pow(raw, gamma);

          const rNorm = Math.sqrt(((px - half) / half) ** 2 + ((py - half) / half) ** 2);
          const visible = rNorm <= 1.0;

          const idx = (py * pxSize + px) * 4;
          data[idx] = visible ? Math.round(cr * I) : 0;
          data[idx + 1] = visible ? Math.round(cg * I) : 0;
          data[idx + 2] = visible ? Math.round(cb * I) : 0;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }, 30);
    return () => clearTimeout(timer);
  }, [D_m, lambda_m, L, sep, lambda, rMax, gamma]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Aperture diameter (D)" value={D} min={0.1} max={10.0} step={0.1} unit="mm" onChange={setD} />
        <Slider label="Wavelength (λ)" value={lambda} min={380} max={780} step={1} unit="nm" onChange={setLambda} />

        <div className="mt-3 mb-3">
          <h3 className="text-usna-muted text-xs font-semibold uppercase tracking-wider mb-2">
            Separation Input
          </h3>
          <div className="flex rounded overflow-hidden border border-usna-grid">
            <button
              onClick={() => setInputMode('angle')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                inputMode === 'angle'
                  ? 'bg-usna-gold text-usna-deep'
                  : 'bg-usna-card text-usna-text hover:text-usna-gold'
              }`}
            >
              Angular (Δθ/θ_c)
            </button>
            <button
              onClick={() => setInputMode('distance')}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                inputMode === 'distance'
                  ? 'bg-usna-gold text-usna-deep'
                  : 'bg-usna-card text-usna-text hover:text-usna-gold'
              }`}
            >
              Distance (R, s)
            </button>
          </div>
        </div>

        {inputMode === 'angle' ? (
          <Slider
            label="Source separation (Δθ/θ_c)"
            value={sepRatio}
            min={0.2} max={3.0} step={0.05}
            unit="× θ_c"
            onChange={setSepRatio}
          />
        ) : (
          <>
            <Slider label="Distance to sources (R)" value={R} min={1} max={100000} step={1} unit="m" onChange={setR} />
            <Slider label="Source separation (s)" value={s} min={0.001} max={100} step={0.001} unit="m" onChange={setS} />
          </>
        )}

        <div className="mt-4 space-y-2">
          <StatusBadge status={status} label={statusLabel} />
          <Readout label="θ_c" value={(thetaC * 1e3).toFixed(4)} unit="mrad" />
          <Readout label="Δθ" value={(deltaTheta * 1e3).toFixed(4)} unit="mrad" />
          <Readout label="Δθ / θ_c" value={effectiveRatio.toFixed(3)} unit="" />
          <Readout label="Dip depth" value={(dipDepth * 100).toFixed(1)} unit="%" />
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
                title: { text: 'Screen Position (mm)' },
                ...(xAxisRange && { range: xAxisRange }),
              },
              ...(logScale && {
                yaxis: { title: { text: 'log₁₀ Intensity' }, range: [-6, 0.05] },
              }),
            }}
          />
        </div>

        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="rounded border border-usna-grid"
            style={{ width: size, height: size }}
          />
        </div>

        <InfoPanel
          title="Rayleigh Criterion"
          description="Two point sources are 'just resolved' when the central maximum of one Airy pattern falls on the first dark ring of the other. At this limit, the combined intensity dip between the peaks is about 74% of the maximum."
          equation={String.raw`\theta_c = 1.22\,\frac{\lambda}{D}, \qquad \theta \approx \frac{s}{R}`}
        />
      </div>
    </div>
  );
}
