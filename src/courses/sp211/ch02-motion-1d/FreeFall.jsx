import { useState, useMemo, useEffect, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import DemoStub from '@shared/components/DemoStub';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * FreeFall — vertical motion under gravity and its two extensions.
 *
 *   default    : the original 1D free-fall explorer (y(t), v(t) plots). L2.
 *   projectile : D06 (L6). Launch angle + speed + height feed a live trajectory
 *                canvas; "hold" pins arcs so several angles overlay, and a
 *                range-vs-angle subplot drops one dot per fired shot, tracing the
 *                sin(2θ) curve empirically. 30° and 60° at equal speed share a
 *                range; with launch height the optimum drops below 45°. A DRAG
 *                toggle integrates the real 2D trajectory (RK4) and overlays it
 *                on the vacuum parabola — showing air resistance REPEALING the
 *                complementary-angle tie (30° and 60° no longer land together).
 *                A draggable ground target scores hits; v_x/v_y launch arrows
 *                and a faded (90−θ) twin arc make the symmetry visible; a
 *                sweep-&-auto-fire button walks 0→90° filling the R(θ) curve.
 *   drag       : D12 (L12). Free fall with linear (bv) or quadratic (½CρAv²)
 *                drag, integrated by RK4, beside a vacuum "ghost" twin. v(t)
 *                plot shows the terminal-velocity asymptote the curve approaches
 *                but never crosses; heavy vs light separate in air, not vacuum.
 *                A cross-section AREA slider + object presets (feather → bowling
 *                ball → skydiver) make "heavy vs light" honest (mass and
 *                ballistic coefficient are now independent). Two dots fall
 *                side-by-side (air vs vacuum); an a(t) trace and force arrows
 *                show acceleration and drag decaying to zero at terminal speed.
 *
 * The wrapper stays hook-free so switching modes never violates the Rules of
 * Hooks: each mode is its own component with its own hooks.
 */

const G = 9.81; // m/s^2
const DEFAULTS = { y0: 20, v0: 0 };

const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const MUTED = '#8B8C8E';

export default function FreeFall({ mode = 'default' }) {
  // Projectile (D06) is 2D motion and now lives under Chapter 3 as its own demo
  // (ch03-motion-2d/Projectile), which re-exports ProjectileMode below. Free Fall
  // keeps the 1D views: default (L2) and drag (D12, L12).
  if (mode === 'drag') return <DragMode />;
  return mode === 'default' ? <FreeFallExplorer /> : <DemoStub mode={mode} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * default — original free-fall explorer (unchanged)
 * ═══════════════════════════════════════════════════════════════════════════ */
function FreeFallExplorer() {
  const [y0, setY0] = useState(DEFAULTS.y0);
  const [v0, setV0] = useState(DEFAULTS.v0);
  const [scrub, setScrub] = useState(0);       // current time on the drop (s)
  const [playing, setPlaying] = useState(true);

  const reset = () => { setY0(DEFAULTS.y0); setV0(DEFAULTS.v0); setScrub(0); setPlaying(true); };

  // Flight time: y0 + v0 t - 1/2 g t^2 = 0 (positive root).
  const disc = v0 * v0 + 2 * G * y0;
  const tGround = disc > 0 ? (v0 + Math.sqrt(disc)) / G : 0.1;

  const N = 240;
  const motion = useMemo(() => {
    const t = [], y = [], v = [], a = [];
    for (let i = 0; i < N; i++) {
      const tt = (i / (N - 1)) * tGround;
      t.push(tt);
      y.push(Math.max(0, y0 + v0 * tt - 0.5 * G * tt * tt));
      v.push(v0 - G * tt);
      a.push(-G);
    }
    return { t, y, v, a };
  }, [y0, v0, tGround]);

  const apex = v0 > 0 ? y0 + (v0 * v0) / (2 * G) : y0;
  const yMax = Math.max(1, apex * 1.05);

  // Keep the scrub inside the (possibly shortened) flight window.
  useEffect(() => { setScrub((s) => Math.min(s, tGround)); }, [tGround]);
  const scrubT = Math.min(scrub, tGround);
  const idx = Math.max(0, Math.min(N - 1, Math.round((scrubT / tGround) * (N - 1))));
  const now = { t: motion.t[idx], y: motion.y[idx], v: motion.v[idx], a: motion.a[idx] };
  const vImpact = v0 - G * tGround;

  // Play: sweep the whole drop over ~2.5 s of wall clock, then loop.
  const playRef = useRef();
  useEffect(() => {
    if (!playing) return;
    const step = tGround / 50;
    playRef.current = setInterval(() => {
      setScrub((s) => (s >= tGround ? 0 : Math.min(tGround, s + step)));
    }, 50);
    return () => clearInterval(playRef.current);
  }, [playing, tGround]);

  // ── the animated drop (own canvas + rAF, reads live values via a ref) ──
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const st = useRef({ y0, v0, yMax, scrubT, tGround });
  st.current = { y0, v0, yMax, scrubT, tGround };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };
    const draw = () => {
      const { y0: yy, v0: vv, yMax: yM, scrubT: sT, tGround: tg } = st.current;
      const padBottom = 22, ballX = W / 2;
      const groundY = H - padBottom, topY = 16, span = groundY - topY;
      const yToPx = (yv) => groundY - (yv / yM) * span;
      ctx.clearRect(0, 0, W, H);
      // ground
      ctx.strokeStyle = '#2A3442'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, groundY); ctx.lineTo(W - 8, groundY); ctx.stroke();
      // release height
      ctx.strokeStyle = 'rgba(197,183,131,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(8, yToPx(yy)); ctx.lineTo(W - 8, yToPx(yy)); ctx.stroke();
      ctx.setLineDash([]);
      // apex line when thrown upward
      if (vv > 0) {
        const ap = yy + (vv * vv) / (2 * G);
        ctx.strokeStyle = 'rgba(127,183,126,0.3)'; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(8, yToPx(ap)); ctx.lineTo(W - 8, yToPx(ap)); ctx.stroke();
        ctx.setLineDash([]);
      }
      // strobe snapshots at equal TIME intervals. Each is pinned at its fixed
      // height y(t_k) and only appears once the ball has reached it, so the
      // dots stay put and the gap between them grows each interval.
      const nSnap = 12;
      const dtk = tg / nSnap;
      for (let k = 0; k <= nSnap; k++) {
        const tk = k * dtk;
        if (sT + 1e-6 < tk) continue; // not yet crossed
        const yk = Math.max(0, yy + vv * tk - 0.5 * G * tk * tk);
        ctx.fillStyle = 'rgba(232,228,219,0.7)';
        ctx.beginPath(); ctx.arc(ballX, yToPx(yk), 5, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = 'rgba(120,124,130,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ballX, yToPx(yk), 5, 0, 2 * Math.PI); ctx.stroke();
      }
      // current ball + velocity arrow
      const cy = Math.max(0, yy + vv * sT - 0.5 * G * sT * sT);
      const by = yToPx(cy);
      const dv = vv - G * sT;
      const len = Math.min(46, Math.abs(dv) * 2.2 + 6);
      drawArrow(ctx, { x: ballX, y: by, dx: 0, dy: (dv >= 0 ? -1 : 1) * len, color: BLUE, width: 3, head: 8 });
      ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = GOLD; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(ballX, by, 8, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = MUTED;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('ground', ballX, groundY + 5);
      raf = requestAnimationFrame(draw);
    };
    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── three stacked, time-synced panels: y (top), v (mid), a (bottom) ──
  const line = (arr, yaxis, color) => ({
    x: motion.t, y: arr, type: 'scatter', mode: 'lines', line: { color, width: 2.5 }, yaxis, hoverinfo: 'skip',
  });
  const dot = (val, yaxis, color) => ({
    x: [now.t], y: [val], type: 'scatter', mode: 'markers',
    marker: { color: '#FFFFFF', size: 8, line: { color, width: 2 } }, yaxis, hoverinfo: 'skip',
  });
  const panel = (domain, title, color, range) => ({
    domain, anchor: 'x', title: { text: title, font: { color } },
    zeroline: true, zerolinecolor: '#2A3442', tickfont: { size: 11 },
    ...(range ? { range, autorange: false } : { range: undefined, autorange: true }),
  });
  const traces = [
    line(motion.y, 'y3', GOLD), line(motion.v, 'y2', BLUE), line(motion.a, 'y', GREEN),
    dot(now.y, 'y3', GOLD), dot(now.v, 'y2', BLUE), dot(now.a, 'y', GREEN),
  ];
  const layout = {
    showlegend: false,
    margin: { l: 54, r: 12, t: 8, b: 38 },
    xaxis: { title: { text: 'Time (s)' }, anchor: 'y', domain: [0, 1], range: [0, tGround] },
    yaxis: panel([0.0, 0.27], 'a (m/s²)', GREEN, [-(G + 2.5), 2]),
    yaxis2: panel([0.37, 0.63], 'v (m/s)', BLUE, undefined),
    yaxis3: panel([0.72, 1.0], 'y (m)', GOLD, [0, yMax]),
    shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: scrubT, x1: scrubT, y0: 0, y1: 1, line: { color: 'rgba(240,236,227,0.5)', width: 1, dash: 'dot' } }],
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Initial height (y₀)" value={y0} min={1} max={100} step={1} unit="m" onChange={setY0} />
        <Slider label="Initial velocity (v₀)" value={v0} min={-20} max={20} step={0.5} unit="m/s" onChange={setV0} />

        <div className="mt-2 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setPlaying((p) => !p)}
                    className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
              {playing ? '❚❚ Pause' : '▶ Drop'}
            </button>
            <span className="text-usna-muted text-xs">play / scrub</span>
          </div>
          <Slider label="Time (t)" value={Number(scrubT.toFixed(2))} min={0} max={Number(tGround.toFixed(2))} step={0.01} unit="s"
                  onChange={(v) => { setPlaying(false); setScrub(v); }} />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Time to ground" value={tGround.toFixed(2)} unit="s" />
          <Readout label="Impact speed" value={Math.abs(vImpact).toFixed(1)} unit="m/s" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="height y" value={now.y.toFixed(1)} unit="m" />
            <Readout label="velocity v" value={now.v.toFixed(1)} unit="m/s" />
            <Readout label="accel a" value={now.a.toFixed(2)} unit="m/s²" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex gap-3" style={{ height: 460 }}>
          <div ref={wrapRef} className="w-24 sm:w-28 shrink-0 bg-usna-card border border-usna-grid rounded-lg overflow-hidden">
            <canvas ref={canvasRef} className="block" />
          </div>
          <div className="flex-1 min-w-0 bg-usna-card border border-usna-grid rounded-lg p-3 overflow-hidden">
            <IntensityPlot traces={traces} layoutOverrides={layout} />
          </div>
        </div>

        <InfoPanel
          title="Free Fall"
          description={`Height, velocity, and acceleration share one time axis. Press Drop (or scrub the time slider) and the falling ball, the marker on each curve, and the dotted time line move together. Acceleration is constant at −g the whole way, velocity is a straight line that passes through zero at the top of a throw, and height is a parabola.`}
          equation={String.raw`y(t) = y_0 + v_0 t - \tfrac{1}{2}g t^2, \quad v(t) = v_0 - g t, \quad a = -g`}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * projectile — D06 (L6): launch angle, held arcs, empirical range(θ) curve
 * ═══════════════════════════════════════════════════════════════════════════ */

// Analytic trajectory from ground level (or launch height h0) with no drag.
// Returns {x,y} sample arrays plus range (x where y returns to 0) and flight time.
function projTrajectory(v0, angleDeg, h0, samples = 120) {
  const th = (angleDeg * Math.PI) / 180;
  const vx = v0 * Math.cos(th);
  const vy = v0 * Math.sin(th);
  // y(t) = h0 + vy t - 1/2 g t^2 = 0  ->  t = (vy + sqrt(vy^2 + 2 g h0)) / g
  const disc = vy * vy + 2 * G * h0;
  const tF = disc > 0 ? (vy + Math.sqrt(disc)) / G : 0;
  const xs = new Array(samples + 1), ys = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * tF;
    xs[i] = vx * t;
    ys[i] = h0 + vy * t - 0.5 * G * t * t;
  }
  return { xs, ys, range: vx * tF, tF, apex: h0 + (vy * vy) / (2 * G) };
}

// Optimal launch angle when launching from height h0 (below 45° once h0 > 0):
// tan(θ*) = v0 / sqrt(v0^2 + 2 g h0).
function optimalAngle(v0, h0) {
  return (Math.atan(v0 / Math.sqrt(v0 * v0 + 2 * G * h0)) * 180) / Math.PI;
}

// Quadratic-drag deceleration constant for the projectile (per unit mass):
// a_drag = -k |v| v  with k = ½ C ρ A / m. One knob (PROJ_DRAG_K) folds the
// whole ballistic coefficient into a single teaching parameter (0 = vacuum).
const PROJ_DRAG_K = 0.008; // 1/m at the "drag on" setting — visibly bends arcs

// Integrate a 2D projectile WITH quadratic drag by RK4 (fine fixed step) until
// it returns to the ground (y ≤ 0). Returns the same shape as projTrajectory so
// the canvas/plot code can treat vacuum and drag arcs identically.
// State = {x, y, vx, vy}; drag acts opposite the velocity vector, ∝ speed².
function projTrajectoryDrag(v0, angleDeg, h0, k = PROJ_DRAG_K) {
  const th = (angleDeg * Math.PI) / 180;
  let x = 0, y = h0;
  let vx = v0 * Math.cos(th), vy = v0 * Math.sin(th);
  const dt = 0.004;
  const xs = [0], ys = [h0];
  let apex = h0, t = 0;
  const maxT = 60;

  // derivative of state under gravity + quadratic drag
  const deriv = (s) => {
    const sp = Math.hypot(s.vx, s.vy);
    return {
      dx: s.vx,
      dy: s.vy,
      dvx: -k * sp * s.vx,
      dvy: -G - k * sp * s.vy,
    };
  };

  while (t < maxT) {
    const s0 = { x, y, vx, vy };
    const a = deriv(s0);
    const s1 = { x: x + 0.5 * dt * a.dx, y: y + 0.5 * dt * a.dy, vx: vx + 0.5 * dt * a.dvx, vy: vy + 0.5 * dt * a.dvy };
    const b = deriv(s1);
    const s2 = { x: x + 0.5 * dt * b.dx, y: y + 0.5 * dt * b.dy, vx: vx + 0.5 * dt * b.dvx, vy: vy + 0.5 * dt * b.dvy };
    const c = deriv(s2);
    const s3 = { x: x + dt * c.dx, y: y + dt * c.dy, vx: vx + dt * c.dvx, vy: vy + dt * c.dvy };
    const d = deriv(s3);

    const nx = x + (dt / 6) * (a.dx + 2 * b.dx + 2 * c.dx + d.dx);
    const ny = y + (dt / 6) * (a.dy + 2 * b.dy + 2 * c.dy + d.dy);
    const nvx = vx + (dt / 6) * (a.dvx + 2 * b.dvx + 2 * c.dvx + d.dvx);
    const nvy = vy + (dt / 6) * (a.dvy + 2 * b.dvy + 2 * c.dvy + d.dvy);

    // stop the instant we cross the ground; linearly interpolate the landing x
    if (ny <= 0 && y > 0) {
      const frac = y / (y - ny);
      const landX = x + frac * (nx - x);
      xs.push(landX); ys.push(0);
      return { xs, ys, range: landX, tF: t + frac * dt, apex, drag: true };
    }
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt;
    if (y > apex) apex = y;
    xs.push(x); ys.push(y);
  }
  return { xs, ys, range: x, tF: t, apex, drag: true };
}

const PROJ_DEFAULTS = { v0: 30, angle: 45, h0: 0 };

export function ProjectileMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [v0, setV0] = useState(PROJ_DEFAULTS.v0);
  const [angle, setAngle] = useState(PROJ_DEFAULTS.angle);
  const [h0, setH0] = useState(PROJ_DEFAULTS.h0);
  // Drag toggle: overlays the real (RK4-integrated) arc on the vacuum parabola.
  const [drag, setDrag] = useState(false);
  // Pinned arcs stay drawn on the canvas until cleared. Each captures its params.
  const [held, setHeld] = useState([]);
  // Fired shots: one {angle, range} dot per launch, feeds the range(θ) subplot.
  const [shots, setShots] = useState([]);
  // Draggable ground target (world x, in metres) + a half-width for "hit" scoring.
  const [targetX, setTargetX] = useState(50);
  const TARGET_HALF = 3; // metres — landing within ±3 m counts as a hit
  const [score, setScore] = useState({ hits: 0, shots: 0 });
  const [lastResult, setLastResult] = useState(null); // 'hit' | 'miss' | null
  // Sweep-&-auto-fire animation state (angle walks 0→90° dropping shots).
  const [sweeping, setSweeping] = useState(false);
  const sweepRef = useRef(null);
  // Flight animation clock for the moving shell (loops).
  const flightRef = useRef(0);

  // Live params are read inside the rAF loop through refs (no per-frame re-render).
  const liveRef = useRef({ v0, angle, h0, held, drag, targetX });
  liveRef.current = { v0, angle, h0, held, drag, targetX };

  // Live trajectory: vacuum always; the drag arc is computed only when needed.
  const live = useMemo(() => projTrajectory(v0, angle, h0), [v0, angle, h0]);
  const liveDrag = useMemo(
    () => (drag ? projTrajectoryDrag(v0, angle, h0) : null),
    [drag, v0, angle, h0]
  );
  const optA = optimalAngle(v0, h0);

  // The range actually used for scoring/plotting reflects the active physics.
  const activeRange = drag ? (liveDrag ? liveDrag.range : live.range) : live.range;

  const reset = () => {
    setV0(PROJ_DEFAULTS.v0); setAngle(PROJ_DEFAULTS.angle); setH0(PROJ_DEFAULTS.h0);
    setHeld([]); setShots([]); setDrag(false);
    setTargetX(50); setScore({ hits: 0, shots: 0 }); setLastResult(null);
    setSweeping(false);
  };

  const hold = () => {
    setHeld((h) => [...h, { v0, angle, h0, drag, color: HELD_COLORS[h.length % HELD_COLORS.length] }]);
  };

  // Fire: record the shot for the empirical range(θ) plot + score against target.
  const fire = () => {
    const r = activeRange;
    setShots((s) => {
      const exists = s.some((p) => Math.abs(p.angle - angle) < 0.5 && Math.abs(p.v0 - v0) < 0.5 && Math.abs(p.h0 - h0) < 0.5 && p.drag === drag);
      if (exists) return s;
      return [...s, { angle, range: r, v0, h0, drag }];
    });
    const hit = Math.abs(r - targetX) <= TARGET_HALF;
    setScore((sc) => ({ hits: sc.hits + (hit ? 1 : 0), shots: sc.shots + 1 }));
    setLastResult(hit ? 'hit' : 'miss');
  };

  // Sweep & auto-fire: walk the angle 0→90° in steps, firing a shot at each so
  // the R(θ) curve fills in as an animation. Uses a setInterval driver.
  useEffect(() => {
    if (!sweeping) return;
    let a = 0;
    const stepDeg = 3;
    // seed the sweep with a clean slate for THIS speed/height family
    setShots([]);
    sweepRef.current = setInterval(() => {
      const r = (liveRef.current.drag ? projTrajectoryDrag(v0, a, h0) : projTrajectory(v0, a, h0)).range;
      setShots((s) => [...s, { angle: a, range: r, v0, h0, drag: liveRef.current.drag }]);
      setAngle(a);
      a += stepDeg;
      if (a > 90) {
        setSweeping(false);
      }
    }, 90);
    return () => clearInterval(sweepRef.current);
  }, [sweeping, v0, h0]);

  // ── canvas: trajectory overlay + drag/vacuum twin + target + v arrows ──────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, groundY, raf, lastNow;
    const padX = 30, padBottom = 34, padTop = 16;

    // World width auto-scales so the longest arc (live, drag twin, held) fits.
    const worldWidth = () => {
      const { v0: lv, angle: la, h0: lh, held: lheld, drag: ld, targetX: tx } = liveRef.current;
      const lt = projTrajectory(lv, la, lh);
      let maxX = lt.range;
      let maxY = lt.apex;
      if (ld) {
        const dt = projTrajectoryDrag(lv, la, lh);
        maxX = Math.max(maxX, dt.range);
        maxY = Math.max(maxY, dt.apex);
      }
      lheld.forEach((p) => {
        const t = p.drag ? projTrajectoryDrag(p.v0, p.angle, p.h0) : projTrajectory(p.v0, p.angle, p.h0);
        maxX = Math.max(maxX, t.range);
        maxY = Math.max(maxY, t.apex);
      });
      maxX = Math.max(maxX, (lv * lv) / G, tx + TARGET_HALF, 10);
      maxY = Math.max(maxY, lh + (lv * lv) / (2 * G), 5);
      return { maxX: maxX * 1.08, maxY: maxY * 1.12 };
    };

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      groundY = H - padBottom;
    };

    let scX = 1, scY = 1, wm = { maxX: 100, maxY: 50 };
    const toX = (x) => padX + x * scX;
    const toY = (y) => groundY - y * scY;
    const fromX = (px) => (px - padX) / scX; // screen → world (for target drag)

    const strokeArc = (t, color, width, dash = []) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      for (let i = 0; i < t.xs.length; i++) {
        const px = toX(t.xs[i]), py = toY(t.ys[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // expose the current world→screen mapping for the pointer handlers
    const mapRef = { toX, fromX, scY, groundY: () => groundY };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const { v0: lv, angle: la, h0: lh, held: lheld, drag: ld, targetX: tx } = liveRef.current;
      const liveT = projTrajectory(lv, la, lh);
      const liveD = ld ? projTrajectoryDrag(lv, la, lh) : null;

      wm = worldWidth();
      scX = (W - padX - 14) / wm.maxX;
      scY = (H - padBottom - padTop) / wm.maxY;
      mapRef.scY = scY;

      ctx.clearRect(0, 0, W, H);

      // ground
      ctx.strokeStyle = '#1A2332';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, groundY);
      ctx.lineTo(W - 6, groundY);
      ctx.stroke();

      // range tick marks
      ctx.fillStyle = MUTED;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      const tickStep = niceStep(wm.maxX, 6);
      for (let m = 0; m <= wm.maxX; m += tickStep) {
        ctx.fillRect(toX(m), groundY - 3, 1, 6);
        ctx.fillText(String(Math.round(m)), toX(m), groundY + 15);
      }

      // draggable ground target (hoop): a ring sitting on the ground line
      const txp = toX(tx);
      ctx.strokeStyle = hexAlpha('#D08770', 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(txp, groundY, TARGET_HALF * scX, 6, 0, 0, 2 * Math.PI);
      ctx.stroke();
      // hit-zone shading
      ctx.fillStyle = hexAlpha('#D08770', 0.16);
      ctx.fillRect(toX(tx - TARGET_HALF), groundY - 26, 2 * TARGET_HALF * scX, 26);
      ctx.fillStyle = hexAlpha('#D08770', 0.95);
      ctx.textAlign = 'center';
      ctx.fillText('🎯', txp, groundY - 14);

      // launch platform (if h0 > 0)
      if (lh > 0.01) {
        ctx.strokeStyle = '#2A3442';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX - 4, toY(lh));
        ctx.lineTo(padX - 4, groundY);
        ctx.stroke();
      }

      // faded complementary twin (90−θ) — only meaningful from ground level
      if (lh < 0.5 && la > 0.5 && la < 89.5 && Math.abs(la - 45) > 0.5) {
        const twin = projTrajectory(lv, 90 - la, lh);
        strokeArc(twin, hexAlpha(BLUE, 0.45), 1.8, [3, 4]);
        ctx.fillStyle = hexAlpha(BLUE, 0.6);
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${(90 - la).toFixed(0)}° twin`, toX(twin.range * 0.5), toY(twin.apex) - 6);
      }

      // held arcs (pinned)
      lheld.forEach((p) => {
        const t = p.drag ? projTrajectoryDrag(p.v0, p.angle, p.h0) : projTrajectory(p.v0, p.angle, p.h0);
        strokeArc(t, hexAlpha(p.color, 0.75), 2, p.drag ? [] : [6, 4]);
        ctx.fillStyle = hexAlpha(p.color, 0.9);
        ctx.beginPath();
        ctx.arc(toX(t.range), toY(0), 3, 0, 2 * Math.PI);
        ctx.fill();
      });

      // when drag is on: vacuum arc drawn faded/dashed as the reference "twin"
      if (ld) {
        strokeArc(liveT, hexAlpha(MUTED, 0.7), 1.8, [6, 4]);
        ctx.fillStyle = hexAlpha(MUTED, 0.7);
        ctx.beginPath();
        ctx.arc(toX(liveT.range), toY(0), 3, 0, 2 * Math.PI);
        ctx.fill();
      }

      // live arc (drag arc if drag on, else vacuum)
      const primary = ld ? liveD : liveT;
      strokeArc(primary, GOLD, 2.6);

      // launch velocity decomposition: v, v_x, v_y arrows at the origin
      const th = (la * Math.PI) / 180;
      const oX = toX(0), oY = toY(lh);
      // pixel length scaled so full-speed vector reads ~15% of the world width
      const arrowScale = (0.16 * wm.maxX * scX) / Math.max(lv, 1);
      const vxPix = lv * Math.cos(th) * arrowScale;
      const vyPix = lv * Math.sin(th) * arrowScale;
      // component arrows first (thin), then the resultant (thick gold)
      drawArrow(ctx, { x: oX, y: oY, dx: vxPix, dy: 0, color: hexAlpha(BLUE, 0.9), width: 2, label: 'vₓ', head: 8 });
      drawArrow(ctx, { x: oX, y: oY, dx: 0, dy: -vyPix, color: hexAlpha(GREEN, 0.9), width: 2, label: 'v_y', head: 8 });
      drawArrow(ctx, { x: oX, y: oY, dx: vxPix, dy: -vyPix, color: GOLD, width: 2.4, label: 'v₀', head: 10 });

      // live landing dot (primary)
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(toX(primary.range), toY(0), 4, 0, 2 * Math.PI);
      ctx.fill();

      // flying shell along the primary arc (loops with a short pause)
      flightRef.current += dt;
      const period = primary.tF + 0.5;
      const phase = flightRef.current % period;
      if (phase <= primary.tF && primary.tF > 0) {
        // interpolate position along the sampled arc by time fraction
        const frac = primary.tF > 0 ? phase / primary.tF : 0;
        const fi = frac * (primary.xs.length - 1);
        const i0 = Math.floor(fi), i1 = Math.min(primary.xs.length - 1, i0 + 1);
        const w = fi - i0;
        const sxw = primary.xs[i0] + w * (primary.xs[i1] - primary.xs[i0]);
        const syw = primary.ys[i0] + w * (primary.ys[i1] - primary.ys[i0]);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(toX(sxw), toY(syw), 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    // ── pointer: drag the target left/right along the ground ──────────────────
    let dragging = false;
    const localX = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      return { cx, cy };
    };
    const onDown = (e) => {
      const { cx, cy } = localX(e);
      const txp = mapRef.toX(liveRef.current.targetX);
      // grab if the press is near the target ring (generous vertical band)
      if (Math.abs(cx - txp) < 26 && cy > mapRef.groundY() - 34) {
        dragging = true;
        e.preventDefault();
      }
    };
    const onMove = (e) => {
      if (!dragging) return;
      const { cx } = localX(e);
      const wx = Math.max(1, mapRef.fromX(cx));
      setTargetX(Math.round(wx));
      e.preventDefault();
    };
    const onUp = () => { dragging = false; };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // ── range-vs-angle subplot ────────────────────────────────────────────────
  // Vacuum theory curve for the CURRENT speed & height (dense sweep).
  const theory = useMemo(() => {
    const xs = [], ys = [];
    for (let a = 0; a <= 90; a += 0.5) {
      xs.push(a);
      ys.push(projTrajectory(v0, a, h0).range);
    }
    return { xs, ys };
  }, [v0, h0]);

  // Drag theory curve (coarser — each point is a full RK4 integration).
  const dragTheory = useMemo(() => {
    if (!drag) return null;
    const xs = [], ys = [];
    for (let a = 0; a <= 90; a += 2) {
      xs.push(a);
      ys.push(projTrajectoryDrag(v0, a, h0).range);
    }
    return { xs, ys };
  }, [drag, v0, h0]);

  const theoryTrace = {
    x: theory.xs, y: theory.ys,
    type: 'scatter', mode: 'lines',
    line: { color: hexAlpha(GOLD, 0.4), width: 2, dash: 'dot' },
    name: 'R(θ) vacuum',
    hoverinfo: 'skip',
  };
  const dragTheoryTrace = dragTheory
    ? {
        x: dragTheory.xs, y: dragTheory.ys,
        type: 'scatter', mode: 'lines',
        line: { color: '#D08770', width: 2.4 },
        name: 'R(θ) with drag',
        hovertemplate: 'θ=%{x:.0f}°  R=%{y:.1f} m<extra></extra>',
      }
    : null;
  const shotsTrace = {
    x: shots.map((s) => s.angle),
    y: shots.map((s) => s.range),
    type: 'scatter', mode: 'markers',
    marker: { color: GOLD, size: 9, line: { color: '#FFFFFF', width: 1.5 } },
    name: 'fired shots',
    hovertemplate: 'θ=%{x:.0f}°  R=%{y:.1f} m<extra></extra>',
  };
  const optTrace = {
    x: [optA, optA], y: [0, Math.max(...theory.ys, 1) * 1.05],
    type: 'scatter', mode: 'lines',
    line: { color: GREEN, width: 1.5, dash: 'dash' },
    name: `vacuum opt ${optA.toFixed(1)}°`,
    hoverinfo: 'skip',
  };

  const rangeTraces = [theoryTrace, optTrace];
  if (dragTheoryTrace) rangeTraces.push(dragTheoryTrace);
  rangeTraces.push(shotsTrace);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Launch speed (v₀)" value={v0} min={5} max={60} step={1} unit="m/s" onChange={setV0} />
        <Slider label="Launch angle (θ)" value={angle} min={0} max={90} step={1} unit="°" onChange={setAngle} />
        <Slider label="Launch height (h₀)" value={h0} min={0} max={50} step={1} unit="m" onChange={setH0} />

        <div className="mt-3 border-t border-usna-grid pt-3">
          <button
            onClick={() => setDrag((d) => !d)}
            className={`w-full py-1.5 rounded text-sm font-medium border transition-colors ${
              drag
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {drag ? '✓ Air drag ON' : 'Air drag OFF (vacuum)'}
          </button>
          <p className="text-usna-muted text-xs mt-1.5 leading-snug">
            With drag on, the gold arc is the real (RK4) trajectory and the grey
            dashed arc is the vacuum twin — 30° and 60° no longer land together.
          </p>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={fire}
            className="w-full py-2 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            ● Fire (plot shot + score)
          </button>
          <div className="flex gap-2">
            <button
              onClick={hold}
              className="flex-1 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
            >
              ⎈ Hold arc
            </button>
            <button
              onClick={() => { setHeld([]); setShots([]); }}
              className="flex-1 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-muted border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
            >
              Clear
            </button>
          </div>
          <button
            onClick={() => setSweeping((s) => !s)}
            className={`w-full py-1.5 rounded text-sm font-medium border transition-colors ${
              sweeping
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {sweeping ? '❚❚ Stop sweep' : '⟳ Sweep & auto-fire 0→90°'}
          </button>
          <p className="text-usna-muted text-xs leading-snug">
            Drag the 🎯 target on the ground and try to land a shot in it — a
            complementary pair of angles gives two ways to hit it (in vacuum).
          </p>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label={drag ? 'Range R (air)' : 'Range R'} value={activeRange.toFixed(1)} unit="m" />
          {drag && <Readout label="Range R (vacuum)" value={live.range.toFixed(1)} unit="m" />}
          <Readout label="Apex height" value={(drag && liveDrag ? liveDrag.apex : live.apex).toFixed(1)} unit="m" />
          <Readout label="Flight time" value={(drag && liveDrag ? liveDrag.tF : live.tF).toFixed(2)} unit="s" />
          <Readout label="Optimal angle (vac)" value={optA.toFixed(1)} unit="°" />
          <Readout label="Target x" value={targetX.toFixed(0)} unit="m" />
          <Readout
            label="Hits / shots"
            value={`${score.hits} / ${score.shots}`}
            unit={lastResult === 'hit' ? '✓ HIT' : lastResult === 'miss' ? '✗ miss' : ''}
          />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 340, background: '#0D1321' }}>
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            <div>θ&nbsp;&nbsp;&nbsp;&nbsp;{angle.toFixed(0)}°</div>
            <div>range&nbsp;{activeRange.toFixed(1)} m {drag ? '(air)' : ''}</div>
            {drag && <div className="text-usna-muted">vacuum {live.range.toFixed(1)} m</div>}
          </div>
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 300 }}>
          <IntensityPlot
            traces={rangeTraces}
            layoutOverrides={{
              showlegend: true,
              legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(0,0,0,0)', font: { size: 11 } },
              margin: { l: 56, r: 14, t: 10, b: 42 },
              xaxis: { title: { text: 'Launch angle θ (°)' }, range: [0, 90], dtick: 15 },
              yaxis: { title: { text: 'Range R (m)' }, range: undefined, autorange: true },
            }}
          />
        </div>

        <InfoPanel
          title={drag ? 'Drag repeals the 30°/60° tie' : 'Range peaks at 45° — but only from the ground'}
          description={
            drag
              ? `Air resistance breaks the clean sin 2θ symmetry. In vacuum, 30° and 60° at the same speed land at the SAME range (grey dashed twin) — the complementary-angle tie from L6. Turn drag on and integrate the real trajectory: the drag force grows with v², so the fast, flat 30° shot bleeds far more energy than the lofted 60° shot. The peach R(θ) curve sags and shifts LEFT of 45°, and the two complementary angles no longer land together — the tie is repealed. Fire 30° then 60° and read the two ranges to see it.`
              : h0 > 0.5
                ? `Fire 30° then 60° at the same speed: from ground level they land at the SAME range, because R(θ) ∝ sin 2θ and sin 60° = sin 120°. But you launched from ${h0.toFixed(0)} m up — the extra fall time rewards a flatter shot, so the optimum has dropped to ${optA.toFixed(1)}°, visibly below 45°. Drop h₀ back to 0 and the peak snaps to 45°. Now flip on air drag to see the tie break entirely.`
                : `Fire 30° then 60° at the same speed and they land at the SAME range — the range depends on sin 2θ, and sin 60° = sin 120°. Every complementary pair (θ, 90−θ) shares a range (see the faded blue twin arc), so the curve is symmetric about its 45° peak. Raise the launch height, or turn on air drag, and watch that symmetry break.`
          }
          equation={String.raw`R = \frac{v_0^2 \sin 2\theta}{g}\ (h_0=0,\ \text{vacuum}), \qquad \ddot{\mathbf r} = -g\,\hat y - k\,|\mathbf v|\,\mathbf v\ (\text{drag})`}
        />
      </div>
    </div>
  );
}

const HELD_COLORS = [BLUE, GREEN, '#D08770', '#B48EAD', '#88C0D0'];

/* ═══════════════════════════════════════════════════════════════════════════
 * drag — D12 (L12): linear vs quadratic drag vs vacuum ghost, RK4-integrated
 * ═══════════════════════════════════════════════════════════════════════════ */

// Air density (kg/m^3). Cross-section AREA is now an explicit parameter so mass
// and ballistic coefficient are independent knobs (the D12 fix).
const RHO = 1.225;      // sea-level air density

// Acceleration of a downward-falling object (v>0 downward), a = g - f_drag/m.
// linear:    f = b v          -> vt = m g / b
// quadratic: f = 1/2 C rho A v|v| -> vt = sqrt(2 m g / (C rho A))
function dragAccel(v, m, coeff, area, model) {
  if (model === 'linear') return G - (coeff * v) / m;
  const kq = 0.5 * coeff * RHO * area;
  return G - (kq * v * Math.abs(v)) / m;
}

// Magnitude of the drag force (N) at speed v — used for the on-canvas arrows.
function dragForce(v, coeff, area, model) {
  if (model === 'linear') return coeff * v;
  return 0.5 * coeff * RHO * area * v * Math.abs(v);
}

function terminalV(m, coeff, area, model) {
  if (model === 'linear') return coeff > 0 ? (m * G) / coeff : Infinity;
  const kq = 0.5 * coeff * RHO * area;
  return kq > 0 ? Math.sqrt((m * G) / kq) : Infinity;
}

// RK4 step on state {y (height above ground), v (downward speed)}.
// dy/dt = -v (height decreases as it falls), dv/dt = a(v).
function rk4Step(state, dt, m, coeff, area, model) {
  const acc = (v) => dragAccel(v, m, coeff, area, model);
  const { y, v } = state;
  const k1v = acc(v),           k1y = -v;
  const k2v = acc(v + 0.5 * dt * k1v), k2y = -(v + 0.5 * dt * k1v);
  const k3v = acc(v + 0.5 * dt * k2v), k3y = -(v + 0.5 * dt * k2v);
  const k4v = acc(v + dt * k3v),       k4y = -(v + dt * k3v);
  return {
    y: y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
    v: v + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
  };
}

// Integrate a full drop from height h0 with a fine fixed step; also produce the
// vacuum twin (closed form) on the same time grid. Returns arrays for plotting.
// Each curve (air / vacuum) is CLIPPED at its own landing time (null after) so
// the vacuum twin no longer flat-lines and diverges past its impact.
function simulateDrop(h0, m, coeff, area, model) {
  const dt = 0.002;
  const maxT = 60;
  const ts = [], vAir = [], yAir = [], aAir = [];
  const vVac = [], yVac = [];
  let s = { y: h0, v: 0 };
  let landAir = null, landVac = null;
  const tVac = Math.sqrt((2 * h0) / G); // closed-form vacuum landing time
  let t = 0;
  while (t <= maxT) {
    ts.push(t);
    // air object: values while still aloft, null once it has landed
    if (landAir === null) {
      vAir.push(s.v);
      yAir.push(Math.max(0, s.y));
      aAir.push(dragAccel(s.v, m, coeff, area, model));
    } else {
      vAir.push(null); yAir.push(null); aAir.push(null);
    }
    // vacuum twin: values while aloft, null after its own landing (no flat-line)
    if (t <= tVac) {
      vVac.push(G * t);
      yVac.push(Math.max(0, h0 - 0.5 * G * t * t));
    } else {
      vVac.push(null); yVac.push(null);
      if (landVac === null) landVac = tVac;
    }
    if (landAir === null && s.y <= 0) landAir = t;
    if (landVac === null && t >= tVac) landVac = tVac;
    if (landAir !== null && landVac !== null && t > Math.max(landAir, landVac)) break;
    const next = rk4Step(s, dt, m, coeff, area, model);
    if (next.y < 0) next.y = 0;
    s = next;
    t += dt;
  }
  // downsample for plotting (keep it light)
  const stride = Math.max(1, Math.floor(ts.length / 600));
  const ds = (arr) => arr.filter((_, i) => i % stride === 0);
  return {
    ts: ds(ts), vAir: ds(vAir), yAir: ds(yAir), aAir: ds(aAir),
    vVac: ds(vVac), yVac: ds(yVac),
    landAir, landVac, vt: terminalV(m, coeff, area, model),
    vImpactAir: landAir !== null ? interpImpactV(ts, vAir, landAir) : (vAir.find((x) => x != null) ?? 0),
    vImpactVac: G * (landVac ?? tVac),
  };
}

function interpImpactV(ts, vs, tLand) {
  // find last non-null speed at or before tLand
  let last = 0;
  for (let j = 0; j < ts.length; j++) {
    if (ts[j] > tLand) break;
    if (vs[j] != null) last = vs[j];
  }
  return last;
}

// Object presets: (mass, area, C) chosen together so "heavy vs light" is honest
// and the terminal-velocity spread is wide (feather ~1 m/s → skydiver ~55 m/s).
const OBJECT_PRESETS = {
  feather:  { label: '🪶 Feather',      mass: 0.0008, area: 0.02,  coeff: 1.0 },
  paper:    { label: '📄 Paper sheet',  mass: 0.005,  area: 0.06,  coeff: 1.2 },
  baseball: { label: '⚾ Baseball',      mass: 0.145,  area: 0.0042, coeff: 0.47 },
  bowling:  { label: '🎳 Bowling ball', mass: 6.0,    area: 0.038, coeff: 0.47 },
  skydiver: { label: '🪂 Skydiver',     mass: 80,     area: 0.7,   coeff: 1.0 },
};

const DRAG_DEFAULTS = { h0: 100, mass: 0.145, coeff: 0.47, area: 0.0042, model: 'quadratic', preset: 'baseball' };

function DragMode() {
  const [h0, setH0] = useState(DRAG_DEFAULTS.h0);
  const [mass, setMass] = useState(DRAG_DEFAULTS.mass);
  const [coeff, setCoeff] = useState(DRAG_DEFAULTS.coeff);
  const [area, setArea] = useState(DRAG_DEFAULTS.area);
  const [model, setModel] = useState(DRAG_DEFAULTS.model);
  const [preset, setPreset] = useState(DRAG_DEFAULTS.preset);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const reset = () => {
    setH0(DRAG_DEFAULTS.h0); setMass(DRAG_DEFAULTS.mass);
    setCoeff(DRAG_DEFAULTS.coeff); setArea(DRAG_DEFAULTS.area);
    setModel(DRAG_DEFAULTS.model); setPreset(DRAG_DEFAULTS.preset);
  };

  // Applying a preset forces the quadratic model (presets are (m, A, C) triples).
  const applyPreset = (key) => {
    const p = OBJECT_PRESETS[key];
    setPreset(key);
    setMass(p.mass); setArea(p.area); setCoeff(p.coeff); setModel('quadratic');
  };

  // Any manual slider tweak clears the active preset badge (custom object).
  const setMassCustom = (v) => { setMass(v); setPreset(null); };
  const setAreaCustom = (v) => { setArea(v); setPreset(null); };
  const setCoeffCustom = (v) => { setCoeff(v); setPreset(null); };

  const sim = useMemo(() => simulateDrop(h0, mass, coeff, area, model), [h0, mass, coeff, area, model]);
  const vt = sim.vt;

  const tMax = Math.max(sim.landAir ?? 0, sim.landVac ?? 0) * 1.05 || 1;

  // Live params for the falling-dots canvas (read in the rAF loop via a ref).
  const liveRef = useRef({ h0, mass, coeff, area, model, vt, landAir: sim.landAir, landVac: sim.landVac });
  liveRef.current = { h0, mass, coeff, area, model, vt, landAir: sim.landAir, landVac: sim.landVac };

  // ── canvas: two dots (air vs vacuum) drop side-by-side; force arrows on air ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    const padTop = 22, padBottom = 30;
    let clock = 0; // shared fall clock (loops), seconds

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const { h0: lh, mass: lm, coeff: lc, area: la, model: lmo, vt: lvt, landAir, landVac } = liveRef.current;
      const period = Math.max(landAir ?? 0, landVac ?? 0) + 0.8;
      clock += dt;
      if (clock > period) clock = 0;

      ctx.clearRect(0, 0, W, H);
      const topY = padTop, groundY = H - padBottom;
      const usable = groundY - topY;

      // ground line
      ctx.strokeStyle = '#1A2332';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, groundY); ctx.lineTo(W - 20, groundY); ctx.stroke();

      const xAir = W * 0.34, xVac = W * 0.68;
      const yToPix = (y) => topY + (1 - Math.max(0, Math.min(1, y / lh))) * usable;

      // vacuum dot: closed form, clamped at its own landing
      const tVac = Math.min(clock, landVac ?? 0);
      const yVac = Math.max(0, lh - 0.5 * G * tVac * tVac);

      // air dot: integrate to the current clock time with a fine step
      let sy = lh, sv = 0;
      const stepN = Math.max(1, Math.floor(clock / 0.004));
      const hstep = clock / stepN;
      for (let i = 0; i < stepN && sy > 0; i++) {
        const st = rk4Step({ y: sy, v: sv }, hstep, lm, lc, la, lmo);
        sy = Math.max(0, st.y); sv = st.v;
      }
      const yAirNow = sy;
      const vAirNow = sv;

      // column labels
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('AIR', xAir, 14);
      ctx.fillText('VACUUM', xVac, 14);

      // divider
      ctx.strokeStyle = '#1A2332';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(W * 0.51, topY - 6); ctx.lineTo(W * 0.51, groundY); ctx.stroke();
      ctx.setLineDash([]);

      // dots
      const drawDot = (x, y, color) => {
        ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, yToPix(y), 9, 0, 2 * Math.PI); ctx.fill();
        ctx.shadowBlur = 0;
      };
      drawDot(xVac, yVac, hexAlpha(MUTED, 0.95));
      drawDot(xAir, yAirNow, GOLD);

      // force arrows on the air dot: gravity (mg, constant) vs drag (grows→mg).
      // Draw them from the dot; scale so gravity ≈ 30% of the usable height.
      const dotPy = yToPix(yAirNow);
      const mg = lm * G;
      const fD = dragForce(vAirNow, lc, la, lmo);
      const gPix = usable * 0.28;
      const gScale = mg > 0 ? gPix / mg : 0;
      // gravity: downward (screen +y)
      drawArrow(ctx, { x: xAir + 20, y: dotPy, dx: 0, dy: mg * gScale, color: hexAlpha(BLUE, 0.95), width: 3, label: 'mg', head: 9 });
      // drag: upward, magnitude fD (shrinks to zero far from vt, → mg at vt)
      if (fD > 0.01 * mg) {
        drawArrow(ctx, { x: xAir - 20, y: dotPy, dx: 0, dy: -fD * gScale, color: hexAlpha('#D08770', 0.95), width: 3, label: 'F_d', head: 9 });
      }

      // live speed readout beside the air dot
      ctx.fillStyle = GOLD;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`v=${vAirNow.toFixed(1)} m/s`, xAir + 34, dotPy);
      if (Number.isFinite(lvt)) {
        ctx.fillStyle = hexAlpha(GREEN, 0.9);
        ctx.fillText(`vₜ=${lvt.toFixed(1)}`, xAir + 34, dotPy + 14);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // v(t): air (gold) approaches but never crosses the dashed terminal line.
  const vAirTrace = {
    x: sim.ts, y: sim.vAir,
    type: 'scatter', mode: 'lines', connectgaps: false,
    line: { color: GOLD, width: 2.6 },
    name: 'v (air)',
    hovertemplate: 't=%{x:.2f}s  v=%{y:.1f} m/s<extra></extra>',
  };
  const vVacTrace = {
    x: sim.ts, y: sim.vVac,
    type: 'scatter', mode: 'lines', connectgaps: false,
    line: { color: hexAlpha(MUTED, 0.9), width: 2, dash: 'dot' },
    name: 'v (vacuum)',
    hoverinfo: 'skip',
  };
  const vtTrace = Number.isFinite(vt)
    ? {
        x: [0, tMax], y: [vt, vt],
        type: 'scatter', mode: 'lines',
        line: { color: GREEN, width: 1.6, dash: 'dash' },
        name: `vₜ = ${vt.toFixed(1)} m/s`,
        hoverinfo: 'skip',
      }
    : null;

  // a(t): decays from g toward 0 as drag rises to meet gravity (middle panel).
  const aAirTrace = {
    x: sim.ts, y: sim.aAir,
    type: 'scatter', mode: 'lines', connectgaps: false,
    line: { color: '#D08770', width: 2.4 },
    name: 'a (air)', yaxis: 'y2',
    hovertemplate: 't=%{x:.2f}s  a=%{y:.2f} m/s²<extra></extra>',
  };
  const gRefTrace = {
    x: [0, tMax], y: [G, G],
    type: 'scatter', mode: 'lines',
    line: { color: hexAlpha(MUTED, 0.6), width: 1.2, dash: 'dot' },
    name: 'g', yaxis: 'y2', hoverinfo: 'skip',
  };

  // Position twins share the bottom panel.
  const yAirTrace = {
    x: sim.ts, y: sim.yAir,
    type: 'scatter', mode: 'lines', connectgaps: false,
    line: { color: GOLD, width: 2.6 },
    name: 'y (air)', yaxis: 'y3', hoverinfo: 'skip',
  };
  const yVacTrace = {
    x: sim.ts, y: sim.yVac,
    type: 'scatter', mode: 'lines', connectgaps: false,
    line: { color: hexAlpha(MUTED, 0.9), width: 2, dash: 'dot' },
    name: 'y (vacuum)', yaxis: 'y3', hoverinfo: 'skip',
  };

  const traces = [vVacTrace, vAirTrace, gRefTrace, aAirTrace, yVacTrace, yAirTrace];
  if (vtTrace) traces.splice(2, 0, vtTrace);

  const modelBtn = (key, label) => (
    <button
      onClick={() => { setModel(key); setPreset(null); }}
      className={`flex-1 px-2 py-1.5 rounded text-sm text-center border transition-colors ${
        model === key
          ? 'bg-usna-gold text-usna-navy border-usna-gold'
          : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
      }`}
    >
      {label}
    </button>
  );

  const coeffLabel = model === 'linear' ? 'Drag constant (b)' : 'Drag coeff (C)';
  const coeffUnit = model === 'linear' ? 'kg/s' : '';
  const coeffMax = 2;
  const coeffStep = model === 'linear' ? 0.05 : 0.01;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-2">Object preset</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(OBJECT_PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-2 py-1.5 rounded text-xs text-center border transition-colors ${
                  preset === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Drag model</div>
          <div className="flex gap-2">
            {modelBtn('linear', 'Linear (bv)')}
            {modelBtn('quadratic', 'Quadratic (v²)')}
          </div>
        </div>

        <Slider label="Initial height (h₀)" value={h0} min={10} max={300} step={5} unit="m" onChange={setH0} />
        <Slider label="Mass (m)" value={mass} min={0.0008} max={80} step={0.001} unit="kg" onChange={setMassCustom} />
        {model === 'quadratic' && (
          <Slider label="Cross-section area (A)" value={area} min={0.001} max={1} step={0.001} unit="m²" onChange={setAreaCustom} />
        )}
        <Slider label={coeffLabel} value={coeff} min={0.02} max={coeffMax} step={coeffStep} unit={coeffUnit} onChange={setCoeffCustom} />

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Terminal speed vₜ" value={Number.isFinite(vt) ? vt.toFixed(1) : '∞'} unit="m/s" />
          <Readout label="Impact v (air)" value={sim.vImpactAir.toFixed(1)} unit="m/s" />
          <Readout label="Impact v (vacuum)" value={sim.vImpactVac.toFixed(1)} unit="m/s" />
          <Readout label="Land time (air)" value={sim.landAir !== null ? sim.landAir.toFixed(2) : '—'} unit="s" />
          <Readout label="Land time (vacuum)" value={sim.landVac !== null ? sim.landVac.toFixed(2) : '—'} unit="s" />
        </div>
        <p className="text-usna-muted text-xs mt-3 leading-snug">
          Area A and mass are now independent: a bowling ball and a beach ball can
          share a mass yet fall very differently. In vacuum every object lands at
          the same instant regardless of mass, area, or shape.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden" style={{ height: 240, background: '#0D1321' }}>
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-1 right-3 text-[10px] font-mono text-usna-muted pointer-events-none">
            blue mg · peach F_d → mg at vₜ
          </div>
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 480 }}>
          <IntensityPlot
            traces={traces}
            layoutOverrides={{
              showlegend: true,
              legend: { x: 0.98, y: 0.98, xanchor: 'right', bgcolor: 'rgba(13,19,33,0.6)', font: { size: 10 } },
              margin: { l: 60, r: 16, t: 10, b: 44 },
              xaxis: { title: { text: 'Time (s)' }, range: [0, tMax], anchor: 'y', domain: [0, 1] },
              yaxis: {
                title: { text: 'Speed v (m/s)', font: { color: GOLD } },
                domain: [0.7, 1.0], range: undefined, autorange: true,
                zeroline: true, zerolinecolor: '#2A3442',
              },
              yaxis2: {
                title: { text: 'a (m/s²)', font: { color: '#D08770' } },
                domain: [0.37, 0.63], range: undefined, autorange: true,
                anchor: 'x', zeroline: true, zerolinecolor: '#2A3442',
              },
              yaxis3: {
                title: { text: 'Height y (m)', font: { color: BLUE } },
                domain: [0.0, 0.3], range: undefined, autorange: true,
                anchor: 'x', zeroline: true, zerolinecolor: '#2A3442',
              },
            }}
          />
        </div>

        <InfoPanel
          title="Terminal velocity: the asymptote the curve never crosses"
          description={`With ${model === 'linear' ? 'linear drag (f = bv)' : 'quadratic drag (f = ½CρAv²)'}, the drag force grows with speed until it exactly balances gravity — the acceleration (peach a(t) trace) decays from g toward zero and the speed levels off at the terminal value vₜ = ${Number.isFinite(vt) ? vt.toFixed(1) + ' m/s' : '∞'}. Above, two dots fall side by side: the gold "air" dot lags behind the grey "vacuum" dot, and the peach drag arrow on it grows until it matches the blue gravity arrow (mg) — at that balance a = 0. Terminal speed now depends on BOTH mass and cross-section area A through the ballistic coefficient, so a heavy compact object (bowling ball) and a light bluffy one (feather) can differ by 50×. In vacuum, none of that matters — v = gt for every object.`}
          equation={
            model === 'linear'
              ? String.raw`m\dot v = mg - b v, \qquad v_t = \frac{mg}{b}`
              : String.raw`m\dot v = mg - \tfrac12 C\rho A v^2, \qquad v_t = \sqrt{\frac{2mg}{C\rho A}}`
          }
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * local helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

// Apply an alpha to a #rrggbb hex, returning an rgba() string for canvas/plotly.
function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// Pick a "nice" round tick spacing so ~target ticks span [0, max].
function niceStep(max, target) {
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * pow;
}
