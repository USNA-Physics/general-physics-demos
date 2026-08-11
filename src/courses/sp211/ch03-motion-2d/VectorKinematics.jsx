import { useRef, useEffect, useState, useCallback } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';
import ControlPanel from '@shared/components/ControlPanel';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';

/**
 * D04 · 2D Vector Kinematics Sandbox — L4 (default).
 *
 * A 2D plane where the student places, drags, and deletes waypoints that define
 * a smooth closed loop r(t). The path is a centripetal Catmull-Rom spline
 * through the waypoints (closed, so the loop animates forever). A particle rides
 * the path and we render, from the same numerically-differentiated motion:
 *
 *   VELOCITY  v = dr/dt   — always tangent to the path.
 *   ACCELERATION a = dv/dt — decomposed into
 *       tangential  a_t  (changes speed, along ±v)
 *       normal      a_n  (changes direction, points toward the inside of the curve).
 *
 * THE MOMENT (primes L7, three lessons early): flip the speed profile to
 * "uniform" and the tangential component vanishes — yet the acceleration arrow
 * stays large and points straight at the center of curvature. Constant speed
 * does NOT mean zero acceleration on a curved path; that sideways arrow is the
 * centripetal acceleration a = v²/r. The osculating circle makes the radius r
 * that feeds v²/r literally visible.
 *
 * Motion pipeline (why the arrows are always self-consistent):
 *   1. Build the spline geometry as a dense polyline around the closed loop.
 *   2. Resample by ARC LENGTH so we can impose a speed profile s(φ) along the
 *      loop independent of how the control points are spaced.
 *   3. The particle's phase φ advances in real time; position is P(s(φ)).
 *   4. v and a are central finite differences of position vs time — no analytic
 *      shortcuts, so the vectors are exactly what the visible motion produces.
 *
 * This maxed pass adds, without disturbing any of the above:
 *   • FIX — the "centripetal at constant speed" banner is gated on the scale-free
 *     ratio aN/aMag > cos20° (the fraction of a that is sideways), not on raw px
 *     magnitudes that changed meaning with speed/zoom.
 *   • [EXPLAIN] a |v|-vs-loop-position strip chart under the canvas with a moving
 *     cursor — flat under Uniform (a_t=0), a sinusoid under Speeding-up whose
 *     SLOPE is a_t.
 *   • [WOW] the path itself is colored by local curvature κ=1/r (heat gradient):
 *     the sharpest bend glows red and that is exactly where a_⊥ peaks.
 *   • [CUSTOMIZE] snap-to-shape presets (circle, ellipse, figure-8). The figure-8
 *     drives a_⊥ through zero and flips it at the central inflection where the
 *     osculating circle blows up — we NAME that state ("r→∞, a_⊥→0").
 *   • [INTERACT] a freeze-frame scrub that, while paused, sets φ directly so you
 *     can park the particle at a curve apex and interrogate the frozen arrows.
 */

const GOLD = '#C5B783';     // path + velocity family
const BLUE = '#5B9BD5';     // acceleration (net)
const GREEN = '#7FB77E';    // tangential component
const RED = '#E27D60';      // normal (centripetal) component
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const BG = '#0D1321';

const HIT = 16;             // px pickup radius for dragging a waypoint
const DELETE_HIT = 12;      // px radius for the little "x" delete target
const ARC_SAMPLES = 1400;   // resolution of the arc-length table around the loop
const MIN_WAYPOINTS = 3;    // below this a closed loop is ill-defined

const COS20 = Math.cos((20 * Math.PI) / 180); // scale-free banner threshold ≈ 0.94
const STRIP_N = 160;        // samples for the |v|-vs-φ strip chart

// A pleasant default racetrack loop, in normalized [0,1] canvas coords so it
// scales to any container size. Reset returns here.
const DEFAULT_WAYPOINTS = [
  { x: 0.24, y: 0.30 },
  { x: 0.62, y: 0.22 },
  { x: 0.80, y: 0.52 },
  { x: 0.60, y: 0.80 },
  { x: 0.26, y: 0.72 },
  { x: 0.14, y: 0.50 },
];

// ── snap-to-shape presets ────────────────────────────────────────────────────
// Each returns a fresh array of normalized [0,1] waypoints whose Catmull-Rom
// spline traces the named shape. Waypoints only (the spline smooths between).

// Perfect circle: equally spaced points on a circle → constant curvature, so
// a_⊥ is the SAME everywhere and the osculating circle equals the path itself.
function circleWaypoints(n = 8, cx = 0.5, cy = 0.5, r = 0.32) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

// Ellipse: curvature is largest at the ends of the major axis (small r there)
// and smallest at the ends of the minor axis — so a_⊥ visibly breathes.
function ellipseWaypoints(n = 10, cx = 0.5, cy = 0.5, rx = 0.4, ry = 0.24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

// Figure-8 (lemniscate-of-Gerono style): x = sin(t), y = sin(t)cos(t). The path
// crosses itself at the center, where it straightens — curvature → 0, radius of
// curvature → ∞, and a_⊥ → 0 and flips sign. That inflection is the point of
// the preset.
function figureEightWaypoints(n = 16, cx = 0.5, cy = 0.5, w = 0.36, h = 0.24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push({ x: cx + w * Math.sin(t), y: cy - h * Math.sin(t) * Math.cos(t) });
  }
  return out;
}

const PRESETS = {
  racetrack: { label: 'Racetrack', make: () => DEFAULT_WAYPOINTS.map((p) => ({ ...p })) },
  circle: { label: 'Circle', make: () => circleWaypoints() },
  ellipse: { label: 'Ellipse', make: () => ellipseWaypoints() },
  figure8: { label: 'Figure-8', make: () => figureEightWaypoints() },
};

// ── spline geometry ────────────────────────────────────────────────────────

// Centripetal Catmull-Rom position for the segment P1→P2 given the four
// control points and local parameter t in [0,1]. Centripetal (alpha=0.5)
// avoids the cusps/self-intersections uniform Catmull-Rom produces on sharp
// waypoint spacing.
function catmullRom(p0, p1, p2, p3, t) {
  const alpha = 0.5;
  const d = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y) || 1e-6, alpha);
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t; // remap local t into the segment's param range

  const lerp = (a, b, ta, tb, u) => {
    const w = tb - ta === 0 ? 0 : (u - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const A1 = lerp(p0, p1, t0, t1, tt);
  const A2 = lerp(p1, p2, t1, t2, tt);
  const A3 = lerp(p2, p3, t2, t3, tt);
  const B1 = lerp(A1, A2, t0, t2, tt);
  const B2 = lerp(A2, A3, t1, t3, tt);
  return lerp(B1, B2, t1, t2, tt);
}

// Discrete signed curvature at polyline vertex b given neighbours a,c (px).
// κ = 1/R via the circumradius of the triangle a-b-c: κ = 2·(cross)/(|ab||bc||ca|).
// Sign is +/- with the turn direction; magnitude is 1/r regardless of spacing.
function curvatureAt(a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const cax = a.x - c.x, cay = a.y - c.y;
  const lab = Math.hypot(abx, aby);
  const lbc = Math.hypot(bcx, bcy);
  const lca = Math.hypot(cax, cay);
  const denom = lab * lbc * lca;
  if (denom < 1e-9) return 0;
  const cross = abx * bcy - aby * bcx; // signed twice-area of the triangle
  return (2 * cross) / denom;          // signed κ (1/px)
}

// Sample the whole CLOSED loop into a dense polyline of {x,y} points (canvas px)
// plus a cumulative arc-length table so we can map arc length → point, plus a
// per-point signed curvature κ (used to heat-color the path).
function buildPath(waypoints) {
  const n = waypoints.length;
  const perSeg = Math.max(8, Math.floor(ARC_SAMPLES / n));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % n];
    const p3 = waypoints[(i + 2) % n];
    for (let j = 0; j < perSeg; j++) {
      pts.push(catmullRom(p0, p1, p2, p3, j / perSeg));
    }
  }
  const m = pts.length;
  // cumulative arc length (wrapping back to the start to close the loop)
  const cum = new Float64Array(m + 1);
  for (let i = 1; i <= m; i++) {
    const a = pts[i - 1];
    const b = pts[i % m];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  // signed curvature per vertex (wrapping neighbours, so the closed loop is
  // continuous). Take a small step of neighbours for a stable estimate.
  const step = Math.max(1, Math.floor(m / 240));
  const kappa = new Float64Array(m);
  let kMax = 1e-9;
  for (let i = 0; i < m; i++) {
    const a = pts[(i - step + m) % m];
    const b = pts[i];
    const c = pts[(i + step) % m];
    kappa[i] = curvatureAt(a, b, c);
    const k = Math.abs(kappa[i]);
    if (k > kMax) kMax = k;
  }
  return { pts, cum, total: cum[m], kappa, kMax };
}

// Point on the loop at arc length s (px), wrapping. Linear interp within the
// dense polyline — fine at this resolution.
function pointAtLength(path, s) {
  const { pts, cum, total } = path;
  if (total <= 0) return { x: pts[0].x, y: pts[0].y };
  const d = ((s % total) + total) % total;
  // binary search the cumulative table
  let lo = 0, hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid + 1; else hi = mid;
  }
  const i = Math.max(1, lo);
  const seg = cum[i] - cum[i - 1] || 1e-9;
  const w = (d - cum[i - 1]) / seg;
  const a = pts[(i - 1) % pts.length];
  const b = pts[i % pts.length];
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

// Speed profile: fraction of the loop covered as a function of loop phase
// φ ∈ [0,1). Uniform ⇒ φ itself. "Speeding up" uses a smooth sinusoidal speed
// that spends the front of the loop slow and the back fast, so |v| visibly
// varies and a_t switches sign — a clean contrast with the uniform case.
function phaseToFraction(phi, uniform) {
  if (uniform) return phi;
  // s'(φ) = 1 + 0.85*cos(2πφ), integrated & normalized. The sin term is 0 at
  // φ=0 and φ=1, so this maps 0→1 monotonically over one loop.
  const twoPi = 2 * Math.PI;
  return phi + (0.85 / twoPi) * Math.sin(twoPi * phi);
}

// d(fraction)/dφ — the speed profile's derivative. Physical |v| along the loop
// is L·rate·f'(φ), so this factor IS the shape of the |v|-vs-φ strip chart:
// flat at 1 for uniform, sinusoidal for speeding-up (and its slope is a_t).
function fractionDeriv(phi, uniform) {
  if (uniform) return 1;
  return 1 + 0.85 * Math.cos(2 * Math.PI * phi);
}

// Heat gradient (cool → hot) for a normalized curvature t ∈ [0,1]. Straight
// stretches read blue/teal; the tightest bend glows red — where a_⊥ peaks.
function heatColor(t) {
  const u = Math.max(0, Math.min(1, t));
  // three-stop ramp: blue(#3E6FB0) → gold(#C5B783) → red(#E27D60)
  const stops = [
    [62, 111, 176],
    [197, 183, 131],
    [226, 125, 96],
  ];
  const seg = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i], b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

// ── wrapper (hook-free): dispatch to the per-mode child ──────────────────────
// Kept a plain wrapper so the Rules of Hooks are never at risk if this demo
// later grows extra modes; the child owns all state/effects.
export default function VectorKinematics({ mode = 'default' }) { // eslint-disable-line no-unused-vars
  return <Sandbox />;
}

// ── the sandbox (owns all hooks) ─────────────────────────────────────────────
function Sandbox() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Waypoints live in normalized [0,1] coords so the loop survives resize; we
  // keep them in a ref (mutated by pointer handlers) AND in state (to trigger
  // re-render of the count / delete-button availability).
  const [waypoints, setWaypoints] = useState(() => DEFAULT_WAYPOINTS.map((p) => ({ ...p })));
  const wpRef = useRef(waypoints);
  wpRef.current = waypoints;

  // UI toggles.
  const [uniform, setUniform] = useState(true);       // uniform vs speeding-up
  const [showV, setShowV] = useState(true);
  const [showA, setShowA] = useState(true);
  const [showTN, setShowTN] = useState(true);         // tangential/normal split
  const [showCircle, setShowCircle] = useState(true); // osculating circle
  const [showKappa, setShowKappa] = useState(true);   // color path by curvature
  const [trail, setTrail] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(0.35);           // loops per second (phase rate)
  const [presetKey, setPresetKey] = useState('racetrack');

  // Freeze-frame: when paused, this slider drives φ directly. We keep the live
  // phase in a ref (the loop owns it) and a mirrored state value for the slider.
  const [scrubPhase, setScrubPhase] = useState(0);
  const phaseRef = useRef(0);
  const scrubbingRef = useRef(false); // true while the user drags the φ slider

  // Mirror toggles into a ref so the single rAF loop always sees fresh values
  // without being torn down/rebuilt on every checkbox click.
  const cfg = useRef({});
  cfg.current = { uniform, showV, showA, showTN, showCircle, showKappa, trail, playing, speed };

  // Live readouts — updated from the loop via throttled state (not per frame).
  const [readout, setReadout] = useState({ speed: 0, aMag: 0, angle: 0, aT: 0, aN: 0, radius: Infinity });

  // Strip-chart data (|v| vs φ over the whole loop) + cursor, published throttled.
  const [strip, setStrip] = useState({ phi: [], v: [], cursorPhi: 0, cursorV: 0, vMax: 1 });

  const applyPreset = useCallback((key) => {
    const p = PRESETS[key];
    if (!p) return;
    setPresetKey(key);
    setWaypoints(p.make());
  }, []);

  const reset = useCallback(() => {
    setPresetKey('racetrack');
    setWaypoints(DEFAULT_WAYPOINTS.map((p) => ({ ...p })));
    setUniform(true); setShowV(true); setShowA(true); setShowTN(true);
    setShowCircle(true); setShowKappa(true); setTrail(true); setPlaying(true);
    setSpeed(0.35); setScrubPhase(0); phaseRef.current = 0;
  }, []);

  // Pointer interaction state (in a ref; no re-render while dragging).
  const drag = useRef({ index: -1 });

  // ── the one effect: setup, resize observer, pointer handlers, rAF loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W = 0, H = 0, raf, last = 0;
    const trailPts = [];           // recent particle positions (px)
    let readoutClock = 0;
    let stripClock = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // normalized [0,1] → px and back
    const toPx = (p) => ({ x: p.x * W, y: p.y * H });
    const toNorm = (x, y) => ({ x: x / W, y: y / H });

    // Build the px-space path fresh each frame from current (normalized)
    // waypoints, so dragging updates the curve live and resize is automatic.
    const currentPath = () => buildPath(wpRef.current.map(toPx));

    // Where the delete "x" sits relative to a waypoint (up-right of the dot).
    const deletePos = (px) => ({ x: px.x + 13, y: px.y - 13 });

    // ── pointer handlers ──────────────────────────────────────────────────
    const localXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e) => {
      const { x, y } = localXY(e);
      const wps = wpRef.current;
      // 1) delete target hit?
      for (let i = 0; i < wps.length; i++) {
        const px = toPx(wps[i]);
        const dp = deletePos(px);
        if (Math.hypot(x - dp.x, y - dp.y) <= DELETE_HIT && wps.length > MIN_WAYPOINTS) {
          setPresetKey('custom');
          setWaypoints((prev) => prev.filter((_, k) => k !== i));
          return;
        }
      }
      // 2) grab a waypoint to drag?
      for (let i = 0; i < wps.length; i++) {
        const px = toPx(wps[i]);
        if (Math.hypot(x - px.x, y - px.y) <= HIT) {
          drag.current.index = i;
          canvas.setPointerCapture?.(e.pointerId);
          return;
        }
      }
      // 3) empty space → add a waypoint, inserted after the nearest edge midpoint
      //    so the loop stays sensible instead of jumping across itself.
      const nrm = toNorm(x, y);
      setPresetKey('custom');
      setWaypoints((prev) => {
        if (prev.length < 2) return [...prev, nrm];
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < prev.length; i++) {
          const a = toPx(prev[i]);
          const b = toPx(prev[(i + 1) % prev.length]);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const d = Math.hypot(x - mx, y - my);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        const out = prev.slice();
        out.splice(bestI + 1, 0, nrm);
        return out;
      });
    };

    const onMove = (e) => {
      if (drag.current.index < 0) return;
      const { x, y } = localXY(e);
      const nrm = toNorm(
        Math.max(0, Math.min(W, x)),
        Math.max(0, Math.min(H, y)),
      );
      const i = drag.current.index;
      // mutate the ref immediately for a smooth live curve; commit to state on up
      wpRef.current = wpRef.current.map((p, k) => (k === i ? nrm : p));
    };

    const onUp = (e) => {
      if (drag.current.index >= 0) {
        setPresetKey('custom');
        setWaypoints(wpRef.current.map((p) => ({ ...p }))); // commit
        canvas.releasePointerCapture?.(e.pointerId);
      }
      drag.current.index = -1;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.style.touchAction = 'none'; // let us own touch drags

    // ── drawing helpers ─────────────────────────────────────────────────────
    const drawGrid = () => {
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      const step = 40;
      ctx.beginPath();
      for (let gx = step; gx < W; gx += step) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
      for (let gy = step; gy < H; gy += step) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
      ctx.stroke();
    };

    // ── main loop ────────────────────────────────────────────────────────────
    const frame = (now) => {
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60; // bound for tab-throttle safety
      const c = cfg.current;

      ctx.clearRect(0, 0, W, H);
      drawGrid();

      const path = currentPath();
      const L = path.total;

      // advance phase — but if the user is scrubbing φ (freeze-frame), the
      // slider owns phaseRef and we do NOT integrate.
      if (c.playing && !scrubbingRef.current && L > 0) {
        phaseRef.current = (phaseRef.current + c.speed * dt) % 1;
      }
      const phase = ((phaseRef.current % 1) + 1) % 1;

      // draw the path — colored by local curvature κ when enabled, else the
      // original gold. Coloring per polyline segment makes the sharpest bend
      // glow red exactly where a_⊥ peaks.
      if (path.pts.length > 1) {
        if (c.showKappa) {
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          for (let i = 1; i < path.pts.length; i++) {
            const a = path.pts[i - 1];
            const b = path.pts[i];
            const k = Math.abs(path.kappa[i]) / path.kMax; // 0..1
            // sqrt spreads the low end so gentle bends still read as warm-ish
            ctx.strokeStyle = heatColor(Math.sqrt(k));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          // close the loop
          const a = path.pts[path.pts.length - 1];
          const b = path.pts[0];
          const k = Math.abs(path.kappa[0]) / path.kMax;
          ctx.strokeStyle = heatColor(Math.sqrt(k));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.lineCap = 'butt';
        } else {
          ctx.strokeStyle = 'rgba(197,183,131,0.55)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          path.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
        }
      }

      // ── kinematics: position, velocity, acceleration by central differences ─
      // Map phase → arc length via the speed profile, then finite-difference
      // position vs TIME. Convert a small phase step to the equivalent time step.
      const posAtPhase = (phi) => {
        const f = phaseToFraction(((phi % 1) + 1) % 1, c.uniform);
        return pointAtLength(path, f * L);
      };
      const dphi = 1 / 800;
      const rate = Math.max(1e-4, c.speed);
      const dtLocal = dphi / rate;

      const p0 = posAtPhase(phase - dphi);
      const pC = posAtPhase(phase);
      const p1 = posAtPhase(phase + dphi);

      // velocity (px/s) and acceleration (px/s²) — screen coords (+y down)
      const vx = (p1.x - p0.x) / (2 * dtLocal);
      const vy = (p1.y - p0.y) / (2 * dtLocal);
      const ax = (p1.x - 2 * pC.x + p0.x) / (dtLocal * dtLocal);
      const ay = (p1.y - 2 * pC.y + p0.y) / (dtLocal * dtLocal);

      const vMag = Math.hypot(vx, vy);
      const aMag = Math.hypot(ax, ay);

      // tangential / normal decomposition of a
      let tux = 0, tuy = 0;
      if (vMag > 1e-6) { tux = vx / vMag; tuy = vy / vMag; }
      const aT = ax * tux + ay * tuy;                 // signed: along +v
      const aTx = aT * tux, aTy = aT * tuy;
      const aNx = ax - aTx, aNy = ay - aTy;           // normal component vector
      const aN = Math.hypot(aNx, aNy);

      // radius of curvature from a_n = v²/r  ⇒  r = v²/|a_n|
      const radius = aN > 1e-6 ? (vMag * vMag) / aN : Infinity;

      // angle between v and a (degrees)
      let angleVA = 0;
      if (vMag > 1e-6 && aMag > 1e-6) {
        const cos = (vx * ax + vy * ay) / (vMag * aMag);
        angleVA = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      }

      // ── trail ────────────────────────────────────────────────────────────
      // Freeze-frame parks the particle, so don't grow the trail while scrubbing.
      const advancing = c.playing && !scrubbingRef.current;
      if (!c.trail) {
        trailPts.length = 0;
      } else if (advancing) {
        trailPts.push({ x: pC.x, y: pC.y });
        if (trailPts.length > 220) trailPts.shift();
      }
      if (c.trail && trailPts.length > 1) {
        for (let i = 1; i < trailPts.length; i++) {
          const alpha = (i / trailPts.length) * 0.5;
          ctx.strokeStyle = `rgba(240,236,227,${alpha.toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(trailPts[i - 1].x, trailPts[i - 1].y);
          ctx.lineTo(trailPts[i].x, trailPts[i].y);
          ctx.stroke();
        }
      }

      // ── osculating circle (center of curvature = particle + r * n̂) ────────
      // At an inflection (figure-8 center) r→∞: we intentionally do NOT draw an
      // absurd circle; the banner names that "r→∞, a_⊥→0" state instead.
      if (c.showCircle && isFinite(radius) && radius < Math.max(W, H) * 3 && aN > 1e-6) {
        const nux = aNx / aN, nuy = aNy / aN; // unit normal (toward inside)
        const cx = pC.x + nux * radius;
        const cy = pC.y + nuy * radius;
        ctx.save();
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = 'rgba(226,125,96,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        // center dot + spoke to particle (the radius r that feeds v²/r)
        ctx.strokeStyle = 'rgba(226,125,96,0.5)';
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(pC.x, pC.y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(226,125,96,0.85)';
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }

      // ── waypoint handles + delete targets ─────────────────────────────────
      const wps = wpRef.current;
      for (let i = 0; i < wps.length; i++) {
        const px = toPx(wps[i]);
        const isDragging = drag.current.index === i;
        ctx.fillStyle = isDragging ? '#FFFFFF' : GOLD;
        ctx.strokeStyle = BG;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px.x, px.y, isDragging ? 8 : 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        // delete "x"
        if (wps.length > MIN_WAYPOINTS) {
          const dp = deletePos(px);
          ctx.strokeStyle = 'rgba(226,125,96,0.9)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(dp.x - 4, dp.y - 4); ctx.lineTo(dp.x + 4, dp.y + 4);
          ctx.moveTo(dp.x + 4, dp.y - 4); ctx.lineTo(dp.x - 4, dp.y + 4);
          ctx.stroke();
        }
      }

      // ── the particle ─────────────────────────────────────────────────────
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(pC.x, pC.y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── vectors (scaled so they read at any speed) ────────────────────────
      const vScale = 0.35;   // px per (px/s)
      const aScale = 0.12;   // px per (px/s²)
      if (c.showV && vMag > 1e-3) {
        drawArrow(ctx, {
          x: pC.x, y: pC.y, dx: vx * vScale, dy: vy * vScale,
          color: GOLD, width: 3, label: 'v', head: 11,
        });
      }
      if (c.showA && aMag > 1e-2) {
        if (c.showTN) {
          if (Math.hypot(aTx, aTy) * aScale > 3) {
            drawArrow(ctx, {
              x: pC.x, y: pC.y, dx: aTx * aScale, dy: aTy * aScale,
              color: GREEN, width: 3, label: 'a∥', head: 10,
            });
          }
          if (Math.hypot(aNx, aNy) * aScale > 3) {
            drawArrow(ctx, {
              x: pC.x, y: pC.y, dx: aNx * aScale, dy: aNy * aScale,
              color: RED, width: 3, label: 'a⊥', head: 10,
            });
          }
        }
        // net a in blue (thin when decomposed, to read as the sum of the two)
        drawArrow(ctx, {
          x: pC.x, y: pC.y, dx: ax * aScale, dy: ay * aScale,
          color: BLUE, width: c.showTN ? 2 : 3, label: c.showTN ? '' : 'a', head: 10,
        });
      }

      // ── legend (top-left) ─────────────────────────────────────────────────
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const legend = [];
      if (c.showV) legend.push(['v  velocity', GOLD]);
      if (c.showA && c.showTN) {
        legend.push(['a∥ tangential', GREEN]);
        legend.push(['a⊥ normal (centripetal)', RED]);
      }
      if (c.showA) legend.push(['a  net', BLUE]);
      legend.forEach((row, i) => {
        const ly = 16 + i * 18;
        ctx.strokeStyle = row[1];
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(12, ly); ctx.lineTo(34, ly); ctx.stroke();
        ctx.fillStyle = MUTED;
        ctx.fillText(row[0], 40, ly);
      });

      // curvature colorbar caption (bottom-left) when the heatmap is on
      if (c.showKappa) {
        const bx = 12, by = H - 18, bw = 120, bh = 8;
        for (let i = 0; i < bw; i++) {
          ctx.fillStyle = heatColor(i / (bw - 1));
          ctx.fillRect(bx + i, by, 1, bh);
        }
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText('κ low', bx, by - 8);
        ctx.textAlign = 'right';
        ctx.fillText('high (tight bend)', bx + bw, by - 8);
        ctx.textAlign = 'left';
      }

      // freeze-frame badge
      if (scrubbingRef.current || (!c.playing)) {
        ctx.fillStyle = 'rgba(197,183,131,0.9)';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`frozen · φ = ${phase.toFixed(2)}`, W - 12, 16);
        ctx.textAlign = 'left';
      }

      // ── publish readouts (throttled to ~10 Hz) ────────────────────────────
      readoutClock += dt;
      if (readoutClock > 0.1) {
        readoutClock = 0;
        setReadout({
          speed: vMag, aMag, angle: angleVA,
          aT, aN, radius: isFinite(radius) ? radius : Infinity,
        });
        // keep the freeze-frame slider position in sync while playing (so it
        // doesn't lie when the user later grabs it)
        if (advancing) setScrubPhase(phase);
      }

      // ── publish strip chart |v| vs φ (throttled to ~5 Hz) ──────────────────
      // |v|(φ) = L·rate·f'(φ). We sample the whole loop so the chart shows the
      // profile at every position, then drop a cursor at the current φ. Flat for
      // uniform (a_t=0); sinusoidal for speeding-up (its slope IS a_t).
      stripClock += dt;
      if (stripClock > 0.2 && L > 0) {
        stripClock = 0;
        const phiArr = new Array(STRIP_N + 1);
        const vArr = new Array(STRIP_N + 1);
        let vMaxLocal = 1e-9;
        for (let i = 0; i <= STRIP_N; i++) {
          const ph = i / STRIP_N;
          const vv = L * rate * fractionDeriv(ph, c.uniform);
          phiArr[i] = ph;
          vArr[i] = vv;
          if (vv > vMaxLocal) vMaxLocal = vv;
        }
        setStrip({
          phi: phiArr,
          v: vArr,
          cursorPhi: phase,
          cursorV: L * rate * fractionDeriv(phase, c.uniform),
          vMax: vMaxLocal,
        });
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
    // loop reads live state through refs; intentionally never rebuilt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Values are in canvas px units; report as unitless "sim" quantities so the
  // pedagogy (relationships, the v–a angle) reads without pretending to be SI m.
  const fmt = (x) => (isFinite(x) ? x.toFixed(0) : '∞');

  // ── FIX: scale-free banner gate ──────────────────────────────────────────
  // The old gate used raw px magnitudes (readout.aMag > 5), which meant the
  // banner appeared/vanished purely by changing speed or canvas size. Gate
  // instead on the DIRECTION of a: the fraction that is sideways, aN/aMag. If
  // that ratio exceeds cos20° the acceleration is essentially all-normal — the
  // centripetal-at-constant-speed situation — regardless of units or zoom. We
  // also require a real amount of acceleration (aMag above a tiny floor) so a
  // momentarily-still particle doesn't trip it on numerical noise.
  const nearlyAllNormal = readout.aMag > 1e-3 && readout.aN / readout.aMag > COS20;
  const centripetal = uniform && nearlyAllNormal;

  // The complementary "r→∞, a_⊥→0" inflection state (figure-8 center, or any
  // near-straight stretch): a is almost ALL tangential, so aN/aMag is tiny and
  // r is huge. Name it rather than silently hiding the osculating circle.
  const COS80 = Math.cos((80 * Math.PI) / 180); // ≈0.174: a is >80° off-normal → nearly tangential
  const inflection =
    readout.aMag > 1e-3 &&
    readout.aN / readout.aMag < COS80 && // a_⊥ is a tiny fraction of a → path is nearly straight
    readout.radius > 800;                // and the osculating radius has blown up

  const Toggle = ({ checked, onChange, label, color }) => (
    <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-usna-gold w-4 h-4"
      />
      <span className="text-sm text-usna-text flex items-center gap-1.5">
        {color && <span className="inline-block w-3 h-0.5 rounded" style={{ background: color }} />}
        {label}
      </span>
    </label>
  );

  // ── strip-chart traces + layout ──────────────────────────────────────────
  // |v| vs loop position φ. Override the shared IntensityPlot base axes (which
  // default to [0,1.05] / "Normalized Intensity") so this reads as a physics plot.
  const stripTraces = [
    {
      x: strip.phi, y: strip.v, type: 'scatter', mode: 'lines',
      line: { color: uniform ? GOLD : BLUE, width: 2.5 }, hoverinfo: 'skip',
    },
    {
      x: [strip.cursorPhi], y: [strip.cursorV], type: 'scatter', mode: 'markers',
      marker: { color: '#FFFFFF', size: 9, line: { color: uniform ? GOLD : BLUE, width: 2 } },
      hoverinfo: 'skip',
    },
  ];
  const stripLayout = {
    showlegend: false,
    margin: { l: 54, r: 14, t: 8, b: 40 },
    xaxis: {
      title: { text: 'loop position φ' }, range: [0, 1], autorange: false,
      zeroline: false, tickfont: { size: 11 },
    },
    yaxis: {
      title: { text: '|v| (px/s)' }, range: [0, strip.vMax * 1.15 || 1], autorange: false,
      zeroline: true, zerolinecolor: '#2A3442', tickfont: { size: 11 },
    },
    shapes: [{
      type: 'line', xref: 'x', yref: 'paper',
      x0: strip.cursorPhi, x1: strip.cursorPhi, y0: 0, y1: 1,
      line: { color: 'rgba(240,236,227,0.5)', width: 1, dash: 'dot' },
    }],
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {/* transport */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setPlaying((p) => {
              // pressing Play always releases any lingering freeze-frame grab so
              // the phase resumes advancing from where it was parked
              if (!p) scrubbingRef.current = false;
              return !p;
            })}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="text-usna-muted text-xs">tap the plane to add points</span>
        </div>

        {/* snap-to-shape presets */}
        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-1.5">Snap to shape</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-2 py-1.5 rounded text-sm border transition-colors ${
                  presetKey === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {presetKey === 'custom' && (
            <div className="text-usna-muted text-xs mt-1">custom loop (edited)</div>
          )}
        </div>

        {/* speed profile toggle */}
        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-1.5">Speed profile</div>
          <div className="flex gap-1.5">
            {[['Uniform', true], ['Speeding up', false]].map(([lbl, val]) => (
              <button
                key={lbl}
                onClick={() => setUniform(val)}
                className={`flex-1 px-2 py-1.5 rounded text-sm border transition-colors ${
                  uniform === val
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* lap rate slider */}
        <div className="mb-1">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-usna-text text-sm font-medium">Lap rate</span>
            <span className="font-mono text-sm text-usna-gold tabular-nums">{speed.toFixed(2)} /s</span>
          </div>
          <input
            type="range" min={0.05} max={1.0} step={0.05} value={speed}
            onInput={(e) => setSpeed(parseFloat(e.target.value))}
            aria-label="Lap rate" className="w-full accent-usna-gold"
          />
        </div>

        {/* freeze-frame scrub — pauses on grab, sets φ directly */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-usna-text text-sm font-medium">Freeze-frame φ</span>
            <span className="font-mono text-sm text-usna-gold tabular-nums">{scrubPhase.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.001} value={scrubPhase}
            onPointerDown={() => { scrubbingRef.current = true; setPlaying(false); }}
            onPointerUp={() => { scrubbingRef.current = false; }}
            onInput={(e) => {
              const v = parseFloat(e.target.value);
              scrubbingRef.current = true;   // covers keyboard/drag without pointerdown
              setPlaying(false);
              phaseRef.current = v;          // the loop reads φ straight from here
              setScrubPhase(v);
            }}
            aria-label="Freeze-frame loop position"
            className="w-full accent-usna-gold"
          />
          <div className="text-usna-muted text-xs mt-1">
            drag to park the particle at an apex and read the frozen arrows
          </div>
        </div>

        {/* visibility toggles */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-1">Show</div>
          <Toggle checked={showV} onChange={setShowV} label="Velocity  v" color={GOLD} />
          <Toggle checked={showA} onChange={setShowA} label="Acceleration  a" color={BLUE} />
          <Toggle checked={showTN} onChange={setShowTN} label="a split: tangential / normal" />
          <Toggle checked={showCircle} onChange={setShowCircle} label="Osculating circle" color={RED} />
          <Toggle checked={showKappa} onChange={setShowKappa} label="Color path by curvature κ" />
          <Toggle checked={trail} onChange={setTrail} label="Trail" color={MUTED} />
        </div>

        {/* readouts */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Speed |v|" value={fmt(readout.speed)} unit="px/s" />
          <Readout label="|a|" value={fmt(readout.aMag)} unit="px/s²" />
          <Readout label="∠(v, a)" value={readout.angle.toFixed(0)} unit="°" />
          <div className="mt-1 pt-1 border-t border-usna-grid">
            <Readout label="a∥ tangential" value={readout.aT.toFixed(0)} unit="px/s²" />
            <Readout label="a⊥ centripetal" value={readout.aN.toFixed(0)} unit="px/s²" />
            <Readout label="radius r" value={fmt(readout.radius)} unit="px" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* the sandbox */}
        <div
          ref={wrapRef}
          className="relative border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 540, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
          {/* the counterintuitive-moment banner */}
          {centripetal && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-usna-navy/85 border border-usna-gold text-usna-gold text-xs font-mono text-center pointer-events-none">
              constant speed, yet |a| ≈ {fmt(readout.aMag)} — pointing sideways.
              <br />that sideways arrow is centripetal: a = v²/r
            </div>
          )}
          {/* the complementary inflection state — name it, don't hide it */}
          {!centripetal && inflection && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-usna-navy/85 text-usna-text text-xs font-mono text-center pointer-events-none border"
              style={{ borderColor: BLUE }}
            >
              inflection: the path straightens here — r → ∞, so a⊥ → 0.
              <br />the osculating circle has flattened to a line.
            </div>
          )}
        </div>

        {/* [EXPLAIN] |v| vs loop-position strip chart with a moving cursor */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0 overflow-hidden" style={{ height: 200 }}>
          <div className="text-usna-muted text-xs mb-1 px-1">
            Speed vs loop position — {uniform
              ? 'flat: |v| constant, so a∥ (its slope) = 0.'
              : 'a sinusoid: the SLOPE of this curve is a∥ (tangential acceleration).'}
          </div>
          <div style={{ height: 160 }}>
            <IntensityPlot traces={stripTraces} layoutOverrides={stripLayout} />
          </div>
        </div>

        <p className="text-usna-muted text-xs px-1">
          Tap empty space to add a waypoint · drag the gold dots to reshape the path ·
          tap a dot's small × to delete it · or snap to a shape and drag the φ slider to freeze a frame.
        </p>

        <InfoPanel {...INFO} />
      </div>
    </div>
  );
}

const INFO = {
  title: 'Velocity is tangent; acceleration turns you',
  description:
    'The velocity arrow always points along the path (tangent). Acceleration is the change in the velocity VECTOR — so on a curve it is nonzero even at constant speed, and it points toward the inside of the bend. Switch the speed profile to "Uniform": the tangential (green) component collapses to zero, but the normal/red arrow — the centripetal acceleration — stays large and aims straight at the center of the osculating circle. Constant speed does not mean no acceleration. Color the path by curvature κ=1/r and the tightest bend glows red — exactly where a⊥ peaks, since a⊥ = κv². Snap to the figure-8 and ride through the center: the path straightens, r → ∞, and a⊥ collapses to zero and flips sign. The |v|-vs-φ strip chart below makes a∥ visible as a slope: flat under Uniform, a sinusoid under Speeding-up. This is the L7 result, three lessons early: a curved trajectory demands a sideways force, and its size is v²/r.',
  equation: String.raw`\vec a = \underbrace{\tfrac{d|\vec v|}{dt}\,\hat T}_{\text{tangential}} + \underbrace{\tfrac{|\vec v|^2}{r}\,\hat N}_{\text{centripetal}}, \qquad \kappa = \tfrac{1}{r}`,
};
