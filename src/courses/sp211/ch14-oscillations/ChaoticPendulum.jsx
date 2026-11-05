import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';
import {
  Q_DEFAULT, OMEGA_D_DEFAULT, PRESETS, STEPS_PER_PERIOD,
  drivePeriod, wrapPi, rk4Step, classifyPeriod,
} from './chaosPhysics';

/**
 * D36 · Chaotic Pendulum Explorer — L36 enrichment (companion to D35 SHM).
 *
 * The driven damped pendulum  θ'' + (1/Q)θ' + sin θ = A cos(ω_D t).  Keep the
 * FULL sin θ (the nonlinearity the small-angle limit throws away), add damping
 * and a periodic push, and the most predictable system in the course becomes
 * chaotic. Five modes, each its own child component so hook sets never collide
 * (the default export is a hook-free wrapper that branches on `mode`):
 *
 *   run         live pendulum + phase space + Poincaré, with period-doubling
 *               drive presets (period 1 → 2 → 4 → chaos). Regime label MEASURED.
 *   divergence  twin pendulums offset by Δθ₀ = 10⁻³; log|Δ(t)| rises linearly
 *               (slope = Lyapunov λ > 0) — determinism without predictability.
 *   poincare    strobe once per drive period and accumulate the strange
 *               attractor; a zoom reveals it stays structured, not a blob.
 *   bifurcation sweep A and plot the Poincaré θ vs A — the period-doubling
 *               cascade. Heavy: runs in a Web Worker, streams columns.
 *   basins      a grid of initial conditions coloured by long-term outcome; the
 *               boundary is a fractal (a Julia-set inset makes the analogy).
 *               Heavy: Web Worker, streams rows, click to zoom.
 *
 * Animation per CONTRIBUTING.md: one rAF loop per mode reading inputs from refs,
 * fixed-step RK4 (several substeps/frame so dt ≪ T_D), readouts published ~10 Hz,
 * no per-frame setState. The sweeps live off-thread (chaosWorker.js).
 */

const GOLD = '#C5B783';
const GOLD_FADE = 'rgba(197,183,131,0.5)';
const RED = '#E06C6C';
const BLUE = '#5B9BD5';
const WHITE = '#F0ECE3';
const BG = '#0D1321';
const GRID = '#1A2332';
const MUTED = '#8B8C8E';
// IBM colorblind-safe trio for the basin classes — distinct from navy/gold chrome
const BASIN_COLORS = [
  [100, 143, 255], // 0 librating (blue)
  [255, 176, 0],   // 1 clockwise (amber)
  [220, 38, 127],  // 2 counter-clockwise (magenta)
];

const TIME_SCALE = 3;       // dimensionless time units per real second at speed 1
const TURBO_RUN = 25;       // "fast forward" multiplier for the pendulum modes
const TURBO_POINCARE = 300; // the Poincaré section needs a large factor to fill quickly
const RUN_TRANSIENT = 8;    // drive periods dropped before Run's Poincaré accumulates
const MONO = '11px JetBrains Mono, monospace';

const col = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function boundedDt(now, last) {
  let dt = (now - last) / 1000;
  if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
  return dt;
}

// Attach a canvas to its wrapper's size and keep it synced. Returns a live
// viewport object { ctx, W, H } plus a dispose().
function makeViewport(wrap, canvas, onResize) {
  const vp = { ctx: null, W: 0, H: 0 };
  const resize = () => {
    vp.W = wrap.clientWidth; vp.H = wrap.clientHeight;
    vp.ctx = setupCanvas(canvas, vp.W, vp.H);
    if (onResize) onResize(vp);
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(wrap);
  return { vp, dispose: () => ro.disconnect() };
}

function clear(ctx, W, H) { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); }

function panelFrame(ctx, x, y, w, h, title) {
  ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  if (title) {
    ctx.fillStyle = MUTED; ctx.font = MONO;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, x + 6, y + 5);
  }
}

// ── the pendulum itself: pivot, rod, bob, optional drive + velocity arrows ──
function drawPendulum(ctx, x, y, w, h, theta, omega, P, opts = {}) {
  const px = x + w / 2, py = y + h * 0.44;
  const armLen = Math.min(w * 0.40, h * 0.34);
  const bx = px + armLen * Math.sin(theta), by = py + armLen * Math.cos(theta);
  const color = opts.color || GOLD;
  // fading bob trail (oldest → newest), used to make divergence legible
  if (opts.trail && opts.trail.length > 1) {
    ctx.fillStyle = color;
    for (let i = 0; i < opts.trail.length; i++) {
      const th = opts.trail[i];
      ctx.globalAlpha = 0.06 + 0.4 * (i / opts.trail.length);
      ctx.beginPath(); ctx.arc(px + armLen * Math.sin(th), py + armLen * Math.cos(th), 2.4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // rod + bob
  ctx.strokeStyle = opts.rod || MUTED; ctx.lineWidth = opts.faint ? 2 : 2.5;
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
  ctx.fillStyle = MUTED; ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = color;
  if (!opts.faint) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
  ctx.beginPath(); ctx.arc(bx, by, opts.faint ? 6 : 9, 0, 2 * Math.PI); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  if (opts.showVel) {
    const vs = Math.min(armLen * 0.9, armLen * 0.22 * Math.abs(omega));
    drawArrow(ctx, { x: bx, y: by, dx: vs * Math.sign(omega) * Math.cos(theta), dy: -vs * Math.sign(omega) * Math.sin(theta), color: BLUE, width: 2.5 });
  }
  if (opts.showDrive) {
    const t = opts.t || 0;
    const dmag = 34 * P.A * Math.cos(P.Om * t);
    drawArrow(ctx, { x: px, y: py - armLen * 0.9, dx: dmag, dy: 0, color: RED, width: 2.5, label: 'drive' });
  }
  return { px, py, bx, by, armLen };
}

// ── phase portrait: θ (x) vs ω (y), fading trail + current point ──
function drawPhase(ctx, x, y, w, h, trail, cur, opts = {}) {
  panelFrame(ctx, x, y, w, h, opts.title || 'phase: θ vs ω');
  const unwrap = opts.unwrap;
  let xMin = -Math.PI, xMax = Math.PI, wMax = 2;
  for (const q of trail) { wMax = Math.max(wMax, Math.abs(q[1])); if (unwrap) { xMin = Math.min(xMin, q[0]); xMax = Math.max(xMax, q[0]); } }
  wMax *= 1.08; const xPad = unwrap ? (xMax - xMin) * 0.05 + 0.1 : 0; xMin -= xPad; xMax += xPad;
  const sx = (v) => x + ((v - xMin) / (xMax - xMin)) * w;
  const sy = (v) => y + h / 2 - (v / wMax) * (h / 2) * 0.92;
  // zero axes
  ctx.strokeStyle = 'rgba(139,140,142,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, sy(0)); ctx.lineTo(x + w, sy(0));
  if (xMin < 0 && xMax > 0) { ctx.moveTo(sx(0), y); ctx.lineTo(sx(0), y + h); } ctx.stroke();
  // plotted abscissa: wrapped to (−π, π] unless the user asked for the raw angle
  const xv = (raw) => (unwrap ? raw : wrapPi(raw));
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = GOLD_FADE; ctx.lineWidth = 1.4; ctx.beginPath();
  let penDown = false;
  trail.forEach((q, i) => {
    const px = xv(q[0]), qx = sx(px), qy = sy(q[1]);
    // lift the pen across a wrap seam so no segment streaks across the plot
    if (penDown && !unwrap && Math.abs(px - xv(trail[i - 1][0])) > Math.PI) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(qx, qy); }
    else if (!penDown) { ctx.moveTo(qx, qy); penDown = true; }
    else ctx.lineTo(qx, qy);
  });
  ctx.stroke();
  if (cur) { ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(sx(unwrap ? cur[0] : wrapPi(cur[0])), sy(cur[1]), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  ctx.restore();
}

// ── Poincaré section scatter: θ (x) vs ω (y), accumulated strobe points ──
function drawPoincare(ctx, x, y, w, h, pts, opts = {}) {
  panelFrame(ctx, x, y, w, h, opts.title || 'Poincaré section');
  const cx = opts.cx ?? 0, cyv = opts.cy ?? 0, zoom = opts.zoom ?? 1;
  const halfX = Math.PI / zoom, halfY = (opts.wSpan ?? 3) / zoom;
  const sx = (v) => x + ((v - (cx - halfX)) / (2 * halfX)) * w;
  const sy = (v) => y + h - ((v - (cyv - halfY)) / (2 * halfY)) * h;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = GOLD;
  for (const q of pts) {
    const qx = sx(wrapPi(q[0])), qy = sy(q[1]);
    if (qx < x || qx > x + w || qy < y || qy > y + h) continue;
    ctx.fillRect(qx - 0.75, qy - 0.75, 1.5, 1.5);
  }
  ctx.restore();
  ctx.fillStyle = MUTED; ctx.font = MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${pts.length} pts${zoom > 1 ? ` · ${zoom.toFixed(1)}×` : ''}`, x + w - 6, y + h - 5);
}

function regimeLabel(period) {
  if (period === 0) return 'chaotic';
  if (period === 1) return 'period-1';
  return `period-${period}`;
}

const GOV_EQ = String.raw`\ddot\theta+\tfrac{1}{Q}\,\dot\theta+\sin\theta=A\cos(\omega_D t)`;

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER — hook-free, branches by mode
// ═══════════════════════════════════════════════════════════════════════════
export default function ChaoticPendulum({ mode = 'run' }) {
  if (mode === 'divergence') return <DivergenceMode />;
  if (mode === 'poincare') return <PoincareMode />;
  if (mode === 'bifurcation') return <BifurcationMode />;
  if (mode === 'basins') return <BasinsMode />;
  return <RunMode />;
}

// shared control group for Q / ω_D
function DriveControls({ Q, setQ, omegaD, setOmegaD, children }) {
  return (
    <div className="border-t border-usna-grid pt-3 mt-1">
      {children}
      <Slider label="Damping quality Q" value={Q} min={0.5} max={6} step={0.1} unit="" onChange={setQ} />
      <Slider label="Drive frequency ω_D" value={omegaD} min={0.3} max={1.2} step={0.01} unit="" onChange={setOmegaD} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN — live pendulum + phase space + Poincaré, period-doubling presets
// ═══════════════════════════════════════════════════════════════════════════
function RunMode() {
  const [A, setA] = useState(0.9);
  const [Q, setQ] = useState(Q_DEFAULT);
  const [omegaD, setOmegaD] = useState(OMEGA_D_DEFAULT);
  const [speed, setSpeed] = useState(1);
  const [showDrive, setShowDrive] = useState(true);
  const [showVel, setShowVel] = useState(true);
  const [unwrap, setUnwrap] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [persist, setPersist] = useState(false);
  const [live, setLive] = useState({ theta: 0, omega: 0, phase: 0, periods: 0, regime: '—' });

  const wrapRef = useRef(null), canvasRef = useRef(null);
  const stateRef = useRef([0.2, 0]);
  const tRef = useRef(0), stepRef = useRef(0), periodsRef = useRef(0);
  const trailRef = useRef([]), poincareRef = useRef([]), omegaRef = useRef([]);
  const P = useRef({}); P.current = { A, Q, Om: omegaD, speed, showDrive, showVel, unwrap, turbo, persist };

  const reseed = (th0 = 0.2) => { stateRef.current = [th0, 0]; tRef.current = 0; stepRef.current = 0; periodsRef.current = 0; trailRef.current = []; poincareRef.current = []; omegaRef.current = []; };
  // A / Q / ω_D change → the attractor is different, so flush accumulators
  useEffect(() => { trailRef.current = []; poincareRef.current = []; omegaRef.current = []; periodsRef.current = 0; stepRef.current = 0; }, [A, Q, omegaD]);

  const reset = () => { setA(0.9); setQ(Q_DEFAULT); setOmegaD(OMEGA_D_DEFAULT); setSpeed(1); setShowDrive(true); setShowVel(true); setUnwrap(false); setTurbo(false); setPersist(false); reseed(); };

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    const { vp, dispose } = makeViewport(wrap, canvas);
    let raf, last, lastPub = 0, acc = 0;
    const draw = (now) => {
      if (last === undefined) last = now;
      const d = P.current;
      acc += boundedDt(now, last) * TIME_SCALE * d.speed * (d.turbo ? TURBO_RUN : 1); last = now;
      const h = drivePeriod(d.Om) / STEPS_PER_PERIOD;
      let guard = 0;
      while (acc >= h && guard < 50000) {
        stateRef.current = rk4Step(stateRef.current, tRef.current, h, d.Q, d.A, d.Om);
        tRef.current += h; acc -= h; stepRef.current++; guard++;
        const s = stateRef.current;
        trailRef.current.push([s[0], s[1]]);
        const cap = d.persist ? 30000 : 1800;
        if (trailRef.current.length > cap) trailRef.current.splice(0, trailRef.current.length - cap);
        if (stepRef.current % STEPS_PER_PERIOD === 0) {
          periodsRef.current++;
          if (periodsRef.current > RUN_TRANSIENT) {
            poincareRef.current.push([s[0], s[1]]);
            if (poincareRef.current.length > 4000) poincareRef.current.shift();
          }
          omegaRef.current.push(s[1]);
          if (omegaRef.current.length > 80) omegaRef.current.shift();
        }
      }
      const { ctx, W, H } = vp; if (!ctx) { raf = requestAnimationFrame(draw); return; }
      clear(ctx, W, H);
      const s = stateRef.current;
      // responsive: three columns on wide canvases, stacked panels share the height
      const pad = 10, colGap = 10;
      const pendW = Math.max(W * 0.34, 190);
      const restX = pad + pendW + colGap;
      const restW = W - restX - pad;
      drawPendulum(ctx, pad, pad, pendW, H - 2 * pad, s[0], s[1], d, { showDrive: d.showDrive, showVel: d.showVel, t: tRef.current });
      ctx.fillStyle = MUTED; ctx.font = MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('full sin θ · damped · driven', pad + 6, H - pad - 2);
      const halfH = (H - 2 * pad - colGap) / 2;
      drawPhase(ctx, restX, pad, restW, halfH, trailRef.current, s, { unwrap: d.unwrap });
      drawPoincare(ctx, restX, pad + halfH + colGap, restW, halfH, poincareRef.current, {});

      if (now - lastPub > 90) {
        lastPub = now;
        const phase = (((d.Om * tRef.current) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        setLive({
          theta: (wrapPi(s[0]) * 180 / Math.PI), omega: s[1],
          phase: phase / (2 * Math.PI), periods: periodsRef.current,
          regime: regimeLabel(classifyPeriod(omegaRef.current)),
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); dispose(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="text-usna-text text-sm mb-1 font-medium">Drive presets (period-doubling route)</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {PRESETS.map((pr) => (
            <button key={pr.key} onClick={() => setA(pr.A)}
              className={`px-2 py-1.5 rounded text-xs border transition-colors ${
                Math.abs(A - pr.A) < 1e-6 ? 'bg-usna-gold text-usna-navy border-usna-gold'
                  : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
              }`}>{pr.label}<br /><span className="font-mono opacity-70">A = {pr.A}</span></button>
          ))}
        </div>
        <Slider label="Drive amplitude A" value={A} min={0} max={2} step={0.005} unit="" onChange={setA} />
        <DriveControls Q={Q} setQ={setQ} omegaD={omegaD} setOmegaD={setOmegaD}>
          <Slider label="Animation speed" value={speed} min={0.25} max={20} step={0.25} unit="×" onChange={setSpeed} />
        </DriveControls>
        <div className="mt-3 border-t border-usna-grid pt-3 space-y-2">
          <ToggleRow label="Fast forward (×25)" on={turbo} onClick={() => setTurbo((v) => !v)} />
          <ToggleRow label="Drive indicator" on={showDrive} onClick={() => setShowDrive((v) => !v)} />
          <ToggleRow label="Velocity arrow" on={showVel} onClick={() => setShowVel((v) => !v)} />
          <ToggleRow label="Unwrap θ (phase plot)" on={unwrap} onClick={() => setUnwrap((v) => !v)} />
          <ToggleRow label="Persist phase trajectory" on={persist} onClick={() => setPersist((v) => !v)} />
          <button onClick={() => reseed()} className="w-full mt-1 px-3 py-1.5 rounded text-sm font-semibold bg-usna-deep text-usna-muted hover:text-usna-gold border border-usna-grid transition-colors">↻ Re-release</button>
        </div>
        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Regime (measured)" value={live.regime} unit="" />
          <Readout label="θ" value={live.theta.toFixed(1)} unit="°" />
          <Readout label="ω" value={live.omega.toFixed(2)} unit="" />
          <Readout label="drive phase" value={live.phase.toFixed(2)} unit="T_D" />
          <Readout label="drive periods" value={live.periods} unit="" />
          <Readout label="T_D = 2π/ω_D" value={drivePeriod(omegaD).toFixed(2)} unit="" />
        </div>
      </ControlPanel>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...RUN_INFO} />
        <InfoPanel {...PERIOD_DOUBLING_INFO} />
      </div>
    </div>
  );
}

const RUN_INFO = {
  title: 'The driven damped pendulum',
  description:
    'A pendulum is a simple harmonic oscillator only in the small-angle limit, where sin θ is replaced by θ. This simulation integrates the full nonlinear equation and adds the two ingredients an ideal pendulum lacks: viscous damping, set by the quality factor Q, and a periodic drive of amplitude A. With both present, the same deterministic equation produces either regular or chaotic motion depending on the drive amplitude. Increasing A through the preset values carries the steady motion through a sequence of period doublings, from a period-1 cycle to period-2, then period-4, and finally to chaos. The phase portrait shows the trajectory in the (θ, ω) plane; the Poincaré section below it samples the state once per drive period. The regime label is determined by analysing those samples rather than assumed, so it reports the behaviour actually observed. A linear driven damped oscillator would forget its initial condition and settle to a single steady swing; the nonlinearity is what permits chaos.',
  equation: GOV_EQ,
};

const PERIOD_DOUBLING_INFO = {
  title: 'What period doubling means',
  description:
    'A motion is periodic when it repeats after a fixed time. For a driven system the natural unit of time is the drive period T_D. The motion is called period-1 when it repeats every single drive period, period-2 when it takes two drive periods to repeat, period-4 when it takes four, and so on. As the drive amplitude increases, a period-1 motion can give way to one that takes twice as long to repeat: successive swings alternate between two slightly different shapes, so the true period doubles. Increasing the amplitude further splits each of those swings again, producing period-4, then period-8, with the doublings arriving closer and closer together. Beyond a critical amplitude the repeat time is effectively infinite and the motion never exactly recurs, which is chaos. Because a period-n motion visits exactly n distinct states when sampled once per drive period, counting the points in the Poincaré section reads the period off directly.',
  equation: String.raw`\text{period-}n:\ \theta(t+n\,T_D)=\theta(t),\qquad T_D=\tfrac{2\pi}{\omega_D}`,
};

// ═══════════════════════════════════════════════════════════════════════════
// DIVERGENCE — twin pendulums + log|Δ(t)|, the Lyapunov slope
// ═══════════════════════════════════════════════════════════════════════════
function DivergenceMode() {
  const [A, setA] = useState(1.5);
  const [Q, setQ] = useState(Q_DEFAULT);
  const [omegaD, setOmegaD] = useState(OMEGA_D_DEFAULT);
  const [logOffset, setLogOffset] = useState(-3); // Δθ₀ = 10^logOffset rad
  const [speed, setSpeed] = useState(1);
  const [turbo, setTurbo] = useState(false);
  const [live, setLive] = useState({ sep: 0, lambda: 0, periods: 0 });

  const wrapRef = useRef(null), canvasRef = useRef(null);
  const aStateRef = useRef([0.2, 0]), bStateRef = useRef([0.2 + 1e-3, 0]);
  const aTrailRef = useRef([]), bTrailRef = useRef([]);
  const tRef = useRef(0), stepRef = useRef(0), periodsRef = useRef(0);
  const sepTraceRef = useRef([]); // {t, logd}
  const P = useRef({}); P.current = { A, Q, Om: omegaD, speed, turbo, d0: Math.pow(10, logOffset) };

  const release = () => {
    const d0 = P.current.d0;
    aStateRef.current = [0.2, 0]; bStateRef.current = [0.2 + d0, 0];
    aTrailRef.current = []; bTrailRef.current = [];
    tRef.current = 0; stepRef.current = 0; periodsRef.current = 0; sepTraceRef.current = [];
  };
  useEffect(() => { release(); }, [A, Q, omegaD, logOffset]); // eslint-disable-line
  const reset = () => { setA(1.5); setQ(Q_DEFAULT); setOmegaD(OMEGA_D_DEFAULT); setLogOffset(-3); setSpeed(1); setTurbo(false); };

  const sepOf = (a, b) => Math.hypot(wrapPi(a[0] - b[0]), a[1] - b[1]);

  useEffect(() => {
    const { vp, dispose } = makeViewport(wrapRef.current, canvasRef.current);
    let raf, last, lastPub = 0, acc = 0;
    const draw = (now) => {
      if (last === undefined) last = now;
      const d = P.current;
      acc += boundedDt(now, last) * TIME_SCALE * d.speed * (d.turbo ? TURBO_RUN : 1); last = now;
      const h = drivePeriod(d.Om) / STEPS_PER_PERIOD;
      let guard = 0;
      while (acc >= h && guard < 50000) {
        aStateRef.current = rk4Step(aStateRef.current, tRef.current, h, d.Q, d.A, d.Om);
        bStateRef.current = rk4Step(bStateRef.current, tRef.current, h, d.Q, d.A, d.Om);
        tRef.current += h; acc -= h; stepRef.current++; guard++;
        if (stepRef.current % (STEPS_PER_PERIOD / 4) === 0) {
          const sep = Math.max(sepOf(aStateRef.current, bStateRef.current), 1e-12);
          sepTraceRef.current.push({ t: tRef.current, logd: Math.log10(sep) });
          if (sepTraceRef.current.length > 4000) sepTraceRef.current.shift();
        }
        if (stepRef.current % Math.round(STEPS_PER_PERIOD / 12) === 0) {
          aTrailRef.current.push(aStateRef.current[0]); if (aTrailRef.current.length > 150) aTrailRef.current.shift();
          bTrailRef.current.push(bStateRef.current[0]); if (bTrailRef.current.length > 150) bTrailRef.current.shift();
        }
        if (stepRef.current % STEPS_PER_PERIOD === 0) periodsRef.current++;
      }
      const { ctx, W, H } = vp; if (!ctx) { raf = requestAnimationFrame(draw); return; }
      clear(ctx, W, H);
      const pad = 10, gap = 10;
      const pendW = Math.max(W * 0.40, 220);
      const a = aStateRef.current, b = bStateRef.current;
      // both pendulums overlaid, each with its own fading trail
      drawPendulum(ctx, pad, pad, pendW, H - 2 * pad, b[0], b[1], d, { color: RED, rod: 'rgba(224,108,108,0.6)', trail: bTrailRef.current });
      drawPendulum(ctx, pad, pad, pendW, H - 2 * pad, a[0], a[1], d, { color: GOLD, rod: 'rgba(197,183,131,0.65)', trail: aTrailRef.current });
      ctx.fillStyle = MUTED; ctx.font = MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`Initial angles differ by Δθ₀ = 10^${logOffset} rad`, pad + 6, H - pad - 2);

      // log|Δ(t)| plot
      const px0 = pad + pendW + gap, pw = W - px0 - pad, py0 = pad, ph = H - 2 * pad;
      drawLogSep(ctx, px0, py0, pw, ph, sepTraceRef.current);

      if (now - lastPub > 90) {
        lastPub = now;
        setLive({ sep: sepOf(a, b), lambda: estimateLambda(sepTraceRef.current), periods: periodsRef.current });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); dispose(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <button onClick={release} className="w-full mb-3 px-3 py-1.5 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">↻ Release both pendulums</button>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          <button onClick={() => setA(0.9)} className={`px-2 py-1.5 rounded text-xs border transition-colors ${Math.abs(A - 0.9) < 1e-6 ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold'}`}>Regular<br /><span className="font-mono opacity-70">A = 0.9</span></button>
          <button onClick={() => setA(1.5)} className={`px-2 py-1.5 rounded text-xs border transition-colors ${Math.abs(A - 1.5) < 1e-6 ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold'}`}>Chaotic<br /><span className="font-mono opacity-70">A = 1.5</span></button>
        </div>
        <Slider label="Drive amplitude A" value={A} min={0} max={2} step={0.005} unit="" onChange={setA} />
        <Slider label="Twin offset Δθ₀ (10^n)" value={logOffset} min={-6} max={-1} step={0.5} unit="" onChange={setLogOffset} />
        <DriveControls Q={Q} setQ={setQ} omegaD={omegaD} setOmegaD={setOmegaD}>
          <Slider label="Animation speed" value={speed} min={0.25} max={20} step={0.25} unit="×" onChange={setSpeed} />
        </DriveControls>
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="mb-2"><ToggleRow label="Fast forward (×25)" on={turbo} onClick={() => setTurbo((v) => !v)} /></div>
          <Readout label="Separation Δ" value={live.sep.toExponential(2)} unit="rad" />
          <Readout label="Lyapunov λ (est.)" value={live.lambda.toFixed(3)} unit="/t" />
          <Readout label="drive periods" value={live.periods} unit="" />
        </div>
      </ControlPanel>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...DIV_INFO} />
      </div>
    </div>
  );
}

function drawLogSep(ctx, x, y, w, h, trace) {
  panelFrame(ctx, x, y, w, h, 'log₁₀ |Δ(t)|  (slope = Lyapunov λ)');
  const yTop = 1, yBot = -7; // log10 separation range: 10^1 (saturated ~π) down to 10^-7
  const tMax = trace.length ? trace[trace.length - 1].t : 1;
  const tMin = trace.length ? trace[0].t : 0;
  const span = Math.max(tMax - tMin, 1);
  const sx = (t) => x + ((t - tMin) / span) * w;
  const sy = (ld) => y + h - ((ld - yBot) / (yTop - yBot)) * h;
  // gridlines at each decade
  ctx.strokeStyle = 'rgba(139,140,142,0.18)'; ctx.lineWidth = 1; ctx.fillStyle = MUTED; ctx.font = MONO;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let d = yBot; d <= yTop; d++) { const yy = sy(d); ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); ctx.fillText(`10^${d}`, x + 4, yy); }
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.8; ctx.beginPath();
  trace.forEach((p, i) => { const qx = sx(p.t), qy = sy(p.logd); i ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy); });
  ctx.stroke(); ctx.restore();
}

// Least-squares slope of log10|Δ| over its linear growth window → λ (base-e per t).
function estimateLambda(trace) {
  const pts = trace.filter((p) => p.logd > -6.5 && p.logd < -0.3);
  if (pts.length < 6) return 0;
  let n = 0, st = 0, sl = 0, stt = 0, stl = 0;
  for (const p of pts) { n++; st += p.t; sl += p.logd; stt += p.t * p.t; stl += p.t * p.logd; }
  const denom = n * stt - st * st; if (Math.abs(denom) < 1e-9) return 0;
  const slope10 = (n * stl - st * sl) / denom; // per unit t, base 10
  return slope10 * Math.LN10; // convert to base e
}

const DIV_INFO = {
  title: 'Sensitive dependence on initial conditions',
  description:
    'Two pendulums are released from almost identical states, differing only by Δθ₀ = 10⁻³ rad, and are then governed by the same equation. In the chaotic regime (A = 1.5) their separation grows exponentially, Δ(t) ≈ Δ₀ exp(λt) with a positive Lyapunov exponent λ. On the logarithmic axis this appears as an approximately straight line whose slope estimates λ. Once the separation reaches order π the two trajectories are effectively independent, so any finite precision in the initial state is eventually lost and long-term prediction fails. In a regular regime, such as the A = 0.9 preset, the separation does not grow and the two pendulums remain synchronised. The contrast between the two cases is the central point: the motion is fully deterministic in both, yet only one is predictable.',
  equation: String.raw`\Delta(t)\sim\Delta_0\,e^{\lambda t}\quad(\lambda>0\text{ in the chaotic regime})`,
};

// ═══════════════════════════════════════════════════════════════════════════
// POINCARÉ — accumulate the strange attractor, with transient discard + zoom
// ═══════════════════════════════════════════════════════════════════════════
function PoincareMode() {
  const [A, setA] = useState(1.5);
  const [Q, setQ] = useState(Q_DEFAULT);
  const [omegaD, setOmegaD] = useState(OMEGA_D_DEFAULT);
  const [transient, setTransient] = useState(20);
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(3);
  const [turbo, setTurbo] = useState(true);
  const [live, setLive] = useState({ pts: 0, periods: 0 });

  const wrapRef = useRef(null), canvasRef = useRef(null);
  const stateRef = useRef([0.2, 0]);
  const tRef = useRef(0), stepRef = useRef(0), periodsRef = useRef(0);
  const ptsRef = useRef([]);
  const P = useRef({}); P.current = { A, Q, Om: omegaD, transient, zoom, speed, turbo };

  const restart = () => { stateRef.current = [0.2, 0]; tRef.current = 0; stepRef.current = 0; periodsRef.current = 0; ptsRef.current = []; };
  useEffect(() => { restart(); }, [A, Q, omegaD]); // eslint-disable-line
  const reset = () => { setA(1.5); setQ(Q_DEFAULT); setOmegaD(OMEGA_D_DEFAULT); setTransient(20); setZoom(1); setSpeed(3); setTurbo(true); restart(); };

  useEffect(() => {
    const { vp, dispose } = makeViewport(wrapRef.current, canvasRef.current);
    let raf, last, lastPub = 0, acc = 0;
    const draw = (now) => {
      if (last === undefined) last = now;
      const d = P.current;
      acc += boundedDt(now, last) * TIME_SCALE * d.speed * (d.turbo ? TURBO_POINCARE : 1); last = now;
      const h = drivePeriod(d.Om) / STEPS_PER_PERIOD;
      let guard = 0;
      while (acc >= h && guard < 80000) {
        stateRef.current = rk4Step(stateRef.current, tRef.current, h, d.Q, d.A, d.Om);
        tRef.current += h; acc -= h; stepRef.current++; guard++;
        if (stepRef.current % STEPS_PER_PERIOD === 0) {
          periodsRef.current++;
          if (periodsRef.current > d.transient) {
            ptsRef.current.push([stateRef.current[0], stateRef.current[1]]);
            if (ptsRef.current.length > 20000) ptsRef.current.shift();
          }
        }
      }
      const { ctx, W, H } = vp; if (!ctx) { raf = requestAnimationFrame(draw); return; }
      clear(ctx, W, H);
      const pad = 10, gap = 10;
      const pendW = Math.max(W * 0.30, 170);
      drawPendulum(ctx, pad, pad, pendW, H - 2 * pad, stateRef.current[0], stateRef.current[1], d, { t: tRef.current });
      const px0 = pad + pendW + gap, pw = W - px0 - pad;
      // when zoomed, centre on the cloud's centroid so magnification reveals the
      // attractor rather than empty space around the origin
      let pcx = 0, pcy = 0; const ppts = ptsRef.current;
      if (d.zoom > 1 && ppts.length) {
        for (const q of ppts) { pcx += wrapPi(q[0]); pcy += q[1]; }
        pcx /= ppts.length; pcy /= ppts.length;
      }
      drawPoincare(ctx, px0, pad, pw, H - 2 * pad, ppts, { zoom: d.zoom, cx: pcx, cy: pcy, title: 'Poincaré section (strobed once per drive period)' });
      if (periodsRef.current <= d.transient) {
        ctx.fillStyle = MUTED; ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`Discarding transient: ${periodsRef.current} of ${d.transient} drive periods`, px0 + pw / 2, pad + (H - 2 * pad) / 2);
      }
      if (now - lastPub > 120) { lastPub = now; setLive({ pts: ptsRef.current.length, periods: periodsRef.current }); }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); dispose(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {PRESETS.map((pr) => (
            <button key={pr.key} onClick={() => setA(pr.A)}
              className={`px-2 py-1.5 rounded text-xs border transition-colors ${Math.abs(A - pr.A) < 1e-6 ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'}`}>{pr.label}<br /><span className="font-mono opacity-70">A = {pr.A}</span></button>
          ))}
        </div>
        <Slider label="Drive amplitude A" value={A} min={0} max={2} step={0.005} unit="" onChange={setA} />
        <Slider label="Discard transient" value={transient} min={0} max={100} step={5} unit="periods" onChange={setTransient} />
        <Slider label="Zoom (about origin)" value={zoom} min={1} max={12} step={0.5} unit="×" onChange={setZoom} />
        <DriveControls Q={Q} setQ={setQ} omegaD={omegaD} setOmegaD={setOmegaD}>
          <Slider label="Animation speed" value={speed} min={0.5} max={30} step={0.5} unit="×" onChange={setSpeed} />
        </DriveControls>
        <div className="mt-3 border-t border-usna-grid pt-3">
          <button onClick={restart} className="w-full mb-2 px-3 py-1.5 rounded text-sm font-semibold bg-usna-deep text-usna-muted hover:text-usna-gold border border-usna-grid transition-colors">Clear and restart</button>
          <div className="mb-2"><ToggleRow label="Fast forward (×300)" on={turbo} onClick={() => setTurbo((v) => !v)} /></div>
          <Readout label="accumulated pts" value={live.pts} unit="" />
          <Readout label="drive periods" value={live.periods} unit="" />
        </div>
      </ControlPanel>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...POIN_INFO} />
      </div>
    </div>
  );
}

const POIN_INFO = {
  title: 'The Poincaré section and the strange attractor',
  description:
    'Sampling the state once per drive period, rather than continuously, reduces the trajectory to a set of points called a Poincaré section. For periodic motion this set is finite: a period-1 cycle yields a single point, period-2 yields two, and period-4 yields four. For chaotic motion the points neither repeat nor fill the plane. They accumulate on a strange attractor, a set with fractal structure that remains intricate under magnification, as the zoom control demonstrates. An initial transient is discarded before accumulation begins, so that the figure represents the attractor itself rather than the approach to it.',
  equation: String.raw`T_D=\dfrac{2\pi}{\omega_D}\quad\text{(strobe period)}`,
};

// ═══════════════════════════════════════════════════════════════════════════
// BIFURCATION — Web Worker sweep of A, Poincaré θ vs A (period-doubling cascade)
// ═══════════════════════════════════════════════════════════════════════════
function BifurcationMode() {
  const [aMin, setAMin] = useState(0.9);
  const [aMax, setAMax] = useState(1.5);
  const [Q, setQ] = useState(Q_DEFAULT);
  const [omegaD, setOmegaD] = useState(OMEGA_D_DEFAULT);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const wrapRef = useRef(null), canvasRef = useRef(null), workerRef = useRef(null), reqRef = useRef(0);
  const rowsRef = useRef([]); // {A, thetas:Float32Array}
  const vpRef = useRef(null);
  const rangeRef = useRef({ aMin, aMax }); rangeRef.current = { aMin, aMax };

  const redraw = () => {
    const vp = vpRef.current; if (!vp || !vp.ctx) return;
    const { ctx, W, H } = vp; clear(ctx, W, H);
    const pad = 46, x0 = pad, y0 = 12, pw = W - pad - 14, ph = H - y0 - 34;
    const { aMin: lo, aMax: hi } = rangeRef.current;
    const sx = (A) => x0 + ((A - lo) / (hi - lo)) * pw;
    const sy = (th) => y0 + ph / 2 - (th / Math.PI) * (ph / 2) * 0.98;
    panelFrame(ctx, x0, y0, pw, ph, '');
    // axis labels
    ctx.fillStyle = MUTED; ctx.font = MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('drive amplitude A →', x0 + pw / 2, y0 + ph + 16);
    ctx.save(); ctx.translate(x0 - 34, y0 + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('strobed θ (−π … π)', 0, 0); ctx.restore();
    // preset markers
    for (const pr of PRESETS) {
      if (pr.A < lo || pr.A > hi) continue;
      const mx = sx(pr.A);
      ctx.strokeStyle = 'rgba(91,155,213,0.5)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y0 + ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = BLUE; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const lx = Math.max(x0 + 26, Math.min(x0 + pw - 26, mx)); // keep edge labels on-canvas
      ctx.fillText(pr.label, lx, y0 - 1);
    }
    // points
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, pw, ph); ctx.clip();
    ctx.fillStyle = GOLD_FADE;
    for (const r of rowsRef.current) { const cxp = sx(r.A); for (let k = 0; k < r.thetas.length; k++) ctx.fillRect(cxp, sy(r.thetas[k]) - 0.4, 1, 0.9); }
    ctx.restore();
  };

  useEffect(() => {
    const { vp, dispose } = makeViewport(wrapRef.current, canvasRef.current, redraw);
    vpRef.current = vp;
    const w = new Worker(new URL('./chaosWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data; if (m.type !== 'bifurcation-rows' || m.reqId !== reqRef.current) return;
      for (const r of m.rows) rowsRef.current.push(r);
      setProgress(m.progress); redraw();
      if (m.done) setRunning(false);
    };
    return () => { w.terminate(); dispose(); };
  }, []);

  const run = () => {
    rowsRef.current = []; setProgress(0); setRunning(true); redraw();
    reqRef.current += 1;
    workerRef.current.postMessage({
      type: 'bifurcation', reqId: reqRef.current,
      params: { Q, Om: omegaD, aMin, aMax, aSteps: 600, settle: 100, samples: 20, th0: 0.2, w0: 0, subs: 120 },
    });
  };
  const reset = () => { setAMin(0.9); setAMax(1.5); setQ(Q_DEFAULT); setOmegaD(OMEGA_D_DEFAULT); rowsRef.current = []; setProgress(0); redraw(); };
  // compute once on first view so the diagram is not blank
  useEffect(() => { const id = setTimeout(run, 120); return () => clearTimeout(id); }, []); // eslint-disable-line

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <button onClick={run} disabled={running} className="w-full mb-3 px-3 py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light disabled:opacity-50 transition-colors">{running ? 'Computing…' : '▶ Compute cascade'}</button>
        {(running || progress > 0) && (
          <div className="mb-3 h-2 rounded bg-usna-deep overflow-hidden border border-usna-grid">
            <div className="h-full bg-usna-gold transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <Slider label="A range: min" value={aMin} min={0} max={1.9} step={0.01} unit="" onChange={setAMin} />
        <Slider label="A range: max" value={aMax} min={0.1} max={2} step={0.01} unit="" onChange={setAMax} />
        <DriveControls Q={Q} setQ={setQ} omegaD={omegaD} setOmegaD={setOmegaD} />
        <p className="mt-3 text-xs text-usna-muted leading-relaxed">The sweep uses 600 values of A. For each, a transient of 100 drive periods is discarded before 20 strobed values of θ are recorded. The blue markers indicate the drive amplitudes used by the Run presets.</p>
      </ControlPanel>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...BIF_INFO} />
        <InfoPanel {...PERIOD_DOUBLING_INFO} />
      </div>
    </div>
  );
}

const BIF_INFO = {
  title: 'The period-doubling route to chaos',
  description:
    'This diagram records the long-term behaviour as a function of drive amplitude A. For each value of A the transient is discarded and the strobed angle θ is plotted. A period-1 motion contributes one value, period-2 contributes two, and period-4 contributes four, so the single branch splits repeatedly as A increases, the splittings accumulating until the branches merge into the broad bands characteristic of chaos. Narrow windows of periodic motion reappear within the chaotic bands. The same qualitative route to chaos appears in many other nonlinear systems. The vertical markers indicate the drive amplitudes used by the Run presets, which allows their behaviour to be located on the diagram. The computation integrates many thousands of trajectories in a background worker, so the interface remains responsive.',
  equation: GOV_EQ,
};

// ═══════════════════════════════════════════════════════════════════════════
// BASINS — Web Worker 2-D outcome map (fractal boundary) + Julia-set analogy
// ═══════════════════════════════════════════════════════════════════════════
const BASIN_DEFAULT_VIEW = { th0Min: -Math.PI, th0Max: Math.PI, w0Min: -3, w0Max: 3 };

function BasinsMode() {
  const [A, setA] = useState(1.07);
  const [Q, setQ] = useState(Q_DEFAULT);
  const [omegaD, setOmegaD] = useState(OMEGA_D_DEFAULT);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState(BASIN_DEFAULT_VIEW);

  const wrapRef = useRef(null), canvasRef = useRef(null), workerRef = useRef(null), reqRef = useRef(0);
  const bufRef = useRef(null), bctxRef = useRef(null);
  const vpRef = useRef(null), viewRef = useRef(view); viewRef.current = view;
  const NX = 150, NY = 150;

  const blit = () => {
    const vp = vpRef.current, buf = bufRef.current; if (!vp || !vp.ctx || !buf) return;
    const { ctx, W, H } = vp; clear(ctx, W, H);
    const pad = 10, side = Math.min(W - 2 * pad, H - 2 * pad);
    const ox = pad, oy = pad;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, NX, NY, ox, oy, side, side);
    panelFrame(ctx, ox, oy, side, side, '');
    const v = viewRef.current;
    ctx.fillStyle = MUTED; ctx.font = MONO;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`θ₀ ∈ [${v.th0Min.toFixed(2)}, ${v.th0Max.toFixed(2)}]`, ox + 6, oy + 6);
    ctx.textBaseline = 'bottom'; ctx.fillText(`ω₀ ∈ [${v.w0Min.toFixed(2)}, ${v.w0Max.toFixed(2)}]  ·  click to zoom in`, ox + 6, oy + side - 6);
    return { ox, oy, side };
  };

  useEffect(() => {
    const buf = document.createElement('canvas'); buf.width = NX; buf.height = NY;
    bufRef.current = buf; bctxRef.current = buf.getContext('2d');
    bctxRef.current.fillStyle = BG; bctxRef.current.fillRect(0, 0, NX, NY);
    const { vp, dispose } = makeViewport(wrapRef.current, canvasRef.current, blit);
    vpRef.current = vp;
    const w = new Worker(new URL('./chaosWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data; if (m.type !== 'basins-row' || m.reqId !== reqRef.current) return;
      const img = bctxRef.current.createImageData(NX, 1);
      for (let i = 0; i < NX; i++) { const c = BASIN_COLORS[m.row[i]]; const o = i * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
      bctxRef.current.putImageData(img, 0, m.j);
      setProgress(m.progress); blit();
      if (m.done) setRunning(false);
    };
    return () => { w.terminate(); dispose(); };
  }, []);

  const dispatch = (v = viewRef.current, aVal = A) => {
    bctxRef.current.fillStyle = BG; bctxRef.current.fillRect(0, 0, NX, NY);
    setProgress(0); setRunning(true); blit();
    reqRef.current += 1;
    workerRef.current.postMessage({
      type: 'basins', reqId: reqRef.current,
      params: { Q, A: aVal, Om: omegaD, ...v, nx: NX, ny: NY, settle: 22, avgPeriods: 14, rotThresh: 0.25, subs: 24 },
    });
  };
  // (re)compute whenever params or view change, debounced so dragging the A
  // slider does not queue a sweep on every tick
  useEffect(() => {
    const id = setTimeout(() => dispatch(view, A), 280);
    return () => clearTimeout(id);
  }, [A, Q, omegaD, view]); // eslint-disable-line

  const onCanvasClick = (e) => {
    const g = blit(); if (!g) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left - g.ox, my = e.clientY - rect.top - g.oy;
    if (mx < 0 || my < 0 || mx > g.side || my > g.side) return;
    const v = viewRef.current;
    const cth = v.th0Min + (mx / g.side) * (v.th0Max - v.th0Min);
    const cw = v.w0Max - (my / g.side) * (v.w0Max - v.w0Min);
    const f = 0.4; // keep 40% of the current span → 2.5× zoom
    const hw = (v.th0Max - v.th0Min) * f / 2, hh = (v.w0Max - v.w0Min) * f / 2;
    setView({ th0Min: cth - hw, th0Max: cth + hw, w0Min: cw - hh, w0Max: cw + hh });
  };
  const reset = () => { setA(1.07); setQ(Q_DEFAULT); setOmegaD(OMEGA_D_DEFAULT); setView(BASIN_DEFAULT_VIEW); };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {(running || progress > 0) && (
          <div className="mb-3 h-2 rounded bg-usna-deep overflow-hidden border border-usna-grid">
            <div className="h-full bg-usna-gold transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <Slider label="Drive amplitude A" value={A} min={0} max={2} step={0.01} unit="" onChange={setA} />
        <DriveControls Q={Q} setQ={setQ} omegaD={omegaD} setOmegaD={setOmegaD} />
        <button onClick={() => setView(BASIN_DEFAULT_VIEW)} className="w-full mt-3 px-3 py-1.5 rounded text-sm font-semibold bg-usna-deep text-usna-muted hover:text-usna-gold border border-usna-grid transition-colors">Reset view</button>
        <div className="mt-3 border-t border-usna-grid pt-3 space-y-1.5 text-xs">
          <LegendRow color={BASIN_COLORS[0]} label="librating (no net rotation)" />
          <LegendRow color={BASIN_COLORS[1]} label="net clockwise" />
          <LegendRow color={BASIN_COLORS[2]} label="net counter-clockwise" />
        </div>
        <p className="mt-3 text-xs text-usna-muted leading-relaxed">Each pixel represents one initial condition (θ₀, ω₀), integrated to remove the transient and then classified by its net rotation. Click the map to zoom into a boundary region.</p>
      </ControlPanel>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex flex-col xl:flex-row gap-4">
          <div ref={wrapRef} onClick={onCanvasClick} className="flex-1 bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden cursor-crosshair" style={{ height: 460, background: BG }}>
            <canvas ref={canvasRef} className="block" />
          </div>
          <div className="xl:w-64 shrink-0 bg-usna-card border border-usna-grid rounded-lg p-3 flex flex-col">
            <div className="text-usna-gold text-sm font-semibold mb-2">Julia set: the analogy</div>
            <JuliaInset />
            <p className="mt-2 text-xs text-usna-muted leading-relaxed">A Julia set is the boundary between the basins of the complex map z → z² + c. The map at left is the basin boundary of a mechanical system. Both arise from the same mathematics of fractal basins.</p>
          </div>
        </div>
        <InfoPanel {...BAS_INFO} />
      </div>
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-2 text-usna-text">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: `rgb(${color[0]},${color[1]},${color[2]})` }} />
      <span>{label}</span>
    </div>
  );
}

// Escape-time Julia set for z → z² + c (c = −0.8 + 0.156i, a classic dendrite).
function JuliaInset() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; const N = 220;
    const ctx = setupCanvas(canvas, N, N);
    const img = ctx.createImageData(N, N);
    const cr = -0.8, ci = 0.156, maxIt = 80, span = 3.2;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        let zr = (px / N - 0.5) * span, zi = (py / N - 0.5) * span, it = 0;
        while (zr * zr + zi * zi < 4 && it < maxIt) { const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; it++; }
        const o = (py * N + px) * 4;
        if (it === maxIt) { img.data[o] = 13; img.data[o + 1] = 19; img.data[o + 2] = 33; }
        else { const f = it / maxIt; img.data[o] = Math.round(40 + 215 * f); img.data[o + 1] = Math.round(30 + 150 * f); img.data[o + 2] = Math.round(90 + 40 * f); }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);
  return <canvas ref={ref} className="block w-full rounded border border-usna-grid" style={{ aspectRatio: '1 / 1' }} />;
}

const BAS_INFO = {
  title: 'Fractal basin boundaries',
  description:
    'Each point in this map corresponds to a different initial condition (θ₀, ω₀), coloured according to the long-term outcome: libration with no net rotation, or net rotation in either direction. Where regions of different outcome meet, the boundary is generally not a smooth curve but a fractal, remaining intricate at every magnification, so that two nearby initial conditions can lead to different outcomes. The inset shows a Julia set, which is the boundary between the basins of attraction of the complex map z → z² + c. The two boundaries arise from the same underlying mathematics, one from a mechanical system and one from the iteration of a complex function. The degree of fractal structure depends on the regime, and is most pronounced where several attractors coexist.',
  equation: String.raw`z\mapsto z^2+c\quad\leftrightarrow\quad\text{basin boundary of }\ \ddot\theta+\tfrac1Q\dot\theta+\sin\theta=A\cos(\omega_D t)`,
};

// shared toggle row (mirrors ShmExplorer's)
function ToggleRow({ label, on, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between w-full text-left text-sm text-usna-text hover:text-usna-gold transition-colors">
      <span>{label}</span>
      <span className={`ml-3 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${on ? 'bg-usna-gold border-usna-gold' : 'bg-usna-deep border-usna-grid'}`}>
        <span className={`h-3.5 w-3.5 rounded-full bg-usna-navy transition-transform ${on ? 'translate-x-4' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}
