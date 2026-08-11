import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import EnergyBars from '@shared/components/EnergyBars';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * D35 · SHM Explorer — L35 (spring), L36 (pendulum).
 *
 * Two faces of simple harmonic motion, each its own child component so the
 * hook sets never collide (the default export is a hook-free wrapper that just
 * branches on mode — see FreeFall's pattern).
 *
 *   spring   : a mass on an ideal spring. k and m set ω = √(k/m) and therefore
 *              the period T = 2π√(m/k); the amplitude slider moves the mass
 *              farther but leaves T untouched. THE MOMENT: bigger swings do NOT
 *              take longer (isochronism) — the readout says so, and the phase-
 *              space ellipse just grows without changing its "orbital" rate.
 *              A rotating-disk shadow shows SHM as the projection of uniform
 *              circular motion. K/U trade on the shared EnergyBars while their
 *              sum stays pinned to E = ½kA². A second GHOST mass at a smaller
 *              amplitude, released simultaneously, stays perfectly in step — the
 *              isochronism made visual. A light damping slider adds an
 *              exponential envelope e^(−γt); the swings decay but the period
 *              stays fixed (still amplitude-independent). Drag the mass on the
 *              canvas to set the amplitude directly.
 *
 *   pendulum : a simple pendulum integrated from the FULL nonlinear equation
 *              θ'' = −(g/L) sin θ (RK4) — never small-angled. A ghost overlay
 *              plays the small-angle prediction T₀ = 2π√(L/g) in lockstep. At
 *              5° the two are indistinguishable; by 45° the real bob visibly
 *              lags — this is exactly where the spring's isochronism finally
 *              breaks. Physical-pendulum presets (rod about end, hoop about rim)
 *              swap in an I-based period T = 2π√(I/mgd). A gravity selector
 *              (Earth / Moon / Jupiter) rescales T₀ = 2π√(L/g) — clocks run slow
 *              on the Moon. A "race" mode releases a 10° and a 60° bob of the
 *              SAME length together; they drift out of phase over ~10 swings.
 *              Drag the bob to set the release angle directly.
 *
 * FIX (phase teleport): the spring now tracks phase INCREMENTALLY
 * (phase += ω·dt) instead of recomputing ω·sim every frame, so changing k/m/A
 * mid-flight no longer jumps ω and teleports the mass — the motion stays
 * continuous through parameter changes.
 * FIX (pendulum "lie"): the real period readout stays "—" (and the T(real) bar
 * stays hidden) until at least one full period has actually been measured, so
 * we never quietly report the small-angle prediction as if it were measured at
 * 80°. The locked measured period and the number of cycles counted are surfaced.
 *
 * Stretch: a subtle Web Audio sine whose pitch tracks ω (spring) or the true
 * angular rate (pendulum), gated behind a toggle so nothing autoplays.
 */

const GOLD = '#C5B783';
const GOLD_FADE = 'rgba(197,183,131,0.42)';
const BLUE = '#5B9BD5';
const GHOST = 'rgba(139,140,142,0.85)';

// gravity presets (m/s²) for the pendulum's T₀ = 2π√(L/g) selector
const GRAVITY = {
  earth:   { label: 'Earth', g: 9.81 },
  moon:    { label: 'Moon',  g: 1.62 },
  jupiter: { label: 'Jupiter', g: 24.79 },
};

// ── tiny shared Web Audio tone: one oscillator, pitch driven by ω ──────────
function makeTone() {
  let ctx = null, osc = null, gain = null;
  return {
    start() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.value = 0.0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
    },
    // map physical ω (rad/s, ~2–15) to an audible pitch; small gain so it's subtle
    set(omega, on) {
      if (!ctx || !osc || !gain) return;
      const f = 110 + omega * 60; // Hz
      osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
      gain.gain.setTargetAtTime(on ? 0.04 : 0.0, ctx.currentTime, 0.05);
    },
    stop() {
      if (!ctx) return;
      try { osc.stop(); ctx.close(); } catch { /* already closed */ }
      ctx = osc = gain = null;
    },
  };
}

// bounded dt so the sim survives tab throttling / non-advancing timestamps
function boundedDt(now, last) {
  let dt = (now - last) / 1000;
  if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
  return dt;
}

const col = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function arrow(ctx, x0, y0, x1, y1, color, width) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = 10;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(ang - 0.42), y1 - head * Math.sin(ang - 0.42));
  ctx.lineTo(x1 - head * Math.cos(ang + 0.42), y1 - head * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
}

// rounded-rect path helper (not in the shared canvas lib)
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER — hook-free, branches by mode
// ═══════════════════════════════════════════════════════════════════════════
export default function ShmExplorer({ mode = 'spring' }) {
  if (mode === 'pendulum') return <PendulumMode />;
  return <SpringMode />;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPRING (L35)
// ═══════════════════════════════════════════════════════════════════════════
const SPRING_DEFAULTS = { k: 20, m: 1.0, A: 0.8, damp: 0 };
const SLIDER_A_MAX = 1.2;   // amplitude slider ceiling — also the canvas scale
const GHOST_A_FRAC = 0.5;   // ghost mass amplitude = half the main amplitude

function SpringMode() {
  const [k, setK] = useState(SPRING_DEFAULTS.k);       // N/m
  const [m, setM] = useState(SPRING_DEFAULTS.m);       // kg
  const [A, setA] = useState(SPRING_DEFAULTS.A);       // m (amplitude)
  const [damp, setDamp] = useState(SPRING_DEFAULTS.damp); // γ (1/s), light damping
  const [showPhase, setShowPhase] = useState(false);
  const [showShadow, setShowShadow] = useState(true);
  const [showGhost, setShowGhost] = useState(true);    // isochronous ghost mass
  const [sound, setSound] = useState(false);

  const omega = Math.sqrt(k / m);
  const period = (2 * Math.PI) / omega;
  const freq = 1 / period;
  const energy = 0.5 * k * A * A;   // total mechanical energy = ½kA² (undamped)

  // live readouts published from the rAF loop (throttled to avoid per-frame churn)
  const [live, setLive] = useState({ x: A, v: 0, K: 0, U: energy, env: A });

  // refs the animation reads without re-subscribing the effect
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const params = useRef({ k, m, A, omega, damp, showPhase, showShadow, showGhost });
  params.current = { k, m, A, omega, damp, showPhase, showShadow, showGhost };
  // setter the pointer handler uses to write amplitude back from a drag
  const setARef = useRef(setA);
  setARef.current = setA;
  const draggingRef = useRef(false);

  const toneRef = useRef(null);
  useEffect(() => {
    if (!sound) { if (toneRef.current) { toneRef.current.stop(); toneRef.current = null; } return; }
    toneRef.current = makeTone();
    toneRef.current.start();
    return () => { if (toneRef.current) { toneRef.current.stop(); toneRef.current = null; } };
  }, [sound]);
  useEffect(() => { if (toneRef.current) toneRef.current.set(omega, sound); }, [omega, sound]);

  const reset = () => {
    setK(SPRING_DEFAULTS.k); setM(SPRING_DEFAULTS.m); setA(SPRING_DEFAULTS.A);
    setDamp(SPRING_DEFAULTS.damp);
    setShowPhase(false); setShowShadow(true); setShowGhost(true); setSound(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastNow, trace = [];
    let lastPublish = 0;
    // FIX: phase is integrated INCREMENTALLY so changing ω (via k/m) mid-flight
    // does not teleport the mass. phase += ω·dt keeps cos(phase) continuous even
    // as ω jumps. simT drives only the damping envelope (also continuous).
    let phase = 0;
    let simT = 0;

    // cached geometry so the pointer handler can invert screen→amplitude
    const geo = { eqY: 0, pxPerM: 1, springX: 0, massSize: 0 };

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      const dt = boundedDt(now, lastNow); lastNow = now;

      const P = params.current;
      const om = P.omega;
      phase += om * dt;    // incremental phase — the fix
      simT += dt;
      if (phase > 1e6) phase -= 2 * Math.PI * Math.floor(phase / (2 * Math.PI));

      const gold = col('--color-gold', GOLD);
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const text = col('--color-text', '#F0ECE3');

      // exponential envelope for light damping: A(t) = A·e^(−γt).
      const env = P.A * Math.exp(-P.damp * simT);
      const ghostEnv = env * GHOST_A_FRAC;

      const x = env * Math.cos(phase);                 // displacement (m)
      // v = d/dt[A e^{-γt} cos ωt] = -A e^{-γt}(ω sinωt + γ cosωt)
      const v = -env * (om * Math.sin(phase) + P.damp * Math.cos(phase));
      const gx = ghostEnv * Math.cos(phase);           // ghost mass (same phase, half A)
      const U = 0.5 * P.k * x * x;
      const K = 0.5 * P.m * v * v;

      ctx.clearRect(0, 0, W, H);

      // ── geometry: left column = spring+mass, right = trace / phase space ──
      const leftW = W * 0.44;
      const eqY = Math.round(H * 0.52);
      const ampPx = Math.min(H * 0.30, leftW * 0.30, 130); // px per metre of amplitude range
      // scale so max displayable amplitude (slider max) fits
      const pxPerM = ampPx / SLIDER_A_MAX;
      const springX = Math.round(leftW * 0.42);
      const massY = eqY - x * pxPerM;
      const massSize = Math.max(34, Math.min(52, leftW * 0.16));
      const supportY = Math.round(H * 0.10);
      geo.eqY = eqY; geo.pxPerM = pxPerM; geo.springX = springX; geo.massSize = massSize;

      // equilibrium line
      ctx.strokeStyle = grid; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(16, eqY); ctx.lineTo(leftW - 8, eqY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.fillText('equilibrium', 18, eqY - 6);

      // support bar + hatching
      const barL = springX - massSize, barR = springX + massSize;
      ctx.strokeStyle = muted; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(barL, supportY); ctx.lineTo(barR, supportY); ctx.stroke();
      ctx.lineWidth = 1.4;
      for (let hx = barL; hx <= barR; hx += 9) {
        ctx.beginPath(); ctx.moveTo(hx, supportY); ctx.lineTo(hx - 8, supportY - 8); ctx.stroke();
      }

      // ── isochronous ghost mass (drawn behind, faint) — smaller amplitude, ──
      // released simultaneously, staying perfectly in step (same ω, same phase).
      if (P.showGhost) {
        const gMassY = eqY - gx * pxPerM;
        const gmx = springX - massSize / 2, gmy = gMassY - massSize / 2, gr = 8;
        ctx.globalAlpha = 0.9;
        roundRect(ctx, gmx, gmy, massSize, massSize, gr);
        ctx.fillStyle = 'rgba(139,140,142,0.30)'; ctx.fill();
        ctx.strokeStyle = GHOST; ctx.lineWidth = 1.4;
        roundRect(ctx, gmx, gmy, massSize, massSize, gr); ctx.stroke();
        ctx.globalAlpha = 1;
        // faint envelope guides for the ghost
        ctx.strokeStyle = 'rgba(139,140,142,0.20)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(barL, eqY - ghostEnv * pxPerM); ctx.lineTo(barR, eqY - ghostEnv * pxPerM);
        ctx.moveTo(barL, eqY + ghostEnv * pxPerM); ctx.lineTo(barR, eqY + ghostEnv * pxPerM);
        ctx.stroke(); ctx.setLineDash([]);
      }

      // zig-zag spring
      const massTop = massY - massSize / 2;
      const coils = 12, springW = massSize * 0.42, lead = 10;
      const zigTop = supportY, zigBot = massTop;
      const zigSpan = Math.max(1, zigBot - lead - (zigTop + lead));
      ctx.strokeStyle = gold; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(springX, zigTop); ctx.lineTo(springX, zigTop + lead);
      for (let i = 0; i <= coils; i++) {
        const yy = zigTop + lead + (i / coils) * zigSpan;
        const side = i % 2 === 0 ? -1 : 1;
        const xx = i === 0 || i === coils ? springX : springX + side * springW;
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(springX, zigBot); ctx.stroke();

      // the mass
      const mx = springX - massSize / 2, my = massY - massSize / 2, r = 8;
      roundRect(ctx, mx, my, massSize, massSize, r);
      ctx.fillStyle = gold; ctx.shadowColor = gold; ctx.shadowBlur = draggingRef.current ? 24 : 16; ctx.fill();
      ctx.shadowBlur = 0;
      // drag affordance
      ctx.fillStyle = draggingRef.current ? gold : muted;
      ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(draggingRef.current ? 'set A…' : '↕ drag mass', springX, my - 8);

      // ── rotating-disk shadow projection (SHM ⇐ uniform circular motion) ──
      // A point runs the circle at angular rate ω; its VERTICAL projection is
      // x(t) = A cos(ωt) — the exact motion of the mass. The disc sits to the
      // left of the spring so the two share the same vertical (x) axis.
      if (P.showShadow) {
        const discR = Math.min(H * 0.16, 46);
        const discCY = eqY;                                   // circle centred on equilibrium
        const dcx = Math.max(discR + 14, springX - massSize - discR - 22);
        // ring
        ctx.strokeStyle = 'rgba(197,183,131,0.30)'; ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(dcx, discCY, discR, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);
        // orbiting point: vertical offset = (x/env)·discR so the shadow height
        // matches the mass, horizontal = the in-quadrature component.
        const nx = env > 0 ? x / env : 0;
        const opx = dcx + discR * Math.sin(phase);
        const opy = discCY - nx * discR;
        // radius from centre to the orbiting point
        ctx.strokeStyle = 'rgba(139,140,142,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(dcx, discCY); ctx.lineTo(opx, opy); ctx.stroke();
        // dashed "shadow" line from the orbiting point across to the mass height
        ctx.strokeStyle = 'rgba(91,155,213,0.55)'; ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(opx, opy); ctx.lineTo(springX, opy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = BLUE;
        ctx.beginPath(); ctx.arc(opx, opy, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = muted; ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('circular', dcx, discCY + discR + 14);
        ctx.fillText('shadow', dcx, discCY + discR + 26);
      }

      // ── right column ──────────────────────────────────────────────────────
      const rx0 = leftW + 10, rx1 = W - 16;
      const rW = Math.max(1, rx1 - rx0);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(rx0 - 6, supportY - 4); ctx.lineTo(rx0 - 6, H - 16); ctx.stroke();

      if (P.showPhase) {
        // phase-space ellipse: x vs v. Amplitude grows the ellipse; ω sets its aspect.
        const ccx = (rx0 + rx1) / 2, ccy = eqY;
        const halfW = rW * 0.40;
        const halfH = Math.min(H * 0.34, 150);
        // full ellipse (the closed orbit) — a spiral when damped
        ctx.strokeStyle = 'rgba(197,183,131,0.40)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let a = 0; a <= 2 * Math.PI + 0.01; a += 0.05) {
          const ex = ccx + halfW * Math.cos(a);
          const ey = ccy - halfH * Math.sin(a);
          a === 0 ? ctx.moveTo(ex, ey) : ctx.lineTo(ex, ey);
        }
        ctx.stroke();
        // axes
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ccx - halfW - 10, ccy); ctx.lineTo(ccx + halfW + 10, ccy);
        ctx.moveTo(ccx, ccy - halfH - 10); ctx.lineTo(ccx, ccy + halfH + 10); ctx.stroke();
        // current state point: (x, v) normalized to CURRENT envelope & vmax so
        // the point rides the unit ellipse (spiraling inward under damping).
        const nx = env > 0 ? x / env : 0;
        const vmax = env * om || 1;
        const nv = v / vmax;
        const spx = ccx + halfW * nx;
        const spy = ccy - halfH * nv;
        ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = gold; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(spx, spy, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = muted; ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('x', ccx + halfW + 22, ccy + 4);
        ctx.fillText('v', ccx, ccy - halfH - 18);
        ctx.textAlign = 'left';
        ctx.fillText('phase space', rx0 + 4, supportY + 6);
      } else {
        // scrolling x(t) trace
        const traceMax = Math.max(4, period * 2.2); // ~2 periods of history
        trace.push({ t: simT, x, g: P.showGhost ? gx : null });
        while (trace.length && simT - trace[0].t > traceMax) trace.shift();
        // decaying amplitude envelope (exponential when damped)
        ctx.strokeStyle = 'rgba(197,183,131,0.20)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        ctx.beginPath();
        trace.forEach((p, i) => {
          const px = rx1 - ((simT - p.t) / traceMax) * rW;
          const e = P.A * Math.exp(-P.damp * p.t) * pxPerM;
          i ? ctx.lineTo(px, eqY - e) : ctx.moveTo(px, eqY - e);
        });
        ctx.stroke();
        ctx.beginPath();
        trace.forEach((p, i) => {
          const px = rx1 - ((simT - p.t) / traceMax) * rW;
          const e = P.A * Math.exp(-P.damp * p.t) * pxPerM;
          i ? ctx.lineTo(px, eqY + e) : ctx.moveTo(px, eqY + e);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        // ghost trace (behind main)
        if (P.showGhost) {
          ctx.strokeStyle = GHOST; ctx.lineWidth = 1.6;
          ctx.beginPath();
          trace.forEach((p, i) => {
            const px = rx1 - ((simT - p.t) / traceMax) * rW;
            const py = eqY - (p.g ?? 0) * pxPerM;
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          });
          ctx.stroke();
        }
        // main trace
        ctx.strokeStyle = gold; ctx.lineWidth = 2.4;
        ctx.beginPath();
        trace.forEach((p, i) => {
          const px = rx1 - ((simT - p.t) / traceMax) * rW;
          const py = eqY - p.x * pxPerM;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = gold; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(rx1, eqY - x * pxPerM, 4.5, 0, 2 * Math.PI); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = muted; ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'left'; ctx.fillText('x(t)', rx0 + 4, supportY + 6);
      }

      void text; void arrow;

      // publish readouts ~12/s
      if (now - lastPublish > 80) {
        lastPublish = now;
        setLive({ x, v, K, U, env });
      }
      raf = requestAnimationFrame(draw);
    };

    // ── drag the mass to set amplitude ──────────────────────────────────────
    // The instantaneous position gets pulled to |screen offset| / pxPerM, and we
    // reset the phase so the mass sits exactly where you dropped it, then the
    // release amplitude becomes the new A.
    const setAmpFromPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const disp = (geo.eqY - py) / geo.pxPerM;               // metres from equilibrium
      let newA = Math.abs(disp);
      newA = Math.max(0.2, Math.min(SLIDER_A_MAX, newA));
      // snap phase so cos(phase)=sign, i.e. mass is at the dragged extreme
      phase = disp >= 0 ? 0 : Math.PI;
      simT = 0;                                                // restart the envelope
      setARef.current(Number(newA.toFixed(2)));
    };
    const hitMass = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      return Math.abs(px - geo.springX) < geo.massSize * 1.4;
    };
    const onDown = (e) => {
      if (!hitMass(e)) return;
      draggingRef.current = true;
      canvas.setPointerCapture?.(e.pointerId);
      setAmpFromPointer(e);
      e.preventDefault();
    };
    const onMove = (e) => { if (draggingRef.current) { setAmpFromPointer(e); e.preventDefault(); } };
    const onUp = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      canvas.releasePointerCapture?.(e.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [period]); // re-seed trace history window when period changes

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Stiffness (k)" value={k} min={4} max={80} step={1} unit="N/m" onChange={setK} />
        <Slider label="Mass (m)" value={m} min={0.2} max={4} step={0.1} unit="kg" onChange={setM} />
        <Slider label="Amplitude (A)" value={A} min={0.2} max={SLIDER_A_MAX} step={0.05} unit="m" onChange={setA} />
        <Slider label="Damping (γ)" value={damp} min={0} max={0.6} step={0.02} unit="1/s" onChange={setDamp} />

        <div className="mt-1 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <ToggleRow label="Isochronous ghost (½ A)" on={showGhost} onClick={() => setShowGhost((s) => !s)} />
          <ToggleRow label="Phase space (x vs v)" on={showPhase} onClick={() => setShowPhase((s) => !s)} />
          <ToggleRow label="Circular-motion shadow" on={showShadow} onClick={() => setShowShadow((s) => !s)} />
          <ToggleRow label="Tone tracks ω" on={sound} onClick={() => setSound((s) => !s)} />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Angular freq ω" value={omega.toFixed(2)} unit="rad/s" />
          <Readout label="Period T" value={period.toFixed(2)} unit="s" />
          <Readout label="Frequency f" value={freq.toFixed(2)} unit="Hz" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Position x" value={live.x.toFixed(2)} unit="m" />
            <Readout label="Velocity v" value={live.v.toFixed(2)} unit="m/s" />
            <Readout label={damp > 0 ? 'Current amp e⁻ᵞᵗ' : 'Total E = ½kA²'}
                     value={damp > 0 ? live.env.toFixed(2) : energy.toFixed(2)}
                     unit={damp > 0 ? 'm' : 'J'} />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
             style={{ height: 440, background: '#0D1321' }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            <div>T&nbsp;&nbsp;{period.toFixed(2)} s</div>
            <div>ω&nbsp;&nbsp;{omega.toFixed(2)} rad/s</div>
            {damp > 0 && <div className="text-usna-muted">γ&nbsp;&nbsp;{damp.toFixed(2)} 1/s (T fixed)</div>}
          </div>
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 flex items-center justify-between gap-6 min-w-0 overflow-hidden">
          <div>
            <div className="text-usna-text text-sm font-medium mb-1">Energy exchange</div>
            <div className="text-usna-muted text-xs max-w-[16rem]">
              {damp > 0
                ? 'With damping the total slowly bleeds away, but K and U still trade back and forth every cycle — and the period never changes.'
                : 'K and U trade back and forth; their sum stays pinned at E = ½kA² (the white line).'}
            </div>
          </div>
          <EnergyBars
            items={[
              { label: 'K', value: live.K, color: GOLD },
              { label: 'U', value: live.U, color: GOLD_FADE },
            ]}
            max={energy || 1}
            total={damp > 0 ? undefined : energy}
            height={140}
            unit=" J"
          />
        </div>

        <InfoPanel {...SPRING_INFO} />
      </div>
    </div>
  );
}

const SPRING_INFO = {
  title: 'Isochronism: amplitude does not set the period',
  description:
    'Pull the mass twice as far and it moves twice as fast at the bottom, covering twice the distance in exactly the same time — so the period is unchanged. Only k and m set T = 2π√(m/k). The faint ghost mass, released at half the amplitude, stays perfectly in step with the big one — same period despite very different swings. Drag the mass on the canvas to set the amplitude yourself, or add light damping: the swings decay along an e^(−γt) envelope but the period stays exactly the same. Watch the phase-space ellipse grow with amplitude while its orbital rate stays fixed, and see the mass as the shadow of a point in uniform circular motion. Most people bet the bigger swing takes longer; it does not. (Switch to Pendulum mode to find the one place this finally breaks.)',
  equation: String.raw`\omega=\sqrt{\tfrac{k}{m}},\quad T=2\pi\sqrt{\tfrac{m}{k}}\ \ (\text{independent of }A)`,
};

// ═══════════════════════════════════════════════════════════════════════════
// PENDULUM (L36)
// ═══════════════════════════════════════════════════════════════════════════
// preset "shape" gives an effective (I about pivot, m, d = pivot→CM) so we can
// run the SAME nonlinear integrator for simple and physical pendulums:
//   θ'' = −(m g d / I) sin θ.  For a simple pendulum I = mL², d = L ⇒ −(g/L)sinθ.
// Each coeff/smallT now takes the selected gravity g so the gravity selector
// rescales T₀ = 2π√(L/g) (and the physical-pendulum equivalents).
const PEND_PRESETS = {
  simple: {
    label: 'Simple (point bob)',
    coeff: (L, g) => g / L,               // = m g d / I  with I=mL², d=L
    smallT: (L, g) => 2 * Math.PI * Math.sqrt(L / g),
    note: 'point mass on a massless rod',
  },
  rod: {
    label: 'Uniform rod (pivot at end)',
    // I = (1/3) m Lᵣ², d = Lᵣ/2, Lᵣ = L (rod length = slider L)
    coeff: (L, g) => (g * (L / 2)) / ((1 / 3) * L * L), // = 3g/(2L)
    smallT: (L, g) => 2 * Math.PI * Math.sqrt((2 * L) / (3 * g)),
    note: 'I = ⅓mL², d = L/2 ⇒ T₀ = 2π√(2L/3g)',
  },
  hoop: {
    label: 'Hoop (pivot on rim)',
    // I = 2 m R², d = R, with R = L/2 so the drawn hoop spans length L
    coeff: (L, g) => (g * (L / 2)) / (2 * (L / 2) * (L / 2)), // = g/L  (with R=L/2)
    smallT: (L, g) => 2 * Math.PI * Math.sqrt((2 * (L / 2)) / g),
    note: 'I = 2mR², d = R ⇒ T₀ = 2π√(2R/g)',
  },
};

const PEND_DEFAULTS = { L: 1.0, theta0Deg: 20, preset: 'simple', gravity: 'earth', race: false };

function PendulumMode() {
  const [L, setL] = useState(PEND_DEFAULTS.L);              // m
  const [theta0Deg, setTheta0Deg] = useState(PEND_DEFAULTS.theta0Deg);
  const [preset, setPreset] = useState(PEND_DEFAULTS.preset);
  const [gravity, setGravity] = useState(PEND_DEFAULTS.gravity);
  const [race, setRace] = useState(PEND_DEFAULTS.race);     // 10° vs 60° race
  const [showGhost, setShowGhost] = useState(true);
  const [sound, setSound] = useState(false);

  const P = PEND_PRESETS[preset];
  const g = GRAVITY[gravity].g;
  const smallT = P.smallT(L, g);                           // small-angle prediction
  const smallOmega = (2 * Math.PI) / smallT;

  // trueT is null until a full period is actually measured (fixes the "lie")
  const [live, setLive] = useState({ trueT: null, ratio: null, cycles: 0, driftDeg: null });

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const params = useRef({ L, theta0Deg, preset, gravity, race, showGhost });
  params.current = { L, theta0Deg, preset, gravity, race, showGhost };
  const setThetaRef = useRef(setTheta0Deg);
  setThetaRef.current = setTheta0Deg;
  const draggingRef = useRef(false);

  const toneRef = useRef(null);
  useEffect(() => {
    if (!sound) { if (toneRef.current) { toneRef.current.stop(); toneRef.current = null; } return; }
    toneRef.current = makeTone();
    toneRef.current.start();
    return () => { if (toneRef.current) { toneRef.current.stop(); toneRef.current = null; } };
  }, [sound]);
  useEffect(() => { if (toneRef.current) toneRef.current.set(smallOmega, sound); }, [smallOmega, sound]);

  const reset = () => {
    setL(PEND_DEFAULTS.L); setTheta0Deg(PEND_DEFAULTS.theta0Deg);
    setPreset(PEND_DEFAULTS.preset); setGravity(PEND_DEFAULTS.gravity);
    setRace(PEND_DEFAULTS.race); setShowGhost(true); setSound(false);
  };

  // reset the integration whenever an initial-condition control changes
  const seedKey = `${L}|${theta0Deg}|${preset}|${gravity}|${race}`;

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastNow;
    let lastPublish = 0;

    const gval = () => GRAVITY[params.current.gravity].g;

    // full nonlinear state (RK4): θ'' = −coeff·sin θ  (NOT small-angled)
    const theta0 = (params.current.theta0Deg * Math.PI) / 180;
    let th = theta0, om = 0;               // true (nonlinear) pendulum
    let ghTh = theta0;                     // small-angle ghost (linear SHM)
    // race mode: two nonlinear bobs of the SAME L at 10° and 60°
    const RACE_A = (10 * Math.PI) / 180, RACE_B = (60 * Math.PI) / 180;
    let rA = RACE_A, rAom = 0, rB = RACE_B, rBom = 0;
    let t = 0;                             // sim time since seed
    // period detection: watch velocity sign flip from + to − (turning point of
    // the +θ swing). trueT stays null until the SECOND such event.
    let prevOm = 0, tLastExtreme = null, measuredT = null;
    let cycles = 0, prevGhSign = Math.sign(theta0) || 1;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const accel = (angle) =>
      -PEND_PRESETS[params.current.preset].coeff(params.current.L, gval()) * Math.sin(angle);

    const rk4 = (angle, rate, dt) => {
      const k1a = rate,                 k1v = accel(angle);
      const k2a = rate + 0.5 * dt * k1v, k2v = accel(angle + 0.5 * dt * k1a);
      const k3a = rate + 0.5 * dt * k2v, k3v = accel(angle + 0.5 * dt * k2a);
      const k4a = rate + dt * k3v,       k4v = accel(angle + dt * k3a);
      return [
        angle + (dt / 6) * (k1a + 2 * k2a + 2 * k3a + k4a),
        rate + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
      ];
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = boundedDt(now, lastNow); lastNow = now;

      // freeze integration while dragging the bob to set a release angle
      if (!draggingRef.current) {
        const steps = 6, h = dt / steps;
        for (let s = 0; s < steps; s++) {
          prevOm = om;
          [th, om] = rk4(th, om, h);
          if (params.current.race) {
            [rA, rAom] = rk4(rA, rAom, h);
            [rB, rBom] = rk4(rB, rBom, h);
          }
          t += h;
          // true period: interval between successive + → − velocity flips.
          if (prevOm > 0 && om <= 0) {
            if (tLastExtreme != null) measuredT = t - tLastExtreme;
            tLastExtreme = t;
          }
          // ghost small-angle: θ = θ0 cos(ω0 t)
          const w0 = (2 * Math.PI) / PEND_PRESETS[params.current.preset].smallT(params.current.L, gval());
          ghTh = theta0 * Math.cos(w0 * t);
          const gs = Math.sign(ghTh) || 1;
          if (gs !== prevGhSign && gs > 0) cycles += 1;
          prevGhSign = gs;
        }
      }

      const gold = col('--color-gold', GOLD);
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const text = col('--color-text', '#F0ECE3');

      ctx.clearRect(0, 0, W, H);

      const px = params.current.preset;
      const isRace = params.current.race;
      const pivotX = Math.round(W * 0.5);
      const pivotY = Math.round(H * 0.16);
      const armLen = Math.min(H * 0.62, W * 0.34);

      // pivot bracket
      ctx.strokeStyle = muted; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(pivotX - 34, pivotY); ctx.lineTo(pivotX + 34, pivotY); ctx.stroke();
      ctx.lineWidth = 1.4;
      for (let hx = pivotX - 34; hx <= pivotX + 34; hx += 9) {
        ctx.beginPath(); ctx.moveTo(hx, pivotY); ctx.lineTo(hx - 8, pivotY - 8); ctx.stroke();
      }

      // reference vertical
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX, pivotY + armLen + 30); ctx.stroke();
      ctx.setLineDash([]);

      const drawBob = (angle, color, glow, ghost, rBobOverride) => {
        const bx = pivotX + armLen * Math.sin(angle);
        const by = pivotY + armLen * Math.cos(angle);
        // arm / shape
        if (px === 'rod' && !isRace) {
          ctx.strokeStyle = color; ctx.lineWidth = ghost ? 2 : 5;
          ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(bx, by); ctx.stroke();
        } else if (px === 'hoop' && !isRace) {
          ctx.strokeStyle = color; ctx.lineWidth = ghost ? 1.4 : 2.2;
          ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(bx, by); ctx.stroke();
          const hcx = pivotX + (armLen / 2) * Math.sin(angle);
          const hcy = pivotY + (armLen / 2) * Math.cos(angle);
          ctx.beginPath(); ctx.arc(hcx, hcy, armLen / 2, 0, 2 * Math.PI); ctx.stroke();
        } else {
          ctx.strokeStyle = color; ctx.lineWidth = ghost ? 1.4 : 2.4;
          ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(bx, by); ctx.stroke();
        }
        // bob
        const rBob = rBobOverride ?? (px === 'simple' ? 15 : 9);
        ctx.beginPath(); ctx.arc(bx, by, rBob, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
        ctx.fill(); ctx.shadowBlur = 0;
        return { bx, by };
      };

      if (isRace) {
        // 10° vs 60° race — same L, both fully nonlinear. They start together and
        // drift out of phase because the 60° bob's period is longer.
        drawBob(rA, BLUE, true, false, 12);
        drawBob(rB, gold, true, false, 12);
        // swept-angle arcs
        ctx.strokeStyle = 'rgba(91,155,213,0.30)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(pivotX, pivotY, armLen * 0.42, Math.PI / 2, Math.PI / 2 - rA, rA > 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(197,183,131,0.30)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(pivotX, pivotY, armLen * 0.5, Math.PI / 2, Math.PI / 2 - rB, rB > 0); ctx.stroke();
        // legend
        ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = BLUE; ctx.fillText('● 10°', 14, H - 34);
        ctx.fillStyle = gold; ctx.fillText('● 60°', 14, H - 18);
      } else {
        // swept-angle arc from vertical to current θ
        ctx.strokeStyle = 'rgba(197,183,131,0.30)'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, armLen * 0.5, Math.PI / 2, Math.PI / 2 - th, th > 0);
        ctx.stroke();
        // ghost small-angle prediction (drawn faint, behind)
        if (params.current.showGhost) drawBob(ghTh, GHOST, false, true);
        // true nonlinear pendulum
        drawBob(th, gold, true, false);
        // labels
        ctx.fillStyle = muted; ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillText(`θ = ${((th * 180) / Math.PI).toFixed(1)}°`, 14, H - 16);
        if (params.current.showGhost) {
          ctx.fillStyle = GHOST;
          ctx.fillText('ghost = small-angle prediction', 14, H - 32);
        }
      }

      // drag affordance + gravity badge
      ctx.fillStyle = draggingRef.current ? gold : muted;
      ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      if (!isRace) ctx.fillText(draggingRef.current ? 'set release angle…' : '↔ drag bob to set θ₀', pivotX, pivotY + armLen + 44);
      ctx.textAlign = 'right'; ctx.fillStyle = muted;
      ctx.fillText(`g = ${gval().toFixed(2)} m/s²  (${GRAVITY[params.current.gravity].label})`, W - 14, H - 16);

      // pivot dot
      ctx.fillStyle = text; ctx.beginPath(); ctx.arc(pivotX, pivotY, 4, 0, 2 * Math.PI); ctx.fill();

      // publish
      if (now - lastPublish > 100) {
        lastPublish = now;
        const T0 = PEND_PRESETS[px].smallT(params.current.L, gval());
        // trueT stays null until a period is actually measured (fixes the lie)
        const trueT = measuredT;
        const ratio = trueT != null ? trueT / T0 : null;
        // race drift: phase-angle difference between the two bobs (deg)
        let driftDeg = null;
        if (isRace) driftDeg = Math.abs((rB - rA) * 180 / Math.PI);
        setLive({ trueT, ratio, cycles, driftDeg });
      }
      raf = requestAnimationFrame(draw);
    };

    // ── drag the bob to set the release angle ───────────────────────────────
    const setAngleFromPointer = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cxp = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cyp = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const pivotX = Math.round(W * 0.5);
      const pivotY = Math.round(H * 0.16);
      // angle from the downward vertical: θ = atan2(dx, dy)
      let ang = Math.atan2(cxp - pivotX, Math.max(1, cyp - pivotY));
      let deg = (ang * 180) / Math.PI;
      deg = Math.max(-80, Math.min(80, deg));
      // release from rest at the dragged angle
      th = (deg * Math.PI) / 180; om = 0;
      setThetaRef.current(Math.round(Math.abs(deg)));
    };
    const hitBob = (e) => {
      if (params.current.race) return false; // race is non-interactive (fixed angles)
      const rect = canvas.getBoundingClientRect();
      const cxp = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cyp = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const pivotX = Math.round(W * 0.5), pivotY = Math.round(H * 0.16);
      const armLen = Math.min(H * 0.62, W * 0.34);
      const bx = pivotX + armLen * Math.sin(th), by = pivotY + armLen * Math.cos(th);
      return Math.hypot(cxp - bx, cyp - by) < 40;
    };
    const onDown = (e) => {
      if (!hitBob(e)) return;
      draggingRef.current = true;
      canvas.setPointerCapture?.(e.pointerId);
      setAngleFromPointer(e);
      e.preventDefault();
    };
    const onMove = (e) => { if (draggingRef.current) { setAngleFromPointer(e); e.preventDefault(); } };
    const onUp = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      canvas.releasePointerCapture?.(e.pointerId);
      // the seedKey change from the new θ₀ re-seeds the integrator cleanly
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [seedKey]); // re-seed the integrator on any IC change

  // exact large-amplitude series for the readout comparison (first two terms):
  // T = T₀ (1 + θ0²/16 + 11θ0⁴/3072 + …)
  const th0 = (theta0Deg * Math.PI) / 180;
  const seriesT = smallT * (1 + th0 * th0 / 16 + (11 * th0 ** 4) / 3072);
  const pctError = ((seriesT - smallT) / smallT) * 100;

  const measured = live.trueT != null;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Pendulum type</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(PEND_PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                disabled={race}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors disabled:opacity-40 ${
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
          <div className="text-usna-text text-sm font-medium mb-2">Gravity</div>
          <div className="flex gap-1.5">
            {Object.entries(GRAVITY).map(([key, gv]) => (
              <button
                key={key}
                onClick={() => setGravity(key)}
                className={`flex-1 px-2 py-1.5 rounded text-xs border transition-colors ${
                  gravity === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {gv.label}
              </button>
            ))}
          </div>
        </div>

        <Slider label="Length (L)" value={L} min={0.3} max={2.5} step={0.1} unit="m" onChange={setL} />
        {race ? (
          <div className="mb-4 text-usna-muted text-xs italic">
            Release angles fixed at 10° and 60° during the race.
          </div>
        ) : (
          <Slider label="Release angle θ₀" value={theta0Deg} min={5} max={80} step={1} unit="°"
                  onChange={setTheta0Deg} />
        )}

        <div className="mt-1 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <ToggleRow label="Race: 10° vs 60° (same L)" on={race} onClick={() => setRace((s) => !s)} />
          <ToggleRow label="Small-angle ghost overlay" on={showGhost} onClick={() => setShowGhost((s) => !s)} />
          <ToggleRow label="Tone tracks ω₀" on={sound} onClick={() => setSound((s) => !s)} />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Small-angle T₀" value={smallT.toFixed(3)} unit="s" />
          <Readout label="True period T" value={measured ? live.trueT.toFixed(3) : '— measuring'} unit={measured ? 's' : ''} />
          <Readout label="T / T₀" value={measured ? live.ratio.toFixed(3) : '—'} unit={measured ? '×' : ''} />
          <Readout label="Cycles counted" value={String(live.cycles)} unit="" />
          {race && live.driftDeg != null && (
            <Readout label="Race phase drift" value={live.driftDeg.toFixed(0)} unit="°" />
          )}
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Series T (θ₀ correction)" value={seriesT.toFixed(3)} unit="s" />
            <Readout label="Predicted error" value={pctError.toFixed(1)} unit="%" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
             style={{ height: 440, background: '#0D1321' }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
          <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold/90 space-y-0.5 text-right pointer-events-none">
            <div>T₀&nbsp;{smallT.toFixed(2)} s</div>
            <div>{measured ? `T  ${live.trueT.toFixed(2)} s` : 'T  measuring…'}</div>
            {measured && (
              <div className={live.ratio > 1.02 ? 'text-usna-text' : 'text-usna-gold/90'}>
                T/T₀ {live.ratio.toFixed(3)}
              </div>
            )}
          </div>
        </div>

        {race ? (
          <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden">
            <div className="text-usna-text text-sm font-medium mb-2">10° vs 60° — the same length, drifting apart</div>
            <div className="text-usna-muted text-xs">
              Both bobs hang from the SAME length and are released together. If isochronism held perfectly they would
              stay locked forever — but the 60° swing takes slightly longer (sin θ &lt; θ), so it falls behind a little
              each cycle. Over ~10 swings the gap grows to a visible {live.driftDeg != null ? `${live.driftDeg.toFixed(0)}°` : 'large'} phase
              drift. This is the spring's isochronism failing, made unmistakable.
            </div>
          </div>
        ) : (
          <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden">
            <div className="text-usna-text text-sm font-medium mb-2">Real period vs small-angle prediction</div>
            <EnergyBars
              items={[
                { label: 'T₀ (pred)', value: smallT, color: GHOST },
                // T(real) bar only appears once a period is actually measured
                { label: 'T (real)', value: measured ? live.trueT : 0, color: GOLD },
              ]}
              max={Math.max(smallT, live.trueT || smallT) * 1.15 || 1}
              height={130}
              unit=" s"
            />
            <div className="text-usna-muted text-xs mt-2">
              {!measured
                ? 'Measuring the real period… the gold bar appears once a full swing has been timed (no guessing before then).'
                : theta0Deg <= 8
                ? 'At small angles the two bars match — small-angle theory holds.'
                : theta0Deg >= 40
                ? 'At large angles the real bob lags: the gold bar overtops the prediction.'
                : 'Raise θ₀ toward 45° and watch the real period pull ahead of the prediction.'}
            </div>
          </div>
        )}

        <InfoPanel {...PEND_INFO} />
      </div>
    </div>
  );
}

const PEND_INFO = {
  title: 'Where isochronism finally breaks',
  description:
    'The simulation integrates the FULL nonlinear equation θ″ = −(g/L) sin θ — never the small-angle approximation — while the faint ghost plays the textbook prediction T₀ = 2π√(L/g). The real period is only reported once a full swing has actually been timed, so we never quietly hand you the prediction and call it a measurement. At 5° the two are indistinguishable, so a pendulum really is a good clock for small swings. But because sin θ < θ, the restoring torque falls short at large angle and the real period grows: by ~45° the gold bob visibly lags the ghost and T/T₀ climbs above 1. Turn on the 10° vs 60° race to see two same-length bobs drift apart over ten swings. Switch gravity to the Moon and every period stretches (2π√(L/g) with a smaller g) — clocks run slow on the Moon. The spring’s amplitude-independence was exact; the pendulum only borrowed it near θ = 0. Physical-pendulum presets swap in I-based periods T = 2π√(I/mgd).',
  equation: String.raw`\ddot\theta=-\frac{g}{L}\sin\theta\;\;\xrightarrow{\theta\to0}\;\;T_0=2\pi\sqrt{\tfrac{L}{g}}`,
};

// ── shared toggle row ──────────────────────────────────────────────────────
function ToggleRow({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between w-full text-left text-sm text-usna-text hover:text-usna-gold transition-colors"
    >
      <span>{label}</span>
      <span
        className={`ml-3 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          on ? 'bg-usna-gold border-usna-gold' : 'bg-usna-deep border-usna-grid'
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full bg-usna-navy transition-transform ${
            on ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}
