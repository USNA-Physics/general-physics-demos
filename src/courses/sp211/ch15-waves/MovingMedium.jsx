import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';

/**
 * D39b · Sound Propagation in a Moving or Structured Medium — SP211 L39 enrichment.
 *
 * The advanced sibling to D39 (the basic Doppler wavefront visualizer). Where D39
 * holds the medium still, this one lets the medium MOVE (wind) or be LAYERED
 * (a sound-speed profile), and makes "the medium is the referee" visible:
 *
 *   uniform       a uniform wind is an effective directional sound speed c_n =
 *                 c + w·n̂. It CANCELS from the pitch for co-moving source and
 *                 receiver (f_r = f_s for ANY wind) and shifts only under their
 *                 relative motion. Advected circular wavefronts show the λ
 *                 anisotropy (long downwind, short upwind) that the speed exactly
 *                 compensates.
 *   wind-shear    a wind that grows with height refracts rays: downwind they bend
 *                 DOWN and carry for miles; upwind they bend UP and open a shadow.
 *   thermal       a daytime lapse (c falls with height) refracts rays UP → a
 *                 surface shadow (the sonar "afternoon effect"); a night inversion
 *                 refracts them DOWN → sound carries far.
 *   ocean-channel a sound-speed minimum at depth (the SOFAR axis) TRAPS rays in a
 *                 duct that ferries them across an ocean, refocusing at convergence
 *                 zones; a "sub" reads detected (in a CZ) or not (in a shadow).
 *
 * Physics: 2-D eikonal ray tracing, RK4, with the effective speed
 *   c_eff(y,θ) = c(y) + w(y)·cos θ        (θ = ray angle from horizontal)
 * and the stratified-medium ray equations
 *   dx/ds = cosθ,  dy/ds = sinθ,  dθ/ds = −(cosθ/c_eff)·∂c_eff/∂y.
 * This conserves the Snell invariant cosθ/c_eff when w=0, so rays turn where the
 * speed rises and bend toward lower speed — the ray invariant made visible.
 *
 * Per CONTRIBUTING.md: one rAF loop reading inputs from refs; the ray fan is
 * PRECOMPUTED (useMemo) when the profile/source change, never per frame — the
 * per-frame work is only the marching pulse / wavefront expansion and ~10 Hz
 * readouts. Canvas for all drawing. SI internally; display km / m / (m/s).
 */

// ── canvas palette (hex — canvas can't read tailwind classes) ────────────────
const BG = '#0D1321';
const GRID = '#1A2332';
const RAY = '#5B9BD5';                     // rays (a readable navy on the dark field)
const RAY_DIM = 'rgba(91,155,213,0.42)';
const GOLD = '#C5B783';                    // caustics / focus / highlighted ray / the answer
const SHADOW = 'rgba(123,127,135,0.20)';   // gray "ray shadow" fill
const WHITE = '#F0ECE3';
const MUTED = '#8B8C8E';
const GREEN = '#7FB77E';
const ORANGE = '#E0895B';

const DEG = Math.PI / 180;
const SRC_X_FRAC = 0.012;     // source sits at 1.2% of the range, just inside the left edge
const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));

// ═════════════════════════════════════════════════════════════════════════════
//  Ray engine (shared by wind-shear / thermal / ocean-channel)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Integrate one ray with RK4 through a stratified profile.
 *  prof: { cAt(y), dcAt(y), wAt(y), dwAt(y) }  — speed + wind + their y-gradients
 *  dom:  { xMax, yMin, yMax, ds, maxSteps, reflectTop }  (y in physical metres)
 * Returns a decimated polyline [{ x, y, t, th }] with cumulative travel time t.
 */
function traceRay(x0, y0, th0, prof, dom) {
  let x = x0, y = y0, th = th0, t = 0;
  const out = [{ x, y, t, th }];
  const ds = dom.ds;
  const keepEvery = 3;                      // decimate: plenty for a smooth curve
  const deriv = (y_, th_) => {
    const ceff = Math.max(1, prof.cAt(y_) + prof.wAt(y_) * Math.cos(th_));
    const dceff = prof.dcAt(y_) + prof.dwAt(y_) * Math.cos(th_);
    return { dx: Math.cos(th_), dy: Math.sin(th_), dth: -(Math.cos(th_) / ceff) * dceff, ceff };
  };
  for (let i = 1; i <= dom.maxSteps; i++) {
    const k1 = deriv(y, th);
    const k2 = deriv(y + 0.5 * ds * k1.dy, th + 0.5 * ds * k1.dth);
    const k3 = deriv(y + 0.5 * ds * k2.dy, th + 0.5 * ds * k2.dth);
    const k4 = deriv(y + ds * k3.dy, th + ds * k3.dth);
    const nx = x + (ds / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
    let ny = y + (ds / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
    let nth = th + (ds / 6) * (k1.dth + 2 * k2.dth + 2 * k3.dth + k4.dth);
    const ceff = (k1.ceff + 2 * k2.ceff + 2 * k3.ceff + k4.ceff) / 6;
    t += ds / ceff;
    // specular reflection at the vertical boundaries (ground / sea surface / seabed)
    if (ny < dom.yMin) { ny = dom.yMin + (dom.yMin - ny); nth = -nth; }
    if (ny > dom.yMax) {
      if (dom.reflectTop) { ny = dom.yMax - (ny - dom.yMax); nth = -nth; }
      else { out.push({ x: nx, y: ny, t, th: nth }); break; }   // escaped (into the sky)
    }
    x = nx; y = ny; th = nth;
    if (i % keepEvery === 0) out.push({ x, y, t, th });
    if (x > dom.xMax || x < 0) { out.push({ x, y, t, th }); break; }
  }
  return out;
}

/** Launch a fan of rays from the source over the configured take-off angles. */
function traceFan(prof, src, dom, fanDeg, nRays) {
  const rays = [];
  for (const deg of linspace(fanDeg[0], fanDeg[1], nRays)) {
    rays.push(traceRay(src.x, src.y, deg * DEG, prof, dom));
  }
  return rays;
}

/**
 * Rasterise the fan onto a coarse grid to find shadow zones (ray-density gaps)
 * and convergence/caustic cells (ray-density spikes).
 *  rule 'below'    — atmosphere: shade un-lit cells BELOW the highest ray in a
 *                    column (the ground shadow under up-refracted rays + gaps).
 *  rule 'interior' — ocean: shade un-lit cells BETWEEN the shallowest and deepest
 *                    ray in a column (the shadow pockets between convergence zones).
 */
function buildCoverage(rays, dom, rule) {
  const gx = 160, gy = 72;
  const density = new Int16Array(gx * gy);
  const stamp = new Int16Array(gx * gy).fill(-1);
  const colLo = new Int16Array(gx).fill(gy);   // lowest lit row per column
  const colHi = new Int16Array(gx).fill(-1);   // highest lit row per column
  const cx = (x) => Math.floor((x / dom.xMax) * gx);
  const cy = (y) => Math.floor(((y - dom.yMin) / (dom.yMax - dom.yMin)) * gy);
  rays.forEach((ray, ri) => {
    for (let i = 1; i < ray.length; i++) {
      // walk the segment so thin fast rays still stamp every column they cross
      const a = ray[i - 1], b = ray[i];
      const steps = Math.max(1, Math.abs(cx(b.x) - cx(a.x)) + Math.abs(cy(b.y) - cy(a.y)));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const gxi = cx(a.x + (b.x - a.x) * f);
        const gyi = cy(a.y + (b.y - a.y) * f);
        if (gxi < 0 || gxi >= gx || gyi < 0 || gyi >= gy) continue;
        const idx = gyi * gx + gxi;
        if (stamp[idx] !== ri) { stamp[idx] = ri; density[idx] += 1; }  // distinct rays
        if (gyi < colLo[gxi]) colLo[gxi] = gyi;
        if (gyi > colHi[gxi]) colHi[gxi] = gyi;
      }
    }
  });
  const shadow = new Uint8Array(gx * gy);
  const caustic = new Uint8Array(gx * gy);
  for (let xi = 0; xi < gx; xi++) {
    if (colHi[xi] < 0) continue;                 // no rays reached this column at all
    for (let yi = 0; yi < gy; yi++) {
      const idx = yi * gx + xi;
      if (density[idx] >= 4) caustic[idx] = 1;    // focusing: many distinct rays overlap
      if (density[idx] > 0) continue;
      const inInterior = yi > colLo[xi] && yi < colHi[xi];
      const belowTop = yi < colHi[xi];
      if (rule === 'interior' ? inInterior : belowTop) shadow[idx] = 1;
    }
  }
  return { gx, gy, shadow, caustic };
}

/** Centroid (physical coords) + count of the shadow and caustic cells, for labels. */
function coverageCentroids(cov, dom) {
  const { gx, gy, shadow, caustic } = cov;
  const acc = (mask) => {
    let sx = 0, sy = 0, n = 0;
    for (let yi = 0; yi < gy; yi++) {
      for (let xi = 0; xi < gx; xi++) {
        if (!mask[yi * gx + xi]) continue;
        sx += (xi + 0.5) / gx * dom.xMax;
        sy += dom.yMin + (yi + 0.5) / gy * (dom.yMax - dom.yMin);
        n += 1;
      }
    }
    return n ? { x: sx / n, y: sy / n, n } : { x: 0, y: 0, n: 0 };
  };
  return { shadow: acc(shadow), caustic: acc(caustic) };
}

/**
 * Pick one representative ray that oscillates clearly about the axis (a moderate
 * take-off angle, trapped if possible), and return it with its turning points
 * (where the ray goes horizontal and reverses) and the turning-depth band. Used
 * to draw the deep-channel mechanism explicitly: refract down, turn, refract up.
 */
function pickPrincipal(rays, dom, fanDeg, n) {
  const idealDeg = 0.62 * fanDeg[1];
  const idx = Math.round(((idealDeg - fanDeg[0]) / (fanDeg[1] - fanDeg[0])) * (n - 1));
  const trapped = (ray) => !ray.some((p) => p.y < 8 || p.y > dom.yMax - 8);
  let ray = null;
  for (let r = 0; r < n && !ray; r++) {
    for (const j of [idx + r, idx - r]) {
      if (j >= 0 && j < rays.length && trapped(rays[j])) { ray = rays[j]; break; }
    }
  }
  if (!ray) ray = rays[Math.min(rays.length - 1, Math.max(0, idx))];
  const turns = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < ray.length; i++) {
    if (Math.sign(ray[i].th) !== Math.sign(ray[i - 1].th) && Math.abs(ray[i].th) < 0.5) {
      turns.push(ray[i]); lo = Math.min(lo, ray[i].y); hi = Math.max(hi, ray[i].y);
    }
  }
  return { ray, turns, upperTurn: lo === Infinity ? null : lo, lowerTurn: hi === -Infinity ? null : hi };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Per-mode configuration for the ray engine
// ═════════════════════════════════════════════════════════════════════════════

const C_AIR = 340;      // m/s
const C_SEA = 1500;     // m/s
const ATM_X = 8000;     // 8 km range
const ATM_Y = 1500;     // 1.5 km ceiling
const OCN_X = 120000;   // 120 km range
const OCN_Y = 4000;     // 4 km depth

const RAY_CFG = {
  'wind-shear': {
    orientation: 'up',           // y = height, ground at bottom
    xMax: ATM_X, yMax: ATM_Y, xUnit: 'km', xScale: 1000,
    srcYFrac: 0.03, fanDeg: [-52, 52], nRays: 85, reflectTop: false,
    shadowRule: 'below', stripVar: 'w',
    sliders: [
      { key: 'shear', label: 'Shear strength', min: 0, max: 45, step: 1, unit: 'm/s top' },
    ],
    toggles: [
      { key: 'dir', label: 'Wind', on: 'Downwind (tailwind)', off: 'Upwind (headwind)' },
      { key: 'log', label: 'Profile', on: 'Log w(y)', off: 'Linear w(y)' },
    ],
    defaults: { shear: 32, dir: true, log: false },
    presets: [
      { label: 'Downwind (carries for miles)', p: { shear: 32, dir: true } },
      { label: 'Upwind (shadow zone)', p: { shear: 32, dir: false } },
      { label: 'Light breeze', p: { shear: 12, dir: true } },
    ],
    detectLabel: 'receiver',
    buildProf({ shear, dir, log }) {
      const sgn = dir ? 1 : -1;
      const z0 = 2, norm = Math.log1p(ATM_Y / z0);
      const shape = log ? (y) => Math.log1p(y / z0) / norm : (y) => y / ATM_Y;
      const dshape = log ? (y) => 1 / ((y + z0) * norm) : () => 1 / ATM_Y;
      return {
        cAt: () => C_AIR, dcAt: () => 0,
        wAt: (y) => sgn * shear * shape(Math.max(0, y)),
        dwAt: (y) => sgn * shear * dshape(Math.max(0, y)),
      };
    },
  },
  thermal: {
    orientation: 'up',
    xMax: ATM_X, yMax: ATM_Y, xUnit: 'km', xScale: 1000,
    srcYFrac: 0.03, fanDeg: [-52, 52], nRays: 85, reflectTop: false,
    shadowRule: 'below', stripVar: 'c',
    sliders: [
      { key: 'grad', label: 'Δc over layer', min: -30, max: 30, step: 1, unit: 'm/s' },
    ],
    toggles: [],
    defaults: { grad: -22 },
    presets: [
      { label: 'Day: lapse (surface shadow)', p: { grad: -22 } },
      { label: 'Night: inversion (carries far)', p: { grad: 22 } },
      { label: 'Neutral (straight rays)', p: { grad: 0 } },
    ],
    detectLabel: 'receiver',
    buildProf({ grad }) {
      return {
        cAt: (y) => C_AIR + grad * (Math.max(0, y) / ATM_Y),
        dcAt: () => grad / ATM_Y,
        wAt: () => 0, dwAt: () => 0,
      };
    },
  },
  'ocean-channel': {
    orientation: 'depth',        // y = depth, surface at top, seabed at bottom
    xMax: OCN_X, yMax: OCN_Y, xUnit: 'km', xScale: 1000,
    srcYFrac: 0.25, fanDeg: [-12, 12], nRays: 80, reflectTop: true,
    shadowRule: 'interior', stripVar: 'c',
    sliders: [
      { key: 'axis', label: 'SOFAR axis depth', min: 500, max: 2000, step: 50, unit: 'm' },
      { key: 'strength', label: 'Channel strength', min: 15, max: 80, step: 1, unit: 'm/s' },
    ],
    toggles: [],
    defaults: { axis: 1000, strength: 45 },
    presets: [
      { label: 'Deep SOFAR axis (1000 m)', p: { axis: 1000, strength: 45 } },
      { label: 'Shallow duct (600 m)', p: { axis: 600, strength: 55 } },
      { label: 'Weak channel (leaky)', p: { axis: 1000, strength: 18 } },
    ],
    detectLabel: 'sub',
    buildProf({ axis, strength }) {
      // Channel with a sound-speed minimum at the axis, rising by ~+strength to
      // BOTH boundaries. The two sides use different curvature (the axis is not
      // centred) so each turning surface is equally strong — that symmetry is
      // what keeps shallow-launched rays trapped instead of escaping upward.
      const cmin = C_SEA - 20;                         // 1480 m/s at the axis
      const aboveSpan = Math.max(axis, 1), belowSpan = Math.max(OCN_Y - axis, 1);
      return {
        cAt: (z) => { const s = z < axis ? aboveSpan : belowSpan; return cmin + strength * ((z - axis) / s) ** 2; },
        dcAt: (z) => { const s = z < axis ? aboveSpan : belowSpan; return (2 * strength * (z - axis)) / (s * s); },
        wAt: () => 0, dwAt: () => 0,
      };
    },
  },
};

// ═════════════════════════════════════════════════════════════════════════════
//  RayMode — wind-shear / thermal / ocean-channel
// ═════════════════════════════════════════════════════════════════════════════

function RayMode({ mode }) {
  const cfg = RAY_CFG[mode];
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [params, setParams] = useState(() => ({ ...cfg.defaults }));
  // Source height fraction (0 = ground/surface boundary) and receiver (fractional
  // of the plot box, so both survive resizes). Receiver drag is cheap — it never
  // retraces the fan; only source position / sliders do.
  const [srcYFrac, setSrcYFrac] = useState(cfg.srcYFrac);
  const [recv, setRecv] = useState({ x: 0.72, y: cfg.srcYFrac });
  const [playing, setPlaying] = useState(true);
  const [showRays, setShowRays] = useState(true);
  const [showStrip, setShowStrip] = useState(true);
  const [live, setLive] = useState({ detected: false, time: 0, nReach: 0 });

  // The physical source position (metres). x sits just inside the left edge.
  const srcX = cfg.xMax * SRC_X_FRAC;
  const srcY = srcYFrac * cfg.yMax;

  // ── precomputed ray field (retrace only when profile / source move) ──────────
  const field = useMemo(() => {
    const prof = cfg.buildProf(params);
    const dom = {
      xMax: cfg.xMax, yMin: 0, yMax: cfg.yMax,
      ds: cfg.xMax / 560, maxSteps: 2600, reflectTop: cfg.reflectTop,
    };
    const rays = traceFan(prof, { x: srcX, y: srcY }, dom, cfg.fanDeg, cfg.nRays);
    const cov = buildCoverage(rays, dom, cfg.shadowRule);
    const ann = coverageCentroids(cov, dom);
    const Tmax = Math.max(...rays.map((r) => r[r.length - 1].t), 1e-3);
    const axisY = mode === 'ocean-channel' ? params.axis : null;   // SOFAR axis depth
    const principal = mode === 'ocean-channel' ? pickPrincipal(rays, dom, cfg.fanDeg, cfg.nRays) : null;
    return { prof, dom, rays, cov, ann, Tmax, axisY, principal };
  }, [cfg, mode, params, srcX, srcY]);

  // refs mirrored for the rAF loop (so the loop sets up once per mode, not per tick)
  const srcRef = useRef({ x: srcX, y: srcY }); srcRef.current = { x: srcX, y: srcY };
  const fieldRef = useRef(field); fieldRef.current = field;
  const recvRef = useRef(recv); recvRef.current = recv;
  const playRef = useRef(playing); playRef.current = playing;
  const showRaysRef = useRef(showRays); showRaysRef.current = showRays;
  const showStripRef = useRef(showStrip); showStripRef.current = showStrip;

  const reset = useCallback(() => {
    setParams({ ...cfg.defaults });
    setSrcYFrac(cfg.srcYFrac);
    setRecv({ x: 0.72, y: cfg.srcYFrac });
    setPlaying(true); setShowRays(true); setShowStrip(true);
  }, [cfg]);

  // ── the animation loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last = null, pulseT = 0, pub = 0;

    // plot box insets (left strip for the profile, margins for axis labels)
    const box = () => ({
      L: showStripRef.current ? 66 : 20, R: W - 14, T: 14, B: H - 26,
    });
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    // physical → canvas mappers
    const mapper = () => {
      const { L, R, T, B } = box();
      const sx = (x) => L + (x / cfg.xMax) * (R - L);
      const sy = cfg.orientation === 'up'
        ? (y) => B - (y / cfg.yMax) * (B - T)       // height up
        : (y) => T + (y / cfg.yMax) * (B - T);      // depth down
      return { L, R, T, B, sx, sy };
    };

    const draw = (ts) => {
      const dt = last == null ? 0 : (ts - last) / 1000; last = ts;
      const f = fieldRef.current;
      if (playRef.current) { pulseT += dt * 0.4 * f.Tmax; if (pulseT > f.Tmax) pulseT = 0; }
      const m = mapper();
      const prof = f.prof;

      ctx.clearRect(0, 0, W, H);

      // backdrop: sky/sea gradient-ish bands + baseline boundary (ground/surface)
      ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      const yBound = cfg.orientation === 'up' ? m.sy(0) : m.sy(0);
      ctx.beginPath(); ctx.moveTo(m.L, yBound); ctx.lineTo(m.R, yBound); ctx.stroke();
      // label the boundary
      ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = MUTED; ctx.textAlign = 'left';
      ctx.fillText(cfg.orientation === 'up' ? 'ground' : 'sea surface', m.L + 4, yBound + (cfg.orientation === 'up' ? -4 : 12));

      // ── shadow + caustic cells ────────────────────────────────────────────────
      const { gx, gy, shadow, caustic } = f.cov;
      const cw = (m.R - m.L) / gx, ch = (m.B - m.T) / gy;
      ctx.fillStyle = SHADOW;
      for (let yi = 0; yi < gy; yi++) {
        for (let xi = 0; xi < gx; xi++) {
          if (!shadow[yi * gx + xi]) continue;
          const yTop = cfg.orientation === 'up'
            ? m.B - (yi + 1) * ch : m.T + yi * ch;
          ctx.fillRect(m.L + xi * cw, cfg.orientation === 'up' ? yTop : m.T + yi * ch, cw + 0.5, ch + 0.5);
        }
      }
      // caustics as a soft gold wash
      ctx.fillStyle = 'rgba(197,183,131,0.22)';
      for (let yi = 0; yi < gy; yi++) {
        for (let xi = 0; xi < gx; xi++) {
          if (!caustic[yi * gx + xi]) continue;
          const yTop = cfg.orientation === 'up' ? m.B - (yi + 1) * ch : m.T + yi * ch;
          ctx.fillRect(m.L + xi * cw, yTop, cw + 0.5, ch + 0.5);
        }
      }

      // ── SOFAR axis (ocean): the depth of the sound-speed minimum ──────────────
      if (f.axisY != null) {
        const ay = m.sy(f.axisY);
        ctx.strokeStyle = 'rgba(197,183,131,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(m.L, ay); ctx.lineTo(m.R, ay); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = GOLD; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText('SOFAR axis', m.L + 4, ay - 4);
      }

      // ── rays ──────────────────────────────────────────────────────────────────
      // In the ocean the fan is dimmed so the bold principal ray (drawn below)
      // reads as the mechanism; the faint fan still shows the convergence pattern.
      if (showRaysRef.current) {
        ctx.strokeStyle = f.principal ? 'rgba(91,155,213,0.18)' : RAY_DIM; ctx.lineWidth = 1.2;
        for (const ray of f.rays) {
          ctx.beginPath();
          for (let i = 0; i < ray.length; i++) {
            const X = m.sx(ray[i].x), Y = m.sy(ray[i].y);
            i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }
      }

      // ── marching wavefront: the locus of all rays at travel-time = pulseT ─────
      // Drawn as a connected curve (breaking where a ray has already left the
      // domain) so it reads as a single front sweeping out and bending.
      ctx.strokeStyle = RAY; ctx.lineWidth = 2.2; ctx.shadowColor = RAY; ctx.shadowBlur = 8;
      ctx.beginPath(); let penDown = false;
      for (const ray of f.rays) {
        const end = ray[ray.length - 1].t;
        if (pulseT < ray[0].t || pulseT > end) { penDown = false; continue; }
        let i = 1; while (i < ray.length && ray[i].t < pulseT) i++;
        if (i >= ray.length) { penDown = false; continue; }
        const a = ray[i - 1], b = ray[i];
        const u = (pulseT - a.t) / ((b.t - a.t) || 1);
        const X = m.sx(a.x + (b.x - a.x) * u), Y = m.sy(a.y + (b.y - a.y) * u);
        penDown ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); penDown = true;
      }
      ctx.stroke(); ctx.shadowBlur = 0;

      // ── deep-channel mechanism: one bold ray oscillating about the axis ───────
      const P = f.principal;
      if (P && P.ray) {
        // the duct band the trapped ray is confined to (between its turning depths)
        if (P.upperTurn != null && P.lowerTurn != null) {
          const yU = m.sy(P.upperTurn), yL = m.sy(P.lowerTurn);
          ctx.fillStyle = 'rgba(91,155,213,0.08)';
          ctx.fillRect(m.L, Math.min(yU, yL), m.R - m.L, Math.abs(yL - yU));
        }
        // the ray itself, bold gold
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6; ctx.shadowColor = GOLD; ctx.shadowBlur = 7;
        ctx.beginPath();
        for (let i = 0; i < P.ray.length; i++) {
          const X = m.sx(P.ray[i].x), Y = m.sy(P.ray[i].y);
          i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke(); ctx.shadowBlur = 0;
        // turning points (ray goes horizontal, then reverses)
        ctx.fillStyle = WHITE; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6;
        P.turns.forEach((tp) => {
          const X = m.sx(tp.x), Y = m.sy(tp.y);
          ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        });
        // label the first turning point, and the down/up legs around the axis
        if (P.turns.length) {
          const t0 = P.turns[0];
          ctx.fillStyle = GOLD; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
          const below = t0.y > (f.axisY ?? 0);
          ctx.fillText('turning point', m.sx(t0.x), m.sy(t0.y) + (below ? 16 : -8));
        }
        // mechanism caption
        ctx.fillStyle = 'rgba(240,236,227,0.8)'; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText('the trapped ray refracts back toward the axis, oscillating between its turning depths', m.L + 4, m.B - 8);
      }

      // ── receiver / sub + detection (highlight the nearest reaching ray) ────────
      // Distance is measured in CANVAS pixels but computed inline from the physical
      // ray points (no per-frame array allocation).
      const rx = cfg.xMax * recvRef.current.x, ry = cfg.yMax * recvRef.current.y;
      const Rpx = m.sx(rx), Rpy = m.sy(ry);
      const tolPx = 10;
      let nearest = null, nReach = 0;
      for (const ray of f.rays) {
        let best = Infinity, bt = 0;
        let ax = m.sx(ray[0].x), ay = m.sy(ray[0].y);
        for (let i = 1; i < ray.length; i++) {
          const bx = m.sx(ray[i].x), by = m.sy(ray[i].y);
          const ddx = bx - ax, ddy = by - ay, L2 = ddx * ddx + ddy * ddy || 1;
          let u = ((Rpx - ax) * ddx + (Rpy - ay) * ddy) / L2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const d = Math.hypot(Rpx - (ax + u * ddx), Rpy - (ay + u * ddy));
          if (d < best) { best = d; bt = ray[i - 1].t + u * (ray[i].t - ray[i - 1].t); }
          ax = bx; ay = by;
        }
        if (best < tolPx) { nReach++; if (!nearest || bt < nearest.t) nearest = { ray, t: bt }; }
      }
      if (nearest) {
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.2; ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let i = 0; i < nearest.ray.length; i++) {
          const X = m.sx(nearest.ray[i].x), Y = m.sy(nearest.ray[i].y);
          i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke(); ctx.shadowBlur = 0;
      }

      // source (height is draggable → read from ref)
      const sX = m.sx(srcRef.current.x), sY = m.sy(srcRef.current.y);
      ctx.fillStyle = WHITE; ctx.shadowColor = GOLD; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(sX, sY, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = MUTED; ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.fillText('source', sX + 9, sY + 4);

      // receiver / sub
      const RX = m.sx(rx), RY = m.sy(ry);
      const detColor = nearest ? GREEN : ORANGE;
      ctx.strokeStyle = detColor; ctx.lineWidth = 2.4; ctx.shadowColor = detColor; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(RX, RY, 9, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(RX, RY, 2.5, 0, 2 * Math.PI); ctx.fillStyle = detColor; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = detColor; ctx.font = 'bold 11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(
        nearest
          ? (cfg.detectLabel === 'sub' ? 'DETECTED' : `arrives ${fmtTime(nearest.t)}`)
          : (cfg.detectLabel === 'sub' ? 'NOT DETECTED' : 'in ray shadow'),
        RX, RY - 16);

      // ── region labels at the centroids of the shadow / convergence cells ──────
      ctx.font = 'bold 11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      if (f.ann.shadow.n > 24) {
        const lx = Math.max(m.L + 40, Math.min(m.R - 40, m.sx(f.ann.shadow.x)));
        ctx.fillStyle = 'rgba(190,193,199,0.9)';
        ctx.fillText('ray shadow', lx, m.sy(f.ann.shadow.y));
      }
      if (f.ann.caustic.n > 20) {
        const lx = Math.max(m.L + 55, Math.min(m.R - 55, m.sx(f.ann.caustic.x)));
        ctx.fillStyle = GOLD;
        ctx.fillText('convergence zones', lx, m.sy(f.ann.caustic.y));
      }
      ctx.textAlign = 'left';

      // ── profile strip (left edge): c(y) or w(y) vs height/depth; also the y-axis
      if (showStripRef.current) {
        drawStrip(ctx, m, cfg, prof);
      }

      // range axis ticks (km); unit tucked at the far right so nothing overlaps
      ctx.fillStyle = MUTED; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      for (let k = 0; k <= 4; k++) {
        const xm = (cfg.xMax * k) / 4;
        ctx.fillText(`${(xm / cfg.xScale).toFixed(cfg.xMax >= 1e5 ? 0 : 1)}`, m.sx(xm), m.B + 16);
      }
      ctx.textAlign = 'right'; ctx.fillText(`range (${cfg.xUnit})`, m.R, m.B + 16);
      ctx.textAlign = 'left';

      // publish readouts ~10 Hz
      if (ts - pub > 95) {
        pub = ts;
        setLive({ detected: !!nearest, time: nearest ? nearest.t : 0, nReach });
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [cfg]);

  // ── dragging: whichever of source / receiver is nearer the pointer ───────────
  const dragRef = useRef(null);
  const toFrac = useCallback((e) => {
    const wrap = wrapRef.current; if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    const L = showStrip ? 66 : 20, R = r.width - 14, T = 14, B = r.height - 26;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const fx = Math.max(0, Math.min(1, (px - L) / (R - L)));
    const fyBox = Math.max(0, Math.min(1, (py - T) / (B - T)));
    const fy = cfg.orientation === 'up' ? 1 - fyBox : fyBox;   // height vs depth
    return { fx, fy, px, py, L, R, T, B };
  }, [cfg.orientation, showStrip]);

  const onDown = useCallback((e) => {
    const p = toFrac(e); if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // pixel distance to source vs receiver to decide what we grabbed
    const srcPxX = p.L + SRC_X_FRAC * (p.R - p.L);
    const srcBoxY = cfg.orientation === 'up' ? (1 - srcYFrac) : srcYFrac;
    const srcPxY = p.T + srcBoxY * (p.B - p.T);
    const recvBoxY = cfg.orientation === 'up' ? (1 - recv.y) : recv.y;
    const recvPxX = p.L + recv.x * (p.R - p.L), recvPxY = p.T + recvBoxY * (p.B - p.T);
    const dS = Math.hypot(p.px - srcPxX, p.py - srcPxY);
    const dR = Math.hypot(p.px - recvPxX, p.py - recvPxY);
    dragRef.current = dS < dR && dS < 40 ? 'src' : 'recv';
    applyDrag(p);
  }, [toFrac, recv, srcYFrac, cfg]);

  const applyDrag = useCallback((p) => {
    if (dragRef.current === 'src') setSrcYFrac(Math.max(0, Math.min(0.9, p.fy)));
    else setRecv({ x: Math.max(0.02, Math.min(0.99, p.fx)), y: Math.max(0.01, Math.min(0.99, p.fy)) });
  }, []);
  const onMove = useCallback((e) => { if (!dragRef.current) return; const p = toFrac(e); if (p) applyDrag(p); }, [toFrac, applyDrag]);
  const onUp = useCallback((e) => { dragRef.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); }, []);

  const info = INFO_RAY[mode];
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {cfg.sliders.map((s) => (
          <Slider
            key={s.key}
            label={s.label}
            value={params[s.key]}
            min={s.min} max={s.max} step={s.step} unit={s.unit}
            onChange={(v) => setParams((q) => ({ ...q, [s.key]: v }))}
          />
        ))}

        {cfg.toggles.map((t) => (
          <div className="mb-3" key={t.key}>
            <div className="text-usna-text text-sm font-medium mb-1.5">{t.label}</div>
            <div className="flex gap-1.5">
              {[{ v: true, label: t.on }, { v: false, label: t.off }].map(({ v, label }) => (
                <button
                  key={String(v)}
                  onClick={() => setParams((q) => ({ ...q, [t.key]: v }))}
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                    !!params[t.key] === v
                      ? 'bg-usna-gold text-usna-navy border-usna-gold'
                      : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
        ))}

        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Presets</div>
          <div className="flex flex-col gap-1.5">
            {cfg.presets.map((pr) => {
              const active = Object.keys(pr.p).every((k) => params[k] === pr.p[k]);
              return (
                <button
                  key={pr.label}
                  onClick={() => setParams((q) => ({ ...q, ...pr.p }))}
                  className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                    active
                      ? 'bg-usna-gold text-usna-navy border-usna-gold'
                      : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                  }`}
                >{pr.label}</button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-1.5 mb-4">
          <TogglePill on={playing} onClick={() => setPlaying((v) => !v)} label={playing ? '❚❚ Pulse' : '▶ Pulse'} />
          <TogglePill on={showRays} onClick={() => setShowRays((v) => !v)} label="Rays" />
          <TogglePill on={showStrip} onClick={() => setShowStrip((v) => !v)} label="Profile" />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label={cfg.detectLabel === 'sub' ? 'Sub' : 'Receiver'}
            value={live.detected ? 'detected' : 'in shadow'} unit="" />
          <Readout label="Rays reaching" value={live.nReach} unit="" />
          <Readout label="Travel time" value={live.detected ? fmtTime(live.time) : '—'} unit="" />
          <div className="text-center mt-2">
            <span className={`text-xs font-mono ${live.detected ? 'text-[#7FB77E]' : 'text-[#E0895B]'}`}>
              {live.detected ? 'rays reach this point' : 'ray shadow; diffraction admits only a weak field'}
            </span>
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden select-none"
          style={{ height: 470, background: BG, cursor: 'crosshair', touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold/80 pointer-events-none text-right space-y-0.5">
            <div>drag source (height) & {cfg.detectLabel}</div>
            <div className="text-usna-muted">gray = ray shadow · gold = convergence</div>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <BendDiagram mode={mode} cfg={cfg} prof={field.prof} axisY={field.axisY} />
          <ControlMeanings mode={mode} params={params} />
        </div>
        {mode === 'ocean-channel' && <ProfileOrigin />}
        <InfoPanel {...info} />
      </div>
    </div>
  );
}

/**
 * Left-edge profile strip: plots c(y) or w(y) against the vertical coordinate,
 * and doubles as the vertical axis (height for the atmosphere, depth for the
 * ocean) with a few numeric ticks so the viewer can read what is being measured.
 */
function drawStrip(ctx, m, cfg, prof) {
  const x0 = 10, x1 = m.L - 8;
  const samples = 48;
  const valAt = (y) => (cfg.stripVar === 'w' ? prof.wAt(y) : prof.cAt(y));
  const ys = linspace(0, cfg.yMax, samples);
  const vs = ys.map(valAt);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const vx = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  // axis box
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  ctx.strokeRect(x0, m.T, x1 - x0, m.B - m.T);
  // zero line for wind
  if (cfg.stripVar === 'w' && lo < 0 && hi > 0) {
    ctx.strokeStyle = 'rgba(139,140,142,0.5)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(vx(0), m.T); ctx.lineTo(vx(0), m.B); ctx.stroke(); ctx.setLineDash([]);
  }
  // vertical ticks (height / depth in metres)
  ctx.fillStyle = MUTED; ctx.font = '8px JetBrains Mono, monospace'; ctx.textAlign = 'left';
  for (let k = 0; k <= 3; k++) {
    const ym = (cfg.yMax * k) / 3;
    const Y = m.sy(ym);
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, Y); ctx.lineTo(x0 + 3, Y); ctx.stroke();
    ctx.fillText(`${Math.round(ym)}`, x0 + 1, Math.max(m.T + 8, Math.min(m.B - 2, Y - 2)));
  }
  // the curve
  ctx.strokeStyle = cfg.stripVar === 'w' ? ORANGE : GOLD; ctx.lineWidth = 2;
  ctx.beginPath();
  ys.forEach((y, i) => {
    const X = vx(vs[i]), Y = m.sy(y);
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  });
  ctx.stroke();
  // titles: the plotted variable (top) and the vertical quantity (bottom)
  ctx.fillStyle = MUTED; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center';
  ctx.fillText(cfg.stripVar === 'w' ? 'w(y) m/s' : 'c(y) m/s', (x0 + x1) / 2, m.T + 8);
  ctx.fillText(cfg.orientation === 'up' ? 'height m' : 'depth m', (x0 + x1) / 2, m.B - 3);
}

function fmtTime(t) {
  if (t >= 1) return `${t.toFixed(t >= 10 ? 0 : 1)} s`;
  return `${(t * 1000).toFixed(0)} ms`;
}
function TogglePill({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
        on ? 'bg-usna-gold text-usna-navy border-usna-gold'
          : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
      }`}
    >{label}</button>
  );
}

// ── explanatory panels ───────────────────────────────────────────────────────

const BEND_CAPTION = {
  'wind-shear':
    'The effective speed c + w changes with height. By Snell\'s law the ray bends toward the slower side and goes horizontal where the effective speed has risen to c₀/cosθ₀, then reverses. This is refraction, a gradual bending of the ray, not diffraction.',
  thermal:
    'Sound speed changes with height through temperature (c ∝ √T), so the ray bends toward the cooler, slower air. By day it curves upward and escapes, opening the ground shadow; by night it curves back down and returns. The bending is refraction, not diffraction.',
  'ocean-channel':
    'Sound travels slowest on the axis and faster above and below it. A ray leaving the axis enters faster water and, by Snell\'s law, bends away from the vertical until it is horizontal at the depth where c has risen to c₀/cosθ₀. There it reverses and is refracted back toward the axis, so it crosses from side to side. This gradual bending is refraction, not diffraction.',
};

const CONTROL_MEANINGS = {
  'wind-shear': [
    { k: 'Shear strength', v: 'wind speed at the top of the layer; the wind grows from zero at the ground' },
    { k: 'Wind direction', v: 'downwind raises the effective speed with height (rays curve down); upwind lowers it (rays curve up)' },
    { k: 'Profile', v: 'linear or logarithmic growth of wind with height' },
  ],
  thermal: [
    { k: 'Δc over layer', v: 'change in sound speed from the ground to the top of the layer; its sign sets the day or night case' },
  ],
  'ocean-channel': [
    { k: 'SOFAR axis depth', v: 'depth of the sound-speed minimum; trapped rays oscillate about it' },
    { k: 'Channel strength Δc', v: 'how much faster sound travels at the channel edges than on the axis (c_edge − c_axis)' },
  ],
};

/**
 * A small live schematic of refraction: the sound-speed field as shaded bands
 * (dark = slow, light = fast), one bold ray bending through it with its turning
 * point marked, and a travelling dot so the down-then-up motion is explicit.
 */
function BendDiagram({ mode, cfg, prof, axisY }) {
  const wrapRef = useRef(null), canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, phase = 0, last = null;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    // trace one illustrative ray through the live profile
    const dom = { xMax: cfg.xMax, yMin: 0, yMax: cfg.yMax, ds: cfg.xMax / 560, maxSteps: 2600, reflectTop: cfg.reflectTop };
    const srcY = axisY != null ? axisY : 0.02 * cfg.yMax;
    const ray = traceRay(cfg.xMax * 0.01, srcY, 7 * DEG, prof, dom);
    const turns = [];
    for (let i = 1; i < ray.length; i++)
      if (Math.sign(ray[i].th) !== Math.sign(ray[i - 1].th) && Math.abs(ray[i].th) < 0.5) turns.push(i);
    const zoomX = Math.min(cfg.xMax, turns[2] != null ? ray[turns[2]].x * 1.18 : cfg.xMax * 0.55);
    const vis = ray.filter((p) => p.x <= zoomX);
    const cs = linspace(0, cfg.yMax, 40).map((y) => prof.cAt(y));
    const cLo = Math.min(...cs), cHi = Math.max(...cs);

    const draw = (ts) => {
      const dt = last == null ? 0 : (ts - last) / 1000; last = ts;
      phase += dt * 0.22; if (phase > 1) phase -= 1;
      const L = 8, R = W - 8, T = 20, B = H - 10;
      const sx = (x) => L + (x / zoomX) * (R - L);
      const sy = cfg.orientation === 'up' ? (y) => B - (y / cfg.yMax) * (B - T) : (y) => T + (y / cfg.yMax) * (B - T);

      ctx.clearRect(0, 0, W, H); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      // speed-shaded bands (dark = slow, light = fast)
      const bands = 44, bh = (B - T) / bands;
      for (let b = 0; b < bands; b++) {
        const yPhys = cfg.orientation === 'up' ? cfg.yMax * (1 - (b + 0.5) / bands) : cfg.yMax * ((b + 0.5) / bands);
        const s = (prof.cAt(yPhys) - cLo) / ((cHi - cLo) || 1);
        ctx.fillStyle = `rgb(${Math.round(13 + s * 46)},${Math.round(19 + s * 60)},${Math.round(33 + s * 78)})`;
        ctx.fillRect(L, T + b * bh, R - L, bh + 1);
      }
      // axis line (ocean)
      if (axisY != null) {
        const ay = sy(axisY);
        ctx.strokeStyle = 'rgba(197,183,131,0.5)'; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(L, ay); ctx.lineTo(R, ay); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = GOLD; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText('axis (slowest)', L + 3, ay - 3);
      }
      // the ray
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.shadowColor = GOLD; ctx.shadowBlur = 6;
      ctx.beginPath();
      vis.forEach((p, i) => { const X = sx(p.x), Y = sy(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke(); ctx.shadowBlur = 0;
      // turning rings + label
      ctx.fillStyle = WHITE; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4;
      turns.forEach((ti) => {
        if (ray[ti].x > zoomX) return;
        const X = sx(ray[ti].x), Y = sy(ray[ti].y);
        ctx.beginPath(); ctx.arc(X, Y, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      });
      if (turns[0] != null && ray[turns[0]].x <= zoomX) {
        const X = sx(ray[turns[0]].x), Y = sy(ray[turns[0]].y);
        ctx.fillStyle = GOLD; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center';
        ctx.fillText('turning point', X, ray[turns[0]].y > srcY ? Y + 14 : Y - 7);
      }
      // travelling dot
      const dp = vis[Math.floor(phase * (vis.length - 1))] || vis[0];
      if (dp) {
        ctx.fillStyle = WHITE; ctx.shadowColor = WHITE; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(sx(dp.x), sy(dp.y), 3.4, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur = 0;
      }
      // header + legend
      ctx.fillStyle = 'rgba(240,236,227,0.9)'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('ray bends toward slower sound', L + 2, 13);
      ctx.fillStyle = MUTED; ctx.textAlign = 'right';
      ctx.fillText('dark = slower   light = faster', R, 13);
      ctx.textAlign = 'left';
      raf = requestAnimationFrame(draw);
    };
    resize(); raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [mode, cfg, prof, axisY]);

  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-3">
      <div className="text-usna-gold text-sm font-semibold mb-2">How the ray bends</div>
      <div ref={wrapRef} className="relative rounded overflow-hidden" style={{ height: 172, background: BG }}>
        <canvas ref={canvasRef} className="block" />
      </div>
      <p className="text-usna-text text-xs mt-2 leading-relaxed">{BEND_CAPTION[mode]}</p>
    </div>
  );
}

/** A small capture-cone wedge of half-angle `deg` from the horizontal. */
function ConeSketch({ deg }) {
  const r = 40, cx = 8, cy = 30, rad = deg * DEG;
  const x2 = cx + r * Math.cos(rad), yUp = cy - r * Math.sin(rad), yDn = cy + r * Math.sin(rad);
  return (
    <svg width="150" height="60" className="my-1" aria-hidden="true">
      <line x1={cx} y1={cy} x2={cx + r + 6} y2={cy} stroke="#5B9BD5" strokeDasharray="3 3" />
      <path d={`M ${cx} ${cy} L ${x2} ${yUp} A ${r} ${r} 0 0 1 ${x2} ${yDn} Z`} fill="rgba(197,183,131,0.25)" stroke="#C5B783" />
      <text x={cx + r + 10} y={cy + 3} fill="#8B8C8E" fontSize="10" fontFamily="monospace">±{deg.toFixed(1)}°</text>
    </svg>
  );
}

/** Plain-language meaning of each control, plus the key derived quantity. */
function ControlMeanings({ mode, params }) {
  const items = CONTROL_MEANINGS[mode] || [];
  let derived = null, coneDeg = null;
  if (mode === 'ocean-channel') {
    const cmin = C_SEA - 20, dc = params.strength;
    coneDeg = Math.acos(cmin / (cmin + dc)) * 180 / Math.PI;
    derived = {
      label: 'Trapping cone', value: `±${coneDeg.toFixed(1)}°`,
      note: 'Rays launched within this angle of horizontal stay in the channel. A larger channel strength widens the cone, so more of the sound is trapped.',
    };
  } else if (mode === 'wind-shear') {
    derived = {
      label: 'Effective speed gain', value: `${params.shear} m/s`,
      note: 'The wind adds up to this much to the sound speed at the top of the layer, setting how sharply the rays bend.',
    };
  } else {
    derived = {
      label: 'Speed change over layer', value: `${params.grad > 0 ? '+' : ''}${params.grad} m/s`,
      note: params.grad < 0 ? 'Speed falls with height (day): rays curve up and a ground shadow forms.'
        : params.grad > 0 ? 'Speed rises with height (night): rays curve down and return to the ground.'
          : 'No gradient: the rays travel straight.',
    };
  }
  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-3">
      <div className="text-usna-gold text-sm font-semibold mb-2">What the controls set</div>
      {mode === 'ocean-channel' && (
        <p className="text-usna-muted text-xs mb-2 leading-relaxed">
          Here the “channel” is an acoustic <span className="text-usna-text">waveguide</span>: a layer of
          water that traps and guides sound by refraction, the way an optical fibre guides light. It is
          not a geographic channel or a frequency band.
        </p>
      )}
      <ul className="space-y-1.5 text-xs text-usna-text leading-relaxed">
        {items.map((it) => (
          <li key={it.k}><span className="text-usna-gold font-mono">{it.k}</span>: {it.v}</li>
        ))}
      </ul>
      <div className="mt-3 pt-2 border-t border-usna-grid">
        <div className="flex justify-between items-baseline">
          <span className="text-usna-muted text-xs">{derived.label}</span>
          <span className="font-mono text-usna-gold text-lg tabular-nums">{derived.value}</span>
        </div>
        {coneDeg != null && <ConeSketch deg={coneDeg} />}
        <p className="text-usna-muted text-xs mt-1 leading-relaxed">{derived.note}</p>
      </div>
    </div>
  );
}

/**
 * Why the ocean sound speed has a minimum at depth. Sound speed is set by
 * temperature, pressure, and salinity, not density alone. Warm surface water is
 * fast; temperature falls with depth and slows it; below the thermocline the
 * temperature is nearly constant but pressure keeps rising and speeds it up
 * again. The two trends cross at a minimum, the SOFAR axis. The decomposition
 * drawn here is schematic (an idealisation of a real profile).
 */
function ProfileOrigin() {
  const wrapRef = useRef(null), canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const C0 = 1480, AP = 55, AT = 70, TAU = 0.16;      // pressure slope, temp amplitude, thermocline scale
    const press = (d) => C0 + AP * d;
    const temp = (d) => C0 + AT * Math.exp(-d / TAU);
    const total = (d) => C0 + AP * d + AT * Math.exp(-d / TAU);
    let ro;
    const draw = () => {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const ctx = setupCanvas(canvas, W, H);
      const L = 28, R = W - 128, T = 10, B = H - 20;
      const ds = linspace(0, 1, 60);
      const totals = ds.map(total), ps = ds.map(press), ts = ds.map(temp);
      const all = totals.concat(ps, ts);
      const lo = Math.min(...all), hi = Math.max(...all);
      const sx = (v) => L + ((v - lo) / (hi - lo || 1)) * (R - L);
      const sy = (d) => T + d * (B - T);
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      // axis labels
      ctx.fillStyle = MUTED; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('sound speed →', L, B + 14);
      ctx.save(); ctx.translate(10, (T + B) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
      ctx.fillText('depth ↓', 0, 0); ctx.restore();
      const plot = (arr, color, width, dash) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash);
        ctx.beginPath(); ds.forEach((d, i) => { const X = sx(arr[i]), Y = sy(d); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke(); ctx.setLineDash([]);
      };
      plot(ps, '#5B9BD5', 1.5, [4, 3]);      // pressure contribution (rises with depth)
      plot(ts, ORANGE, 1.5, [4, 3]);         // temperature contribution (warm at top)
      plot(totals, GOLD, 2.6, null);         // the sum, with a minimum
      // minimum marker + axis line
      let mi = 0; for (let i = 1; i < totals.length; i++) if (totals[i] < totals[mi]) mi = i;
      const mx = sx(totals[mi]), my = sy(ds[mi]);
      ctx.strokeStyle = 'rgba(197,183,131,0.5)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(L, my); ctx.lineTo(R, my); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = WHITE; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(mx, my, 3.6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = GOLD; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left';
      ctx.fillText('axis: c minimum', L + 3, my - 4);
      // legend
      [['total c(z)', GOLD], ['pressure ↑', '#5B9BD5'], ['temperature', ORANGE]].forEach(([lbl, col], i) => {
        const y = T + 10 + i * 16;
        ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(R + 12, y); ctx.lineTo(R + 28, y); ctx.stroke();
        ctx.fillStyle = col; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText(lbl, R + 32, y + 3);
      });
    };
    draw(); ro = new ResizeObserver(draw); ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-3">
      <div className="text-usna-gold text-sm font-semibold mb-2">Why the speed has a minimum</div>
      <div ref={wrapRef} className="relative rounded overflow-hidden" style={{ height: 150, background: BG }}>
        <canvas ref={canvasRef} className="block" />
      </div>
      <p className="text-usna-text text-xs mt-2 leading-relaxed">
        Sound speed in water is set by temperature, pressure, and salinity, not by density alone. Warm
        surface water carries sound quickly. Temperature falls with depth through the thermocline and the
        speed drops with it. Below the thermocline the temperature is nearly constant, but pressure keeps
        rising and speeds the sound up again. The two trends cross at a minimum near one kilometre, the
        SOFAR axis. Salinity plays a smaller part.
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  UniformMode — a uniform wind as an effective directional sound speed + Doppler
// ═════════════════════════════════════════════════════════════════════════════

const U_C = 150;          // wave speed through the medium, px/s ("speed of sound")
const U_TEMIT = 0.5;      // s between emitted wavefronts
const U_F0 = 1 / U_TEMIT; // emitted (rest) frequency, Hz

function UniformMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [wind, setWind] = useState(60);        // wind speed, px/s
  const [windDeg, setWindDeg] = useState(0);   // wind direction (0 = +x, blowing right)
  const [us, setUs] = useState(0);             // source speed (+x), px/s
  const [ur, setUr] = useState(0);             // receiver speed (+x), px/s
  const [fs, setFs] = useState(U_F0);          // emitted frequency slider (scaled)
  const [recv, setRecv] = useState({ x: 0.78, y: 0.5 });
  const [showFronts, setShowFronts] = useState(true);
  const [live, setLive] = useState({ cn: U_C, fr: U_F0, lamTo: 0, lamAway: 0 });

  const refs = {
    wind: useRef(wind), windDeg: useRef(windDeg), us: useRef(us), ur: useRef(ur),
    fs: useRef(fs), recv: useRef(recv), showFronts: useRef(showFronts),
  };
  refs.wind.current = wind; refs.windDeg.current = windDeg; refs.us.current = us;
  refs.ur.current = ur; refs.fs.current = fs; refs.recv.current = recv; refs.showFronts.current = showFronts;

  const reset = useCallback(() => {
    setWind(60); setWindDeg(0); setUs(0); setUr(0); setFs(U_F0);
    setRecv({ x: 0.78, y: 0.5 }); setShowFronts(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last = null, sim = 0, lastEmit = 0, pub = 0;
    let fronts = [];                 // { x0, y0, te } — emission point + time
    let srcX0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };
    // Start the source left-of-centre (not hard against the edge) so the upwind
    // rings have room to be seen; a moving source still has most of the frame to cross.
    const resetSim = () => { sim = 0; lastEmit = 0; fronts = []; srcX0 = W * 0.32; };

    const draw = (ts) => {
      if (ctx === undefined) return;
      let dt = last == null ? 1 / 60 : (ts - last) / 1000; last = ts;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;
      if (!(srcX0 >= 0)) resetSim();   // also re-seeds if a resize left it unset / NaN

      const w = refs.wind.current, wd = refs.windDeg.current * DEG;
      const Wv = { x: w * Math.cos(wd), y: w * Math.sin(wd) };
      const uS = refs.us.current, uR = refs.ur.current;
      const f0 = refs.fs.current;
      const srcY = H / 2;
      const src = { x: srcX0 + uS * sim, y: srcY };

      // emit wavefronts at the live source position
      const Temit = 1 / f0;
      while (sim - lastEmit >= Temit) {
        lastEmit += Temit;
        fronts.push({ x0: srcX0 + uS * lastEmit, y0: srcY, te: lastEmit });
      }
      const diag = Math.hypot(W, H) * 1.3;
      fronts = fronts.filter((fr) => U_C * (sim - fr.te) < diag);

      // recycle when a moving source leaves the frame (either edge)
      if (src.x > W - 40 || src.x < 40) { resetSim(); raf = requestAnimationFrame(draw); return; }

      // receiver + its velocity
      const R = { x: refs.recv.current.x * W, y: refs.recv.current.y * H };
      const Ur = { x: uR, y: 0 }, Us = { x: uS, y: 0 };
      const dx = R.x - src.x, dy = R.y - src.y, dist = Math.hypot(dx, dy) || 1;
      const nHat = { x: dx / dist, y: dy / dist };             // source → receiver
      const wDotN = Wv.x * nHat.x + Wv.y * nHat.y;
      const cN = U_C + wDotN;                                  // effective speed along n̂
      const usDotN = Us.x * nHat.x + Us.y * nHat.y;
      const urDotN = Ur.x * nHat.x + Ur.y * nHat.y;
      // Doppler in a moving medium: f_r = f0 (c_n − u_r·n̂)/(c_n − u_s·n̂)
      const denom = cN - usDotN;
      const fr = denom > 1e-3 ? f0 * (cN - urDotN) / denom : Infinity;
      // directional wavelengths toward / away along the wind line
      const lamTo = cN / f0;                                   // along n̂
      const cAway = U_C - wDotN;
      const lamAway = cAway / f0;

      // ── render ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

      // advected wavefronts: each circle's CENTER drifts downwind with the medium
      if (refs.showFronts.current) {
        ctx.shadowColor = GOLD;
        for (const fr0 of fronts) {
          const age = sim - fr0.te; if (age <= 0) continue;
          const cx = fr0.x0 + Wv.x * age, cy = fr0.y0 + Wv.y * age;
          const r = U_C * age; if (r < 0.5) continue;
          const a = Math.max(0.06, 0.7 * (1 - r / diag));
          ctx.strokeStyle = `rgba(197,183,131,${a.toFixed(3)})`;
          ctx.shadowBlur = 8 * (1 - r / diag); ctx.lineWidth = 1.7;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // wind arrow (field-wide drift indicator), top-left
      drawArrow(ctx, 70, 40, 70 + Wv.x * 0.6, 40 + Wv.y * 0.6, GREEN, 'wind');

      // line of sight source→receiver
      ctx.strokeStyle = 'rgba(240,236,227,0.25)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(R.x, R.y); ctx.stroke(); ctx.setLineDash([]);

      // source + its velocity arrow
      if (Math.abs(uS) > 1) drawArrow(ctx, src.x, src.y, src.x + uS * 0.5, src.y, BLUE_U, 'u_s');
      ctx.fillStyle = WHITE; ctx.shadowColor = GOLD; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(src.x, src.y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = MUTED; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('source', src.x, src.y + 22);

      // receiver + its velocity arrow
      if (Math.abs(uR) > 1) drawArrow(ctx, R.x, R.y, R.x + uR * 0.5, R.y, BLUE_U, 'u_r');
      const shiftColor = !Number.isFinite(fr) ? WHITE : fr > f0 * 1.001 ? GREEN : fr < f0 * 0.999 ? ORANGE : WHITE;
      ctx.strokeStyle = BLUE_U; ctx.lineWidth = 2.5; ctx.shadowColor = BLUE_U; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(R.x, R.y, 9, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(R.x, R.y, 2.5, 0, 2 * Math.PI); ctx.fillStyle = BLUE_U; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = BLUE_U; ctx.fillText('receiver', R.x, R.y - 16);
      ctx.fillStyle = shiftColor; ctx.font = 'bold 12px JetBrains Mono, monospace';
      const bx = Math.max(60, Math.min(W - 60, R.x));
      ctx.fillText(Number.isFinite(fr) ? `f_r = ${fr.toFixed(2)} Hz` : "f_r → ∞", bx, R.y + 28);

      // the cancellation banner
      if (Math.abs(uS) < 1 && Math.abs(uR) < 1) {
        ctx.fillStyle = GREEN; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText('Source and receiver at rest: c_n cancels, so f_r = f_s for any wind.', 12, H - 12);
      }

      if (ts - pub > 95) {
        pub = ts;
        setLive({ cn: cN, fr, lamTo, lamAway });
      }
      raf = requestAnimationFrame(draw);
    };

    resize(); resetSim();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // receiver drag
  const dragRef = useRef(false);
  const toFrac = useCallback((e) => {
    const wrap = wrapRef.current; if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return {
      x: Math.max(0.03, Math.min(0.97, (e.clientX - r.left) / r.width)),
      y: Math.max(0.05, Math.min(0.95, (e.clientY - r.top) / r.height)),
    };
  }, []);
  const onDown = useCallback((e) => { dragRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); const p = toFrac(e); if (p) setRecv(p); }, [toFrac]);
  const onMove = useCallback((e) => { if (!dragRef.current) return; const p = toFrac(e); if (p) setRecv(p); }, [toFrac]);
  const onUp = useCallback((e) => { dragRef.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); }, []);

  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
  const coMoving = Math.abs(us - ur) < 1e-6;
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Wind speed" value={wind} min={0} max={120} step={1} unit="px/s" onChange={setWind} />
        <Slider label="Wind direction" value={windDeg} min={-180} max={180} step={5} unit="°" onChange={setWindDeg} />
        <Slider label="Source speed u_s" value={us} min={-80} max={80} step={1} unit="px/s" onChange={setUs} />
        <Slider label="Receiver speed u_r" value={ur} min={-80} max={80} step={1} unit="px/s" onChange={setUr} />
        <Slider label="Emitted f_s" value={Number(fs.toFixed(1))} min={1} max={4} step={0.1} unit="Hz" onChange={setFs} />

        <div className="flex gap-1.5 mb-4">
          <TogglePill on={showFronts} onClick={() => setShowFronts((v) => !v)} label="Wavefronts" />
          <TogglePill on={us === 0 && ur === 0} onClick={() => { setUs(0); setUr(0); }} label="Both at rest" />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="c_n = c + w·n̂" value={fmt(live.cn)} unit="px/s" />
          <Readout label="Emitted f_s" value={fmt(fs)} unit="Hz" />
          <Readout label="Received f_r" value={fmt(live.fr)} unit="Hz" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="λ toward (n̂)" value={fmt(live.lamTo)} unit="px" />
            <Readout label="λ away" value={fmt(live.lamAway)} unit="px" />
          </div>
          <div className="text-center mt-2">
            <span className={`text-xs font-mono ${coMoving ? 'text-[#7FB77E]' : 'text-usna-gold'}`}>
              {coMoving
                ? 'Endpoints co-moving: f_r = f_s (wind cancels)'
                : `Relative motion: f_r ${live.fr > fs ? '>' : '<'} f_s`}
            </span>
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden select-none"
          style={{ height: 470, background: BG, cursor: 'crosshair', touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold/80 pointer-events-none text-right">
            drag the receiver · wind drifts the wavefronts
          </div>
        </div>
        <InfoPanel {...INFO_UNIFORM} />
      </div>
    </div>
  );
}

const BLUE_U = '#5B9BD5';

/** Minimal arrow used by UniformMode (self-contained, labelled). */
function drawArrow(ctx, x0, y0, x1, y1, color, label) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len, head = Math.min(9, len * 0.4);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * ux - head * 0.6 * uy, y1 - head * uy + head * 0.6 * ux);
  ctx.lineTo(x1 - head * ux + head * 0.6 * uy, y1 - head * uy - head * 0.6 * ux);
  ctx.closePath(); ctx.fill();
  if (label) {
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, (x0 + x1) / 2, Math.min(y0, y1) - 6);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Wrapper (hook-free; branches by mode so hook sets never collide)
// ═════════════════════════════════════════════════════════════════════════════

export default function MovingMedium({ mode = 'uniform' }) {
  if (mode === 'wind-shear' || mode === 'thermal' || mode === 'ocean-channel') {
    return <RayMode mode={mode} />;
  }
  return <UniformMode />;
}

// ── InfoPanel copy ────────────────────────────────────────────────────────────
const INFO_UNIFORM = {
  title: 'A uniform wind as an effective sound speed',
  description:
    'A uniform wind moves the whole medium at velocity w. Along a direction n̂ the signal then travels at the effective speed c_n = c + w·n̂, faster downwind and slower upwind. Each wavefront expands at speed c about a centre that drifts downwind with the medium, so successive fronts are spaced by (c − w)T upwind and (c + w)T downwind. When the source and receiver are both at rest the received frequency equals the emitted frequency for every wind, because c_n appears in both the numerator and the denominator of the Doppler ratio and cancels. A shift appears only when the endpoints move relative to each other, carried now on the wind-tilted speed c_n. Refraction in a layered medium is treated in the other three modes.',
  equation: String.raw`c_n = c + \vec w\cdot\hat n,\qquad f_r = f_s\,\frac{c_n - \vec u_r\cdot\hat n}{c_n - \vec u_s\cdot\hat n}`,
};

const INFO_RAY = {
  'wind-shear': {
    title: 'Refraction by wind shear',
    description:
      'Wind speed usually increases with height. On the downwind side this raises the effective speed c_eff = c + w cosθ with height, so the rays curve downward, return to the ground, and carry sound to large range. On the upwind side the effective speed falls with height, the rays curve upward and leave the ground, and a shadow region opens near the source. Reversing the wind interchanges the two sides. The shaded region is a ray shadow: diffraction admits a weak field into it, so it is not perfectly silent. Drag the source height and the receiver; the gold curve is the first ray to arrive.',
    equation: String.raw`\frac{\cos\theta}{c_{\text{eff}}(y)} = \text{const},\qquad c_{\text{eff}} = c(y) + w(y)\cos\theta`,
  },
  thermal: {
    title: 'Refraction by temperature layering',
    description:
      'The sound speed rises with temperature as c ∝ √T. By day the ground is warm and the air cools with height, so c falls with height and the rays curve upward. A shadow zone opens along the ground a short distance from the source. This is the afternoon effect familiar in outdoor acoustics and in sonar. By night the ground cools and a temperature inversion forms: c rises with height, the rays curve back down to the ground, and sound carries to large range. A ray turns horizontal at the height where the speed has risen to c₀/cosθ₀. Switch between the day and night presets to open and close the ground shadow.',
    equation: String.raw`c(y)\propto\sqrt{T(y)},\qquad \frac{\cos\theta}{c(y)} = \text{const}`,
  },
  'ocean-channel': {
    title: 'The deep sound channel (SOFAR)',
    description:
      'In the deep ocean the sound speed passes through a minimum near one kilometre depth, the SOFAR axis (SOund Fixing And Ranging). Warm water speeds sound up near the surface and high pressure speeds it up at depth, so the speed is lowest in between. A ray launched near the axis is refracted back toward it from either side and stays trapped in the channel, which acts as an acoustic waveguide. Trapped rays travel for hundreds of kilometres with little loss and refocus at regular convergence zones, separated by quieter shadow regions. A receiver in a convergence zone detects the source; one in a shadow does not. Narrowband processing of these arrivals, plotted as frequency against time, is the LOFAR (Low-Frequency Analysis and Recording) display used in passive sonar. Raise the channel strength to confine the rays more tightly, or move the axis to shift the pattern.',
    equation: String.raw`\cos\theta(z) = \frac{c(z)}{c_{\text{launch}}},\qquad \text{turning where } c(z)=\frac{c_0}{\cos\theta_0}`,
  },
};
