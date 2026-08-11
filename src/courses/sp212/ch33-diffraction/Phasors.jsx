import { useState, useMemo, useCallback } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import IntensityPlot from '@shared/components/IntensityPlot';
import ScreenStrip from '@shared/components/ScreenStrip';
import InfoPanel from '@shared/components/InfoPanel';
import PhasorDiagram from '@shared/components/PhasorDiagram';
import { singleSlitIntensity, nSlitIntensity, sinc } from '../lib/physics';
import { makeTrace } from '@shared/lib/plotly';

const MODES = [
  { key: 'single-slit', label: 'Single Slit (Huygens)' },
  { key: 'n-slit', label: 'N-Slit Interference' },
];

const SS_DEFAULTS = { a: 0.10, lambda: 550, M: 20 };
const NS_DEFAULTS = { a: 0.08, d: 0.40, lambda: 550, N: 3 };
const L = 2.0;

export default function Phasors() {
  const [mode, setMode] = useState('single-slit');

  const [a, setA] = useState(SS_DEFAULTS.a);
  const [lambda, setLambda] = useState(SS_DEFAULTS.lambda);
  const [M, setM] = useState(SS_DEFAULTS.M);

  const [nsA, setNsA] = useState(NS_DEFAULTS.a);
  const [nsD, setNsD] = useState(NS_DEFAULTS.d);
  const [nsLambda, setNsLambda] = useState(NS_DEFAULTS.lambda);
  const [N, setN] = useState(NS_DEFAULTS.N);

  const [yPos, setYPos] = useState(0);

  const reset = () => {
    if (mode === 'single-slit') {
      setA(SS_DEFAULTS.a); setLambda(SS_DEFAULTS.lambda); setM(SS_DEFAULTS.M);
    } else {
      setNsA(NS_DEFAULTS.a); setNsD(NS_DEFAULTS.d); setNsLambda(NS_DEFAULTS.lambda); setN(NS_DEFAULTS.N);
    }
    setYPos(0);
  };

  const isSingle = mode === 'single-slit';
  const curA = isSingle ? a : nsA;
  const curLambda = isSingle ? lambda : nsLambda;
  const a_m = curA * 1e-3;
  const d_m = nsD * 1e-3;
  const lambda_m = curLambda * 1e-9;
  const yPos_m = yPos * 1e-3;

  const charLen = isSingle ? (lambda_m * L) / a_m : (lambda_m * L) / d_m;
  const xMax = 3 * charLen;

  const yRange = parseFloat((xMax * 1e3).toFixed(2));
  const yStep = Math.max(0.01, parseFloat((yRange / 300).toFixed(2)));

  const phasors = useMemo(() => {
    const sinTheta = yPos_m / Math.sqrt(yPos_m ** 2 + L ** 2);

    if (isSingle) {
      const totalPhase = (2 * Math.PI * a_m * sinTheta) / lambda_m;
      const result = [];
      for (let k = 0; k < M; k++) {
        result.push({ amplitude: 1 / M, phase: (k * totalPhase) / M });
      }
      return result;
    }

    const beta = (Math.PI * a_m * sinTheta) / lambda_m;
    const envelope = sinc(beta);
    const delta = (2 * Math.PI * d_m * sinTheta) / lambda_m;
    const result = [];
    for (let k = 0; k < N; k++) {
      result.push({ amplitude: Math.abs(envelope) / N, phase: k * delta + (envelope < 0 ? Math.PI : 0) });
    }
    return result;
  }, [isSingle, yPos_m, a_m, d_m, lambda_m, M, N]);

  const nPts = 2000;

  const { xData, yData } = useMemo(() => {
    const xs = [];
    const ys = [];
    for (let i = 0; i < nPts; i++) {
      const y = -xMax + (2 * xMax * i) / (nPts - 1);
      xs.push(y * 1e3);
      ys.push(
        isSingle
          ? singleSlitIntensity(y, a_m, lambda_m, L)
          : nSlitIntensity(y, a_m, d_m, N, lambda_m, L),
      );
    }
    return { xData: xs, yData: ys };
  }, [isSingle, a_m, d_m, N, lambda_m, xMax]);

  const traces = useMemo(() => [makeTrace(xData, yData, curLambda)], [xData, yData, curLambda]);

  const markerShapes = [
    {
      type: 'line',
      x0: yPos, x1: yPos,
      y0: 0, y1: 1.05,
      xref: 'x', yref: 'y',
      line: { color: '#C5B783', width: 2, dash: 'dash' },
    },
  ];

  const intensityFn = useCallback(
    (y) =>
      isSingle
        ? singleSlitIntensity(y, a_m, lambda_m, L)
        : nSlitIntensity(y, a_m, d_m, N, lambda_m, L),
    [isSingle, a_m, d_m, N, lambda_m],
  );

  const sinTheta = yPos_m / Math.sqrt(yPos_m ** 2 + L ** 2);
  const totalPhaseDeg = isSingle
    ? ((2 * Math.PI * a_m * sinTheta) / lambda_m) * (180 / Math.PI)
    : ((2 * Math.PI * d_m * sinTheta) / lambda_m) * (180 / Math.PI);

  const infoTitle = isSingle ? 'Huygens Wavelet Phasors' : 'N-Slit Phasors';

  const infoDescription = isSingle
    ? `The slit is divided into ${M} Huygens wavelets. At the center (y = 0) all phasors align, giving maximum intensity. As you move off-axis, the total phase across the slit grows and the chain curls. At the first minimum the chain completes a full circle \u2014 the resultant is zero. Total phase across slit: ${totalPhaseDeg.toFixed(1)}\u00B0.`
    : `Each slit contributes one phasor whose amplitude is set by the single-slit envelope sinc(\u03B2). The phase step between adjacent slits is \u03B4 = 2\u03C0d sin\u03B8/\u03BB. At principal maxima all phasors align; between them, the vectors fan out and partially cancel. Phase step \u03B4: ${totalPhaseDeg.toFixed(1)}\u00B0.`;

  const infoEquation = isSingle
    ? String.raw`E = \sum_{k=0}^{M-1} \frac{1}{M}\, e^{\,i k \Delta\phi / M}, \quad \Delta\phi = \frac{2\pi a \sin\theta}{\lambda}`
    : String.raw`E = \frac{\operatorname{sinc}\beta}{N} \sum_{k=0}^{N-1} e^{\,i k \delta}, \quad \delta = \frac{2\pi d \sin\theta}{\lambda}`;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="flex rounded-lg overflow-hidden border border-usna-grid mb-4">
          {MODES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setMode(key); setYPos(0); }}
              className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                mode === key
                  ? 'bg-usna-gold text-usna-navy'
                  : 'bg-usna-card text-usna-text hover:text-usna-gold'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isSingle ? (
          <>
            <Slider label="Slit width (a)" value={a} min={0.01} max={0.50} step={0.01} unit="mm" onChange={setA} />
            <Slider label="Wavelength (λ)" value={lambda} min={380} max={780} step={1} unit="nm" onChange={setLambda} />
            <Slider label="Wavelets (M)" value={M} min={6} max={60} step={1} unit="" onChange={setM} />
          </>
        ) : (
          <>
            <Slider label="Number of slits (N)" value={N} min={2} max={12} step={1} unit="" onChange={setN} />
            <Slider label="Slit width (a)" value={nsA} min={0.01} max={0.50} step={0.01} unit="mm" onChange={setNsA} />
            <Slider label="Slit separation (d)" value={nsD} min={0.1} max={2.0} step={0.01} unit="mm" onChange={setNsD} />
            <Slider label="Wavelength (λ)" value={nsLambda} min={380} max={780} step={1} unit="nm" onChange={setNsLambda} />
          </>
        )}

        <div className="mt-2 border-t border-usna-grid pt-4">
          <Slider
            label="Screen position (y)"
            value={parseFloat(yPos.toFixed(2))}
            min={-yRange}
            max={yRange}
            step={yStep}
            unit="mm"
            onChange={setYPos}
          />
        </div>
      </ControlPanel>

      <div className="flex-1 flex flex-col gap-4">
        <div className="flex flex-col xl:flex-row gap-4">
          <div className="flex flex-col items-center gap-2">
            <h3 className="text-usna-text text-sm font-medium">Phasor Diagram</h3>
            <PhasorDiagram phasors={phasors} wavelengthNm={curLambda} size={380} />
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <h3 className="text-usna-text text-sm font-medium">Intensity Pattern</h3>
            <div className="bg-usna-card border border-usna-grid rounded-lg p-4" style={{ height: 400 }}>
              <IntensityPlot
                traces={traces}
                layoutOverrides={{
                  xaxis: { title: { text: 'Screen Position y (mm)' } },
                  shapes: markerShapes,
                }}
              />
            </div>
          </div>
        </div>

        <ScreenStrip
          intensityFn={intensityFn}
          xRange={[-xMax, xMax]}
          wavelengthNm={curLambda}
          gamma={0.5}
          height={60}
        />

        <InfoPanel
          title={infoTitle}
          description={infoDescription}
          equation={infoEquation}
        />
      </div>
    </div>
  );
}
