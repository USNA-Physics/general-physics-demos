import { useState, useRef, useEffect, useMemo } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D37b · Coupled Oscillators → the Continuum String — SP211 L37, Block 0.
 *
 * The bridge from the single oscillator of L35–L36 to the field y(x,t) of the
 * wave equation. A string is a chain of coupled simple harmonic oscillators:
 * each bead n (mass m, spacing a) is pulled back by the tension in the two
 * segments to its neighbours,
 *
 *     m ÿ_n = (F_T / a) (y_{n+1} − 2 y_n + y_{n−1}).
 *
 * Nothing new is introduced from N = 1 to N → ∞ — only Newton's second law on
 * more masses. Three modes tell the story:
 *
 *   chain      Beads on a string. Pluck one and watch the coupled motion. N = 1
 *              is the L35 oscillator (ω = √(2F_T/ma)); N = 2 beats; N ≈ 20 a
 *              plucked disturbance propagates and reflects. A gold continuum
 *              curve interpolates the beads so the "string" appears as N grows.
 *   modes      The chain frozen into normal mode p, shape sin(pπn/(N+1)), with
 *              the discrete dispersion relation ω = 2√(F_T/ma)|sin(ka/2)| peeling
 *              off the continuum line ω = vk toward the zone edge k = π/a.
 *   continuum  Sweep N upward: the same launched pulse goes from lumpy and
 *              dispersing to a clean shape travelling at v = √(F_T/μ). An
 *              optional inset watches the second difference become ∂²y/∂x².
 *
 * Physics is a pure velocity-Verlet integrator on N degrees of freedom (no ODE
 * library); the force is a three-point stencil, O(N) per substep. Normal-mode
 * shapes and frequencies are closed form. All state lives in refs; the rAF loop
 * reads sliders from refs and draws imperatively; readouts publish ~10 Hz.
 *
 * Choice worth flagging: the linear mass density μ is the slider (not per-bead
 * mass), so v = √(F_T/μ) is held fixed as N sweeps and the continuum limit is a
 * refinement of the *same* string. Per-bead mass m = μa is a derived readout.
 * With a = L/(N+1) the N = 1 case reproduces ω = √(2F_T/ma) exactly.
 */

// ── palette (hex for canvas) ───────────────────────────────────────────────
const NAVY = '#4472C4';   // the discrete medium (beads/segments); lifted from #00205B for contrast on dark bg
const NAVY_DEEP = '#00205B';
const GOLD = '#C5B783';   // the continuum / answer overlay
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const RED = '#E06C6C';
const GRID = '#1A2332';
const BG = '#0D1321';

const L = 1.0;            // string length (m), fixed
const A0 = 0.10;          // default pluck / pulse amplitude (m)
const Y_SCALE = 0.14;     // |y| that maps to the canvas amplitude band

const PRESETS = [
  { slug: 'kick', label: 'Single-bead kick' },
  { slug: 'gaussian', label: 'Gaussian bump' },
  { slug: 'launch', label: 'Launched pulse →' },
  { slug: 'halfsine', label: 'Half-sine (mode 1)' },
];

/* ========================================================================== *
 *  Physics — velocity-Verlet on the coupled chain                            *
 * ========================================================================== */

// spacing for N interior beads between fixed walls at x = 0 and x = L
const spacing = (N) => L / (N + 1);
// stencil coefficient  F_T / (m a) = F_T / (μ a²)  (since m = μ a)
const stencilCoef = (FT, muSI, a) => FT / (muSI * a * a);
const waveV = (FT, muSI) => Math.sqrt(FT / muSI);

// Build initial (y, v) for a preset. Arrays are length N+2 with ghost/wall
// nodes at indices 0 and N+1; beads live at 1..N, bead n sits at x = n·a.
function seedState(preset, N, FT, muSI) {
  const y = new Float64Array(N + 2);
  const v = new Float64Array(N + 2);
  const a = spacing(N);
  const x = (n) => n * a;
  const w = 0.07;                        // Gaussian half-width (m)
  const g = (xn) => { const u = (xn - 0.5) / w; return A0 * Math.exp(-u * u); };
  const gprime = (xn) => g(xn) * (-2 * (xn - 0.5) / (w * w));
  const vw = waveV(FT, muSI);

  if (preset === 'kick') {
    const mid = Math.max(1, Math.round((N + 1) / 2));
    y[mid] = A0;
  } else if (preset === 'gaussian') {
    for (let n = 1; n <= N; n++) y[n] = g(x(n));
  } else if (preset === 'launch') {
    // right-moving d'Alembert pulse: y = f(x), ẏ = −v f'(x)
    for (let n = 1; n <= N; n++) { y[n] = g(x(n)); v[n] = -vw * gprime(x(n)); }
  } else if (preset === 'halfsine') {
    for (let n = 1; n <= N; n++) y[n] = A0 * Math.sin((Math.PI * n) / (N + 1));
  }
  return { y, v };
}

function applyBC(y, N, freeEnds) {
  if (freeEnds) { y[0] = y[1]; y[N + 1] = y[N]; }   // Neumann: zero slope
  else { y[0] = 0; y[N + 1] = 0; }                  // Dirichlet: pinned
}

// One velocity-Verlet substep in place. `acc` is scratch of length N+2.
function verletStep(y, v, acc, N, coef, dt, freeEnds) {
  applyBC(y, N, freeEnds);
  for (let n = 1; n <= N; n++) acc[n] = coef * (y[n + 1] - 2 * y[n] + y[n - 1]);
  for (let n = 1; n <= N; n++) { v[n] += 0.5 * acc[n] * dt; y[n] += v[n] * dt; }
  applyBC(y, N, freeEnds);
  for (let n = 1; n <= N; n++) {
    const a2 = coef * (y[n + 1] - 2 * y[n] + y[n - 1]);
    v[n] += 0.5 * a2 * dt;
  }
}

// Closed-form normal mode p: shape sin(pπn/(N+1)), ω_p = 2√coef·|sin(pπ/2(N+1))|.
const modeOmega = (p, N, coef) => 2 * Math.sqrt(coef) * Math.abs(Math.sin((p * Math.PI) / (2 * (N + 1))));
const modeK = (p, N, a) => (p * Math.PI) / ((N + 1) * a);   // = pπ/L

/* ── Catmull-Rom helper: smooth gold curve through node points ───────────── */
function strokeSmooth(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
  ctx.stroke();
}

// Catmull-Rom interpolation of y at an arbitrary x in [0, L], given node values
// y[0..N+1] at x_n = n·a. Used for the continuum second-derivative reference.
function splineY(yArr, N, a, xq) {
  const t = xq / a;                 // continuous node index
  let i = Math.floor(t);
  if (i < 0) i = 0; if (i > N) i = N;
  const f = t - i;
  const p0 = yArr[Math.max(0, i - 1)];
  const p1 = yArr[i];
  const p2 = yArr[Math.min(N + 1, i + 1)];
  const p3 = yArr[Math.min(N + 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

/* ========================================================================== *
 *  Mode dispatch (hook-free wrapper so switching never reorders hooks)        *
 * ========================================================================== */

export default function CoupledOscillators({ mode = 'chain' }) {
  if (mode === 'modes') return <ModesView />;
  if (mode === 'continuum') return <ContinuumView />;
  return <ChainView />;
}

/* ========================================================================== *
 *  CHAIN — beads on a string                                                  *
 * ========================================================================== */

const CHAIN_DEFAULTS = { N: 2, FT: 10, mu: 8, speed: 0.03 };

function ChainView() {
  const [N, setN] = useState(CHAIN_DEFAULTS.N);
  const [FT, setFT] = useState(CHAIN_DEFAULTS.FT);     // N
  const [mu, setMu] = useState(CHAIN_DEFAULTS.mu);     // g/m displayed; kg/m internal
  const [speed, setSpeed] = useState(CHAIN_DEFAULTS.speed);
  const [preset, setPreset] = useState('kick');
  const [freeEnds, setFreeEnds] = useState(false);
  const [showCont, setShowCont] = useState(true);
  const [highlight, setHighlight] = useState(false);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState({ energy: 0 });
  const nonceRef = useRef(0);

  const muSI = mu / 1000;
  const a = spacing(N);
  const v = waveV(FT, muSI);
  const mBead = muSI * a;             // per-bead mass (kg)

  const reseed = () => { nonceRef.current++; };
  const reset = () => {
    setN(CHAIN_DEFAULTS.N); setFT(CHAIN_DEFAULTS.FT); setMu(CHAIN_DEFAULTS.mu);
    setSpeed(CHAIN_DEFAULTS.speed); setPreset('kick'); setFreeEnds(false);
    setShowCont(true); setHighlight(false); setPaused(false); reseed();
  };

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pRef = useRef({});
  pRef.current = { N, FT, muSI, speed, preset, freeEnds, showCont, highlight, paused, nonce: nonceRef.current };

  // index of the bead whose restoring force + y(t) we highlight
  const hiRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastNow, lastPub = 0;
    const padX = 30;
    const sim = { y: null, v: null, acc: null, N: 0, t: 0, key: '', trace: [] };

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const geom = () => {
      const x0 = padX, x1 = W - padX, span = x1 - x0;
      const y0 = H * 0.46, ampPx = H * 0.30;
      return { x0, x1, span, y0, ampPx };
    };
    const nodeGX = (n, g) => g.x0 + (n / (sim.N + 1)) * g.span;
    const yToPY = (yv, g) => g.y0 - (yv / Y_SCALE) * g.ampPx;

    // click → highlight nearest bead (toggle off if same)
    const onDown = (e) => {
      const p = pRef.current;
      if (!p.highlight) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const g = geom();
      let best = 1, bd = Infinity;
      for (let n = 1; n <= sim.N; n++) { const d = Math.abs(nodeGX(n, g) - px); if (d < bd) { bd = d; best = n; } }
      hiRef.current = hiRef.current === best ? null : best;
    };
    canvas.addEventListener('pointerdown', onDown);

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let rdt = (now - lastNow) / 1000; lastNow = now;
      if (!(rdt > 0) || rdt > 0.1) rdt = 1 / 60;
      const p = pRef.current;
      const a = spacing(p.N);
      const coef = stencilCoef(p.FT, p.muSI, a);
      const vw = waveV(p.FT, p.muSI);

      // (re)seed on N / preset / BC / nonce change
      const key = `${p.N}|${p.preset}|${p.freeEnds ? 'f' : 'p'}|${p.nonce}`;
      if (sim.key !== key) {
        const s = seedState(p.preset, p.N, p.FT, p.muSI);
        sim.y = s.y; sim.v = s.v; sim.acc = new Float64Array(p.N + 2);
        sim.N = p.N; sim.t = 0; sim.key = key; sim.trace = [];
        if (hiRef.current && hiRef.current > p.N) hiRef.current = null;
      }

      // advance physics by slow-motion-scaled time, substepping for stability
      if (!p.paused) {
        const dtFrame = rdt * p.speed;
        const dtMax = 0.2 * a / vw;
        const nsub = Math.min(600, Math.max(1, Math.ceil(dtFrame / dtMax)));
        const dt = dtFrame / nsub;
        for (let s = 0; s < nsub; s++) verletStep(sim.y, sim.v, sim.acc, sim.N, coef, dt, p.freeEnds);
        sim.t += dtFrame;
      }

      const g = geom();
      ctx.clearRect(0, 0, W, H);

      // equilibrium baseline + walls
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y0); ctx.stroke();
      ctx.setLineDash([]);
      if (!p.freeEnds) {
        ctx.strokeStyle = MUTED; ctx.lineWidth = 2;
        [0, sim.N + 1].forEach((n) => {
          const gx = nodeGX(n, g);
          ctx.beginPath(); ctx.moveTo(gx, g.y0 - 16); ctx.lineTo(gx, g.y0 + 16); ctx.stroke();
        });
      }

      // tension segments (navy polyline through all nodes incl. walls)
      ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let n = 0; n <= sim.N + 1; n++) {
        const gx = nodeGX(n, g), gy = yToPY(sim.y[n], g);
        n ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
      }
      ctx.stroke();

      // gold continuum curve through the beads
      if (p.showCont) {
        const pts = [];
        for (let n = 0; n <= sim.N + 1; n++) pts.push([nodeGX(n, g), yToPY(sim.y[n], g)]);
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4;
        ctx.shadowColor = GOLD; ctx.shadowBlur = 6;
        strokeSmooth(ctx, pts);
        ctx.shadowBlur = 0;
      }

      // beads (skip filled circles when very dense to stay readable)
      const r = Math.max(2, Math.min(6, 90 / sim.N));
      const drawBeads = sim.N <= 80;
      for (let n = 1; n <= sim.N; n++) {
        const gx = nodeGX(n, g), gy = yToPY(sim.y[n], g);
        const isHi = p.highlight && hiRef.current === n;
        if (drawBeads || isHi) {
          ctx.beginPath(); ctx.arc(gx, gy, isHi ? 7 : r, 0, 2 * Math.PI);
          ctx.fillStyle = isHi ? RED : NAVY_DEEP;
          ctx.strokeStyle = isHi ? RED : NAVY;
          ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
        }
      }

      // highlighted bead: restoring-force breakdown + y(t) trace
      if (p.highlight && hiRef.current && hiRef.current <= sim.N) {
        const n = hiRef.current;
        const gx = nodeGX(n, g), gy = yToPY(sim.y[n], g);
        const gxL = nodeGX(n - 1, g), gyL = yToPY(sim.y[n - 1], g);
        const gxR = nodeGX(n + 1, g), gyR = yToPY(sim.y[n + 1], g);
        // tension pulls along each segment toward the neighbour (unit·scale)
        const seg = (tx, ty) => { const dx = tx - gx, dy = ty - gy, L2 = Math.hypot(dx, dy) || 1; return [dx / L2, dy / L2]; };
        const [ulx, uly] = seg(gxL, gyL), [urx, ury] = seg(gxR, gyR);
        const TS = 30;
        ctx.globalAlpha = 0.9;
        drawArrow(ctx, { x: gx, y: gy, dx: ulx * TS, dy: uly * TS, color: MUTED, width: 2, head: 8 });
        drawArrow(ctx, { x: gx, y: gy, dx: urx * TS, dy: ury * TS, color: MUTED, width: 2, head: 8 });
        ctx.globalAlpha = 1;
        // net transverse restoring force  ∝ (y_{n+1} + y_{n-1} − 2y_n)
        const netY = (sim.y[n + 1] + sim.y[n - 1] - 2 * sim.y[n]);
        const fpx = Math.max(-70, Math.min(70, -(netY / Y_SCALE) * g.ampPx * 2.2));
        drawArrow(ctx, { x: gx, y: gy, dx: 0, dy: -fpx, color: RED, width: 3, head: 10, label: 'F restoring' });

        // y(t) trace strip along the bottom
        if (!p.paused) { sim.trace.push(sim.y[n]); if (sim.trace.length > 320) sim.trace.shift(); }
        const ty0 = H - 36, tAmp = 26;
        ctx.strokeStyle = GRID; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(g.x0, ty0); ctx.lineTo(g.x1, ty0); ctx.stroke();
        ctx.strokeStyle = RED; ctx.lineWidth = 1.8;
        ctx.beginPath();
        const tr = sim.trace;
        for (let i = 0; i < tr.length; i++) {
          const gxx = g.x0 + (i / 320) * g.span;
          const gyy = ty0 - (tr[i] / Y_SCALE) * tAmp;
          i ? ctx.lineTo(gxx, gyy) : ctx.moveTo(gxx, gyy);
        }
        ctx.stroke();
        ctx.fillStyle = MUTED; ctx.font = '11px monospace';
        ctx.fillText(`bead ${n}:  y(t) — its simple harmonic motion`, g.x0, ty0 - tAmp - 4);
      } else if (p.highlight) {
        ctx.fillStyle = MUTED; ctx.font = '12px monospace';
        ctx.fillText('tap a bead to see its restoring force and y(t)', g.x0, H - 14);
      }

      // caption
      ctx.fillStyle = MUTED; ctx.font = '11px monospace';
      ctx.fillText(`N = ${sim.N}  bead${sim.N === 1 ? '' : 's'}${sim.N === 1 ? '  (this is the L35 oscillator)' : ''}`, g.x0, 18);

      // throttled energy readout (½m v² + ½(F_T/a)(Δy)²)
      if (now - lastPub > 100) {
        lastPub = now;
        let E = 0;
        for (let n = 1; n <= sim.N; n++) E += 0.5 * (p.muSI * a) * sim.v[n] * sim.v[n];
        for (let n = 0; n <= sim.N; n++) { const dy = sim.y[n + 1] - sim.y[n]; E += 0.5 * (p.FT / a) * dy * dy; }
        setLive({ energy: E });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('pointerdown', onDown); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Beads (N)" value={N} min={1} max={120} step={1} unit="" onChange={setN} />
        <Slider label="Tension (F_T)" value={FT} min={2} max={40} step={1} unit="N" onChange={setFT} />
        <Slider label="Linear density (μ)" value={mu} min={2} max={30} step={0.5} unit="g/m" onChange={setMu} />
        <Slider label="Slow motion" value={speed} min={0.005} max={0.1} step={0.005} unit="×" onChange={setSpeed} />

        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-1.5">Initial condition</div>
          <select
            value={preset}
            onChange={(e) => { setPreset(e.target.value); reseed(); }}
            className="w-full bg-usna-deep text-usna-text border border-usna-grid rounded px-2 py-1.5 text-sm focus:border-usna-gold outline-none"
          >
            {PRESETS.map((pr) => <option key={pr.slug} value={pr.slug}>{pr.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-2 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setPaused((x) => !x)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
              {paused ? '▶ Play' : '❚❚ Pause'}
            </button>
            <button onClick={reseed}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors">
              ↺ Re-pluck
            </button>
          </div>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={freeEnds} onChange={(e) => { setFreeEnds(e.target.checked); reseed(); }} />
            free ends (default: fixed)
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={showCont} onChange={(e) => setShowCont(e.target.checked)} />
            continuum curve
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
            highlight one bead
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Beads N" value={N} unit="" />
          <Readout label="Spacing a = L/(N+1)" value={(a * 1000).toFixed(1)} unit="mm" />
          <Readout label="Bead mass m = μa" value={(mBead * 1000).toFixed(2)} unit="g" />
          <Readout label="Wave speed √(F_T/μ)" value={v.toFixed(2)} unit="m/s" />
          <Readout label="Energy (conserved)" value={live.energy.toExponential(2)} unit="J" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 400, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ cursor: highlight ? 'pointer' : 'default', touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="One bead is SHM; many beads is a wave"
          description="Each bead is pulled back by the tension in the two segments to its neighbours, so its equation of motion is Newton's second law with a three-point restoring force. At N = 1 that is exactly the L35 mass–spring oscillator, ω = √(2F_T/ma). At N = 2 two normal modes beat against each other as energy sloshes back and forth. By N ≈ 20 a pluck no longer just sloshes — a disturbance propagates down the chain and reflects off the fixed ends, and the gold continuum curve shows the beads already tracing a smooth string. Nothing new was added but more masses. The wave speed is set by the string (F_T and μ), not by how hard you pluck, and a symplectic integrator keeps the total energy flat over long runs."
          equation={String.raw`m\ddot y_n = \frac{F_T}{a}\,\bigl(y_{n+1} - 2y_n + y_{n-1}\bigr), \qquad v = \sqrt{F_T/\mu}, \quad \mu = m/a`}
        />
      </div>
    </div>
  );
}

/* ========================================================================== *
 *  MODES — normal modes & dispersion                                          *
 * ========================================================================== */

const MODES_DEFAULTS = { N: 8, FT: 10, mu: 8, p: 1 };

function ModesView() {
  const [N, setN] = useState(MODES_DEFAULTS.N);
  const [FT, setFT] = useState(MODES_DEFAULTS.FT);
  const [mu, setMu] = useState(MODES_DEFAULTS.mu);
  const [p, setP] = useState(MODES_DEFAULTS.p);
  const [animate, setAnimate] = useState(true);
  const [paused, setPaused] = useState(false);

  const muSI = mu / 1000;
  const a = spacing(N);
  const coef = stencilCoef(FT, muSI, a);
  const v = waveV(FT, muSI);
  const pClamped = Math.min(p, N);
  const omegaP = modeOmega(pClamped, N, coef);
  const kP = modeK(pClamped, N, a);

  // keep p ≤ N as N shrinks
  useEffect(() => { if (p > N) setP(N); }, [N, p]);

  const reset = () => { setN(MODES_DEFAULTS.N); setFT(MODES_DEFAULTS.FT); setMu(MODES_DEFAULTS.mu); setP(MODES_DEFAULTS.p); setAnimate(true); setPaused(false); };

  // ── left canvas: the chain frozen (or oscillating) in mode p ─────────────
  const wrapRef = useRef(null), canvasRef = useRef(null);
  const pRef = useRef({});
  pRef.current = { N, coef, p: pClamped, animate, paused };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastNow, t = 0;
    const padX = 30;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let rdt = (now - lastNow) / 1000; lastNow = now;
      if (!(rdt > 0) || rdt > 0.1) rdt = 1 / 60;
      const pr = pRef.current;
      const wp = modeOmega(pr.p, pr.N, pr.coef);
      // slow the standing oscillation to a watchable rate independent of ω_p
      if (pr.animate && !pr.paused) t += rdt;
      const envelope = pr.animate ? Math.cos(2 * Math.PI * 0.12 * t * (wp / modeOmega(1, pr.N, pr.coef))) : 1;

      const x0 = padX, x1 = W - padX, span = x1 - x0, y0 = H * 0.5, ampPx = H * 0.34;
      const nodeGX = (n) => x0 + (n / (pr.N + 1)) * span;
      const shape = (n) => A0 * Math.sin((pr.p * Math.PI * n) / (pr.N + 1)) * envelope;
      const yToPY = (yv) => y0 - (yv / Y_SCALE) * ampPx;

      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); ctx.setLineDash([]);

      // gold sine arch (the continuous-string mode shape)
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
      ctx.beginPath();
      const SAMP = 160;
      for (let i = 0; i <= SAMP; i++) {
        const nn = (i / SAMP) * (pr.N + 1);
        const gx = x0 + (i / SAMP) * span;
        const gy = yToPY(A0 * Math.sin((pr.p * Math.PI * nn) / (pr.N + 1)) * envelope);
        i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
      }
      ctx.stroke(); ctx.globalAlpha = 1;

      // chain segments
      ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let n = 0; n <= pr.N + 1; n++) { const gx = nodeGX(n), gy = yToPY(n === 0 || n === pr.N + 1 ? 0 : shape(n)); n ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy); }
      ctx.stroke();

      // beads
      const r = Math.max(2.5, Math.min(6, 90 / pr.N));
      for (let n = 1; n <= pr.N; n++) {
        const gx = nodeGX(n), gy = yToPY(shape(n));
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 2 * Math.PI);
        ctx.fillStyle = NAVY_DEEP; ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      }

      ctx.fillStyle = MUTED; ctx.font = '12px monospace';
      ctx.fillText(`mode p = ${pr.p} of N = ${pr.N}   ·   shape sin(pπn/(N+1))`, x0, 20);

      raf = requestAnimationFrame(draw);
    };
    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── dispersion + ladder (Plotly, recompute only on N/F_T/μ) ──────────────
  const disp = useMemo(() => {
    const kEdge = Math.PI / a;
    const kDisc = [], wDisc = [];
    for (let q = 1; q <= N; q++) { kDisc.push(modeK(q, N, a)); wDisc.push(modeOmega(q, N, coef)); }
    // continuum line ω = v k over [0, zone edge]
    const kLine = [0, kEdge], wLine = [0, v * kEdge];
    return { kDisc, wDisc, kLine, wLine, kEdge };
  }, [N, FT, mu, a, coef, v]);

  const dispTraces = useMemo(() => ([
    { x: disp.kLine, y: disp.wLine, type: 'scatter', mode: 'lines', line: { color: GOLD, width: 2.5 }, name: 'ω = v k' },
    { x: disp.kDisc, y: disp.wDisc, type: 'scatter', mode: 'markers', marker: { color: NAVY, size: 8 }, name: 'discrete ω_p' },
    { x: [disp.kDisc[pClamped - 1]], y: [disp.wDisc[pClamped - 1]], type: 'scatter', mode: 'markers', marker: { color: RED, size: 13, line: { color: TEXT, width: 1 } }, name: 'selected' },
    { x: [disp.kEdge, disp.kEdge], y: [0, Math.max(...disp.wDisc) * 1.08], type: 'scatter', mode: 'lines', line: { color: MUTED, width: 1, dash: 'dot' }, name: 'zone edge k = π/a' },
  ]), [disp, pClamped]);

  const dispLayout = useMemo(() => ({
    margin: { l: 58, r: 14, t: 28, b: 46 },
    xaxis: { title: { text: 'wavenumber k (rad/m)', font: { size: 14 } }, range: [0, disp.kEdge * 1.04] },
    yaxis: { title: { text: 'ω (rad/s)', font: { size: 14 } }, range: [0, Math.max(...disp.wDisc) * 1.1], autorange: false },
    showlegend: false,
  }), [disp]);

  const ladderTraces = useMemo(() => {
    const ps = []; for (let q = 1; q <= N; q++) ps.push(q);
    return [
      { x: ps, y: ps.map((q) => (q * Math.PI * v) / L), type: 'scatter', mode: 'lines', line: { color: GOLD, width: 2.5 }, name: 'pπv/L' },
      { x: ps, y: ps.map((q) => modeOmega(q, N, coef)), type: 'scatter', mode: 'markers', marker: { color: NAVY, size: 7 }, name: 'discrete' },
      { x: [pClamped], y: [omegaP], type: 'scatter', mode: 'markers', marker: { color: RED, size: 12, line: { color: TEXT, width: 1 } }, name: 'selected' },
    ];
  }, [N, FT, mu, coef, v, pClamped, omegaP]);

  const ladderLayout = useMemo(() => ({
    margin: { l: 58, r: 14, t: 28, b: 46 },
    xaxis: { title: { text: 'mode number p', font: { size: 14 } }, range: [0, N + 1] },
    yaxis: { title: { text: 'ω_p (rad/s)', font: { size: 14 } }, autorange: true },
    showlegend: false,
  }), [N]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Beads (N)" value={N} min={1} max={60} step={1} unit="" onChange={setN} />
        <Slider label="Mode number (p)" value={pClamped} min={1} max={Math.max(1, N)} step={1} unit="" onChange={setP} />
        <Slider label="Tension (F_T)" value={FT} min={2} max={40} step={1} unit="N" onChange={setFT} />
        <Slider label="Linear density (μ)" value={mu} min={2} max={30} step={0.5} unit="g/m" onChange={setMu} />

        <div className="flex items-center gap-2 border-t border-usna-grid pt-3">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
            animate cos(ω_p t)
          </label>
          {animate && (
            <button onClick={() => setPaused((x) => !x)}
              className="px-3 py-1 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
              {paused ? '▶' : '❚❚'}
            </button>
          )}
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Modes available" value={N} unit="" />
          <Readout label="Selected k_p" value={kP.toFixed(2)} unit="rad/m" />
          <Readout label="Discrete ω_p" value={omegaP.toFixed(1)} unit="rad/s" />
          <Readout label="Continuum v·k_p" value={(v * kP).toFixed(1)} unit="rad/s" />
          <Readout label="Zone edge π/a" value={(Math.PI / a).toFixed(1)} unit="rad/m" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 240, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0 bg-usna-card border border-usna-grid rounded-lg p-2 overflow-hidden" style={{ height: 300 }}>
            <IntensityPlot traces={dispTraces} layoutOverrides={dispLayout} />
          </div>
          <div className="flex-1 min-w-0 bg-usna-card border border-usna-grid rounded-lg p-2 overflow-hidden" style={{ height: 300 }}>
            <IntensityPlot traces={ladderTraces} layoutOverrides={ladderLayout} />
          </div>
        </div>
        <InfoPanel
          title="N modes, and why low modes already look continuous"
          description="An N-bead chain has exactly N normal modes, each a collective simple harmonic motion with shape sin(pπn/(N+1)). The low modes are the sine arches of a continuous string, so their frequencies land right on the continuum line ω = vk (left plot) and the continuum ladder pπv/L (right plot). The discrete dispersion curve ω = 2√(F_T/ma)|sin(ka/2)| only peels away from the straight line as k approaches the zone edge π/a — the shortest wavelength the lattice can represent, where neighbouring beads swing in antiphase. The chain simply runs out of modes at p = N; everything below that is the string you already know. This is the hook to L41 standing waves."
          equation={String.raw`y_n^{(p)} = \sin\!\frac{p\pi n}{N+1}, \qquad \omega(k) = 2\sqrt{F_T/ma}\;\bigl|\sin(ka/2)\bigr| \;\xrightarrow[ka\ll1]{}\; vk`}
        />
      </div>
    </div>
  );
}

/* ========================================================================== *
 *  CONTINUUM — take N → ∞                                                      *
 * ========================================================================== */

const CONT_DEFAULTS = { N: 6, FT: 10, mu: 8, speed: 0.03 };

function ContinuumView() {
  const [N, setN] = useState(CONT_DEFAULTS.N);
  const [FT, setFT] = useState(CONT_DEFAULTS.FT);
  const [mu, setMu] = useState(CONT_DEFAULTS.mu);
  const [speed, setSpeed] = useState(CONT_DEFAULTS.speed);
  const [paused, setPaused] = useState(false);
  const [autoN, setAutoN] = useState(false);
  const [showInset, setShowInset] = useState(false);
  const nonceRef = useRef(0);

  const muSI = mu / 1000;
  const a = spacing(N);
  const v = waveV(FT, muSI);

  const reseed = () => { nonceRef.current++; };
  const reset = () => { setN(CONT_DEFAULTS.N); setFT(CONT_DEFAULTS.FT); setMu(CONT_DEFAULTS.mu); setSpeed(CONT_DEFAULTS.speed); setPaused(false); setAutoN(false); setShowInset(false); reseed(); };

  // auto-increase N sweep
  useEffect(() => {
    if (!autoN) return undefined;
    const id = setInterval(() => {
      setN((n) => {
        if (n >= 120) { setAutoN(false); return n; }
        return Math.min(120, n + 2);
      });
    }, 180);
    return () => clearInterval(id);
  }, [autoN]);

  const wrapRef = useRef(null), canvasRef = useRef(null);
  const pRef = useRef({});
  pRef.current = { N, FT, muSI, speed, paused, showInset, nonce: nonceRef.current };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastNow;
    const padX = 30;
    const sim = { y: null, v: null, acc: null, N: 0, key: '' };
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let rdt = (now - lastNow) / 1000; lastNow = now;
      if (!(rdt > 0) || rdt > 0.1) rdt = 1 / 60;
      const p = pRef.current;
      const a = spacing(p.N);
      const coef = stencilCoef(p.FT, p.muSI, a);
      const vw = waveV(p.FT, p.muSI);

      // reseed on N or nonce change — but preserve the launched pulse shape by
      // reseeding fresh each time (the whole point is the *same* pulse at new N)
      const key = `${p.N}|${p.nonce}`;
      if (sim.key !== key) {
        const s = seedState('launch', p.N, p.FT, p.muSI);
        sim.y = s.y; sim.v = s.v; sim.acc = new Float64Array(p.N + 2); sim.N = p.N; sim.key = key;
      }

      if (!p.paused) {
        const dtFrame = rdt * p.speed;
        const dtMax = 0.2 * a / vw;
        const nsub = Math.min(600, Math.max(1, Math.ceil(dtFrame / dtMax)));
        const dt = dtFrame / nsub;
        for (let s = 0; s < nsub; s++) verletStep(sim.y, sim.v, sim.acc, sim.N, coef, dt, false);
      }

      const splitInset = p.showInset;
      const mainH = splitInset ? H * 0.6 : H;
      const x0 = padX, x1 = W - padX, span = x1 - x0;
      const y0 = mainH * 0.52, ampPx = mainH * 0.34;
      const nodeGX = (n) => x0 + (n / (sim.N + 1)) * span;
      const yToPY = (yv) => y0 - (yv / Y_SCALE) * ampPx;

      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); ctx.setLineDash([]);

      // gold continuum curve first (underlay)
      const pts = [];
      for (let n = 0; n <= sim.N + 1; n++) pts.push([nodeGX(n), yToPY(sim.y[n])]);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6; ctx.shadowColor = GOLD; ctx.shadowBlur = 7;
      strokeSmooth(ctx, pts); ctx.shadowBlur = 0;

      // navy chain segments + beads on top
      ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (let n = 0; n <= sim.N + 1; n++) { const gx = nodeGX(n), gy = yToPY(sim.y[n]); n ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy); }
      ctx.stroke(); ctx.globalAlpha = 1;
      if (sim.N <= 80) {
        const r = Math.max(2, Math.min(5, 80 / sim.N));
        for (let n = 1; n <= sim.N; n++) {
          const gx = nodeGX(n), gy = yToPY(sim.y[n]);
          ctx.beginPath(); ctx.arc(gx, gy, r, 0, 2 * Math.PI);
          ctx.fillStyle = NAVY_DEEP; ctx.strokeStyle = NAVY; ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
        }
      }

      ctx.fillStyle = MUTED; ctx.font = '11px monospace';
      ctx.fillText(sim.N <= 14 ? `N = ${sim.N}: lumpy — the pulse disperses` : `N = ${sim.N}: smooth — one pulse, speed v`, x0, 16);

      // ── second-difference inset: (Δ²y)/a² vs ∂²y/∂x² ─────────────────────
      if (splitInset) {
        const iy0 = mainH + (H - mainH) * 0.5, iAmp = (H - mainH) * 0.34;
        ctx.strokeStyle = GRID; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, mainH); ctx.lineTo(x1, mainH); ctx.stroke();
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(x0, iy0); ctx.lineTo(x1, iy0); ctx.stroke(); ctx.setLineDash([]);

        // normalisation so both curves share a scale
        let peak = 1e-9;
        for (let n = 1; n <= sim.N; n++) peak = Math.max(peak, Math.abs(sim.y[n + 1] - 2 * sim.y[n] + sim.y[n - 1]) / (a * a));
        const sc = (iAmp * 0.9) / peak;

        // gold: smooth ∂²y/∂x² from the spline of the displacement field
        const h = a * 0.5;
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.2; ctx.beginPath();
        const SAMP = 200;
        for (let i = 0; i <= SAMP; i++) {
          const xq = (i / SAMP) * L;
          const xm = Math.max(h, Math.min(L - h, xq));
          const d2 = (splineY(sim.y, sim.N, a, xm + h) - 2 * splineY(sim.y, sim.N, a, xm) + splineY(sim.y, sim.N, a, xm - h)) / (h * h);
          const gx = x0 + (i / SAMP) * span, gy = iy0 - d2 * sc;
          i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
        }
        ctx.stroke();

        // navy dots: discrete (y_{n+1} − 2y_n + y_{n−1}) / a²
        ctx.fillStyle = NAVY;
        for (let n = 1; n <= sim.N; n++) {
          const d2 = (sim.y[n + 1] - 2 * sim.y[n] + sim.y[n - 1]) / (a * a);
          const gx = nodeGX(n), gy = iy0 - d2 * sc;
          ctx.beginPath(); ctx.arc(gx, gy, 3, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.fillStyle = MUTED; ctx.font = '11px monospace';
        ctx.fillText('(y_{n+1}−2y_n+y_{n−1})/a²  →  ∂²y/∂x²', x0, mainH + 14);
      }

      raf = requestAnimationFrame(draw);
    };
    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Beads (N)" value={N} min={2} max={120} step={1} unit="" onChange={(x) => { setN(x); }} />
        <Slider label="Tension (F_T)" value={FT} min={2} max={40} step={1} unit="N" onChange={setFT} />
        <Slider label="Linear density (μ)" value={mu} min={2} max={30} step={0.5} unit="g/m" onChange={setMu} />
        <Slider label="Slow motion" value={speed} min={0.005} max={0.1} step={0.005} unit="×" onChange={setSpeed} />

        <div className="flex flex-col gap-2 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setPaused((x) => !x)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
              {paused ? '▶ Play' : '❚❚ Pause'}
            </button>
            <button onClick={reseed}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors">
              ⇢ Launch pulse
            </button>
          </div>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={autoN} onChange={(e) => setAutoN(e.target.checked)} />
            auto-increase N
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer select-none">
            <input type="checkbox" checked={showInset} onChange={(e) => setShowInset(e.target.checked)} />
            second-difference inset
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Beads N" value={N} unit="" />
          <Readout label="Spacing a = L/(N+1)" value={(a * 1000).toFixed(1)} unit="mm" />
          <Readout label="Wave speed √(F_T/μ)" value={v.toFixed(2)} unit="m/s" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 420, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="Take N → ∞ and the wave equation emerges"
          description="This is the payoff. Launch the same pulse at small N and it is lumpy: the chain is dispersive, so short-wavelength components travel at the wrong speed and the pulse spreads and trails ripples. Drag N upward (or press auto-increase) and the beads fill in the gold string — the same pulse locks into a single clean shape travelling at v = √(F_T/μ), the long-wavelength non-dispersive limit that L37 Block 1 assumes. Turn on the inset to watch the algebra: the discrete second difference (y_{n+1} − 2y_n + y_{n−1})/a² converges to the smooth second derivative ∂²y/∂x². That single Taylor step is all that separates Newton's second law on a chain of beads from the wave equation. The wave equation is not a new law — it is this law in the limit where the beads are too dense to see."
          equation={String.raw`\frac{y_{n+1}-2y_n+y_{n-1}}{a^2} \xrightarrow[a\to0]{} \frac{\partial^2 y}{\partial x^2}, \qquad \frac{\partial^2 y}{\partial t^2} = v^2\frac{\partial^2 y}{\partial x^2}, \quad v=\sqrt{F_T/\mu}`}
        />
      </div>
    </div>
  );
}
