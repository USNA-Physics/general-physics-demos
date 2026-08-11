import { useState, useRef, useEffect, useMemo } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import EnergyBars from '@shared/components/EnergyBars';

/**
 * D18 · Energy Landscape Explorer — L18 (default), L19 (equilibria), L20 (dissipation).
 *
 * A ball rides a potential-energy landscape U(x). The ball's motion is integrated
 * directly from the landscape: the force is the (numerical) negative slope,
 * F = -dU/dx, so a = F/m — nothing is hard-coded per preset, every U(x) just works.
 * As the ball moves, kinetic and potential energy trade in real time while the
 * total-mechanical-energy line stays frozen across the landscape; the ball
 * physically cannot climb past the two points where that line meets U(x) (the
 * classical turning points).
 *
 *   default     : drag the ball to a height and release. K and U swap on the bars
 *                 but the total-E bar (and the E-line on the landscape) never move —
 *                 the ball coasts forever between its turning points.
 *   equilibria  : the same landscape, now annotated. A tangent arrow shows
 *                 F = -dU/dx at the ball; minima are marked stable (○), maxima
 *                 unstable (△); the turning points glow where E = U(x). THE MOMENT:
 *                 balance the ball on the double-well hump — it sits (unstable)
 *                 until the tiniest nudge sends it into one well or the other.
 *   dissipation : add friction. Mechanical energy now bleeds into a growing THERMAL
 *                 bar; K + U falls, but K + U + thermal stays flat — energy is
 *                 conserved, just no longer all mechanical, and the ball settles
 *                 into the nearest minimum.
 *
 * Self-contained physics + canvas (rAF + ResizeObserver + pointer drag). Landscape
 * is drag-editable (stretch): grab a control knob on the curve and reshape U(x).
 *
 * ── this pass adds ──────────────────────────────────────────────────────────
 *   • K is now ALWAYS ½mv² from the integrator (one branch, no μ=0 vs μ>0 jump).
 *     At μ=0 a tiny per-frame velocity rescale pins ½mv² + U = E0 exactly, so the
 *     symplectic integrator's E-line is razor-flat without a separate K formula.
 *   • Domain walls reflect ELASTICALLY (|v| preserved) — a ball that reaches a
 *     wall no longer lowers its own "constant" E-line. Friction still bleeds E,
 *     but only through the drag term, never the wall.
 *   • Editing U(x) re-freezes E0 to max(E0, U(x_ball)) so the ball is never left
 *     stranded above its own E-line (which would read as negative K).
 *   • Phase-space (x,v) inset: a live orbit — ellipse in the bowl, figure-8
 *     separatrix in the double well, a dot pinned at the unstable fixed point when
 *     balanced on the hump.
 *   • "Ghost race": a second faint ball dropped from a hair-different height on the
 *     double well; two near-identical starts diverge into opposite wells.
 *   • Small-oscillation overlay at the nearest stable minimum: the parabolic fit
 *     U ≈ ½U''(x0)(x−x0)² and the predicted SHM period T = 2π√(m/U'').
 *   • The drop-line at the ball is a two-tone stacked bar: U (ground→ball) and
 *     K (ball→E-line), so "K = the gap up to the E-line" is legible in place.
 */

// ── palette (hex for canvas; tailwind classes elsewhere) ────────────────────
const GOLD = '#C5B783';
const GOLD_SOFT = 'rgba(197,183,131,0.42)';
const WHITE = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const RED = '#E27D60';
const THERMAL = '#C0392B';
const GREEN = '#7FB77E';
const BLUE = '#5B9BD5';

const M = 1.0;          // ball mass (kg); a = F/m
const XMIN = -5;        // landscape domain (world x, m)
const XMAX = 5;
const H_MAX = 20;       // top of the potential window (J, since m=1 → U in J-ish units)

// ── the three canonical landscapes, plus a drag-editable one ────────────────
// Each returns U(x) in joules (m = 1 kg so U is energy directly). Curves are
// tuned to sit inside [0, H_MAX] over the domain.
const PRESETS = {
  ramp: {
    label: 'Ramp (incline)',
    U: (x) => 1.7 * (x + XMAX),          // straight incline: constant slope → constant force
  },
  bowl: {
    label: 'Spring bowl (parabola)',
    U: (x) => 0.7 * x * x,               // U = ½kx² with k=1.4 → SHM about x=0
  },
  well: {
    label: 'Double well',
    U: (x) => 0.16 * (x * x - 9) * (x * x - 9) / 4 + 0.5, // two minima near ±3, hump at 0
  },
};

// Sample a U-function to a table for fast drawing + smooth numeric slope.
const NS = 220;
function sampleU(fn) {
  const xs = new Array(NS), us = new Array(NS);
  const dx = (XMAX - XMIN) / (NS - 1);
  for (let i = 0; i < NS; i++) {
    xs[i] = XMIN + i * dx;
    us[i] = fn(xs[i]);
  }
  return { xs, us, dx };
}

// Interpolate the sampled potential + its slope at an arbitrary x (linear interp).
function uAt(tbl, x) {
  const { xs, us } = tbl;
  if (x <= xs[0]) return us[0] + slopeAt(tbl, xs[0]) * (x - xs[0]);
  if (x >= xs[NS - 1]) return us[NS - 1] + slopeAt(tbl, xs[NS - 1]) * (x - xs[NS - 1]);
  const f = (x - xs[0]) / tbl.dx;
  const i = Math.floor(f);
  const frac = f - i;
  return us[i] * (1 - frac) + us[i + 1] * frac;
}
function slopeAt(tbl, x) {
  const { us, dx } = tbl;
  const f = (x - tbl.xs[0]) / dx;
  let i = Math.round(f);
  i = Math.max(1, Math.min(NS - 2, i));
  return (us[i + 1] - us[i - 1]) / (2 * dx); // centered difference = dU/dx
}
// Second derivative U'' at x (needed for the small-oscillation / SHM fit).
function curvatureAt(tbl, x) {
  const { us, dx } = tbl;
  const f = (x - tbl.xs[0]) / dx;
  let i = Math.round(f);
  i = Math.max(1, Math.min(NS - 2, i));
  return (us[i + 1] - 2 * us[i] + us[i - 1]) / (dx * dx);
}

// Find local minima (stable) and maxima (unstable) of a sampled table.
// Returns arrays of {x, u, i}. Used for markers AND the SHM overlay.
function findExtrema(tbl) {
  const { xs, us } = tbl;
  const minima = [], maxima = [];
  for (let i = 2; i < NS - 2; i++) {
    const dL = us[i] - us[i - 2];
    const dR = us[i + 2] - us[i];
    if (dL < 0 && dR > 0) minima.push({ x: xs[i], u: us[i], i });
    else if (dL > 0 && dR < 0) maxima.push({ x: xs[i], u: us[i], i });
  }
  return { minima, maxima };
}

// ── thin, hook-free wrapper: all three modes share one child (features branch
// on the mode string inside), so hooks live in exactly one place. ────────────
export default function EnergyLandscape({ mode = 'default' }) {
  const m = mode === 'equilibria' || mode === 'dissipation' ? mode : 'default';
  return <LandscapeSim mode={m} />;
}

function LandscapeSim({ mode }) {
  const isEquil = mode === 'equilibria';
  const isDissip = mode === 'dissipation';

  const [preset, setPreset] = useState(isEquil ? 'well' : 'bowl');
  const [mass, setMass] = useState(M);
  const [friction, setFriction] = useState(isDissip ? 0.4 : 0);
  const [editMode, setEditMode] = useState(false);
  const [running, setRunning] = useState(true);
  const [showPhase, setShowPhase] = useState(true);
  const [showSHM, setShowSHM] = useState(false);
  const [ghostOn, setGhostOn] = useState(false);
  // Live readouts mirrored to React at a light cadence (not per frame).
  const [ro, setRo] = useState({
    K: 0, U: 0, E: 0, therm: 0, x: 0, v: 0, F: 0, Tperiod: 0, Ucurv: 0,
  });

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Mutable simulation state the rAF loop owns; refs so control changes reach it
  // without restarting the effect.
  const sim = useRef({
    x: 0, v: 0, thermal: 0, E0: 0, released: true,
    // second, faint "ghost" ball for the divergence race (double well)
    ghost: { x: 0, v: 0, E0: 0, active: false },
    // short trail of recent (x,v) points for the phase-space orbit
    orbit: [],
  });
  const massRef = useRef(mass); massRef.current = mass;
  const fricRef = useRef(friction); fricRef.current = friction;
  const runRef = useRef(running); runRef.current = running;
  const editRef = useRef(editMode); editRef.current = editMode;
  const modeRef = useRef(mode); modeRef.current = mode;
  const phaseRef = useRef(showPhase); phaseRef.current = showPhase;
  const shmRef = useRef(showSHM); shmRef.current = showSHM;
  const presetRef = useRef(preset); presetRef.current = preset;

  // Editable copy of the landscape table (starts as the chosen preset).
  const tblRef = useRef(sampleU(PRESETS[preset].U));

  // Rebuild the landscape + re-seed the ball whenever the preset changes.
  useEffect(() => {
    tblRef.current = sampleU(PRESETS[preset].U);
    seedBall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Turning the ghost race on (double well only) launches a second, faint ball a
  // hair away from the primary's start; off removes it.
  useEffect(() => {
    const s = sim.current;
    if (ghostOn && preset === 'well') {
      // primary drops from x≈-0.02 (on the hump); ghost from a whisker to the +side.
      seedBall();
      const tbl = tblRef.current;
      s.ghost.x = 0.02; s.ghost.v = 0; s.ghost.E0 = uAt(tbl, 0.02); s.ghost.active = true;
      setRunning(true);
    } else {
      s.ghost.active = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostOn, preset]);

  // Place the ball at a sensible starting point for the current landscape and
  // freeze its total energy E0 = U(x0) (released from rest at height).
  function seedBall() {
    const tbl = tblRef.current;
    let x0;
    if (preset === 'ramp') x0 = 2.4;            // partway up the incline
    else if (preset === 'bowl') x0 = 3.4;       // near the rim of the bowl
    else x0 = -0.02;                            // essentially ON the double-well hump
    const s = sim.current;
    s.x = x0; s.v = 0; s.thermal = 0;
    s.E0 = uAt(tbl, x0);
    s.released = true;
    s.orbit = [];
  }

  const reset = () => {
    setPreset(isEquil ? 'well' : 'bowl');
    setMass(M);
    setFriction(isDissip ? 0.4 : 0);
    setEditMode(false);
    setRunning(true);
    setGhostOn(false);
    setShowSHM(false);
    setShowPhase(true);
    tblRef.current = sampleU(PRESETS[isEquil ? 'well' : 'bowl'].U);
    seedBall();
  };

  // ── canvas + physics loop ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    const pad = { l: 46, r: 18, t: 22, b: 34 };

    // world <-> screen (recomputed each frame from live W,H)
    let toX, toY, fromX, sxRef, syRef, groundYRef;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const buildMap = () => {
      const plotL = pad.l, plotR = W - pad.r;
      const plotB = H - pad.b, plotT = pad.t;
      const sx = (plotR - plotL) / (XMAX - XMIN);
      const sy = (plotB - plotT) / H_MAX;
      toX = (wx) => plotL + (wx - XMIN) * sx;
      toY = (wy) => plotB - wy * sy;
      fromX = (px) => XMIN + (px - plotL) / sx;
      sxRef = sx; syRef = sy; groundYRef = plotB;
    };

    seedBall(); // first placement (also handles fast-refresh)

    // ── one symplectic (semi-implicit Euler) substep of the ball's motion on the
    // landscape, with viscous drag; returns heat generated this substep. Shared by
    // the primary ball and the ghost so their physics is byte-identical. ─────────
    const stepBall = (b, tbl, mNow, mu, h) => {
      const slope = slopeAt(tbl, b.x);
      const Fcons = -slope;                       // conservative force from U
      const Fdrag = -mu * 6 * b.v;                // linear (viscous) drag
      const a = (Fcons + Fdrag) / mNow;
      const vOld = b.v;
      b.v += a * h;
      const dx = 0.5 * (vOld + b.v) * h;
      b.x += dx;
      let heat = Math.abs(Fdrag * dx);
      // ── ELASTIC domain walls: clamp position, flip velocity, keep |v| intact.
      // (Previously ×0.5 here, which quietly drained "conserved" energy at μ=0.)
      if (b.x < XMIN + 0.02) { b.x = XMIN + 0.02; b.v = Math.abs(b.v); }
      if (b.x > XMAX - 0.02) { b.x = XMAX - 0.02; b.v = -Math.abs(b.v); }
      return heat;
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      buildMap();
      const tbl = tblRef.current;
      const s = sim.current;
      const mNow = massRef.current;
      const mu = fricRef.current;

      // ── integrate motion from the landscape: F = -dU/dx, a = F/m ────────────
      // Semi-implicit (symplectic) Euler with a light substep for stability at
      // steep slopes; friction opposes velocity and drains into the thermal bar.
      if (runRef.current && s.released && !editRef.current) {
        const sub = 4;
        const h = dt / sub;
        for (let k = 0; k < sub; k++) {
          s.thermal += stepBall(s, tbl, mNow, mu, h);
          if (s.ghost.active) stepBall(s.ghost, tbl, mNow, mu, h);
        }

        // ── keep E EXACTLY flat when μ=0 by rescaling v so ½mv²+U = E0. This lets
        // us report K from the SAME ½mv² the integrator uses (no separate branch)
        // while removing symplectic drift, so the dashed E-line never wobbles. ──
        if (mu === 0) {
          reFreeze(s, tbl, mNow);
          if (s.ghost.active) reFreeze(s.ghost, tbl, mNow);
        }
      }

      // ── energies (ONE branch: K is always ½mv² from the integrator) ─────────
      const U = uAt(tbl, s.x);
      const K = 0.5 * mNow * s.v * s.v;
      const Emech = K + U;
      const Etot = mu > 0 ? Emech + s.thermal : s.E0;
      const Fnow = -slopeAt(tbl, s.x);

      // record a short (x,v) trail for the phase-space orbit
      s.orbit.push([s.x, s.v]);
      if (s.orbit.length > 260) s.orbit.shift();

      // ── draw ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // faint frame + baseline
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);

      // y-axis label
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.save();
      ctx.translate(14, (pad.t + groundYRef) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('U(x)  energy', 0, 0);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillText('position  x', (pad.l + (W - pad.r)) / 2, H - 10);

      // ── the total-energy line: frozen across the whole landscape ────────────
      const eLevel = mu > 0 ? Emech : s.E0; // mechanical energy available to motion
      const eY = toY(eLevel);
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.l, eY);
      ctx.lineTo(W - pad.r, eY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = WHITE;
      ctx.textAlign = 'left';
      ctx.fillText(mu > 0 ? 'E_mech' : 'E (total)', pad.l + 4, eY - 5);

      // ── shade the classically-allowed region (U ≤ E), where the motion lives;
      // the edges of the shading ARE the turning points. Drawn as explicit
      // polygons between U(x) and the E-line over each stretch where U < E. ─────
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < NS; i++) {
        if (tbl.us[i] <= eLevel) {
          const px = toX(tbl.xs[i]);
          if (!started) { ctx.moveTo(px, eY); started = true; }
          ctx.lineTo(px, toY(tbl.us[i]));
        } else if (started) {
          ctx.lineTo(toX(tbl.xs[i]), eY);
          ctx.closePath();
          ctx.fillStyle = 'rgba(197,183,131,0.10)';
          ctx.fill();
          ctx.beginPath();
          started = false;
        }
      }
      if (started) {
        ctx.lineTo(toX(tbl.xs[NS - 1]), eY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(197,183,131,0.10)';
        ctx.fill();
      }

      // ── small-oscillation overlay: parabola fitted to the nearest stable min ─
      // U ≈ U(x0) + ½U''(x0)(x−x0)². Drawn dashed over the true curve so students
      // see SHM "hiding" in the bottom of any well; period from T = 2π√(m/U''). ─
      let shmInfo = null;
      if (shmRef.current) {
        shmInfo = drawSHMOverlay(ctx, tbl, s.x, mNow, toX, toY);
      }

      // ── the potential curve U(x) (gold) ─────────────────────────────────────
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < NS; i++) {
        const px = toX(tbl.xs[i]);
        const py = toY(Math.min(H_MAX, tbl.us[i]));
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();

      // ── mode: equilibria — mark stable minima / unstable maxima + turning pts
      if (modeRef.current === 'equilibria') {
        markExtrema(ctx, tbl, toX, toY);
        markTurningPoints(ctx, tbl, eLevel, toX, toY);
      } else {
        // still show turning points faintly in the other modes (the "walls")
        markTurningPoints(ctx, tbl, eLevel, toX, toY, true);
      }

      // ── drag-edit knobs on the curve (stretch) ──────────────────────────────
      if (editRef.current) {
        ctx.fillStyle = 'rgba(226,125,96,0.9)';
        for (let kx = XMIN + 1; kx <= XMAX - 1; kx += 1) {
          const py = toY(Math.min(H_MAX, uAt(tbl, kx)));
          ctx.beginPath();
          ctx.arc(toX(kx), py, 5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // ── the ball, sitting on the curve at (x, U(x)) ─────────────────────────
      const bx = toX(s.x);
      const by = toY(Math.min(H_MAX, U));

      // ── two-tone stacked drop-bar at the ball: U (ground→ball) + K (ball→E). ─
      // Makes "K = the gap up to the E-line" visible right where the ball is.
      const barW = 9;
      const gY = groundYRef;
      // U segment (soft gold): from ground up to the ball
      ctx.fillStyle = 'rgba(197,183,131,0.22)';
      ctx.fillRect(bx - barW / 2, by, barW, gY - by);
      // K segment (bright gold): from the ball up to the E-line
      ctx.fillStyle = 'rgba(197,183,131,0.55)';
      ctx.fillRect(bx - barW / 2, eY, barW, by - eY);
      // outline + tiny labels
      ctx.strokeStyle = 'rgba(240,236,227,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - barW / 2, eY, barW, gY - eY);
      if (by - eY > 14) label(ctx, 'K', bx + barW / 2 + 8, (eY + by) / 2 + 3, GOLD);
      if (gY - by > 16) label(ctx, 'U', bx + barW / 2 + 8, (by + gY) / 2 + 3, GOLD_SOFT);

      // ── force arrow (equilibria): tangent slope F = -dU/dx along the surface ─
      if (modeRef.current === 'equilibria') {
        drawForceArrow(ctx, bx, by, Fnow, sxRef);
      }

      // ── the ghost ball (faint) for the divergence race ──────────────────────
      if (s.ghost.active) {
        const gUu = uAt(tbl, s.ghost.x);
        const gbx = toX(s.ghost.x);
        const gby = toY(Math.min(H_MAX, gUu));
        ctx.fillStyle = 'rgba(91,155,213,0.45)';
        ctx.beginPath();
        ctx.arc(gbx, gby, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(gbx, gby, 8, 0, 2 * Math.PI);
        ctx.stroke();
        label(ctx, 'ghost', gbx, gby - 14, BLUE);
      }

      // ── the primary ball ────────────────────────────────────────────────────
      ctx.fillStyle = WHITE;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = GOLD;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, 2 * Math.PI);
      ctx.stroke();

      // grab hint when paused / draggable
      if (!s.released || editRef.current) {
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(editRef.current ? 'drag the curve' : 'drag me, then Release', bx, by - 18);
      }

      // ── phase-space (x,v) inset ─────────────────────────────────────────────
      if (phaseRef.current) {
        drawPhaseInset(ctx, W, H, tbl, s, mNow, presetRef.current);
      }

      // publish readouts (light cadence handled by a separate interval reading roLive)
      roLive.K = K; roLive.U = U; roLive.E = Etot; roLive.therm = s.thermal;
      roLive.x = s.x; roLive.v = s.v; roLive.F = Fnow;
      roLive.Tperiod = shmInfo ? shmInfo.T : 0;
      roLive.Ucurv = shmInfo ? shmInfo.k : 0;

      raf = requestAnimationFrame(draw);
    };

    const roLive = { K: 0, U: 0, E: 0, therm: 0, x: 0, v: 0, F: 0, Tperiod: 0, Ucurv: 0 };
    const publish = setInterval(() => setRo({ ...roLive }), 90);

    resize();
    raf = requestAnimationFrame(draw);
    const obs = new ResizeObserver(resize);
    obs.observe(wrap);

    // ── pointer interaction: drag ball (place / set height) or edit curve ─────
    let dragging = false;
    let editIndex = -1;

    const pointerX = (e) => {
      const rect = canvas.getBoundingClientRect();
      return fromX ? fromX(e.clientX - rect.left) : 0;
    };
    const pointerPy = (e) => {
      const rect = canvas.getBoundingClientRect();
      return e.clientY - rect.top;
    };

    const onDown = (e) => {
      const wx = pointerX(e);
      const tbl = tblRef.current;
      const s = sim.current;
      if (editRef.current) {
        // grab the nearest integer control knob
        editIndex = Math.round(Math.max(XMIN + 1, Math.min(XMAX - 1, wx)));
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      // grab the ball if the pointer is near it (in x)
      if (Math.abs(wx - s.x) < 0.9) {
        dragging = true;
        s.released = false;
        s.v = 0;
        s.orbit = [];
        setRunning(true);
        canvas.setPointerCapture?.(e.pointerId);
      }
    };
    const onMove = (e) => {
      const tbl = tblRef.current;
      const s = sim.current;
      if (editRef.current && editIndex >= XMIN + 1) {
        // set U at nearby samples toward the pointer height, smoothed
        const py = pointerPy(e);
        const targetU = Math.max(0, Math.min(H_MAX, (groundYRef - py) / syRef));
        for (let i = 0; i < NS; i++) {
          const d = Math.abs(tbl.xs[i] - editIndex);
          const wgt = Math.exp(-(d * d) / (2 * 0.7 * 0.7)); // gaussian brush
          tbl.us[i] = tbl.us[i] * (1 - wgt) + targetU * wgt;
        }
        // ── re-freeze E0 so reshaping the curve never strands the ball above its
        // own E-line (which would read as negative K). Lift E0 to the ball's new
        // U if the ground rose under it; otherwise leave the frozen level. ──────
        const uHere = uAt(tbl, s.x);
        if (s.E0 < uHere) s.E0 = uHere;
        s.orbit = [];
        return;
      }
      if (!dragging) return;
      const wx = Math.max(XMIN + 0.1, Math.min(XMAX - 0.1, pointerX(e)));
      s.x = wx;
      s.v = 0;
      s.thermal = 0;
      s.E0 = uAt(tbl, wx); // hold the ball at rest on the curve → E = U here
    };
    const onUp = (e) => {
      if (dragging) {
        dragging = false;
        sim.current.released = true; // release → let it roll from rest at this height
      }
      editIndex = -1;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      clearInterval(publish);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── bar items for the shared EnergyBars grammar ────────────────────────────
  const barItems = useMemo(() => {
    const items = [
      { label: 'K', value: ro.K, color: GOLD },
      { label: 'U', value: ro.U, color: GOLD_SOFT },
    ];
    if (isDissip) items.push({ label: 'thermal', value: ro.therm, color: THERMAL });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ro.K, ro.U, ro.therm, isDissip]);

  const barMax = Math.max(ro.E, ro.K + ro.U + ro.therm, 1);

  const presetBtns = (
    <div className="mb-4">
      <div className="text-usna-text text-sm font-medium mb-2">Landscape</div>
      <div className="flex flex-col gap-1.5">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => { setPreset(key); setEditMode(false); if (key !== 'well') setGhostOn(false); }}
            className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
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
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {presetBtns}

        <Slider label="Mass (m)" value={mass} min={0.5} max={4} step={0.5} unit="kg" onChange={setMass} />

        {isDissip && (
          <Slider
            label="Friction (μ)"
            value={friction}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={setFriction}
          />
        )}

        <div className="mt-2 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={() => setRunning((r) => !r)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {running ? '❚❚ Pause' : '▶ Run'}
          </button>
          <button
            onClick={() => { seedBall(); setRunning(true); }}
            className="px-3 py-1.5 rounded text-sm bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            ↺ Re-drop ball
          </button>
          <button
            onClick={() => setEditMode((e) => !e)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              editMode
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {editMode ? '✎ Editing landscape' : '✎ Edit landscape'}
          </button>
          <span className="text-usna-muted text-xs">
            Drag the ball to a height, then release. In edit mode, drag the red knobs to reshape U(x).
          </span>
        </div>

        {/* ── visualization toggles ─────────────────────────────────────────── */}
        <div className="mt-2 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={() => setShowPhase((p) => !p)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              showPhase
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {showPhase ? '◉ Phase-space (x,v)' : '○ Phase-space (x,v)'}
          </button>
          <button
            onClick={() => setShowSHM((s) => !s)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              showSHM
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {showSHM ? '◉ Small-oscillation fit' : '○ Small-oscillation fit'}
          </button>
          <button
            onClick={() => setGhostOn((g) => !g)}
            disabled={preset !== 'well'}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              preset !== 'well'
                ? 'bg-usna-deep text-usna-muted border-usna-grid opacity-50 cursor-not-allowed'
                : ghostOn
                  ? 'bg-usna-gold text-usna-navy border-usna-gold'
                  : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {ghostOn ? '◉ Ghost race (double well)' : '○ Ghost race (double well)'}
          </button>
          {preset !== 'well' && (
            <span className="text-usna-muted text-xs">Ghost race needs the double-well landscape.</span>
          )}
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Position x" value={ro.x.toFixed(2)} unit="m" />
          <Readout label="Velocity v" value={ro.v.toFixed(2)} unit="m/s" />
          <Readout label="Force −dU/dx" value={ro.F.toFixed(2)} unit="N" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Kinetic K" value={ro.K.toFixed(2)} unit="J" />
            <Readout label="Potential U" value={ro.U.toFixed(2)} unit="J" />
            {isDissip && <Readout label="Thermal" value={ro.therm.toFixed(2)} unit="J" />}
            <Readout label="Total E" value={ro.E.toFixed(2)} unit="J" />
          </div>
          {showSHM && ro.Tperiod > 0 && (
            <div className="mt-2 pt-2 border-t border-usna-grid">
              <Readout label="Well stiffness U″" value={ro.Ucurv.toFixed(2)} unit="N/m" />
              <Readout label="SHM period T" value={ro.Tperiod.toFixed(2)} unit="s" />
            </div>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div
            ref={wrapRef}
            className="relative flex-1 min-w-0 overflow-hidden rounded-lg border border-usna-grid"
            style={{ height: 420, background: '#0D1321' }}
          >
            <canvas ref={canvasRef} className="block" />
          </div>
          <div className="bg-usna-card border border-usna-grid rounded-lg p-4 flex flex-col items-center justify-end shrink-0">
            <div className="text-usna-muted text-xs mb-2 self-start">Energy budget</div>
            <EnergyBars items={barItems} max={barMax} total={ro.E} height={330} unit="J" />
          </div>
        </div>
        <InfoPanel {...INFO[mode]} />
      </div>
    </div>
  );
}

// ── physics helper: rescale v so ½mv² + U = E0 exactly (μ=0 drift removal) ────
// Only touches speed, never direction, and never fires if there is essentially no
// motion (so a ball resting at a minimum is left alone). Because the wall bounce
// is now elastic, E0 stays the true frozen mechanical energy.
function reFreeze(b, tbl, m) {
  const U = uAt(tbl, b.x);
  const Kwant = b.E0 - U;
  if (Kwant <= 0) { b.v = 0; return; }        // at/above a turning point: stop
  const vWant = Math.sqrt((2 * Kwant) / m);
  if (Math.abs(b.v) < 1e-6) return;            // momentarily at rest: don't inject
  b.v = Math.sign(b.v) * vWant;
}

// ── drawing helpers (local; no shared-lib edits) ─────────────────────────────

// Force arrow drawn as a horizontal push along the surface (F = -dU/dx points
// "downhill"). Length scales with force magnitude; color = red for clarity.
function drawForceArrow(ctx, bx, by, F, sx) {
  if (Math.abs(F) < 1e-3) {
    // at equilibrium: draw a small "balanced" ring instead of an arrow
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 15, 0, 2 * Math.PI);
    ctx.stroke();
    return;
  }
  const len = Math.max(14, Math.min(70, Math.abs(F) * 12));
  const dir = Math.sign(F);
  const x2 = bx + dir * len;
  const y = by - 16; // float the arrow just above the ball
  ctx.strokeStyle = RED;
  ctx.fillStyle = RED;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  // arrowhead
  const ah = 7;
  ctx.beginPath();
  ctx.moveTo(x2, y);
  ctx.lineTo(x2 - dir * ah, y - ah * 0.7);
  ctx.lineTo(x2 - dir * ah, y + ah * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = RED;
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('F', (bx + x2) / 2, y - 6);
}

// Find local minima (stable ○) and maxima (unstable △) of the sampled U and mark
// them. Uses the sign change of the discrete slope.
function markExtrema(ctx, tbl, toX, toY) {
  const { minima, maxima } = findExtrema(tbl);
  for (const e of minima) {
    const px = toX(e.x), py = toY(Math.min(H_MAX, e.u));
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py + 16, 6, 0, 2 * Math.PI);
    ctx.stroke();
    label(ctx, 'stable', px, py + 36, GREEN);
  }
  for (const e of maxima) {
    const px = toX(e.x), py = toY(Math.min(H_MAX, e.u));
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, py - 22);
    ctx.lineTo(px - 6, py - 11);
    ctx.lineTo(px + 6, py - 11);
    ctx.closePath();
    ctx.stroke();
    label(ctx, 'unstable', px, py - 28, RED);
  }
}

// Turning points: where the frozen E-line crosses U(x). The ball cannot go past
// these — draw a bright vertical "wall" the ball visibly rebounds from.
function markTurningPoints(ctx, tbl, eLevel, toX, toY, faint = false) {
  const { xs, us } = tbl;
  const groundY = toY(0);
  for (let i = 1; i < NS; i++) {
    const a = us[i - 1] - eLevel;
    const b = us[i] - eLevel;
    if (a === 0 || (a < 0) !== (b < 0)) {
      // linear-interpolate the crossing x
      const t = a === b ? 0 : a / (a - b);
      const xcross = xs[i - 1] + t * tbl.dx;
      const px = toX(xcross), py = toY(eLevel);
      ctx.strokeStyle = faint ? 'rgba(91,155,213,0.35)' : '#5B9BD5';
      ctx.lineWidth = faint ? 1.5 : 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, groundY);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!faint) {
        ctx.fillStyle = '#5B9BD5';
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
        ctx.fill();
        label(ctx, 'turning pt', px, groundY - 6, '#5B9BD5');
      }
    }
  }
}

// ── small-oscillation (SHM) overlay ──────────────────────────────────────────
// Pick the stable minimum nearest the ball, fit U ≈ U0 + ½k(x−x0)² with
// k = U''(x0), draw the parabola dashed over the true curve, and return the
// predicted period T = 2π√(m/k). This is where SHM "emerges" from any well.
function drawSHMOverlay(ctx, tbl, ballX, m, toX, toY) {
  const { minima } = findExtrema(tbl);
  if (minima.length === 0) return null;
  // nearest minimum to the ball
  let best = minima[0], bd = Math.abs(minima[0].x - ballX);
  for (const e of minima) {
    const d = Math.abs(e.x - ballX);
    if (d < bd) { bd = d; best = e; }
  }
  const x0 = best.x, U0 = best.u;
  const k = curvatureAt(tbl, x0);      // U''(x0) = effective spring constant
  if (!(k > 0)) return null;

  // draw the fitted parabola over a window around x0 (dashed green)
  ctx.strokeStyle = 'rgba(127,183,126,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  const span = 2.2;                    // ± window (m) around the minimum
  let first = true;
  for (let xx = x0 - span; xx <= x0 + span; xx += 0.05) {
    if (xx < XMIN || xx > XMAX) continue;
    const u = U0 + 0.5 * k * (xx - x0) * (xx - x0);
    if (u > H_MAX) continue;
    const px = toX(xx), py = toY(u);
    if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  const px0 = toX(x0), py0 = toY(Math.min(H_MAX, U0));
  const T = 2 * Math.PI * Math.sqrt(m / k);
  label(ctx, `SHM  T=${T.toFixed(2)}s`, px0, py0 + 52, GREEN);
  return { T, k };
}

// ── phase-space (x,v) inset ──────────────────────────────────────────────────
// A small (x,v) plane in the top-right. We draw the theoretical constant-energy
// contour v(x) = ±√(2(E0−U)/m) (the closed orbit the ball must ride) plus the
// live dot + a fading trail. For the double well the contour naturally shows the
// two lobes / figure-8 separatrix; balanced on the hump the orbit collapses to a
// dot at the unstable fixed point.
function drawPhaseInset(ctx, W, H, tbl, s, m, preset) {
  const iw = Math.min(150, W * 0.34);
  const ih = Math.min(112, H * 0.34);
  const ox = W - iw - 22;          // top-right, inside the frame
  const oy = 30;
  const pad = 10;
  const plotL = ox + pad, plotR = ox + iw - pad;
  const plotT = oy + pad, plotB = oy + ih - pad;

  // panel background
  ctx.fillStyle = 'rgba(13,19,33,0.86)';
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillRect(ox, oy, iw, ih);
  ctx.strokeRect(ox, oy, iw, ih);

  // velocity scale: symmetric range that comfortably holds the current orbit
  const E = s.E0;
  // max |v| anywhere the orbit can reach (min U on the allowed set)
  let umin = Infinity;
  for (let i = 0; i < NS; i++) if (tbl.us[i] < umin) umin = tbl.us[i];
  const vMax = Math.max(0.5, Math.sqrt(Math.max(0, 2 * (E - umin) / m)) * 1.15);

  const xToP = (x) => plotL + ((x - XMIN) / (XMAX - XMIN)) * (plotR - plotL);
  const vToP = (v) => (plotT + plotB) / 2 - (v / vMax) * ((plotB - plotT) / 2);

  // axes (v=0 line, x-center faint)
  ctx.strokeStyle = 'rgba(240,236,227,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotL, vToP(0)); ctx.lineTo(plotR, vToP(0));
  ctx.stroke();

  // constant-energy contour v = ±√(2(E−U)/m): the closed orbit the ball rides.
  ctx.strokeStyle = 'rgba(197,183,131,0.85)';
  ctx.lineWidth = 1.5;
  for (const sign of [1, -1]) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < NS; i++) {
      const arg = 2 * (E - tbl.us[i]) / m;
      if (arg <= 0) { pen = false; continue; }   // classically forbidden → lift pen
      const v = sign * Math.sqrt(arg);
      const px = xToP(tbl.xs[i]), py = vToP(v);
      if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // fading (x,v) trail from the live integration
  const orbit = s.orbit;
  for (let i = 1; i < orbit.length; i++) {
    const alpha = (i / orbit.length) * 0.6;
    ctx.strokeStyle = `rgba(91,155,213,${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xToP(orbit[i - 1][0]), vToP(orbit[i - 1][1]));
    ctx.lineTo(xToP(orbit[i][0]), vToP(orbit[i][1]));
    ctx.stroke();
  }

  // live dot
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(xToP(s.x), vToP(s.v), 3.5, 0, 2 * Math.PI);
  ctx.fill();

  // title
  ctx.fillStyle = MUTED;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('phase space (x, v)', ox + 4, oy + ih - 3);
}

function label(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

// ── per-mode info copy naming the counterintuitive moment ────────────────────
const INFO = {
  default: {
    title: 'Energy Landscape: K and U trade, E stays put',
    description:
      'The ball rolls under the force from the landscape itself — the force is the negative slope of U(x), so where the curve is steep the ball accelerates hard, and where it is flat it coasts. Drag the ball to a height and release: the K bar and the U bar swap heights continuously, but the total-E bar (and the dashed E-line across the landscape) never budge. The two-tone bar at the ball splits that E-line into U below and K above, so K is literally the gap up to the E-line. Open the phase-space inset to watch the motion trace one closed orbit — an ellipse for the bowl. The ball trades all its energy back and forth forever, rising to exactly the same height on each side.',
    equation: String.raw`F = -\frac{dU}{dx}, \qquad E = K + U = \text{const}`,
  },
  equilibria: {
    title: 'Equilibria & turning points',
    description:
      'The red arrow is the force F = -dU/dx: it always points downhill, and it vanishes wherever the curve is flat. Minima (○) are stable — nudge the ball and the force pushes it back. Maxima (△) are unstable. The blue dashed walls are the turning points where the E-line meets U(x); the ball physically cannot cross them. Turn on "Small-oscillation fit" to see SHM emerge from the bottom of any stable well (T = 2π√(m/U″)). THE MOMENT: run the ghost race — two balls dropped a hair apart on the hump follow the figure-8 separatrix in the phase inset and then commit to opposite wells; the peak is an unstable equilibrium and the tiniest difference decides everything.',
    equation: String.raw`\text{equilibrium: } \frac{dU}{dx}=0 \quad\Rightarrow\quad \frac{d^2U}{dx^2}>0\ \text{stable},\ <0\ \text{unstable}`,
  },
  dissipation: {
    title: 'Friction: mechanical energy becomes heat',
    description:
      'Turn up the friction slider and watch a third bar grow. Kinetic + potential energy no longer stays constant — the K and U bars shrink swing after swing as their energy bleeds into the THERMAL bar. But add all three together and the total is flat again: energy is conserved, it has just left the mechanical account. In the phase-space inset the orbit spirals inward toward a stable minimum instead of closing. The ball spirals down and finally comes to rest in the nearest minimum, unable to climb back out because that climb-energy is now heat.',
    equation: String.raw`K + U + E_{\text{thermal}} = \text{const}, \qquad \frac{d}{dt}(K+U) = -\,|F_{\text{fric}}\, v|`,
  },
};
