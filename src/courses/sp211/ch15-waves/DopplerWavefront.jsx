import { useRef, useEffect, useState, useCallback } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';

/**
 * D39 · Doppler Wavefront Visualizer — L39 (default). Demo Day #3 headliner.
 *
 * Pure expanding-circle geometry, drawn on canvas. A source emits circular
 * wavefronts at a FIXED emission frequency f0. Each wavefront is a circle
 * centered on the source's position AT ITS EMISSION TIME, expanding outward at
 * the wave speed C. Because the source keeps moving, the emission centers march
 * forward, so the rings crowd ahead of the source (short λ, high f') and stretch
 * behind it (long λ, low f'). No algebra required — the picture *is* the formula.
 *
 * Draggable observer: the received frequency is measured two ways that agree —
 * (a) live count of wavefront arrivals crossing the observer, and (b) the closed
 * geometric form for the current arrangement. A source-motion vs observer-motion
 * toggle exposes the asymmetry: at the same relative speed the two f' differ.
 *
 * THE MOMENTS:
 *   1. Crowded-ahead / stretched-behind rings explain the ± sign before any math.
 *   2. Slide source speed → C: the leading edges pile into a single wall (the
 *      sound barrier) with a screen-flash "boom". Past C the wall opens into a
 *      Mach cone whose half-angle satisfies sin θ = 1/Mach, drawn as the envelope.
 *   3. Match the Mach number in the two modes: f'_source = f0·C/(C−v) is NOT
 *      f'_observer = f0·(C+v)/C — the source/observer asymmetry of a MEDIUM. A
 *      relativistic-light toggle collapses that gap: light has no medium, so only
 *      the relative velocity matters (f' = f0·√((1+β)/(1−β))).
 *
 * Self-contained (canvas + rAF + ResizeObserver + optional Web Audio). All hooks
 * run unconditionally; single `default` mode, so no per-mode child split needed.
 */

const C = 150;            // wave speed through the medium, px/s (also "speed of sound")
const T_EMIT = 0.5;       // seconds between emitted wavefronts (source rest period)
const F0 = 1 / T_EMIT;    // emitted (rest) frequency, Hz
const AUDIO_BASE = 320;   // Hz mapped to f0 for the audible tone

// USNA canvas palette (hex — canvas cannot read tailwind classes).
const GOLD = '#C5B783';
const WHITE = '#F0ECE3';
const MUTED = '#8B8C8E';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const ORANGE = '#E0895B';
const BG = '#0D1321';
const GRID = '#1A2332';

const PRESETS = {
  approaching: { label: 'Observer ahead (approaching)', mach: 0.6, ox: 0.86, oy: 0.5 },
  receding: { label: 'Observer behind (receding)', mach: 0.6, ox: 0.14, oy: 0.5 },
  abeam: { label: 'Observer abeam (no shift)', mach: 0.6, ox: 0.5, oy: 0.16 },
  barrier: { label: 'At the sound barrier (Mach 1)', mach: 1.0, ox: 0.86, oy: 0.5 },
  supersonic: { label: 'Supersonic — Mach cone', mach: 1.35, ox: 0.5, oy: 0.28 },
};

const DEFAULTS = { mach: 0.6, ox: 0.86, oy: 0.5, moveObserver: false, audio: false, relativistic: false };

// ── local physics helpers (nothing suitable in the shared libs) ──────────────
// Classical source-motion Doppler for a receiver on the source's line of sight,
// approaching component cosθ of the source velocity toward the observer.
const fSourceMoving = (f0, c, vLOS) => {
  const denom = c - vLOS;             // vLOS>0 ⇒ source approaching ⇒ compressed
  return denom > 1e-6 ? f0 * c / denom : Infinity;
};
// Classical observer-motion Doppler; vLOS = component of observer velocity toward
// the source (positive ⇒ approaching ⇒ blue-shift).
const fObserverMoving = (f0, c, vLOS) => f0 * (c + vLOS) / c;
// Relativistic (light) Doppler: no medium, only the relative radial speed matters.
// β>0 ⇒ approaching ⇒ blue-shift. Symmetric — source vs observer motion identical.
const fRelativistic = (f0, c, vLOS) => {
  const beta = Math.max(-0.999, Math.min(0.999, vLOS / c));
  return f0 * Math.sqrt((1 + beta) / (1 - beta));
};

export default function DopplerWavefront({ mode = 'default' }) {
  void mode; // single-mode demo

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // ── React state (UI) ──────────────────────────────────────────────────────
  const [mach, setMach] = useState(DEFAULTS.mach);
  // Observer position as a fraction of the canvas (so it survives resizes).
  const [obs, setObs] = useState({ x: DEFAULTS.ox, y: DEFAULTS.oy });
  const [moveObserver, setMoveObserver] = useState(DEFAULTS.moveObserver);
  const [audioOn, setAudioOn] = useState(DEFAULTS.audio);
  const [relativistic, setRelativistic] = useState(DEFAULTS.relativistic);
  // Live readouts, throttled out of the rAF loop to avoid per-frame churn.
  const [live, setLive] = useState({
    fAhead: F0 / (1 - DEFAULTS.mach), fBehind: F0 / (1 + DEFAULTS.mach), fObs: F0,
    fCount: F0, fSrcMatch: F0 / (1 - DEFAULTS.mach), fObsMatch: F0 * (1 + DEFAULTS.mach),
    lamAhead: null, lamBehind: null,
  });

  // ── refs mirrored from state so the animation loop reads fresh values ──────
  const machRef = useRef(mach);
  const obsRef = useRef(obs);
  const moveObsRef = useRef(moveObserver);
  const relRef = useRef(relativistic);
  machRef.current = mach;
  obsRef.current = obs;
  moveObsRef.current = moveObserver;
  relRef.current = relativistic;

  // Web Audio refs — created lazily on first enable.
  const audioCtxRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);
  const targetFreqRef = useRef(AUDIO_BASE);
  // Percussive per-wavefront "click" + Mach-1 "boom" both live on the same ctx.
  const clickReady = useRef(false);

  const reset = useCallback(() => {
    setMach(DEFAULTS.mach);
    setObs({ x: DEFAULTS.ox, y: DEFAULTS.oy });
    setMoveObserver(DEFAULTS.moveObserver);
    setAudioOn(DEFAULTS.audio);
    setRelativistic(DEFAULTS.relativistic);
  }, []);

  const applyPreset = useCallback((key) => {
    const p = PRESETS[key];
    setMach(p.mach);
    setObs({ x: p.ox, y: p.oy });
  }, []);

  // ── Web Audio lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!audioOn) {
      // tear down on disable
      if (oscRef.current) {
        try { oscRef.current.stop(); } catch { /* already stopped */ }
        oscRef.current.disconnect();
        oscRef.current = null;
      }
      if (gainRef.current) { gainRef.current.disconnect(); gainRef.current = null; }
      clickReady.current = false;
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AC();
    const ac = audioCtxRef.current;
    if (ac.state === 'suspended') ac.resume();

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = targetFreqRef.current;
    gain.gain.value = 0.0;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    // gentle fade-in so there is no click
    gain.gain.setTargetAtTime(0.09, ac.currentTime, 0.05);
    oscRef.current = osc;
    gainRef.current = gain;
    clickReady.current = true;

    return () => {
      try { osc.stop(); } catch { /* noop */ }
      osc.disconnect();
      gain.disconnect();
      if (oscRef.current === osc) oscRef.current = null;
      if (gainRef.current === gain) gainRef.current = null;
      clickReady.current = false;
    };
  }, [audioOn]);

  // Fire a short percussive click at each wavefront arrival — you HEAR the rate.
  const playClick = useCallback(() => {
    const ac = audioCtxRef.current;
    if (!ac || !clickReady.current) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.1);
  }, []);

  // Low "boom" transient at Mach 1 — a decaying noise-ish thud.
  const playBoom = useCallback(() => {
    const ac = audioCtxRef.current;
    if (!ac || !clickReady.current) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.75);
  }, []);

  // ── canvas animation (mount once; reads refs for live params) ──────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow, lastEmit;
    let wavefronts = [];      // { x, y, te } — center + emission time
    let arrivals = [];        // sim-times when a front crossed the observer (for f' count)
    let srcX0, srcY;          // source launch point (px); resets when it exits the frame
    let obsPrevInside = [];   // per-wavefront inside/outside flag, for arrival detection
    let readoutT = 0;         // throttle timer for publishing readouts
    let flash = 0;            // screen-flash intensity for the Mach-1 boom (0..1)
    let boomFreeze = 0;       // seconds of brief freeze-on-the-wall remaining
    let boomArmed = true;     // fire the boom once per crossing into the Mach≈1 band

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const resetSim = () => {
      sim = 0;
      lastEmit = 0;
      wavefronts = [];
      arrivals = [];
      obsPrevInside = [];
      srcY = H / 2;
      srcX0 = -60;
    };

    // Observer pixel position from the fractional ref.
    const obsPx = () => ({ x: obsRef.current.x * W, y: obsRef.current.y * H });

    const draw = (now) => {
      if (sim === undefined) { resetSim(); lastNow = now; }
      // Accumulate our own clock with a bounded dt so the sim survives tab
      // throttling / non-advancing timestamps.
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const mNow = machRef.current;
      const v = mNow * C;
      const moving = moveObsRef.current; // true → observer moves toward a stationary source
      const rel = relRef.current;        // relativistic-light mode (no medium asymmetry)

      // Sound barrier detection (only meaningful when the SOURCE is the mover and
      // we are in the classical/medium regime — light has no barrier).
      const inBarrier = !moving && !rel && mNow > 0.985 && mNow < 1.015;
      if (inBarrier && boomArmed) {
        boomArmed = false;
        flash = 1;
        boomFreeze = 0.28;   // brief freeze on the wall
        playBoom();
      }
      if (!inBarrier) boomArmed = true;

      // The freeze pauses the simulation clock (but not the render) so the wall
      // reads as a held snapshot; the flash decays regardless.
      const frozen = boomFreeze > 0;
      if (frozen) boomFreeze = Math.max(0, boomFreeze - dt);
      const simDt = frozen ? 0 : dt;
      sim += simDt;
      readoutT += dt;
      flash = Math.max(0, flash - dt * 2.2);

      // In "moving observer" mode the source sits still and the observer glides
      // toward (then past) it at speed v; otherwise the source glides and the
      // observer is where the user dragged it. The medium (C) is shared both
      // ways — that shared C is exactly why the two classical f' don't match.
      const src = moving ? { x: W * 0.5, y: H / 2 } : { x: srcX0 + v * sim, y: srcY };

      // Emit new wavefronts at the source's live position.
      while (sim - lastEmit >= T_EMIT) {
        lastEmit += T_EMIT;
        const ex = moving ? W * 0.5 : srcX0 + v * lastEmit;
        const ey = moving ? H / 2 : srcY;
        wavefronts.push({ x: ex, y: ey, te: lastEmit });
        obsPrevInside.push(false);
      }
      // Drop wavefronts that have expanded past the far corner.
      const diag = Math.hypot(W, H) * 1.25;
      const keep = [], keepInside = [];
      for (let i = 0; i < wavefronts.length; i++) {
        if (C * (sim - wavefronts[i].te) < diag) {
          keep.push(wavefronts[i]);
          keepInside.push(obsPrevInside[i]);
        }
      }
      wavefronts = keep; obsPrevInside = keepInside;

      // Loop: recycle once the moving source leaves the frame. In observer-moving
      // mode the source is stationary and the observer auto-sweeps (below), so
      // nothing needs recycling here.
      const ob = obsPx();
      if (!moving && src.x > W + 80 && !frozen) {
        resetSim();
        raf = requestAnimationFrame(draw);
        return;
      }

      // ── observer live position + its velocity vector ────────────────────────
      let obX = ob.x, obY = ob.y;
      let obVx = 0, obVy = 0;
      if (moving) {
        // observer starts at right edge, glides left at speed v toward (and past)
        // the source. Velocity is constant −x throughout the sweep.
        const period = (W + 120) / Math.max(v, 1);
        const phase = (sim % period) / period; // 0→1 sweep
        obX = (W + 60) - phase * (W + 120);
        obY = H / 2;
        obVx = -v; obVy = 0;
      }

      // ── measure received frequency by counting arrivals ─────────────────────
      // An "arrival" = the observer transitions from outside a ring to inside it.
      let arrivedThisFrame = false;
      for (let i = 0; i < wavefronts.length; i++) {
        const w = wavefronts[i];
        const r = C * (sim - w.te);
        const d = Math.hypot(obX - w.x, obY - w.y);
        const inside = d <= r;
        if (inside && !obsPrevInside[i]) { arrivals.push(sim); arrivedThisFrame = true; } // just crossed
        obsPrevInside[i] = inside;
      }
      if (arrivedThisFrame && !frozen) playClick();
      // keep only arrivals within a sliding 3 s window for a stable rate
      const WIN = 3.0;
      arrivals = arrivals.filter((t) => sim - t <= WIN);
      const fObsCount = arrivals.length >= 2
        ? (arrivals.length - 1) / (arrivals[arrivals.length - 1] - arrivals[0])
        : F0;

      // ── analytic received frequency (the fix) ──────────────────────────────
      // Compute the TRUE line-of-sight geometry in every mode so the badge agrees
      // with the live arrival count — including the receding half of an observer
      // that has already passed the source.
      const dx = obX - src.x, dy = obY - src.y;
      const dist = Math.hypot(dx, dy) || 1;
      const losX = dx / dist, losY = dy / dist; // unit vector source → observer

      let fObsGeom;
      if (rel) {
        // Relativistic light: only the RELATIVE radial velocity matters, so both
        // modes give the same answer. Radial (recession) rate = d(distance)/dt.
        // Source-mover: source velocity +x → recession component = +v·losX.
        // Observer-mover: observer velocity (obVx,obVy) → recession = −(vel·los).
        let vRecede;
        if (moving) vRecede = -(obVx * losX + obVy * losY);
        else vRecede = v * losX; // source velocity is +x
        // fRelativistic takes the approaching component (+ ⇒ blue-shift).
        fObsGeom = fRelativistic(F0, C, -vRecede);
      } else if (moving) {
        // OBSERVER MOVING (classical, medium): received f' = f0 (C + v_toward)/C,
        // where v_toward = component of observer velocity along observer→source.
        // Observer→source unit vector = (−losX, −losY); flips sign automatically
        // once the observer passes the source (then v_toward < 0 ⇒ red-shift).
        const vToward = obVx * (-losX) + obVy * (-losY);
        fObsGeom = fObserverMoving(F0, C, vToward);
      } else {
        // SOURCE MOVING (classical, medium): f' = f0 · C / (C − v_s·cosθ),
        // θ between source velocity (+x) and the line of sight to the observer.
        // v_s·cosθ = component of source velocity toward the observer = v·losX.
        const vLOS = v * losX;
        fObsGeom = fSourceMoving(F0, C, vLOS);
      }

      // ── dual readout at matched Mach: source-mover vs observer-mover ─────────
      // Evaluated for a receiver dead ahead on the axis (cosθ = 1) so it is the
      // pure, comparable head-on shift regardless of which mode is displayed.
      let fSrcMatch, fObsMatch;
      if (rel) {
        // relativistic collapses the asymmetry: both equal the same √-formula.
        fSrcMatch = fRelativistic(F0, C, v);
        fObsMatch = fSrcMatch;
      } else {
        fSrcMatch = fSourceMoving(F0, C, v);       // f0·C/(C−v)
        fObsMatch = fObserverMoving(F0, C, v);     // f0·(C+v)/C
      }

      // ── literal ring-spacing (λ) ahead of vs behind the source ──────────────
      // Measure the radial gap between the two innermost rings on each side along
      // the source's axis. For a source mover this is λ_ahead = (C−v)T ahead and
      // (C+v)T behind; we read it straight off the drawn geometry so the label
      // matches the pixels.
      let lamAhead = null, lamBehind = null;
      let ringsAhead = [], ringsBehind = [];
      if (!moving && !rel) {
        for (const w of wavefronts) {
          const r = C * (sim - w.te);
          if (r <= 1) continue;
          // ahead intersection (to the +x side of this ring's center)
          ringsAhead.push(w.x + r);
          ringsBehind.push(w.x - r);
        }
        // Nearest pair straddling the source position gives the local spacing.
        ringsAhead.sort((a, b) => a - b);
        ringsBehind.sort((a, b) => b - a);
        const aheadEdges = ringsAhead.filter((x) => x >= src.x - 2);
        const behindEdges = ringsBehind.filter((x) => x <= src.x + 2);
        if (aheadEdges.length >= 2) lamAhead = Math.abs(aheadEdges[1] - aheadEdges[0]);
        if (behindEdges.length >= 2) lamBehind = Math.abs(behindEdges[1] - behindEdges[0]);
      }

      // audio tracks the geometric prediction (smooth), clamped to audible range.
      const fForAudio = Number.isFinite(fObsGeom) ? fObsGeom : F0 * 3;
      targetFreqRef.current = Math.max(120, Math.min(1400, (fForAudio / F0) * AUDIO_BASE));
      if (oscRef.current && audioCtxRef.current) {
        oscRef.current.frequency.setTargetAtTime(
          targetFreqRef.current, audioCtxRef.current.currentTime, 0.06,
        );
      }

      // publish readouts ~8×/s
      if (readoutT >= 0.12) {
        readoutT = 0;
        setLive({
          fAhead: rel ? fRelativistic(F0, C, v) : (mNow < 1 ? F0 / (1 - mNow) : Infinity),
          fBehind: rel ? fRelativistic(F0, C, -v) : F0 / (1 + mNow),
          fObs: Number.isFinite(fObsGeom) ? fObsGeom : Infinity,
          fCount: fObsCount,
          fSrcMatch: Number.isFinite(fSrcMatch) ? fSrcMatch : Infinity,
          fObsMatch,
          lamAheadPx: lamAhead,   // measured ring spacing ahead, px
          lamBehindPx: lamBehind, // measured ring spacing behind, px
        });
      }

      // ── render ──────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // medium baseline + source track
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      // wavefronts: glowing gold rings, brightness fading with age so the packed
      // leading edge reads bright & dense and the trailing rings dim out.
      ctx.shadowColor = GOLD;
      for (const w of wavefronts) {
        const r = C * (sim - w.te);
        if (r <= 0.5) continue;
        const age = Math.min(1, r / diag);
        const alpha = (0.7 * (1 - age) + 0.07).toFixed(3);
        ctx.strokeStyle = `rgba(197,183,131,${alpha})`;
        ctx.shadowBlur = 10 * (1 - age);
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // ── λ annotation: literal ring spacing ahead vs behind ──────────────────
      if (!moving && !rel && lamAhead != null && src.x > 60 && src.x < W - 60) {
        const y = H / 2;
        // ahead bracket (green, compressed)
        const a0 = src.x, a1 = src.x + lamAhead;
        ctx.strokeStyle = GREEN;
        ctx.fillStyle = GREEN;
        ctx.lineWidth = 2;
        drawSpan(ctx, a0, a1, y - 40, GREEN);
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`λ_ahead ${lamAhead.toFixed(0)}px`, (a0 + a1) / 2, y - 46);
        // behind bracket (orange, stretched)
        if (lamBehind != null) {
          const b0 = src.x, b1 = src.x - lamBehind;
          ctx.strokeStyle = ORANGE;
          ctx.fillStyle = ORANGE;
          drawSpan(ctx, b0, b1, y + 40, ORANGE);
          ctx.fillText(`λ_behind ${lamBehind.toFixed(0)}px`, (b0 + b1) / 2, y + 58);
        }
      }

      // Sound-barrier wall: near Mach 1 the leading edges coincide — highlight it.
      if (mNow > 0.92 && mNow < 1.08 && !moving && !rel) {
        ctx.strokeStyle = `rgba(255,255,255,${(0.8 - Math.abs(mNow - 1) * 6).toFixed(3)})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = WHITE;
        ctx.shadowBlur = 18;
        // the wall sits at the source, tangent to all fronts (vertical near it)
        ctx.beginPath();
        ctx.moveTo(src.x, 0);
        ctx.lineTo(src.x, H);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Mach cone envelope when supersonic: half-angle θ, sin θ = 1/Mach.
      if (mNow > 1.001 && !moving && !rel) {
        const a = Math.asin(1 / mNow);
        const L = Math.hypot(W, H) * 1.2;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 5]);
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 8;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(src.x - L * Math.cos(a), src.y + s * L * Math.sin(a));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
      }

      // source velocity arrow (subsonic/supersonic, when it is the mover)
      if (!moving && v > 1) {
        const alen = Math.min(46, 18 + v * 0.12);
        ctx.strokeStyle = BLUE;
        ctx.fillStyle = BLUE;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(src.x + alen, src.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(src.x + alen, src.y);
        ctx.lineTo(src.x + alen - 8, src.y - 5);
        ctx.lineTo(src.x + alen - 8, src.y + 5);
        ctx.closePath();
        ctx.fill();
      }

      // source (bright white, strong glow)
      ctx.fillStyle = WHITE;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.arc(src.x, src.y, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.fillText('source', src.x, src.y + 22);

      // observer (blue ring, glowing; draggable target in stationary-source mode)
      const drawObX = moving ? obX : ob.x;
      const drawObY = moving ? obY : ob.y;
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = BLUE;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(drawObX, drawObY, 9, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(drawObX, drawObY, 3, 0, 2 * Math.PI);
      ctx.fillStyle = BLUE;
      ctx.fill();
      ctx.shadowBlur = 0;
      // observer velocity arrow in moving mode (shows approach vs recede)
      if (moving && v > 1) {
        const al = Math.min(42, 16 + v * 0.11);
        ctx.strokeStyle = BLUE;
        ctx.fillStyle = BLUE;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(drawObX, drawObY);
        ctx.lineTo(drawObX - al, drawObY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(drawObX - al, drawObY);
        ctx.lineTo(drawObX - al + 8, drawObY - 5);
        ctx.lineTo(drawObX - al + 8, drawObY + 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = BLUE;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText('observer', drawObX, drawObY - 16);

      // received-frequency badge next to the observer — color keyed to the TRUE
      // shift (so the badge and the arrival count now agree on both halves).
      const badge = Number.isFinite(fObsGeom)
        ? `f' = ${fObsGeom.toFixed(2)} Hz`
        : `f' → ∞ (shock)`;
      ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.fillStyle = !Number.isFinite(fObsGeom)
        ? WHITE
        : (fObsGeom > F0 * 1.001 ? GREEN : (fObsGeom < F0 * 0.999 ? ORANGE : WHITE));
      const bx = Math.max(66, Math.min(W - 66, drawObX));
      ctx.fillText(badge, bx, drawObY + 28);

      // orientation labels on the wave field
      if (!moving && !rel && src.x > 70 && src.x < W - 70 && mNow < 1.001) {
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = GREEN;
        ctx.fillText('compressed → higher f', Math.min(W - 90, src.x + 92), H / 2 - 12);
        ctx.fillStyle = ORANGE;
        ctx.fillText('stretched → lower f', Math.max(90, src.x - 92), H / 2 - 12);
      }
      if (rel) {
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'left';
        ctx.fillText('relativistic light: no medium → source/observer symmetric', 12, H - 12);
      }

      // Mach-1 screen flash overlay (the visible half of the "boom").
      if (flash > 0.001) {
        ctx.fillStyle = `rgba(255,255,255,${(flash * 0.55).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      raf = requestAnimationFrame(draw);
    };

    // Local helper: draw a dimensioned span with tick caps (λ bracket).
    function drawSpan(c, x0, x1, y, col) {
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x0, y); c.lineTo(x1, y);
      c.moveTo(x0, y - 5); c.lineTo(x0, y + 5);
      c.moveTo(x1, y - 5); c.lineTo(x1, y + 5);
      c.stroke();
      // vertical guides to the axis
      c.setLineDash([2, 3]);
      c.beginPath();
      c.moveTo(x0, y); c.lineTo(x0, H / 2);
      c.moveTo(x1, y); c.lineTo(x1, H / 2);
      c.stroke();
      c.setLineDash([]);
    }

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [playClick, playBoom]);

  // ── pointer dragging of the observer (only meaningful when source is mover) ─
  const draggingRef = useRef(false);

  const pointerToFrac = useCallback((e) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0.02, Math.min(0.98, x)),
      y: Math.max(0.04, Math.min(0.96, y)),
    };
  }, []);

  const onPointerDown = useCallback((e) => {
    if (moveObsRef.current) return; // observer is auto-driven in this mode
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pointerToFrac(e);
    if (p) setObs(p);
  }, [pointerToFrac]);

  const onPointerMove = useCallback((e) => {
    if (!draggingRef.current) return;
    const p = pointerToFrac(e);
    if (p) setObs(p);
  }, [pointerToFrac]);

  const onPointerUp = useCallback((e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  // ── HUD strings ────────────────────────────────────────────────────────────
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
  const shift = live.fObs > F0 * 1.001 ? 'blue-shifted (higher)' : live.fObs < F0 * 0.999 ? 'red-shifted (lower)' : 'no shift';
  // asymmetry gap between the two matched-Mach forms (0 in relativistic mode).
  const asymGap = (Number.isFinite(live.fSrcMatch) && Number.isFinite(live.fObsMatch))
    ? live.fSrcMatch - live.fObsMatch
    : Infinity;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider
          label="Speed"
          value={Number(mach.toFixed(2))}
          min={0}
          max={relativistic ? 0.95 : 1.6}
          step={0.01}
          unit={relativistic ? 'β (v/c)' : 'Mach'}
          onChange={setMach}
        />

        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Who is moving?</div>
          <div className="flex gap-1.5">
            {[
              { k: false, label: 'Source moves' },
              { k: true, label: 'Observer moves' },
            ].map(({ k, label }) => (
              <button
                key={String(k)}
                onClick={() => setMoveObserver(k)}
                className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                  moveObserver === k
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-usna-muted text-xs mt-1.5">
            {moveObserver
              ? 'Observer glides toward — then past — a still source. Watch f′ flip from blue to red as it passes.'
              : 'Drag the blue observer anywhere in the field.'}
          </p>
        </div>

        <div className="mb-4">
          <button
            onClick={() => setRelativistic((r) => !r)}
            className={`w-full px-3 py-2 rounded text-sm font-medium border transition-colors ${
              relativistic
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {relativistic ? '💡 Relativistic light (no medium)' : '🔊 Sound (medium) — go relativistic?'}
          </button>
          <p className="text-usna-muted text-xs mt-1.5">
            {relativistic
              ? 'Light has no medium: f′ = f₀·√((1+β)/(1−β)) — source & observer motion give the SAME shift. No sound barrier.'
              : 'Sound rides a medium: source-motion ≠ observer-motion, and a barrier forms at Mach 1.'}
          </p>
        </div>

        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Presets</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                disabled={relativistic && p.mach >= 1}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  relativistic && p.mach >= 1
                    ? 'bg-usna-deep text-usna-muted/40 border-usna-grid cursor-not-allowed'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-2">
          <button
            onClick={() => setAudioOn((a) => !a)}
            className={`w-full px-3 py-2 rounded text-sm font-medium border transition-colors ${
              audioOn
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {audioOn ? '🔊 Audio on — tone + per-ring clicks' : '🔈 Play Doppler audio'}
          </button>
          <p className="text-usna-muted text-xs mt-1.5">
            A tone tracks f′, plus a click on every wavefront arrival — you hear the rate. A boom fires at Mach 1.
          </p>
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Emitted f₀" value={F0.toFixed(2)} unit="Hz" />
          <Readout label="Received f′" value={fmt(live.fObs)} unit="Hz" />
          <Readout label="f′ (arrival count)" value={fmt(live.fCount ?? F0)} unit="Hz" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="f ahead (max)" value={fmt(live.fAhead)} unit="Hz" />
            <Readout label="f behind (min)" value={fmt(live.fBehind)} unit="Hz" />
          </div>

          {/* dual readout at matched speed: the source/observer asymmetry */}
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <div className="text-usna-text text-xs font-medium mb-1">
              Same {relativistic ? 'β' : 'Mach'} = {mach.toFixed(2)}, head-on:
            </div>
            <Readout label="f′ source-moves" value={fmt(live.fSrcMatch)} unit="Hz" />
            <Readout label="f′ observer-moves" value={fmt(live.fObsMatch)} unit="Hz" />
            <div className="text-center mt-1">
              <span className={`text-xs font-mono ${Math.abs(asymGap) < 1e-4 ? 'text-[#7FB77E]' : 'text-usna-gold'}`}>
                {relativistic
                  ? 'Δ = 0 — light is symmetric'
                  : `asymmetry Δ = ${fmt(asymGap)} Hz`}
              </span>
            </div>
          </div>

          {/* measured ring spacing (λ) ahead vs behind */}
          {!relativistic && !moveObserver && (
            <div className="mt-2 pt-2 border-t border-usna-grid">
              <Readout
                label="λ ahead (spacing)"
                value={live.lamAheadPx != null ? live.lamAheadPx.toFixed(0) : '—'}
                unit="px"
              />
              <Readout
                label="λ behind (spacing)"
                value={live.lamBehindPx != null ? live.lamBehindPx.toFixed(0) : '—'}
                unit="px"
              />
            </div>
          )}

          <div className="text-center mt-2">
            <span className={`text-xs font-mono ${
              live.fObs > F0 * 1.001 ? 'text-[#7FB77E]' : live.fObs < F0 * 0.999 ? 'text-[#E0895B]' : 'text-usna-muted'
            }`}>
              {shift}
            </span>
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden select-none"
          style={{ height: 460, background: BG, cursor: moveObserver ? 'default' : 'crosshair', touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            <div>
              {relativistic
                ? `β  ${mach.toFixed(2)}  (v = ${(mach * C).toFixed(0)} px/s, c = ${C})`
                : `Mach  ${mach.toFixed(2)}  (${(mach * C).toFixed(0)} px/s, C = ${C})`}
            </div>
            <div>f₀&nbsp;&nbsp;{F0.toFixed(2)} Hz</div>
          </div>
          {mach > 1.001 && !moveObserver && !relativistic && (
            <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold font-semibold pointer-events-none">
              MACH {mach.toFixed(2)} · sinθ = 1/M = {(1 / mach).toFixed(2)}
            </div>
          )}
          {mach > 0.92 && mach < 1.08 && !moveObserver && !relativistic && (
            <div className="absolute top-2 right-3 text-xs font-mono text-white font-semibold pointer-events-none">
              SOUND BARRIER
            </div>
          )}
          {relativistic && (
            <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold font-semibold pointer-events-none">
              LIGHT · c fixed
            </div>
          )}
        </div>
        <InfoPanel {...(relativistic ? INFO_REL : INFO)} />
      </div>
    </div>
  );
}

const INFO = {
  title: 'Doppler shift is geometry, not magic',
  description:
    "Each ring is a wavefront frozen at the position the source occupied when it emitted — the source then keeps moving, so the emission centers march forward and the rings crowd ahead (short wavelength, higher pitch) while stretching behind (long wavelength, lower pitch). The green/orange brackets measure that ring spacing literally: λ_ahead = (C−v)T is the compressed gap, λ_behind = (C+v)T the stretched one. Drag the observer through the field, or let it glide past a still source: the received f′ rises approaching and drops receding, and the live arrival-count matches the closed formula on BOTH halves. Match the Mach number in the two modes — f′_source = f₀·C/(C−v) is NOT f′_observer = f₀·(C+v)/C, because only the source's motion re-spaces the wavefronts. Push the source to Mach 1 and the leading edges pile into one wall (the sound barrier, with a boom); past it, that wall opens into the Mach cone, half-angle sinθ = 1/Mach.",
  equation: String.raw`f' = f_0\,\frac{c \pm v_o}{c \mp v_s}, \qquad \sin\theta = \frac{1}{M} = \frac{c}{v_s}`,
};

const INFO_REL = {
  title: 'Light has no medium — the asymmetry disappears',
  description:
    "Sound rides a medium, so 'source moving' and 'observer moving' are physically different situations and give different f′ at the same speed (that is the Δ in the dual readout). Light has no medium: there is no rest frame to move relative to, only the RELATIVE velocity between source and observer. The classical two-formula split collapses into one symmetric law, the relativistic Doppler factor f′ = f₀·√((1+β)/(1−β)) with β = v/c. Approaching blue-shifts, receding red-shifts, and — crucially — it makes no difference which one you say is 'moving'. There is also no sound barrier: nothing can reach β = 1, so no wall of piled-up wavefronts ever forms. Toggle back to Sound to feel the contrast.",
  equation: String.raw`f' = f_0\sqrt{\frac{1+\beta}{1-\beta}}, \qquad \beta = \frac{v}{c}`,
};
