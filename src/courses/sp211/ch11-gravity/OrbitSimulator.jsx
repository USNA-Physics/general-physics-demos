import { useState, useRef, useEffect } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';

/**
 * D31 · Orbit Simulator — L31 (kepler), L32 (escape).
 *
 * Newton's cannonball, made honest by the integrator. A satellite is launched
 * from a chosen altitude to the right of a central body; a launch-speed slider
 * (or a click-and-drag velocity vector) sweeps the whole conic family:
 *
 *   v below circular  → tight ellipse whose *far-side* perigee can dip below the
 *                       surface → suborbital arc that "keeps missing the ground"
 *   v = v_c           → circular orbit
 *   v_c < v < v_esc   → ellipse (launch point is perigee)
 *   v = v_esc         → parabola (the E = 0 knife-edge)
 *   v > v_esc         → hyperbola — gone for good
 *
 * ── THE HONEST-CRASH FIX ────────────────────────────────────────────────────
 * The launch is tangential from radius r0, so r0 is ALWAYS an apsis. When
 * v < v_c the satellite is at *apogee* (too slow to stay up) and the ellipse's
 * *perigee sits on the far side* at r = 2a − r0. So the classification must ask
 * whether that far-side perigee dips below R_planet — not whether the launch
 * point does. We compute the true perigee analytically (conservation of energy
 * + angular momentum) and only call a shot "suborbital / crashes" when
 * r_peri < R_planet with the orbit bound. That is what makes "keeps missing the
 * ground → closes into an orbit" geometrically true as you fire faster.
 *
 * The integrator is velocity-Verlet (leapfrog): symplectic, so bound orbits
 * close and the total-energy readout holds its sign, making v_esc a crisp line
 * and the analytic crash prediction agree with the actual impact.
 *
 *   kepler : the ellipse animates with equal-area sector shading (Kepler II) and
 *            a live dA/dt readout that stays constant; each completed orbit drops
 *            a point on a T² vs a³ mini-plot (Kepler III, empirically). A
 *            "Newton's cannonball" stepper fires progressively faster shots and
 *            leaves each previous trajectory faded, building the Principia figure
 *            in layers (suborbital arc → circle → ellipse → escape). Click the
 *            field to set altitude and DRAG to set the full velocity vector →
 *            tilted ellipses where perigee is no longer the launch point.
 *   escape : a U(r) = −GM/r potential-well diagram is drawn with the total-energy
 *            line across it — bound (E-line cuts the well → turning point r_max)
 *            vs escape (E-line clears the well). The turning-point marker
 *            r_max = −GM/E races off-screen as E → 0⁻, which is exactly why the
 *            SIGN of E decides bound vs gone.
 *
 * THE MOMENT: start suborbital and raise the speed until the arc that "keeps
 * missing the ground" closes into an orbit. An orbit is just a projectile that
 * never comes down.
 *
 * Units are a scaled canvas system (NOT SI): pixels for length, seconds of
 * accumulated sim-time for time. GM, R0 etc. are chosen so a circular orbit fits
 * comfortably on screen. The physics — the conic family, Kepler II/III, the
 * E = 0 boundary, and the analytic apsides — is exact regardless of scale.
 *
 * Wrapper is hook-free and branches by mode into KeplerLab / EscapeLab, each of
 * which owns its own hooks (Rules of Hooks).
 */

// ── scaled-unit constants (shared by both modes) ───────────────────────────
const GM = 60000;          // gravitational parameter (px^3 / s^2, scaled)
const R_PLANET = 16;       // drawn planet radius (px) — also the "ground"
const SOFT = 4;            // softening length (px) — guards the singularity
const DT = 1 / 600;        // integration step (s) — small for a clean E=0 line
const SUBSTEPS = 40;       // substeps per drawn frame → sets accuracy AND time rate
const TRAIL_MAX = 1400;    // trail points kept

// Launch geometry: satellite starts to the right of the planet, body moves up.
// Altitude is measured above the planet surface; r0 = R_PLANET + altitude.
const ALT_MIN = 40;
const ALT_MAX = 220;
const ALT_DEF = 130;

// Circular / escape speed at a given launch radius.
const vCircular = (r0) => Math.sqrt(GM / r0);
const vEscape = (r0) => Math.SQRT2 * vCircular(r0);

const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const RED = '#E06C6C';

// ── analytic conic solver ──────────────────────────────────────────────────
// Given a launch radius r0 and a launch velocity of magnitude v making angle
// `flight` to the LOCAL TANGENT (0 = purely tangential), return the orbit's
// specific energy, semi-major axis, eccentricity, and the two apsides. This is
// what makes the crash classification honest for BOTH tangential launches and
// tilted click-to-launch vectors.
//
//   E   = v²/2 − GM/r0                       (specific energy)
//   L   = r0 · v · cos(flight)               (specific angular momentum)
//   a   = −GM/(2E)                           (semi-major axis; <0 if unbound)
//   e   = sqrt(1 + 2 E L² / GM²)             (eccentricity)
//   r_peri = a(1−e),  r_apo = a(1+e)         (bound only)
function solveConic(r0, v, flight = 0) {
  const E = 0.5 * v * v - GM / r0;
  const L = r0 * v * Math.cos(flight);
  const bound = E < -1e-9;
  const a = -GM / (2 * E);                 // ±Infinity handled by callers via `bound`
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * E * L * L) / (GM * GM)));
  const rPeri = bound ? a * (1 - ecc) : (L * L / GM) / (1 + ecc); // conic focal form
  const rApo = bound ? a * (1 + ecc) : Infinity;
  return { E, L, a, ecc, bound, rPeri, rApo };
}

// Classify a shot from its analytic conic (honest crash test).
function classify(r0, v, flight = 0) {
  const c = solveConic(r0, v, flight);
  if (!c.bound) {
    return Math.abs(c.E) < 1e-6 * (GM / r0) ? 'parabola' : 'hyperbola';
  }
  if (c.rPeri < R_PLANET) return 'suborbital';        // far-side perigee hits ground
  if (c.ecc < 0.02) return 'circular';
  return 'ellipse';
}

// ───────────────────────────────────────────────────────────────────────────
// Wrapper — hook-free, branches by mode.
// ───────────────────────────────────────────────────────────────────────────
export default function OrbitSimulator({ mode = 'kepler' }) {
  if (mode === 'escape') return <EscapeLab />;
  return <KeplerLab />;
}

// ───────────────────────────────────────────────────────────────────────────
// Simulation engine — a factory closed over a canvas. Both labs drive the same
// velocity-Verlet integrator; each supplies its own per-frame draw extras and
// event callbacks (orbit completed / crashed / escaped). The launch velocity is
// a full vector so tilted click-to-launch ellipses work with no special cases.
// ───────────────────────────────────────────────────────────────────────────
function makeSim(canvas, wrap, opts) {
  let ctx, W, H, raf;
  let cx, cy;                     // planet center (canvas px)
  let body, ax, ay, trail;
  let phase;                      // 'flying' | 'crashed' | 'escaped'
  let prevAngle, angleAccum;      // for detecting completed orbits
  let simT, orbitT0;             // accumulated sim time / time at last apsis-return
  let rMin, rMax, rMinPos, rMaxPos;
  let lastR, rising;              // apsis detection
  // Areal velocity: dA/dt = ½ |r × v| is a conserved constant. Track it live.
  let dAdt = 0;

  // Fixed-window swept-sector samples for Kepler II. We keep the polygon of the
  // last KEEP positions ending "now" (fast wedge near perigee, slow wedge near
  // apogee) plus one frozen wedge captured at the previous apsis for comparison.
  let recent = [];                // recent [x,y] for the live wedge
  let frozenWedge = null;         // [{x,y}...] captured earlier for comparison

  // Faded previous trajectories for the Newton's-cannonball layering.
  // Each: { pts:[[x,y]...], color } — captured when the caller asks to layer.
  let ghosts = [];

  const col = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const accel = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const r2 = dx * dx + dy * dy;
    const denom = Math.pow(r2 + SOFT * SOFT, 1.5);
    return [-GM * dx / denom, -GM * dy / denom];
  };

  const dist = () => Math.hypot(body.x - cx, body.y - cy);

  // Launch state: opts.getLaunch() returns {x,y,vx,vy} in canvas px (world),
  // OR falls back to the simple tangential form via getR0()/getV().
  const computeLaunch = () => {
    if (opts.getLaunch) {
      const L = opts.getLaunch(cx, cy);
      if (L) return L;
    }
    const r0 = opts.getR0();
    const v = opts.getV();
    // tangential, to the right of the planet, moving straight up (CCW)
    return { x: cx + r0, y: cy, vx: 0, vy: -v };
  };

  const reset = () => {
    cx = W * 0.42;                // planet left-of-center so ellipses have room
    cy = H * 0.5;
    const L = computeLaunch();
    body = { x: L.x, y: L.y, vx: L.vx, vy: L.vy };
    const a = accel(body.x, body.y);
    ax = a[0]; ay = a[1];
    trail = [[body.x, body.y]];
    phase = 'flying';
    prevAngle = Math.atan2(body.y - cy, body.x - cx);
    angleAccum = 0;
    simT = 0; orbitT0 = 0;
    const r0 = dist();
    rMin = r0; rMax = r0;
    rMinPos = [body.x, body.y]; rMaxPos = [body.x, body.y];
    lastR = r0; rising = true;
    recent = [[body.x, body.y]];
    frozenWedge = null;
    // dA/dt = ½ |r × v|
    dAdt = 0.5 * Math.abs((body.x - cx) * body.vy - (body.y - cy) * body.vx);
    opts.onReset && opts.onReset();
  };

  // velocity-Verlet (leapfrog) — symplectic; bound conics close, E holds sign.
  const step = (dt) => {
    body.x += body.vx * dt + 0.5 * ax * dt * dt;
    body.y += body.vy * dt + 0.5 * ay * dt * dt;
    const a = accel(body.x, body.y);
    body.vx += 0.5 * (ax + a[0]) * dt;
    body.vy += 0.5 * (ay + a[1]) * dt;
    ax = a[0]; ay = a[1];
    simT += dt;

    const r = dist();
    if (r < rMin) { rMin = r; rMinPos = [body.x, body.y]; }
    if (r > rMax) { rMax = r; rMaxPos = [body.x, body.y]; }

    // apsis crossing (r turning around) → freeze a comparison wedge
    if (rising && r < lastR) {
      rising = false;
      frozenWedge = recent.slice();      // wedge swept approaching apoapsis (slow)
    } else if (!rising && r > lastR) {
      rising = true;
    }
    lastR = r;

    // swept-angle bookkeeping for completed-orbit detection
    const ang = Math.atan2(body.y - cy, body.x - cx);
    let d = ang - prevAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    angleAccum += d;
    prevAngle = ang;
  };

  const drawWedge = (poly, color) => {
    if (!poly || poly.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (const p of poly) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  const draw = () => {
    const gold = col('--color-gold', '#C5B783');
    const grid = col('--color-grid', '#1A2332');
    const navy = '#00205B';

    // integrate a bounded batch of substeps unless we've stopped or paused
    if (phase === 'flying' && !opts.isPaused?.()) {
      for (let i = 0; i < SUBSTEPS; i++) {
        step(DT);
        // crash: dipped below the surface (suborbital arc hits the ground)
        if (dist() <= R_PLANET) { phase = 'crashed'; break; }
      }
      if (phase === 'flying') {
        trail.push([body.x, body.y]);
        if (trail.length > TRAIL_MAX) trail.shift();
        recent.push([body.x, body.y]);
        const KEEP = Math.round(SUBSTEPS * 6);
        if (recent.length > KEEP) recent.shift();

        // completed a full CCW orbit back to the launch apsis?
        if (angleAccum <= -2 * Math.PI) {
          const period = simT - orbitT0;
          const a = 0.5 * (rMin + rMax);           // semi-major axis
          opts.onOrbit && opts.onOrbit({ period, a, rMin, rMax });
          angleAccum += 2 * Math.PI;
          orbitT0 = simT;
          rMin = dist(); rMax = dist();
          rMinPos = [body.x, body.y]; rMaxPos = [body.x, body.y];
        }

        // escaped far off-screen (hyperbola / parabola)
        const far = 1.9 * Math.hypot(W, H);
        if (dist() > far) phase = 'escaped';
      }
    }

    // report live state every frame (throttled by caller if needed)
    opts.onFrame && opts.onFrame(liveState());

    // ── render ────────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);

    // faint grid dots
    ctx.fillStyle = grid;
    const gs = 46;
    for (let gx = gs; gx < W; gx += gs)
      for (let gy = gs; gy < H; gy += gs) {
        ctx.beginPath();
        ctx.arc(gx, gy, 0.8, 0, 2 * Math.PI);
        ctx.fill();
      }

    // faded ghost trajectories (Newton's-cannonball layering)
    for (const g of ghosts) {
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < g.pts.length; i++) {
        const p = g.pts[i];
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    // reference circle at the circular-orbit radius for the current launch r0
    // (uses the slider r0 for tangential launches; the aim radius otherwise)
    const r0 = opts.getR0 ? opts.getR0() : dist();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(139,140,142,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // equal-area wedges (kepler mode only)
    if (opts.showSectors) {
      if (frozenWedge) drawWedge(frozenWedge, 'rgba(91,155,213,0.28)'); // slow wedge
      drawWedge(recent, 'rgba(197,183,131,0.34)');                      // live wedge
    }

    // trail (fading conic)
    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.strokeStyle = `rgba(240,236,227,${(t * 0.55).toFixed(3)})`;
      ctx.lineWidth = 0.7 + t * 1.5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
      ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }

    // apside markers — perigee = the CLOSEST point, apogee = the farthest, both
    // tracked from the actual trajectory (so tilted ellipses label correctly and
    // a sub-circular launch correctly shows perigee on the FAR side).
    const drawApside = (x, y, label, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(label, x + 6, y - 6);
    };
    if (opts.showSectors && phase === 'flying' && rMax > rMin * 1.05) {
      drawApside(rMinPos[0], rMinPos[1], 'perigee', 'rgba(197,183,131,0.9)');
      drawApside(rMaxPos[0], rMaxPos[1], 'apogee', 'rgba(91,155,213,0.9)');
    }

    // planet glow + body
    const glow = ctx.createRadialGradient(cx, cy, R_PLANET * 0.3, cx, cy, R_PLANET * 3.4);
    glow.addColorStop(0, 'rgba(197,183,131,0.30)');
    glow.addColorStop(1, 'rgba(197,183,131,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R_PLANET * 3.4, 0, 2 * Math.PI);
    ctx.fill();
    const bodyGrad = ctx.createRadialGradient(
      cx - R_PLANET * 0.35, cy - R_PLANET * 0.35, R_PLANET * 0.2, cx, cy, R_PLANET,
    );
    bodyGrad.addColorStop(0, gold);
    bodyGrad.addColorStop(1, navy);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R_PLANET, 0, 2 * Math.PI);
    ctx.fill();

    // satellite
    if (phase !== 'crashed') {
      const sat = phase === 'escaped' ? gold : '#FFFFFF';
      ctx.fillStyle = sat;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(body.x, body.y, 4.2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // let the caller paint extra overlays (aim vector during drag) in world px
    opts.onDraw && opts.onDraw(ctx, { cx, cy });

    // status stamp
    ctx.font = '12px "JetBrains Mono", monospace';
    if (phase === 'crashed') {
      ctx.fillStyle = 'rgba(224,108,108,0.95)';
      ctx.fillText('SUBORBITAL — impacted the surface', 12, H - 14);
    } else if (phase === 'escaped') {
      ctx.fillStyle = 'rgba(224,108,108,0.95)';
      ctx.fillText('ESCAPE — the satellite is gone', 12, H - 14);
    }

    raf = requestAnimationFrame(draw);
  };

  const liveState = () => {
    const r = dist();
    const v2 = body.vx * body.vx + body.vy * body.vy;
    const K = 0.5 * v2;             // per unit mass
    const U = -GM / Math.max(r, SOFT); // per unit mass
    return {
      phase,
      r, speed: Math.sqrt(v2),
      K, U, E: K + U,
      dAdt,
    };
  };

  const resize = () => {
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    ctx = setupCanvas(canvas, W, H);
    reset();
  };

  resize();
  raf = requestAnimationFrame(draw);
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  return {
    relaunch: reset,
    // Snapshot the current trail as a faded ghost, then relaunch (layering).
    layer(color) {
      ghosts.push({ pts: trail.slice(), color });
      if (ghosts.length > 8) ghosts.shift();
      reset();
    },
    clearGhosts() { ghosts = []; reset(); },
    // Map a canvas-relative point to world px (for click-to-launch aim math).
    center() { return { cx, cy, W, H }; },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}

// ── shared canvas host ─────────────────────────────────────────────────────
// Exposes pointer events so labs can implement click-to-launch. The `bind`
// callback receives the DOM wrapper + canvas so a lab can attach listeners.
function OrbitCanvas({ simRef, height = 460, overlay, onPointer }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const sim = makeSim(canvasRef.current, wrapRef.current, simRef.current.opts);
    simRef.current.api = sim;
    return () => { sim.destroy(); simRef.current.api = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rel = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full min-w-0 overflow-hidden rounded-lg"
      style={{ height, background: '#0D1321' }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={onPointer ? { touchAction: 'none', cursor: 'crosshair' } : undefined}
        onPointerDown={onPointer && ((e) => { canvasRef.current.setPointerCapture?.(e.pointerId); onPointer('down', rel(e)); })}
        onPointerMove={onPointer && ((e) => onPointer('move', rel(e)))}
        onPointerUp={onPointer && ((e) => { canvasRef.current.releasePointerCapture?.(e.pointerId); onPointer('up', rel(e)); })}
        onPointerCancel={onPointer && ((e) => onPointer('up', rel(e)))}
      />
      {overlay}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// KEPLER LAB (L31) — equal-area sectors, dA/dt, cannonball layering,
// click-to-launch velocity vector, T² vs a³ empirical plot.
// ───────────────────────────────────────────────────────────────────────────
function KeplerLab() {
  const [alt, setAlt] = useState(ALT_DEF);
  const [mult, setMult] = useState(1.28);   // ×v_c — an ellipse by default
  const [live, setLive] = useState({ r: 0, speed: 0, phase: 'flying', dAdt: 0 });
  const [orbits, setOrbits] = useState([]); // {period, a}
  const [cannonStep, setCannonStep] = useState(0); // index into the layering sequence
  const [aim, setAim] = useState(null);     // {x,y,vx,vy} custom launch (click-to-launch)
  const [aimClass, setAimClass] = useState(null);

  const altRef = useRef(alt); altRef.current = alt;
  const multRef = useRef(mult); multRef.current = mult;
  const aimRef = useRef(aim); aimRef.current = aim;
  const dragRef = useRef(null);             // {mode:'down'|'drag', px,py, curX,curY}
  const frameThrottle = useRef(0);

  // The progressive "fire faster" sequence: sub-circular → circular → ellipse →
  // ellipse → escape. Each entry is a ×v_c multiplier + a ghost tint.
  const CANNON_SEQ = [
    { mult: 0.86, color: 'rgba(224,108,108,0.45)', name: 'suborbital' },
    { mult: 1.00, color: 'rgba(197,183,131,0.55)', name: 'circular' },
    { mult: 1.15, color: 'rgba(240,236,227,0.40)', name: 'ellipse' },
    { mult: 1.32, color: 'rgba(91,155,213,0.50)',  name: 'wider ellipse' },
    { mult: 1.42, color: 'rgba(224,108,108,0.55)', name: 'escape (√2·v_c)' },
  ];

  const simRef = useRef({
    api: null,
    opts: {
      showSectors: true,
      getR0: () => R_PLANET + altRef.current,
      getV: () => multRef.current * vCircular(R_PLANET + altRef.current),
      // click-to-launch: if an aim vector is set, use it verbatim (tilted ellipse)
      getLaunch: (cx, cy) => {
        const a = aimRef.current;
        if (!a) return null;
        return { x: cx + a.rx, y: cy + a.ry, vx: a.vx, vy: a.vy };
      },
      onFrame: (s) => {
        const now = performance.now();
        if (now - frameThrottle.current > 100) {
          frameThrottle.current = now;
          setLive(s);
        }
      },
      onOrbit: ({ period, a }) => {
        setOrbits((prev) => {
          if (prev.length && Math.abs(prev[prev.length - 1].a - a) < 0.5) return prev;
          return [...prev, { period, a }].slice(-40);
        });
      },
      // draw the aim vector while dragging (arrow from launch point along v)
      onDraw: (ctx, { cx, cy }) => {
        const d = dragRef.current;
        if (!d || d.mode !== 'drag') return;
        const lx = d.px, ly = d.py;       // launch point (canvas px)
        const vx = d.curX - lx, vy = d.curY - ly; // drag delta → velocity direction
        // launch marker
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 2 * Math.PI); ctx.fill();
        // aim arrow
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(d.curX, d.curY); ctx.stroke();
        const ang = Math.atan2(vy, vx), hs = 8;
        ctx.beginPath();
        ctx.moveTo(d.curX, d.curY);
        ctx.lineTo(d.curX - hs * Math.cos(ang - 0.4), d.curY - hs * Math.sin(ang - 0.4));
        ctx.lineTo(d.curX - hs * Math.cos(ang + 0.4), d.curY - hs * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fillStyle = '#FFFFFF'; ctx.fill();
        ctx.fillStyle = 'rgba(240,236,227,0.85)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText('drag to aim v', d.curX + 8, d.curY);
      },
    },
  });

  // Convert a drag (launch point + drag delta) into an aim vector, matching the
  // velocity SCALE the sliders use so tilted launches are comparable in energy.
  const VDRAG_SCALE = 1.4; // px of drag → px/s of speed
  const commitAim = (d) => {
    const cen = simRef.current.api?.center?.();
    if (!cen) return;
    const rx = d.px - cen.cx, ry = d.py - cen.cy;
    const vx = (d.curX - d.px) * VDRAG_SCALE;
    const vy = (d.curY - d.py) * VDRAG_SCALE;
    const r0 = Math.hypot(rx, ry);
    const speed = Math.hypot(vx, vy);
    // flight angle from local tangent (0 = tangential); needed for honest class
    const tangent = Math.atan2(-rx, ry);           // CCW tangent direction
    const flight = Math.acos(Math.max(-1, Math.min(1,
      (vx * Math.cos(tangent) + vy * Math.sin(tangent)) / (speed || 1))));
    setAim({ rx, ry, vx, vy });
    setAimClass(speed > 1 ? classify(r0, speed, flight) : null);
    aimRef.current = { rx, ry, vx, vy };
    simRef.current.api?.clearGhosts?.();
  };

  const onPointer = (kind, p) => {
    if (kind === 'down') {
      dragRef.current = { mode: 'down', px: p.x, py: p.y, curX: p.x, curY: p.y };
    } else if (kind === 'move') {
      const d = dragRef.current;
      if (!d) return;
      d.curX = p.x; d.curY = p.y;
      if (Math.hypot(p.x - d.px, p.y - d.py) > 4) d.mode = 'drag';
    } else if (kind === 'up') {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.mode === 'drag') { commitAim(d); }
    }
  };

  const relaunch = () => {
    setOrbits([]);
    setCannonStep(0);
    simRef.current.api?.clearGhosts?.();
  };
  const clearAim = () => {
    setAim(null); aimRef.current = null; setAimClass(null);
    simRef.current.api?.clearGhosts?.();
  };
  const reset = () => {
    setAlt(ALT_DEF); setMult(1.28); setOrbits([]); setCannonStep(0);
    setAim(null); aimRef.current = null; setAimClass(null);
    setTimeout(() => simRef.current.api?.clearGhosts?.(), 0);
  };

  // Newton's-cannonball stepper: freeze the CURRENT trajectory as a ghost, bump
  // the speed slider to the next entry, and relaunch — building the layers.
  const fireFaster = () => {
    const api = simRef.current.api;
    if (!api) return;
    setAim(null); aimRef.current = null; setAimClass(null);
    const cur = CANNON_SEQ[cannonStep % CANNON_SEQ.length];
    api.layer(cur.color);                 // snapshot current + relaunch
    const next = (cannonStep + 1) % CANNON_SEQ.length;
    setMult(CANNON_SEQ[next].mult);
    setCannonStep(next);
    if (next === 0) api.clearGhosts?.();  // wrapped around → start a fresh figure
  };

  const r0 = R_PLANET + alt;
  const vc = vCircular(r0);

  // T² vs a³ plot (empirical Kepler III). Kepler's constant is 4π²/GM.
  const a3 = orbits.map((o) => Math.pow(o.a, 3));
  const t2 = orbits.map((o) => o.period * o.period);
  const keplerK = 4 * Math.PI * Math.PI / GM;
  const a3max = a3.length ? Math.max(...a3) * 1.1 : Math.pow(2 * r0, 3);
  const refLine = { x: [0, a3max], y: [0, keplerK * a3max] };

  const plotTraces = [
    {
      x: refLine.x, y: refLine.y, type: 'scatter', mode: 'lines',
      line: { color: 'rgba(139,140,142,0.6)', width: 1.5, dash: 'dash' },
      hoverinfo: 'skip', name: 'T² = (4π²/GM) a³',
    },
    {
      x: a3, y: t2, type: 'scatter', mode: 'markers',
      marker: { color: GOLD, size: 9, line: { color: '#FFFFFF', width: 1 } },
      hoverinfo: 'skip', name: 'completed orbits',
    },
  ];
  const plotLayout = {
    showlegend: false,
    margin: { l: 58, r: 12, t: 8, b: 42 },
    xaxis: { title: { text: 'a³  (semi-major³)' }, range: undefined, autorange: true, zeroline: true, zerolinecolor: '#2A3442' },
    yaxis: { title: { text: 'T²  (period²)' }, range: undefined, autorange: true, zeroline: true, zerolinecolor: '#2A3442' },
  };

  // Honest classification from the analytic conic (far-side perigee test).
  const conicNow = aim
    ? aimClass
    : classify(r0, mult * vc, 0);
  const conicLabel = {
    suborbital: 'suborbital → crashes', circular: 'circular',
    ellipse: 'ellipse', parabola: 'parabola', hyperbola: 'hyperbola',
  }[conicNow] || conicNow;

  // For the tangential slider, show the predicted far-side perigee so the crash
  // story is legible even before launch.
  const cPred = solveConic(r0, mult * vc, 0);
  const perigeeAlt = cPred.bound ? (cPred.rPeri - R_PLANET) : Infinity;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Launch altitude" value={alt} min={ALT_MIN} max={ALT_MAX} step={1} unit="px"
                onChange={(v) => { clearAim(); setAlt(v); }} />
        <Slider label="Launch speed" value={Number(mult.toFixed(2))} min={0.7} max={1.42} step={0.01} unit="×v_c"
                onChange={(v) => { clearAim(); setMult(v); }} />

        <div className="mt-1 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={fireFaster}
            className="w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            🎯 Fire faster (leave a faded arc)
          </button>
          <button
            onClick={relaunch}
            className="w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            ↻ Relaunch (clear layers + T²–a³)
          </button>
          <p className="text-usna-muted text-xs leading-snug">
            "Fire faster" builds Newton's cannonball figure in layers: each shot
            leaves a faded arc as the trajectory grows suborbital → circle →
            ellipse → escape. Or <b>click the field and drag</b> to aim the full
            velocity vector — a tilted ellipse whose perigee is not the launch point.
          </p>
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Conic" value={conicLabel} unit="" />
          {!aim && (
            <Readout
              label="Far-side perigee alt"
              value={perigeeAlt === Infinity ? '∞' : perigeeAlt.toFixed(0)}
              unit="px"
            />
          )}
          <Readout label="Radius r" value={live.r.toFixed(0)} unit="px" />
          <Readout label="Speed v" value={live.speed.toFixed(0)} unit="px/s" />
          <Readout label="v_circular" value={vc.toFixed(0)} unit="px/s" />
          <Readout label="dA/dt (areal)" value={live.dAdt.toFixed(0)} unit="px²/s" />
          <Readout label="Orbits logged" value={String(orbits.length)} unit="" />
          {orbits.length > 0 && (
            <Readout label="Last period T" value={orbits[orbits.length - 1].period.toFixed(2)} unit="s" />
          )}
          {aim && (
            <button
              onClick={clearAim}
              className="mt-2 w-full px-2 py-1 rounded text-xs bg-usna-deep text-usna-muted border border-usna-grid hover:text-usna-text transition-colors"
            >
              clear click-launch → back to slider
            </button>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <OrbitCanvas
          simRef={simRef}
          height={440}
          onPointer={onPointer}
          overlay={
            <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
              <div>gold wedge = swept now (near perigee = fast)</div>
              <div>blue wedge = swept near apogee (slow)</div>
              <div>equal areas ⟹ equal times · dA/dt = {live.dAdt.toFixed(0)} px²/s (const)</div>
            </div>
          }
        />

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 260 }}>
          <div className="text-usna-text text-sm font-medium mb-1">
            Kepler III, built one orbit at a time — T² vs a³
          </div>
          <div style={{ height: 210 }}>
            <IntensityPlot traces={plotTraces} layoutOverrides={plotLayout} />
          </div>
        </div>

        <InfoPanel {...INFO.kepler} />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ESCAPE LAB (L32) — total energy E = K + U with the sign highlighted, plus a
// U(r) potential-well diagram carrying the E-line and turning-point marker.
// ───────────────────────────────────────────────────────────────────────────
function EscapeLab() {
  const [alt, setAlt] = useState(ALT_DEF);
  const [mult, setMult] = useState(1.0);   // ×v_esc — start bound
  const [live, setLive] = useState({ r: 0, speed: 0, K: 0, U: 0, E: 0, phase: 'flying' });

  const altRef = useRef(alt); altRef.current = alt;
  const multRef = useRef(mult); multRef.current = mult;
  const frameThrottle = useRef(0);

  const simRef = useRef({
    api: null,
    opts: {
      showSectors: false,
      getR0: () => R_PLANET + altRef.current,
      getV: () => multRef.current * vEscape(R_PLANET + altRef.current),
      onFrame: (s) => {
        const now = performance.now();
        if (now - frameThrottle.current > 80) {
          frameThrottle.current = now;
          setLive(s);
        }
      },
    },
  });

  const relaunch = () => simRef.current.api && simRef.current.api.relaunch();
  const reset = () => {
    setAlt(ALT_DEF); setMult(1.0);
    setTimeout(() => simRef.current.api && simRef.current.api.relaunch(), 0);
  };

  const r0 = R_PLANET + alt;
  const vesc = vEscape(r0);

  // Bound / knife-edge / escape from the SIGN of E (the physics), plus the
  // slider position as a cross-check.
  const E = live.E;
  const near0 = Math.abs(mult - 1) < 0.01;
  const sign = near0 ? 0 : E < 0 ? -1 : 1;
  const signColor = sign < 0 ? BLUE : sign > 0 ? RED : GOLD;
  const signLabel = sign < 0 ? 'E < 0  ·  BOUND' : sign > 0 ? 'E > 0  ·  ESCAPE' : 'E = 0  ·  PARABOLIC KNIFE-EDGE';

  // Turning point r_max = −GM/E (bound only). This is where K → 0 and the
  // satellite momentarily stops before falling back; as E → 0⁻ it races to ∞.
  // Use launch energy for a stable, slider-driven prediction.
  const vLaunch = mult * vesc;
  const Elaunch = 0.5 * vLaunch * vLaunch - GM / r0;
  const rTurn = Elaunch < -1e-9 ? -GM / Elaunch : Infinity;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Launch altitude" value={alt} min={ALT_MIN} max={ALT_MAX} step={1} unit="px" onChange={setAlt} />
        <Slider label="Launch speed" value={Number(mult.toFixed(3))} min={0.75} max={1.3} step={0.005} unit="×v_esc" onChange={setMult} />

        <div className="mt-1 border-t border-usna-grid pt-3">
          <button
            onClick={relaunch}
            className="w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            ↻ Relaunch
          </button>
          <p className="text-usna-muted text-xs mt-2 leading-snug">
            Creep the speed toward 1×v_esc. On the well diagram the horizontal
            E-line rises; while it still cuts the well there is a turning point
            r_max = −GM/E where the satellite stops and falls back. As E → 0⁻ that
            turning point races off to infinity — the moment it clears the well,
            the satellite is gone.
          </p>
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Radius r" value={live.r.toFixed(0)} unit="px" />
          <Readout label="Speed v" value={live.speed.toFixed(0)} unit="px/s" />
          <Readout label="v_escape" value={vesc.toFixed(0)} unit="px/s" />
          <Readout
            label="Turning point r_max"
            value={rTurn === Infinity ? '∞ (escapes)' : rTurn.toFixed(0)}
            unit={rTurn === Infinity ? '' : 'px'}
          />
          <Readout label="Kinetic K" value={live.K.toFixed(0)} unit="J/kg" />
          <Readout label="Potential U" value={live.U.toFixed(0)} unit="J/kg" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* the energy-sign banner: this is the counterintuitive payoff */}
        <div
          className="rounded-lg px-4 py-3 border flex items-center justify-between"
          style={{ borderColor: signColor, background: 'rgba(13,19,33,0.85)' }}
        >
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: signColor }}>
              Total mechanical energy
            </div>
            <div className="font-mono text-2xl tabular-nums" style={{ color: signColor }}>
              E = {E >= 0 ? '+' : ''}{E.toFixed(0)} <span className="text-sm text-usna-muted">J/kg</span>
            </div>
          </div>
          <div className="font-mono text-sm text-right" style={{ color: signColor }}>
            {signLabel}
          </div>
        </div>

        <OrbitCanvas
          simRef={simRef}
          height={360}
          overlay={
            <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
              <div>E &lt; 0 → ellipse (falls back)</div>
              <div>E = 0 → parabola (just barely escapes)</div>
              <div>E &gt; 0 → hyperbola (gone)</div>
            </div>
          }
        />

        {/* U(r) potential-well diagram with the E-line + turning point */}
        <PotentialWell r0={r0} Elaunch={Elaunch} rTurn={rTurn} liveR={live.r} sign={sign} />

        <InfoPanel {...INFO.escape} />
      </div>
    </div>
  );
}

// ── U(r) potential-well diagram ────────────────────────────────────────────
// Draws U(r) = −GM/r, the horizontal total-energy line E, and the turning
// point where they intersect (bound) or the "clears the well" case (escape).
// This is the canonical picture that explains the SIGN of E.
function PotentialWell({ r0, Elaunch, rTurn, liveR, sign }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef({ r0, Elaunch, rTurn, liveR, sign });
  stateRef.current = { r0, Elaunch, rTurn, liveR, sign };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf;

    const draw = () => {
      const { r0, Elaunch, rTurn, liveR, sign } = stateRef.current;
      const PAD_L = 52, PAD_R = 16, PAD_T = 16, PAD_B = 34;
      const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

      // r range: from just outside the surface out to a few × the launch radius,
      // wide enough to show the turning point when it is finite.
      const rMinX = R_PLANET;
      const rMaxX = Math.max(4 * r0, isFinite(rTurn) ? rTurn * 1.25 : 4 * r0);
      // U range: from the deepest drawn well up to a bit above 0.
      const Umin = -GM / rMinX;
      const Umax = Math.max(0, Elaunch) + 0.15 * Math.abs(Umin);
      const Ulo = Umin, Uhi = Umax;

      const X = (r) => PAD_L + ((r - rMinX) / (rMaxX - rMinX)) * plotW;
      const Y = (U) => PAD_T + (1 - (U - Ulo) / (Uhi - Ulo)) * plotH;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0E1826';
      ctx.fillRect(0, 0, W, H);

      // axes
      ctx.strokeStyle = '#2A3442';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T); ctx.lineTo(PAD_L, H - PAD_B); ctx.lineTo(W - PAD_R, H - PAD_B); ctx.stroke();

      // U = 0 reference line (the escape threshold)
      const y0 = Y(0);
      ctx.strokeStyle = 'rgba(139,140,142,0.5)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PAD_L, y0); ctx.lineTo(W - PAD_R, y0); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8B8C8E';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('U = 0', PAD_L + 4, y0 - 2);

      // U(r) = −GM/r curve
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let first = true;
      for (let px = 0; px <= plotW; px++) {
        const r = rMinX + (px / plotW) * (rMaxX - rMinX);
        const U = -GM / r;
        const yy = Y(U);
        if (first) { ctx.moveTo(X(r), yy); first = false; } else ctx.lineTo(X(r), yy);
      }
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('U(r) = −GM/r', W - PAD_R - 96, Y(-GM / rMaxX) - 14);

      // total-energy line E (horizontal)
      const eColor = sign < 0 ? BLUE : sign > 0 ? RED : GOLD;
      const yE = Y(Elaunch);
      ctx.strokeStyle = eColor;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PAD_L, yE); ctx.lineTo(W - PAD_R, yE); ctx.stroke();
      ctx.fillStyle = eColor;
      ctx.textAlign = 'right'; ctx.textBaseline = yE < y0 ? 'bottom' : 'top';
      ctx.fillText(`E = ${Elaunch >= 0 ? '+' : ''}${Elaunch.toFixed(0)}`, W - PAD_R - 2, yE + (yE < y0 ? -3 : 3));

      // launch radius marker
      const xr0 = X(r0);
      ctx.strokeStyle = 'rgba(240,236,227,0.35)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(xr0, PAD_T); ctx.lineTo(xr0, H - PAD_B); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(240,236,227,0.6)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('launch r₀', xr0, H - PAD_B + 4);

      // turning point where E-line meets the well (bound only)
      if (isFinite(rTurn) && rTurn <= rMaxX) {
        const xt = X(rTurn);
        ctx.fillStyle = eColor;
        ctx.beginPath(); ctx.arc(xt, yE, 5, 0, 2 * Math.PI); ctx.fill();
        // vertical drop to axis
        ctx.strokeStyle = eColor;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(xt, yE); ctx.lineTo(xt, H - PAD_B); ctx.stroke();
        ctx.setLineDash([]);
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`r_max = ${rTurn.toFixed(0)}`, Math.min(xt, W - PAD_R - 40), yE - 8);
      } else if (isFinite(rTurn)) {
        // turning point is off-screen to the right → about to escape
        ctx.fillStyle = eColor;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText('r_max → off-screen', W - PAD_R - 2, yE - 8);
      } else {
        // E ≥ 0: the line clears the well — no turning point, unbounded
        ctx.fillStyle = RED;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('E clears the well → escapes to r = ∞', PAD_L + plotW / 2, yE - 12);
      }

      // live satellite position on the well (its current r), riding the curve
      if (liveR > 0) {
        const rr = Math.min(Math.max(liveR, rMinX), rMaxX);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(X(rr), Y(-GM / rr), 4, 0, 2 * Math.PI); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // axis labels
      ctx.fillStyle = '#8B8C8E';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('distance r (px)', PAD_L + plotW / 2, H - 2);
      ctx.save();
      ctx.translate(12, PAD_T + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText('energy per unit mass', 0, 0);
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };
    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden">
      <div className="text-usna-text text-sm font-medium mb-1">
        Potential well U(r) with the total-energy line
      </div>
      <div ref={wrapRef} className="min-w-0 overflow-hidden" style={{ height: 220 }}>
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
const INFO = {
  kepler: {
    title: "Newton's cannonball → Kepler's laws",
    description:
      'An orbit is just a projectile that keeps missing the ground. Because the launch is tangential, the launch radius is always an apsis — so below 1×v_c the satellite starts at apogee and its true perigee sits on the far side at r = 2a − r₀. Only when that far-side perigee dips below the surface does the shot actually crash (the "Far-side perigee alt" readout goes negative), so "Fire faster" honestly walks the arc from suborbital → circle → ellipse → escape, leaving each attempt faded behind it. The two shaded wedges sweep equal areas in equal numbers of steps and the dA/dt readout holds constant — Kepler II. Each completed orbit drops a point on the T² vs a³ plot, all landing on T² = (4π²/GM)·a³ — Kepler III, empirically. Click-and-drag sets the full velocity vector, tilting the ellipse so perigee is no longer where you launched.',
    equation: String.raw`\frac{dA}{dt} = \tfrac12|\vec r\times\vec v| = \text{const}, \qquad T^2 = \frac{4\pi^2}{GM}\,a^3`,
  },
  escape: {
    title: 'The sign of the energy decides everything',
    description:
      'Total mechanical energy E = K + U is conserved along the whole trajectory (a symplectic velocity-Verlet integrator keeps that true numerically). Read it off the potential-well diagram: the horizontal E-line cuts the well U(r) = −GM/r at the turning point r_max = −GM/E, where the satellite momentarily stops and falls back — that is a bound orbit (E < 0). Raise the launch speed and the E-line rises; the turning point r_max races outward and, exactly at E = 0 (v = v_esc), it reaches infinity and the line just clears the lip of the well. Any higher and E > 0: the line never meets the well again, so nothing turns the satellite around and it escapes on a hyperbola. The sign of E is the whole story.',
    equation: String.raw`E = \tfrac12 v^2 - \frac{GM}{r}, \qquad r_{\max} = -\frac{GM}{E}, \qquad v_{\text{esc}} = \sqrt{\frac{2GM}{r}}`,
  },
};
