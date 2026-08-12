import { useState, useMemo, useEffect, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { stackedTimeLayout } from '@shared/lib/linkedPlots';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * D24 · Rotational Kinematics Grapher — L24 (default).
 *
 * The ANGULAR twin of D01 (1D Motion Grapher). Same machinery, Greek letters:
 * three time-synchronized panels stacked in one figure — θ(t), ω(t), α(t) —
 * sharing a single time axis so a scrub line spans all three. The rotation is
 * built by numerically integrating α(t) (cumulative trapezoid), so every preset
 * flows through the same pipeline and the three curves are guaranteed
 * consistent (ω = ∫α, θ = ∫ω) — exactly as v = ∫a, x = ∫v in week 1.
 *
 *   default : pick a preset spin; scrub/play the timeline and read θ, ω, α.
 *             A small spinning disk is synced to the scrub time with two painted
 *             dots — one on the rim (radius r) and one at half the radius. Both
 *             share the SAME ω, but the rim dot moves at twice the linear speed
 *             (v = r·ω). That connects the angular story back to the linear one.
 *
 * The default export is a hook-free wrapper that dispatches to a per-mode child
 * (RULES OF HOOKS): the child owns every hook. `mode` is kept parallel to D01 so
 * the router contract is honoured even though this demo only ships 'default'.
 *
 * THE MOMENT: everything you learned in week 1 is about to happen again with
 * Greek letters — and the disk shows that one ω gives every point its own v.
 *
 * This pass adds four things without disturbing the moment:
 *   • FIX  the rim velocity arrow now respects the SIGN of ω (reverses for ω<0).
 *   • WOW  a D01↔D24 "ghost overlay": the Latin x/v/a twin (same preset shape,
 *          numerically identical because the pipeline is the same) is drawn dim
 *          behind the Greek θ/ω/α, so the isomorphism lands in one figure.
 *   • INTERACT  "flick the disk": drag the rim to spin it and the demo records
 *          your hand's angular velocity, then rebuilds θ/ω/α from YOUR motion.
 *   • PHYSICS  shade the area under ω(t) up to the scrub (= θ, annotated) and
 *          draw the tangent-slope triangle on θ(t) (slope = ω) — D01's area
 *          grammar, in Greek.
 *   • CUSTOMIZE  a rim-radius slider: v_rim scales linearly while ω is the
 *          untouched shared invariant.
 */

const T = 10;          // total time window (s)
const N = 400;         // samples across the window
const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';

// Presets are the angular mirrors of D01's motion presets. The `label` and the
// integrated θ/ω/α curves double as the Latin twin (x/v/a) for the ghost
// overlay — the numbers are identical because both flow through one integrator,
// which is precisely the isomorphism we want students to see.
const PRESETS = {
  'constant-w': {
    label: 'Constant ω (α = 0)',
    theta0: 0, omega0: 2.0, alpha: () => 0,
  },
  'constant-a': {
    label: 'Constant α (spin-up)',
    theta0: 0, omega0: 0, alpha: () => 1.0,
  },
  'spin-brake': {
    label: 'Spin-up, then brake',
    theta0: 0, omega0: 0,
    // accelerate for the first half, then a stronger brake — the L24 twist:
    // ω keeps rising until α flips, and θ keeps *increasing* even while braking
    // (right up until ω reaches zero), just like "up and back" in D01.
    alpha: (t) => (t < T / 2 ? 1.6 : -1.6),
  },
};

// Build t, θ, ω, α arrays by integrating α(t) (cumulative trapezoid).
// Identical structure to D01's integrate() — that is the whole point.
function integrate(theta0, omega0, alphaFn) {
  const dt = T / (N - 1);
  const t = new Array(N), a = new Array(N), w = new Array(N), th = new Array(N);
  for (let i = 0; i < N; i++) {
    t[i] = i * dt;
    a[i] = alphaFn(t[i]);
  }
  w[0] = omega0; th[0] = theta0;
  for (let i = 1; i < N; i++) {
    w[i] = w[i - 1] + 0.5 * (a[i] + a[i - 1]) * dt;
    th[i] = th[i - 1] + 0.5 * (w[i] + w[i - 1]) * dt;
  }
  return { t, th, w, a };
}

// Given a raw ω(t) sample stream (from a flick), resample onto the canonical
// N-point grid and re-derive θ (= ∫ω) and α (= dω/dt) by the SAME trapezoid /
// finite-difference rules used above, so a hand-driven spin is a first-class
// preset that obeys ω = ∫α, θ = ∫ω exactly like the built-ins.
function motionFromOmega(omegaGrid) {
  const dt = T / (N - 1);
  const t = new Array(N), th = new Array(N), a = new Array(N);
  th[0] = 0;
  for (let i = 0; i < N; i++) t[i] = i * dt;
  for (let i = 1; i < N; i++) {
    th[i] = th[i - 1] + 0.5 * (omegaGrid[i] + omegaGrid[i - 1]) * dt;
  }
  // α by central difference (forward/backward at the ends).
  for (let i = 0; i < N; i++) {
    if (i === 0) a[i] = (omegaGrid[1] - omegaGrid[0]) / dt;
    else if (i === N - 1) a[i] = (omegaGrid[N - 1] - omegaGrid[N - 2]) / dt;
    else a[i] = (omegaGrid[i + 1] - omegaGrid[i - 1]) / (2 * dt);
  }
  return { t, th, w: omegaGrid, a };
}

// Linearly interpolate a motion's θ/ω at a continuous time t (s), so the disk can
// play back smoothly between the N discrete samples instead of stepping.
function sampleAt(motion, t) {
  const f = Math.max(0, Math.min(N - 1, (t / T) * (N - 1)));
  const i0 = Math.floor(f);
  const i1 = Math.min(N - 1, i0 + 1);
  const frac = f - i0;
  return {
    th: motion.th[i0] + frac * (motion.th[i1] - motion.th[i0]),
    w: motion.w[i0] + frac * (motion.w[i1] - motion.w[i0]),
  };
}

const DEFAULTS = { preset: 'spin-brake', radius: 0.5 };

// ── hook-free wrapper: dispatch to the per-mode child (owns all hooks) ────────
export default function RotationGrapher({ mode = 'default' }) {
  // Only 'default' ships today; the switch keeps the door open without ever
  // calling a hook conditionally in this wrapper.
  switch (mode) {
    case 'default':
    default:
      return <DefaultMode />;
  }
}

function DefaultMode() {
  const [preset, setPreset] = useState(DEFAULTS.preset);
  const [scrub, setScrub] = useState(0);      // current time on the timeline (s)
  const [playing, setPlaying] = useState(false);
  const [radius, setRadius] = useState(DEFAULTS.radius); // rim radius R (m)
  const [showGhost, setShowGhost] = useState(false);     // D01 Latin twin overlay
  const [showArea, setShowArea] = useState(false);       // ∫ω = θ / slope = ω grammar
  const [flick, setFlick] = useState(null);              // hand-driven motion (or null)

  const reset = () => {
    setPreset(DEFAULTS.preset); setScrub(0); setPlaying(false);
    setRadius(DEFAULTS.radius); setShowGhost(false); setShowArea(false);
    setFlick(null);
    tRef.current = 0;
  };

  // The rotation for the current preset — unless the student has flicked the
  // disk, in which case their recorded motion wins.
  const motion = useMemo(() => {
    if (flick) return flick;
    const p = PRESETS[preset];
    return integrate(p.theta0, p.omega0, p.alpha);
  }, [preset, flick]);

  // Play: a continuous rAF clock sweeps the window in ~6 s. It advances tRef every
  // frame (the disk draw loop reads it for smooth 60 fps motion) and pushes the
  // React scrub at ~30 fps, which is plenty for the plot cursor without thrashing
  // Plotly. Manual scrubbing and reset keep tRef in sync (see below).
  useEffect(() => {
    if (!playing) return;
    tRef.current = scrubRef.current; // resume from wherever the scrub sits
    let raf, last, lastPush = 0;
    const sweep = T / 6; // time-units per real second → ~6 s to cross the window
    const tick = (nowMs) => {
      if (last === undefined) last = nowMs;
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      tRef.current += dt * sweep;
      if (tRef.current >= T) tRef.current = 0; // loop
      if (nowMs - lastPush > 33) { lastPush = nowMs; setScrub(tRef.current); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Sample the motion at the scrub time.
  const idx = Math.max(0, Math.min(N - 1, Math.round((scrub / T) * (N - 1))));
  const now = { t: motion.t[idx], th: motion.th[idx], w: motion.w[idx], a: motion.a[idx] };

  // Linear quantities of the painted dots (same ω, different r → different v).
  // Rim radius R is now a slider: v_rim scales, ω is untouched.
  const R = radius;
  const vRim = R * now.w;          // rim dot: r = R
  const vHalf = (R / 2) * now.w;   // inner dot: r = R/2 → exactly half the speed
  const revs = now.th / (2 * Math.PI);

  // Running area under ω up to the scrub (= θ, by construction), and the local
  // slope of θ (= ω). These power the annotated area/slope grammar on the plot.
  const areaOmega = motion.th[idx] - motion.th[0]; // ∫₀ᵗ ω dt  == Δθ
  const slopeTheta = now.w;                          // dθ/dt     == ω

  // ── canvas: spinning disk synced to the scrub angle ────────────────────────
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  // Publish live values to refs so the rAF loop reads them without React
  // re-subscribing every frame (avoids per-frame churn, per the canvas pattern).
  const angleRef = useRef(now.th);
  angleRef.current = now.th;
  const omegaRef = useRef(now.w);
  omegaRef.current = now.w;
  // Rim velocity arrow length (px, ∝ |v_rim|), capped for the canvas.
  const rimArrowLenRef = useRef(0);
  rimArrowLenRef.current = Math.min(70, Math.abs(vRim) * 12);
  // Live refs so the rAF draw loop can run a continuous 60 fps play clock without
  // re-subscribing: it samples the current motion at a smoothly advancing time
  // instead of snapping to the ~30 fps React scrub state (which drives the plot).
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;
  const tRef = useRef(0); // continuous play-clock time (s), owned by the play loop

  // ── flick capture: drag the rim to spin the disk directly ──────────────────
  // While dragging we integrate the pointer's angular velocity into a live
  // "recording" of ω(t); on release we resample it into a full motion object.
  const draggingRef = useRef(false);
  const lastRef = useRef(null);   // { ang, t } of the previous pointer sample
  const recRef = useRef(null);    // { ts:[], ws:[], ang } during a flick
  const geomRef = useRef({ cx: 0, cy: 0, rimPx: 1 }); // canvas geometry for hit-test
  const [flicking, setFlicking] = useState(false);    // UI hint while dragging

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    let ctx, W = 0, H = 0, raf;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      const cx = W / 2;
      const cy = H / 2;
      const rimPx = Math.min(W, H) * 0.40; // pixels for r = R
      const halfPx = rimPx / 2;            // pixels for r = R/2
      geomRef.current = { cx, cy, rimPx };
      // Pick the angle/ω to draw: a live flick wins; during playback we sample the
      // motion at the smooth play-clock time (60 fps, not the 30 fps scrub state);
      // when paused or scrubbing we use the scrub-derived values.
      let ang, om;
      if (draggingRef.current && recRef.current) {
        ang = recRef.current.ang;
        om = recRef.current.liveW || 0;
      } else if (playingRef.current) {
        const s = sampleAt(motionRef.current, tRef.current);
        ang = s.th; om = s.w;
      } else {
        ang = angleRef.current; om = omegaRef.current;
      }

      // background
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B1220';
      ctx.fillRect(0, 0, W, H);

      // disk body
      ctx.beginPath();
      ctx.arc(cx, cy, rimPx, 0, Math.PI * 2);
      ctx.fillStyle = draggingRef.current ? 'rgba(197,183,131,0.14)' : 'rgba(91,155,213,0.10)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = draggingRef.current ? 'rgba(197,183,131,0.7)' : 'rgba(240,236,227,0.35)';
      ctx.stroke();

      // inner reference ring at r = R/2
      ctx.beginPath();
      ctx.arc(cx, cy, halfPx, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(240,236,227,0.18)';
      ctx.stroke();

      // radius spoke from centre to the rim dot (shows the angular sweep)
      const rx = cx + rimPx * Math.cos(-ang); // canvas y is down → negate angle
      const ry = cy + rimPx * Math.sin(-ang);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(rx, ry);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(197,183,131,0.55)';
      ctx.stroke();

      // hub
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = GOLD;
      ctx.fill();

      // inner painted dot at r = R/2 (blue) — half the linear speed
      const hx = cx + halfPx * Math.cos(-ang);
      const hy = cy + halfPx * Math.sin(-ang);
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.fillStyle = BLUE;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#F0ECE3';
      ctx.stroke();

      // rim painted dot at r = R (gold) — full linear speed
      ctx.beginPath();
      ctx.arc(rx, ry, 8, 0, Math.PI * 2);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#F0ECE3';
      ctx.stroke();

      // tangential velocity arrows (perpendicular to the spoke), length ∝ |v|.
      // Both dots share the same ω, but the rim arrow is twice as long (v = r·ω).
      // FIX: the arrow direction now follows the SIGN of ω — for ω<0 the tangent
      // reverses, so a braking/reversing disk shows a correctly flipped v arrow.
      const arrowLen = (draggingRef.current || playingRef.current)
        ? Math.min(70, Math.abs(radiusRef.current * om) * 12)
        : rimArrowLenRef.current;
      const spin = om >= 0 ? 1 : -1;
      drawTangentArrow(ctx, rx, ry, ang, arrowLen, spin, GOLD);
      drawTangentArrow(ctx, hx, hy, ang, arrowLen / 2, spin, BLUE);

      // flick hint
      if (draggingRef.current) {
        ctx.fillStyle = 'rgba(240,236,227,0.85)';
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`ω = ${om.toFixed(2)} rad/s`, cx, H - 12);
      } else {
        ctx.fillStyle = 'rgba(197,183,131,0.6)';
        ctx.font = '11px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('drag the rim to flick the disk', cx, H - 12);
      }

      raf = requestAnimationFrame(draw);
    };

    // ---- pointer handlers for the flick ----
    const angleAt = (e) => {
      const rect = canvas.getBoundingClientRect();
      const { cx, cy } = geomRef.current;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Screen y is down; negate to recover the math-convention angle used above.
      return Math.atan2(-(py - cy), px - cx);
    };
    const withinRim = (e) => {
      const rect = canvas.getBoundingClientRect();
      const { cx, cy, rimPx } = geomRef.current;
      const dx = (e.clientX - rect.left) - cx;
      const dy = (e.clientY - rect.top) - cy;
      const d = Math.hypot(dx, dy);
      return d > rimPx * 0.35 && d < rimPx * 1.25; // grab the rim annulus
    };
    // Shortest signed angular step, so crossing ±π doesn't spike ω.
    const wrapDelta = (d) => {
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    };

    const onDown = (e) => {
      if (!withinRim(e)) return;
      e.preventDefault();
      setPlaying(false);
      draggingRef.current = true;
      setFlicking(true);
      const ang = angleAt(e);
      lastRef.current = { ang, t: performance.now() };
      recRef.current = { ts: [0], ws: [0], ang, liveW: 0, t0: performance.now() };
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const now2 = performance.now();
      const ang = angleAt(e);
      const prev = lastRef.current;
      const dtSec = Math.max(1e-3, (now2 - prev.t) / 1000);
      const dAng = wrapDelta(ang - prev.ang);
      const w = dAng / dtSec;                 // instantaneous hand ω
      const rec = recRef.current;
      rec.ang += dAng;                        // unwrapped cumulative angle to draw
      rec.liveW = w;
      const relT = (now2 - rec.t0) / 1000;
      if (relT <= T) { rec.ts.push(relT); rec.ws.push(w); }
      lastRef.current = { ang, t: now2 };
    };
    const finishFlick = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setFlicking(false);
      canvas.releasePointerCapture?.(e?.pointerId);
      const rec = recRef.current;
      recRef.current = null;
      if (!rec || rec.ts.length < 3) return;  // ignore a tap
      // Resample the recorded (t, ω) samples onto the canonical N-point grid via
      // linear interpolation; beyond the last sample ω holds (a free spin), and
      // gentle smoothing tames pointer jitter so α (= dω/dt) stays readable.
      const grid = resampleOmega(rec.ts, rec.ws);
      setFlick(motionFromOmega(grid));
      setScrub(0);
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', finishFlick);
    canvas.addEventListener('pointercancel', finishFlick);
    canvas.addEventListener('pointerleave', finishFlick);

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', finishFlick);
      canvas.removeEventListener('pointercancel', finishFlick);
      canvas.removeEventListener('pointerleave', finishFlick);
    };
  }, []);

  // ── traces (θ top, ω middle, α bottom) ─────────────────────────────────────
  const line = (y, yaxis, color, extra = {}) => ({
    x: motion.t, y, type: 'scatter', mode: 'lines', line: { color, width: 2.5, ...extra }, yaxis, hoverinfo: 'skip',
  });
  const dot = (val, yaxis, color) => ({
    x: [now.t], y: [val], type: 'scatter', mode: 'markers',
    marker: { color: '#FFFFFF', size: 8, line: { color, width: 2 } }, yaxis, hoverinfo: 'skip',
  });
  // Area fill under a curve up to the scrub (D01's area grammar, in Greek).
  const areaFill = (arr, yaxis, color) => ({
    x: motion.t.slice(0, idx + 1), y: arr.slice(0, idx + 1),
    type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tozeroy',
    fillcolor: color, yaxis, hoverinfo: 'skip',
  });

  const traces = [];

  // WOW — D01 ghost: the Latin twin x/v/a is numerically identical to θ/ω/α
  // (same integrator, same preset shape), so we plot the very same arrays dimmed
  // and dashed BEHIND the Greek curves. Same figure, both alphabets: v is the
  // slope of x exactly as ω is the slope of θ.
  if (showGhost) {
    traces.push(
      line(motion.th, 'y3', 'rgba(240,236,227,0.30)', { dash: 'dot', width: 2 }), // x-ghost
      line(motion.w, 'y2', 'rgba(240,236,227,0.30)', { dash: 'dot', width: 2 }),  // v-ghost
      line(motion.a, 'y', 'rgba(240,236,227,0.30)', { dash: 'dot', width: 2 }),   // a-ghost
    );
  }

  // PHYSICS — area under ω(t) = θ (shaded on the ω panel).
  if (showArea) {
    traces.push(areaFill(motion.w, 'y2', 'rgba(91,155,213,0.28)'));
    // Tangent-slope triangle on θ(t): slope of the hypotenuse = ω(scrub).
    traces.push(...tangentTriangle(now.t, now.th, slopeTheta, 'y3'));
  }

  traces.push(
    line(motion.th, 'y3', GOLD),
    line(motion.w, 'y2', BLUE),
    line(motion.a, 'y', GREEN),
    dot(now.th, 'y3', GOLD),
    dot(now.w, 'y2', BLUE),
    dot(now.a, 'y', GREEN),
  );

  // Base stacked layout from the shared lib (panels top→bottom).
  const layout = stackedTimeLayout(
    [
      { title: 'θ (rad)', color: GOLD },
      { title: 'ω (rad/s)', color: BLUE },
      { title: 'α (rad/s²)', color: GREEN },
    ],
    { tMax: T, scrubT: now.t },
  );
  // The shared IntensityPlot base sets yaxis.range=[0,1.05]; clear it on every
  // panel so each θ/ω/α axis autoranges to physical values.
  ['yaxis', 'yaxis2', 'yaxis3'].forEach((k) => {
    layout[k] = { ...layout[k], range: undefined, autorange: true };
  });
  layout.showlegend = false;

  // Annotations for the area/slope grammar (Greek edition of D01's ∫ / slope).
  if (showArea) {
    layout.annotations = [
      {
        xref: 'x', yref: 'y2', x: now.t * 0.5, y: 0,
        text: `∫ω dt = θ = ${areaOmega.toFixed(2)} rad`, showarrow: false,
        font: { color: '#DCE6F0', size: 12 }, yshift: 14,
      },
      {
        xref: 'x', yref: 'y3', x: now.t, y: now.th,
        text: `slope = ω = ${slopeTheta.toFixed(2)} rad/s`, showarrow: true,
        arrowcolor: 'rgba(240,236,227,0.5)', ax: -46, ay: -26,
        font: { color: '#F0ECE3', size: 12 },
      },
    ];
  }
  // Ghost legend note when the twin is on.
  if (showGhost) {
    layout.annotations = [
      ...(layout.annotations || []),
      {
        xref: 'paper', yref: 'paper', x: 0.99, y: 1.0, xanchor: 'right', yanchor: 'top',
        text: '···· Latin twin (x, v, a)', showarrow: false,
        font: { color: 'rgba(240,236,227,0.55)', size: 11 },
      },
    ];
  }

  const presetBtns = (
    <div className="mb-4">
      <div className="text-usna-text text-sm font-medium mb-2">Preset spin</div>
      <div className="flex flex-col gap-1.5">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => { setFlick(null); setPreset(key); }}
            className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
              preset === key && !flick
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setFlick(null)}
          disabled={!flick}
          className={`px-3 py-1.5 rounded text-xs text-left border transition-colors ${
            flick
              ? 'bg-usna-deep text-usna-gold border-usna-gold'
              : 'bg-usna-deep text-usna-muted border-usna-grid opacity-60 cursor-not-allowed'
          }`}
        >
          {flick ? '↺ Your flick (tap to clear)' : 'flick the disk to record your own'}
        </button>
      </div>
    </div>
  );

  const toggleRow = (label, on, setOn, hint) => (
    <button
      onClick={() => setOn((v) => !v)}
      className={`w-full px-3 py-1.5 rounded text-sm text-left border transition-colors ${
        on
          ? 'bg-usna-gold text-usna-navy border-usna-gold'
          : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
      }`}
    >
      <span className="font-medium">{on ? '✓ ' : ''}{label}</span>
      {hint && <span className={`block text-xs ${on ? 'text-usna-navy' : 'text-usna-muted'}`}>{hint}</span>}
    </button>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {presetBtns}

        <div className="mt-1 flex flex-col gap-1.5">
          {toggleRow('D01 ghost overlay', showGhost, setShowGhost, 'dim Latin x/v/a behind Greek θ/ω/α')}
          {toggleRow('Area = θ · slope = ω', showArea, setShowArea, '∫ω dt under ω(t); tangent on θ(t)')}
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <span className="text-usna-muted text-xs">scrub the timeline</span>
          </div>
          <Slider label="Time (t)" value={Number(scrub.toFixed(1))} min={0} max={T} step={0.1} unit="s"
                  onChange={(v) => { setPlaying(false); setScrub(v); tRef.current = v; }} />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Slider label="Rim radius (r)" value={radius} min={0.2} max={1.0} step={0.05} unit="m"
                  onChange={setRadius} />
          <div className="text-usna-muted text-xs -mt-1">v_rim scales with r; ω is the shared invariant.</div>
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Angle θ" value={now.th.toFixed(2)} unit="rad" />
          <Readout label="  = revolutions" value={revs.toFixed(2)} unit="rev" />
          <Readout label="Angular velocity ω" value={now.w.toFixed(2)} unit="rad/s" />
          <Readout label="Angular accel. α" value={now.a.toFixed(2)} unit="rad/s²" />
        </div>

        <div className="mt-2 pt-2 border-t border-usna-grid">
          <div className="text-usna-muted text-xs mb-1">Linear speed of the painted dots (same ω)</div>
          <Readout label={`Rim dot  (r = ${R.toFixed(2)} m)`} value={vRim.toFixed(2)} unit="m/s" />
          <Readout label={`Inner dot (r = ${(R / 2).toFixed(2)} m)`} value={vHalf.toFixed(2)} unit="m/s" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 460 }}>
          <IntensityPlot traces={traces} layoutOverrides={layout} />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div
            ref={wrapRef}
            className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
            style={{ height: 260, flex: '1 1 0%', touchAction: 'none' }}
          >
            <canvas ref={canvasRef} className="block" style={{ touchAction: 'none', cursor: flicking ? 'grabbing' : 'grab' }} />
          </div>
          <div className="bg-usna-card border border-usna-grid rounded-lg p-4 sm:w-56 flex flex-col justify-center gap-2">
            <div className="text-usna-text text-sm font-medium mb-1">One ω, two speeds</div>
            <div className="flex items-center gap-2 text-sm font-mono">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: GOLD }} />
              <span className="text-usna-text">rim · v = {vRim.toFixed(2)} m/s</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-mono">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: BLUE }} />
              <span className="text-usna-text">inner · v = {vHalf.toFixed(2)} m/s</span>
            </div>
            <div className="text-usna-muted text-xs mt-1">
              Both dots share the disk's single ω, yet the rim dot travels twice as
              far each turn, because v = r·ω. Drag the rim to flick your own spin.
            </div>
          </div>
        </div>

        <InfoPanel {...INFO} />
      </div>
    </div>
  );
}

// Resample scattered (t, ω) flick samples onto the canonical N-point grid.
// Linear interpolation between samples; ω holds at the last recorded value past
// the final sample (a hand let go → the disk coasts); a light moving-average
// smooth tames pointer jitter so the derived α stays legible.
function resampleOmega(ts, ws) {
  const dt = T / (N - 1);
  const grid = new Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    while (j < ts.length - 1 && ts[j + 1] < t) j++;
    if (t <= ts[0]) {
      grid[i] = ws[0];
    } else if (t >= ts[ts.length - 1]) {
      grid[i] = ws[ws.length - 1];
    } else {
      const t0 = ts[j], t1 = ts[j + 1];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      grid[i] = ws[j] + f * (ws[j + 1] - ws[j]);
    }
  }
  // 5-point moving average (edge-clamped) to remove sampling spikes.
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) {
      const m = i + k;
      if (m >= 0 && m < N) { s += grid[m]; c++; }
    }
    out[i] = s / c;
  }
  return out;
}

// Build the tangent-slope triangle on θ(t) at the scrub: a short run Δt to the
// left, the corresponding rise (slope·Δt), returned as three thin scatter traces
// (rise, run, hypotenuse) — the Greek twin of D01's slope grammar.
function tangentTriangle(t, theta, slope, yaxis) {
  const run = Math.min(1.4, Math.max(0.4, t * 0.25)); // a readable base
  const t0 = t - run;
  const rise = slope * run;
  const y0 = theta - rise;
  const col = 'rgba(240,236,227,0.75)';
  const base = { type: 'scatter', mode: 'lines', line: { color: col, width: 1.5 }, yaxis, hoverinfo: 'skip' };
  return [
    { ...base, x: [t0, t], y: [y0, y0] },                       // run (horizontal)
    { ...base, x: [t, t], y: [y0, theta] },                     // rise (vertical)
    { ...base, x: [t0, t], y: [y0, theta], line: { color: col, width: 1.5, dash: 'dash' } }, // hypotenuse
  ];
}

// Draw a tangential velocity arrow at a dot, perpendicular to its radius.
// `spin` is the SIGN of ω (+1 CCW, −1 CW): for CCW we rotate the outward radial
// by +90° in screen space; for CW we reverse it, so the arrow always points the
// way the point is actually moving. (FIX: previously hard-coded to CCW.)
function drawTangentArrow(ctx, px, py, ang, len, spin, color) {
  if (len < 1) return;
  const s = spin >= 0 ? 1 : -1;
  // Tangent for CCW at screen angle -ang: rotate radial (cos(-ang), sin(-ang))
  // by +90° in screen space → (sin(-ang), -cos(-ang)); multiply by s for CW.
  const ux = s * Math.sin(-ang);
  const uy = s * -Math.cos(-ang);
  const ex = px + ux * len;
  const ey = py + uy * len;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ex, ey);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  // arrowhead
  const head = 7;
  const back = Math.atan2(uy, ux);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - head * Math.cos(back - 0.4), ey - head * Math.sin(back - 0.4));
  ctx.lineTo(ex - head * Math.cos(back + 0.4), ey - head * Math.sin(back + 0.4));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

const INFO = {
  title: 'Week one again, in Greek letters',
  description:
    'Angle, angular velocity, and angular acceleration share one time axis, so the derivative relationships that governed x, v, and a carry over unchanged: ω is the slope of θ, α is the slope of ω, and θ is the accumulated area under ω. Turn on the D01 ghost overlay and the Latin twin (x, v, a) appears as the same figure dimmed behind the Greek curves, so the correspondence is visible directly. Turn on "Area = θ, slope = ω" to shade ∫ω dt under ω(t), which equals θ, and to draw the tangent-slope triangle on θ(t), whose slope is ω, the same area grammar as week one. On "Spin-up, then brake," α flips sign at the midpoint, yet θ keeps increasing until ω reaches zero, just like "up and back" in 1D motion. The spinning disk ties this back to linear motion: both painted dots share the disk\'s single ω, but the rim dot moves at twice the linear speed of the inner dot because v = r·ω. Slide the rim radius and v_rim scales while ω does not, or drag the rim to record your own angular velocity and rebuild θ/ω/α from that motion.',
  equation: String.raw`\omega = \frac{d\theta}{dt}, \quad \alpha = \frac{d\omega}{dt}, \quad \theta = \int_0^t \omega\,dt, \quad v = r\,\omega`,
};
