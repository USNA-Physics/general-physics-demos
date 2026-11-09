import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import EnergyBars from '@shared/components/EnergyBars';
import { setupCanvas } from '@shared/lib/canvas';
import { superpose, harmonic, beatFreq, makeXs, k_of, omega_of } from '@shared/lib/waveEngine';

/**
 * D40 · Superposition Sandbox — L40 (beats), L41 (standing waves).
 *
 * Two modes, two counterintuitive payoffs, one idea: add sine waves and the
 * geometry of the sum tells the story.
 *
 *   beats    : two traveling waves of nearly-equal frequency summed on a canvas.
 *              The components are drawn faint; the sum is bold. Detune f2 away
 *              from f1 and a slow amplitude *envelope* emerges — the beat — at
 *              f_beat = |f1 − f2|. A two-oscillator Web Audio output makes the
 *              wah-wah audible: the loudness pulse you hear IS the envelope you
 *              see. (Both frequencies are audio-scaled up so the ear can hear
 *              them; the on-screen f1/f2 are the same numbers driving the sound.)
 *
 *              NEW — "moving beats": the classic beat above shares one wavenumber
 *              k for both components, so the envelope breathes UNIFORMLY in time
 *              (temporal beats only — same k). Flip on "moving beats" and the two
 *              components get slightly different k as well as ω. Now the beat
 *              NODES are spatial and they TRAVEL — at the group velocity
 *              v_g = Δω/Δk, while the fast ripple underneath moves at the phase
 *              velocity v_p = ω̄/k̄. The gap between the two is the whole lead-in
 *              to group-vs-phase velocity and wave packets.
 *
 *   standing : two equal, counter-propagating waves sum to sin(kx)cos(ωt).
 *              Nodes and antinodes appear and STAY PUT — everything moves, but
 *              nothing travels. Harmonic buttons snap the wavelength to a
 *              fixed-fixed string mode f_n = n·v/2L (harmonic()). "Pluck" the
 *              string anywhere and it decomposes into its Fourier harmonics; a
 *              live spectrum bar chart shows the coefficients and lets you toggle
 *              individual harmonics on/off to watch the triangle rebuild.
 *              THE MOMENT: freeze the frame where the string is dead flat — the
 *              displacement (and all potential energy) is zero, yet the string
 *              is moving fastest everywhere. The energy went into pure kinetic.
 *              KE/PE breathing bars run continuously (90° out of phase, all-KE
 *              exactly at the flat instant) as the live version of the freeze.
 *
 *              HONESTY FIX: that dead-flat instant is exact ONLY for a single
 *              mode. A multi-harmonic pluck is NEVER perfectly flat — when the
 *              fundamental crosses zero the higher harmonics generally do not, so
 *              the "all kinetic" arrows for a pluck are approximate. We find the
 *              genuinely flattest instant numerically and caption the residual.
 *
 *              FINALE: an optional cavity overlay scales the standing wave into a
 *              two-mirror laser cavity with a mode-number label — the picture
 *              behind a laser, a Michelson interferometer, and LIGO's kilometre
 *              standing waves.
 *
 * The default export is a hook-free wrapper (like FreeFall) that dispatches to a
 * per-mode child, so each child owns its own hooks / canvas / AudioContext and
 * the Rules of Hooks are never bent across a mode switch.
 */

const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const BG = '#0D1321';

// ────────────────────────────────────────────────────────────────────────────
// Wrapper: pick the child by mode. No hooks live here.
// ────────────────────────────────────────────────────────────────────────────
export default function SuperpositionSandbox({ mode = 'beats' }) {
  if (mode === 'standing') return <StandingMode />;
  return <BeatsMode />;
}

// ════════════════════════════════════════════════════════════════════════════
// BEATS (L40)
// ════════════════════════════════════════════════════════════════════════════

// The sliders are REAL audio frequencies (Hz) in a comfortable listening band, so
// the presets (400 & 403, 400 & 600) are literal and the two-oscillator sum below
// is honest. audioHz is the identity: no transpose is needed in this band.
const BEAT_FMIN = 200, BEAT_FMAX = 600;   // base-frequency slider range
const DETUNE_MAX = 20;                     // fine detune slider range, ±Hz (presets reach wider gaps)
const BEAT_DEFAULTS = { f1: 300, f2: 303, volume: 0.14, delta: 0, visSpeed: 0.5 };
const audioHz = (f) => f;
const EPS_EQUAL = 0.5;    // |f1−f2| below this counts as the same frequency
// A real 400 Hz tone scrolling across the window would be an unwatchable blur, and
// a slow beat riding on it would be invisible (the carrier/beat ratio is ~130). So
// the CANVAS is a slow-motion caricature: the carrier is pinned to a fixed watchable
// rate and the detune is exaggerated (tanh) so the beat stays visible, while the
// AUDIO plays the true tones. The eye reads the structure; the ear judges the pitch.
const VIS_CARRIER = 0.9;       // Hz — on-screen average ripple rate (held fixed)
const VIS_DETUNE_GAIN = 40;    // exaggerates the relative detune for the eye
const toVisFreqs = (f1, f2) => {
  const fbar = 0.5 * (f1 + f2) || 1;
  const half = 0.5 * VIS_CARRIER * Math.tanh((VIS_DETUNE_GAIN * (f2 - f1)) / fbar);
  return [VIS_CARRIER - half, VIS_CARRIER + half];
};
const BEAT_PRESETS = [
  { key: 'reinforce', label: '(a) Equal, in step', f1: 400, f2: 400, delta: 0 },
  { key: 'cancel', label: '(b) Equal, ½λ apart', f1: 400, f2: 400, delta: Math.PI },
  { key: 'throb', label: '(c) 400 & 403 (throb)', f1: 400, f2: 403, delta: 0 },
  { key: 'chord', label: '(d) 400 & 600 (two tones)', f1: 400, f2: 600, delta: 0 },
];
const BEAT_XMAX = 12;     // metres of string shown
const BEAT_SAMPLES = 600;
const BEAT_SPEED = 1.0;   // wave phase speed used to turn the visual f into ω on-screen
// Base spatial wavelength (m) used for both components in the classic (equal-k)
// beat. λ = BEAT_XMAX/3 → three ripples across the window.
const BEAT_LAMBDA = BEAT_XMAX / 3;
// In "moving beats" the second component's wavenumber is detuned by this fraction
// of k so the two k's differ, giving spatial (traveling) beat nodes.
const K_DETUNE = 0.12;

function BeatsMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const scopeWrapRef = useRef(null);   // oscilloscope strip: displacement at a probe vs time
  const scopeCanvasRef = useRef(null);

  const [f1, setF1] = useState(BEAT_DEFAULTS.f1);
  const [f2, setF2] = useState(BEAT_DEFAULTS.f2);
  const [delta, setDelta] = useState(BEAT_DEFAULTS.delta); // relative phase (rad), equal-f case
  const [volume, setVolume] = useState(BEAT_DEFAULTS.volume);
  const [visSpeed, setVisSpeed] = useState(BEAT_DEFAULTS.visSpeed); // slow-motion factor (visual only)
  const [playing, setPlaying] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  const [moving, setMoving] = useState(false); // "moving beats": detune k too

  // live values published from the rAF loop (throttled to avoid per-frame churn)
  const [live, setLive] = useState({ env: 1, vp: 0, vg: 0 });

  // refs the animation + audio read every frame (no re-subscribe on change)
  const f1Ref = useRef(f1); f1Ref.current = f1;
  const f2Ref = useRef(f2); f2Ref.current = f2;
  const deltaRef = useRef(delta); deltaRef.current = delta;
  const visSpeedRef = useRef(visSpeed); visSpeedRef.current = visSpeed;
  const showRef = useRef(showComponents); showRef.current = showComponents;
  const movingRef = useRef(moving); movingRef.current = moving;
  const volumeRef = useRef(volume); volumeRef.current = volume;

  const fBeat = beatFreq(f1, f2);

  // ── Web Audio: an honest two-oscillator sum ───────────────────────────────
  // Two real sine oscillators at f₁ and f₂, each through its own gain into a master
  // gain. The beat, the interference, and the chord all EMERGE from the real sum,
  // so there is no faked envelope and no spurious sidebands. A DelayNode on the
  // second branch imposes the relative phase δ for the equal-frequency case: a
  // delay of δ/(2πf) seconds, so δ = π is half a period and the tones cancel.
  const audioRef = useRef({ ctx: null, osc1: null, osc2: null, g1: null, g2: null, delay: null, master: null });

  // seconds of delay that realise phase δ at frequency f (equal-frequency case only)
  const phaseDelaySeconds = (fa, fb, d) => {
    if (Math.abs(fa - fb) >= EPS_EQUAL || fa <= 0) return 0;  // phase drifts on its own
    const dd = (((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    return dd / (2 * Math.PI * fa);
  };

  const stopAudio = (when) => {
    const a = audioRef.current;
    const t = when != null ? when : (a.ctx ? a.ctx.currentTime : 0);
    try { a.osc1 && a.osc1.stop(t); } catch (e) { /* already stopped */ }
    try { a.osc2 && a.osc2.stop(t); } catch (e) { /* already stopped */ }
    a.osc1 = a.osc2 = null;
  };

  const startAudio = () => {
    const a = audioRef.current;
    // Create/resume the context only inside this user-gesture handler.
    if (!a.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      a.ctx = new AC();
      a.master = a.ctx.createGain();
      a.master.gain.value = 0;
      a.master.connect(a.ctx.destination);
    }
    if (a.ctx.state === 'suspended') a.ctx.resume();
    const t = a.ctx.currentTime;
    const o1 = a.ctx.createOscillator(), o2 = a.ctx.createOscillator();
    const g1 = a.ctx.createGain(), g2 = a.ctx.createGain();
    const delay = a.ctx.createDelay(0.05);
    o1.type = o2.type = 'sine';
    o1.frequency.setValueAtTime(audioHz(f1Ref.current), t);
    o2.frequency.setValueAtTime(audioHz(f2Ref.current), t);
    g1.gain.value = 0.5; g2.gain.value = 0.5;  // in step → amplitude 1.0 (louder than one)
    delay.delayTime.setValueAtTime(phaseDelaySeconds(f1Ref.current, f2Ref.current, deltaRef.current), t);
    o1.connect(g1).connect(a.master);
    o2.connect(delay).connect(g2).connect(a.master);
    o1.start(); o2.start();
    a.osc1 = o1; a.osc2 = o2; a.g1 = g1; a.g2 = g2; a.delay = delay;
    a.master.gain.setTargetAtTime(volumeRef.current, t, 0.02);  // soft fade-in, no click
  };

  const toggleAudio = () => {
    const a = audioRef.current;
    if (playing) {
      // ramp the master down, then stop the oscillators a hair later (no click)
      if (a.ctx && a.master) { a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 0.02); stopAudio(a.ctx.currentTime + 0.08); }
      else stopAudio();
      setPlaying(false);
    } else { startAudio(); setPlaying(true); }
  };

  // keep oscillator frequencies, the phase delay, and the volume in sync with the
  // controls, all with short ramps so slider drags stay click-free
  useEffect(() => {
    const a = audioRef.current;
    if (!playing || !a.ctx || !a.osc1 || !a.osc2) return;
    const t = a.ctx.currentTime;
    a.osc1.frequency.setTargetAtTime(audioHz(f1), t, 0.02);
    a.osc2.frequency.setTargetAtTime(audioHz(f2), t, 0.02);
    a.delay.delayTime.setTargetAtTime(phaseDelaySeconds(f1, f2, delta), t, 0.02);
    a.master.gain.setTargetAtTime(volume, t, 0.02);
  }, [f1, f2, delta, volume, playing]);

  // stop + close audio on unmount
  useEffect(() => () => {
    stopAudio();
    const a = audioRef.current;
    if (a.ctx) { try { a.ctx.close(); } catch (e) { /* noop */ } a.ctx = null; }
  }, []);

  // ── canvas animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    const padX = 24;
    const xs = makeXs(BEAT_XMAX, BEAT_SAMPLES);
    let readoutAccum = 0;
    // Accumulated phase of each component. Advancing phase incrementally (rather
    // than evaluating ω·t with the absolute clock) keeps the wave continuous when
    // ω changes, so moving a slider no longer snaps the pattern to a new phase.
    let phiA = 0, phiB = 0;
    // oscilloscope: the REAL beat envelope (loudness vs time). Node spacing is the
    // true beat period 1/Δf, so it tracks Δf and matches what the ear hears (it is
    // driven by the real frequencies, not the slow-motion caricature).
    let scopeCtx, scopeW, scopeH;
    const SCOPE_WIN = 7;                 // seconds of the loudness trace shown (wider = slower scroll)
    const SCOPE_SLOW = 0.6;              // extra calming of the throb rate beyond the speed knob

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      const sw = scopeWrapRef.current, sc = scopeCanvasRef.current;
      if (sw && sc) { scopeW = sw.clientWidth; scopeH = sw.clientHeight; scopeCtx = setupCanvas(sc, scopeW, scopeH); }
    };

    const drawTrace = (y, color, width, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const px = padX + (xs[i] / BEAT_XMAX) * (W - 2 * padX);
        const py = H / 2 - y[i];
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // draw a curve from an analytic function of x (metres)
    const drawFn = (fn, color, width, alpha, dash) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const px = padX + (xs[i] / BEAT_XMAX) * (W - 2 * padX);
        const py = H / 2 - fn(xs[i]);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };

    // oscilloscope: the loudness envelope of the two REAL tones versus time,
    // 2A|cos(πΔf·t)|, drawn analytically per pixel (so it never aliases) and
    // scrolling with the clock. The band pinches to zero at every beat node, one
    // every 1/Δf seconds, so widening Δf visibly packs the throbs closer together.
    // Equal frequencies give a steady band at the interference level 2A|cos(δ/2)|.
    const drawScope = (df, dlt, eq, nowT, spd) => {
      scopeCtx.clearRect(0, 0, scopeW, scopeH);
      scopeCtx.fillStyle = BG; scopeCtx.fillRect(0, 0, scopeW, scopeH);
      scopeCtx.strokeStyle = GRID; scopeCtx.lineWidth = 1;
      scopeCtx.beginPath(); scopeCtx.moveTo(0, scopeH / 2); scopeCtx.lineTo(scopeW, scopeH / 2); scopeCtx.stroke();
      const amp = scopeH * 0.42;
      // envelope scrolls at df·spd·SCOPE_SLOW so the slow-motion knob calms it; the
      // readout still reports the true beat period 1/Δf.
      const envAt = (t) => (eq ? Math.abs(Math.cos(0.5 * dlt)) : Math.abs(Math.cos(Math.PI * df * spd * SCOPE_SLOW * t)));
      const tAt = (x) => nowT - SCOPE_WIN * (1 - x / scopeW);
      // filled band between the ±envelope rails
      scopeCtx.beginPath();
      for (let x = 0; x <= scopeW; x += 2) { const y = scopeH / 2 - envAt(tAt(x)) * amp; x === 0 ? scopeCtx.moveTo(x, y) : scopeCtx.lineTo(x, y); }
      for (let x = scopeW; x >= 0; x -= 2) { const y = scopeH / 2 + envAt(tAt(x)) * amp; scopeCtx.lineTo(x, y); }
      scopeCtx.closePath();
      scopeCtx.fillStyle = 'rgba(197,183,131,0.18)'; scopeCtx.fill();
      // the two rails, bold gold
      scopeCtx.strokeStyle = GOLD; scopeCtx.lineWidth = 1.8;
      [1, -1].forEach((s) => {
        scopeCtx.beginPath();
        for (let x = 0; x <= scopeW; x += 2) { const y = scopeH / 2 - s * envAt(tAt(x)) * amp; x === 0 ? scopeCtx.moveTo(x, y) : scopeCtx.lineTo(x, y); }
        scopeCtx.stroke();
      });
      scopeCtx.fillStyle = MUTED; scopeCtx.font = '10px ui-monospace, monospace';
      scopeCtx.textAlign = 'right';
      scopeCtx.fillText(eq ? 'steady — no beat' : `beat period 1/Δf = ${(1 / df).toFixed(2)} s`, scopeW - 6, scopeH - 6);
      scopeCtx.textAlign = 'left';
    };

    const draw = (now) => {
      if (sim === undefined) { sim = 0; lastNow = now; }
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;
      readoutAccum += dt;

      const fA = f1Ref.current;
      const fB = f2Ref.current;
      const isMoving = movingRef.current;
      const equal = Math.abs(fA - fB) < EPS_EQUAL;
      const ampPx = Math.min(H * 0.2, 70);

      // slow-motion caricature: fixed watchable carrier, exaggerated detune (audio
      // plays the true tones separately).
      const [fVisA, fVisB] = toVisFreqs(fA, fB);

      const kBase = k_of(BEAT_LAMBDA);
      // classic beat: both share k (temporal beats only). moving beat: detune k.
      const kA = kBase;
      const kB = isMoving ? kBase * (1 + K_DETUNE) : kBase;
      // visSpeed scales the whole on-screen motion (carrier and envelope together),
      // a pure slow-motion knob; the audio is unaffected.
      const spd = visSpeedRef.current;
      const omA = omega_of(fVisA) * BEAT_SPEED * spd;
      const omB = omega_of(fVisB) * BEAT_SPEED * spd;

      // advance each component's phase incrementally (continuous across ω changes)
      phiA += omA * dt;
      phiB += omB * dt;
      if (equal) phiB = phiA;   // lock so the relative phase is exactly δ (clean interference)

      // relative phase δ drives the equal-frequency sum from double-height to flat
      const dStatic = equal && !isMoving ? deltaRef.current : 0;
      // bake the accumulated phase into each wave's phase offset (ω = 0, t = 0),
      // so superpose draws sin(kx − φ) with the continuous φ
      const wA = { A: ampPx, k: kA, omega: 0, phase: -phiA };
      const wB = { A: ampPx, k: kB, omega: 0, phase: -phiB + dStatic };

      ctx.clearRect(0, 0, W, H);

      // equilibrium axis
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, H / 2); ctx.lineTo(W - padX, H / 2); ctx.stroke();

      const yA = superpose([wA], xs, 0);
      const yB = superpose([wB], xs, 0);
      const ySum = superpose([wA, wB], xs, 0);

      if (showRef.current) {
        drawTrace(yA, BLUE, 1.6, 0.5);
        drawTrace(yB, GREEN, 1.6, 0.5);
      }

      // Envelope of A·sin(kx−ωt) + A·sin(k'x−ω't):
      //   sum = 2A cos( Δk·x/2 − Δω·t/2 ) · sin( k̄·x − ω̄·t )
      // The envelope is 2A·|cos(Δk·x/2 − Δω·t/2)|.
      //   • classic (Δk=0): envelope = 2A|cos(Δω t/2)| — no x dependence, so it
      //     breathes uniformly in time (temporal beat).
      //   • moving (Δk≠0): the argument depends on x, so beat NODES sit where
      //     cos=0 and they TRAVEL at v_g = Δω/Δk.
      const dk = kA - kB;
      const dOm = omA - omB;
      const dPhi = phiA - phiB;   // accumulated phase difference (= 0 when locked equal)

      if (isMoving && Math.abs(dk) > 1e-9) {
        const envFn = (s) => (x) =>
          s * 2 * ampPx * Math.abs(Math.cos(0.5 * dk * x - 0.5 * dPhi));
        // draw both envelope rails as smooth curves
        drawFn(envFn(1), 'rgba(197,183,131,0.32)', 1.4, 1, [5, 6]);
        drawFn(envFn(-1), 'rgba(197,183,131,0.32)', 1.4, 1, [5, 6]);
        // mark the traveling beat nodes (envelope zeros) with small ticks
        ctx.fillStyle = 'rgba(91,155,213,0.9)';
        for (let m = -6; m <= 12; m++) {
          // cos(Δk x/2 − ΔΦ/2) = 0  →  Δk x/2 − ΔΦ/2 = (m+½)π
          const x = (2 / dk) * ((m + 0.5) * Math.PI + 0.5 * dPhi);
          if (x < 0 || x > BEAT_XMAX) continue;
          const px = padX + (x / BEAT_XMAX) * (W - 2 * padX);
          ctx.beginPath(); ctx.arc(px, H / 2, 3, 0, 2 * Math.PI); ctx.fill();
        }
      } else {
        // classic temporal envelope: flat rails that breathe up/down in time. The
        // phase term folds in δ for the equal-frequency case, so the rails collapse
        // to zero at δ = π (the sum is flat and the tones cancel).
        const envAmp = Math.abs(2 * ampPx * Math.cos(0.5 * (dPhi + dStatic)));
        ctx.strokeStyle = 'rgba(197,183,131,0.28)';
        ctx.lineWidth = 1; ctx.setLineDash([5, 6]);
        [1, -1].forEach((s) => {
          ctx.beginPath();
          ctx.moveTo(padX, H / 2 - s * envAmp);
          ctx.lineTo(W - padX, H / 2 - s * envAmp);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // the sum — bold gold with a glow
      ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
      drawTrace(ySum, GOLD, 2.8, 1);
      ctx.shadowBlur = 0;

      // ── oscilloscope: the loudness envelope of the two true tones, slowed to the
      // same slow-motion factor as the canvas so it scrolls at a watchable pace ───
      if (scopeCtx) drawScope(Math.abs(fA - fB), deltaRef.current, equal, sim, spd);

      if (readoutAccum > 0.12) {
        readoutAccum = 0;
        // for the readouts: phase & group velocity (only meaningful when moving)
        const kbar = 0.5 * (kA + kB);
        const ombar = 0.5 * (omA + omB);
        const vp = kbar !== 0 ? ombar / kbar : 0;
        const vg = Math.abs(dk) > 1e-9 ? dOm / dk : NaN;
        // envelope "now" fraction: the static interference level 2A|cos(δ/2)| when
        // the frequencies are equal, else the breathing temporal-beat envelope
        const envNow = isMoving ? 1 : Math.abs(Math.cos(0.5 * (dPhi + dStatic)));
        setLive({ env: envNow, vp, vg });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const applyPreset = (p) => { setF1(p.f1); setF2(p.f2); setDelta(p.delta); };

  const reset = () => {
    const a = audioRef.current;
    if (a.ctx && a.master) { a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 0.02); stopAudio(a.ctx.currentTime + 0.08); }
    else stopAudio();
    setPlaying(false);
    setF1(BEAT_DEFAULTS.f1); setF2(BEAT_DEFAULTS.f2); setDelta(BEAT_DEFAULTS.delta);
    setVolume(BEAT_DEFAULTS.volume); setVisSpeed(BEAT_DEFAULTS.visSpeed);
    setShowComponents(true); setMoving(false);
  };

  const beatPeriod = fBeat > 1e-6 ? 1 / fBeat : Infinity;
  const gap = Math.abs(f1 - f2);
  const isEqual = gap < EPS_EQUAL;
  const pathFrac = (((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI); // Δx/λ ∈ [0,1)
  // one-line "what you'd hear", from the same numbers that drive the audio
  const hearText = isEqual
    ? (Math.abs(Math.cos(delta / 2)) > 0.92 ? 'louder (reinforcing)'
      : Math.abs(Math.cos(delta / 2)) < 0.08 ? 'silent (cancelling)'
        : 'partly cancelling')
    : gap < 15 ? `throb ${gap.toFixed(gap < 1 ? 1 : 0)} per second`
      : 'two separate tones (a chord)';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider
          label="Base frequency f₁"
          value={Math.round(f1)} min={BEAT_FMIN} max={BEAT_FMAX} step={1} unit="Hz"
          onChange={(v) => { const d = f2 - f1; setF1(v); setF2(v + d); }}
        />
        <Slider
          label="Detune Δf = f₂ − f₁"
          value={Number(Math.max(-DETUNE_MAX, Math.min(DETUNE_MAX, f2 - f1)).toFixed(1))}
          min={-DETUNE_MAX} max={DETUNE_MAX} step={0.2} unit="Hz"
          onChange={(d) => setF2(f1 + d)}
        />
        <p className="text-usna-muted text-xs -mt-2 mb-3 leading-snug">
          Fine detune for beats. For a wide gap or a chord, use the presets below.
        </p>

        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-2">Presets (predict, then listen)</div>
          <div className="grid grid-cols-1 gap-1.5">
            {BEAT_PRESETS.map((p) => {
              const active = f1 === p.f1 && f2 === p.f2 && (p.f1 !== p.f2 || Math.abs(delta - p.delta) < 1e-3);
              return (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p)}
                  className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                    active ? 'bg-usna-gold text-usna-navy border-usna-gold'
                      : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                  }`}
                >{p.label}</button>
              );
            })}
          </div>
          <button
            onClick={() => setF2(f1)}
            className="w-full mt-1.5 px-3 py-1.5 rounded text-xs border border-usna-grid bg-usna-deep text-usna-muted hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            Match f₂ = f₁ (then detune by hand)
          </button>
        </div>

        {/* relative phase: a real, meaningful control only when f₁ = f₂ */}
        <div className="border-t border-usna-grid pt-3">
          {isEqual && !moving ? (
            <>
              <Slider label="Relative phase δ" value={Number(delta.toFixed(2))} min={0} max={2 * Math.PI} step={0.05} unit="rad" onChange={setDelta} />
              <Readout label="Path difference Δx/λ" value={pathFrac.toFixed(2)} unit="λ" />
              <p className="text-usna-muted text-xs mt-1 leading-snug">
                δ = π is a half-wavelength path difference: the two tones arrive antiphase and cancel to silence.
              </p>
            </>
          ) : (
            <p className="text-usna-muted text-xs leading-snug">
              Relative phase applies when f₁ = f₂. With unequal frequencies the phase drifts on its own, which is the beat.
            </p>
          )}
        </div>

        <div className="border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={toggleAudio}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                playing ? 'bg-usna-gold text-usna-navy' : 'bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold'
              }`}
            >
              {playing ? '❚❚ Mute' : '🔊 Play tones'}
            </button>
            <span className="text-usna-gold text-xs font-mono">you'd hear: {hearText}</span>
          </div>
          <Slider label="Volume" value={Number(volume.toFixed(2))} min={0} max={0.6} step={0.01} unit="" onChange={setVolume} />
        </div>

        <div className="border-t border-usna-grid pt-3">
          <Slider label="Animation speed" value={Number(visSpeed.toFixed(2))} min={0.15} max={1.5} step={0.05} unit="×" onChange={setVisSpeed} />
          <p className="text-usna-muted text-xs -mt-2 mb-3 leading-snug">
            Slow-motion for the picture only; the audio frequencies and beat rate are unchanged.
          </p>
          <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-usna-text cursor-pointer select-none">
            <input type="checkbox" checked={showComponents} onChange={(e) => setShowComponents(e.target.checked)} className="accent-[#C5B783]" />
            Show component waves
          </label>
          <label className="flex items-center gap-2 text-sm text-usna-text cursor-pointer select-none">
            <input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} className="accent-[#C5B783]" />
            Moving beats (detune k too)
          </label>
          <p className="text-usna-muted text-xs leading-snug">
            {moving
              ? 'Δk ≠ 0: beat nodes are spatial and travel at the group velocity vg = Δω/Δk, while the ripple moves at the phase velocity vp = ω̄/k̄.'
              : 'Same k for both waves: the envelope breathes uniformly in time, a temporal beat with no traveling nodes.'}
          </p>
          </div>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Beat frequency" value={fBeat.toFixed(fBeat < 10 ? 1 : 0)} unit="Hz" />
          <Readout label="Beat period" value={isFinite(beatPeriod) ? beatPeriod.toFixed(2) : '∞'} unit="s" />
          {!moving && isEqual && <Readout label="Interference level" value={(live.env * 100).toFixed(0)} unit="%" />}
          {!moving && !isEqual && <Readout label="Envelope now" value={(live.env * 100).toFixed(0)} unit="%" />}
          {moving && (
            <>
              <Readout label="Phase velocity vp" value={live.vp.toFixed(1)} unit="m/s" />
              <Readout label="Group velocity vg" value={isFinite(live.vg) ? live.vg.toFixed(1) : '—'} unit="m/s" />
            </>
          )}
          <Readout label="Tone f₁" value={Math.round(f1)} unit="Hz" />
          <Readout label="Tone f₂" value={Math.round(f2)} unit="Hz" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 420, background: BG }}>
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            <div>f₁ = {Math.round(f1)} Hz&nbsp;&nbsp;f₂ = {Math.round(f2)} Hz</div>
            <div>f_beat = |f₁ − f₂| = {fBeat.toFixed(fBeat < 10 ? 1 : 0)} Hz</div>
            <div className="text-usna-muted">slow-motion view · you'd hear: {hearText}</div>
            {moving && <div className="text-[#5B9BD5]">moving beats · nodes travel at vg</div>}
          </div>
        </div>
        <div ref={scopeWrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 120, background: BG }}>
          <canvas ref={scopeCanvasRef} className="block" />
          <div className="absolute top-1.5 left-3 text-xs font-mono text-usna-gold/80 pointer-events-none">
            Beat envelope · loudness vs time · node spacing = beat period 1/Δf (slowed with the speed knob)
          </div>
        </div>
        <InfoPanel {...(moving ? INFO.beatsMoving : INFO.beats)} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STANDING WAVES (L41)
// ════════════════════════════════════════════════════════════════════════════

const STANDING_DEFAULTS = { n: 3, L: 1.0, waveSpeed: 20, ampFrac: 0.7 };
const STANDING_SAMPLES = 300;
const STAND_F1_SIM = 0.10;   // fundamental temporal frequency of the sim clock; low so
                             // even mode n oscillates slowly (n·f) — the velocity arrows
                             // and KE↔PE transfer stay watchable up through the harmonics
const MAX_HARMONIC = 6;
const PLUCK_MODES = 12;      // harmonics kept in the pluck decomposition

function StandingMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [n, setN] = useState(STANDING_DEFAULTS.n);
  const [L, setL] = useState(STANDING_DEFAULTS.L);
  const [v, setV] = useState(STANDING_DEFAULTS.waveSpeed);
  const [ampFrac, setAmpFrac] = useState(STANDING_DEFAULTS.ampFrac);
  const [frozen, setFrozen] = useState(false);
  // pluck decomposition: array of harmonic amplitudes (null → pure single mode)
  const [pluckModes, setPluckModes] = useState(null);
  const [pluckPos, setPluckPos] = useState(null); // fraction along string, for readout
  // per-harmonic on/off toggles for the spectrum (index 0 = harmonic 1)
  const [enabled, setEnabled] = useState(() => Array(PLUCK_MODES).fill(true));
  const [cavity, setCavity] = useState(false); // LIGO/laser-cavity overlay

  const [live, setLive] = useState({
    maxSpeed: 0, flatness: 0, ke: 0.5, pe: 0.5, flatResidual: 0,
  });

  const nRef = useRef(n); nRef.current = n;
  const frozenRef = useRef(frozen); frozenRef.current = frozen;
  const ampRef = useRef(ampFrac); ampRef.current = ampFrac;
  const pluckRef = useRef(pluckModes); pluckRef.current = pluckModes;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const cavityRef = useRef(cavity); cavityRef.current = cavity;
  // freeze the sim clock at the flat instant; store the offset so cos(ω t)=0
  const freezeTimeRef = useRef(null);

  const fN = harmonic(n, v, L); // f_n = n v / 2L

  // ── Fourier decomposition of a triangular pluck ───────────────────────────
  // A string pinched to height 1 at fraction p and released is a triangle; its
  // fixed-fixed sine-series coefficients are:
  //   b_m = (2 / (m²π² p (1−p))) · sin(mπp)
  const decomposePluck = (p) => {
    const modes = [];
    let peak = 0;
    for (let m = 1; m <= PLUCK_MODES; m++) {
      const b = (2 / (m * m * Math.PI * Math.PI * p * (1 - p))) * Math.sin(m * Math.PI * p);
      modes.push(b);
      peak = Math.max(peak, Math.abs(b));
    }
    // normalise so the biggest harmonic is ~1 for a clean drawing amplitude
    return modes.map((b) => b / (peak || 1));
  };

  const onCanvasPointer = (e) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const padX = 44;
    const x0 = padX, x1 = rect.width - padX;
    let p = (e.clientX - rect.left - x0) / (x1 - x0);
    p = Math.max(0.04, Math.min(0.96, p));
    setPluckModes(decomposePluck(p));
    setPluckPos(p);
    setEnabled(Array(PLUCK_MODES).fill(true));
    setFrozen(false);
    freezeTimeRef.current = null;
  };

  const toggleHarmonic = (i) => {
    setEnabled((prev) => {
      const next = prev.slice();
      next[i] = !next[i];
      return next;
    });
    // a change in the active harmonics invalidates any prior freeze phase
    if (frozen) { setFrozen(false); freezeTimeRef.current = null; }
  };

  // effective mode coefficients = decomposition × on/off mask
  const activeModes = (modes, mask) =>
    modes ? modes.map((b, i) => (mask[i] ? b : 0)) : null;

  // ── canvas animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    const padX = 44;
    let readoutAccum = 0;
    const w1 = 2 * Math.PI * STAND_F1_SIM; // fundamental angular frequency of sim

    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // shape(u,t) and transverse velocity vel(u,t) for a given mode list. Each
    // mode m: sin(mπu)·cos(ω_m t), ω_m = m·ω_1; velocity is the ∂/∂t.
    const shapeOf = (modes, nNow, u, t) => {
      if (modes) {
        let s = 0;
        for (let m = 1; m <= modes.length; m++) s += modes[m - 1] * Math.sin(m * Math.PI * u) * Math.cos(m * w1 * t);
        return s;
      }
      return Math.sin(nNow * Math.PI * u) * Math.cos(nNow * w1 * t);
    };
    const velOf = (modes, nNow, u, t) => {
      if (modes) {
        let s = 0;
        for (let m = 1; m <= modes.length; m++) s += -modes[m - 1] * (m * w1) * Math.sin(m * Math.PI * u) * Math.sin(m * w1 * t);
        return s;
      }
      return -(nNow * w1) * Math.sin(nNow * Math.PI * u) * Math.sin(nNow * w1 * t);
    };

    // Energy bookkeeping (up to a common constant): total mechanical energy of
    // mode m ∝ b_m²·ω_m². At time t, KE ∝ Σ b_m² ω_m² sin²(ω_m t) and
    // PE ∝ Σ b_m² ω_m² cos²(ω_m t). For a single mode these are the classic
    // sin²/cos² breathing, 90° out of phase, KE maxing when the string is flat.
    const energyNow = (modes, nNow, t) => {
      let ke = 0, pe = 0;
      if (modes) {
        for (let m = 1; m <= modes.length; m++) {
          const e = modes[m - 1] * modes[m - 1] * (m * w1) * (m * w1);
          const s = Math.sin(m * w1 * t), c = Math.cos(m * w1 * t);
          ke += e * s * s;
          pe += e * c * c;
        }
      } else {
        const e = (nNow * w1) * (nNow * w1);
        const s = Math.sin(nNow * w1 * t), c = Math.cos(nNow * w1 * t);
        ke = e * s * s; pe = e * c * c;
      }
      return { ke, pe, total: ke + pe };
    };

    const draw = (now) => {
      if (sim === undefined) { sim = 0; lastNow = now; }
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      // advance the clock only when not frozen
      if (!frozenRef.current) sim += dt;
      readoutAccum += dt;

      const nNow = nRef.current;
      const modes = activeModes(pluckRef.current, enabledRef.current);
      const x0 = padX, x1 = W - padX, span = x1 - x0;
      const showCavity = cavityRef.current;
      // pull the string toward the top when the cavity overlay is on, to leave
      // room for the mirrors + labels along the bottom band.
      const y0 = showCavity ? H * 0.42 : H / 2;
      const A = Math.min(H * 0.28, 110) * ampRef.current;

      // effective sim time (frozen at the flat instant if requested)
      const tEff = frozenRef.current && freezeTimeRef.current != null ? freezeTimeRef.current : sim;

      const shape = (u) => shapeOf(modes, nNow, u, tEff);
      const vel = (u) => velOf(modes, nNow, u, tEff);

      ctx.clearRect(0, 0, W, H);

      // ── cavity overlay: two mirrors bracketing the string ──────────────────
      if (showCavity) {
        // mirror bars
        ctx.fillStyle = 'rgba(91,155,213,0.9)';
        ctx.fillRect(x0 - 14, y0 - H * 0.34, 8, H * 0.68);
        ctx.fillRect(x1 + 6, y0 - H * 0.34, 8, H * 0.68);
        // hatched backs to read as mirrors
        ctx.strokeStyle = 'rgba(91,155,213,0.6)'; ctx.lineWidth = 1;
        for (let hY = -H * 0.32; hY < H * 0.32; hY += 8) {
          ctx.beginPath(); ctx.moveTo(x0 - 14, y0 + hY); ctx.lineTo(x0 - 22, y0 + hY + 8); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1 + 14, y0 + hY); ctx.lineTo(x1 + 22, y0 + hY + 8); ctx.stroke();
        }
        ctx.fillStyle = MUTED; ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('mirror', x0 - 10, y0 + H * 0.38);
        ctx.fillText('mirror', x1 + 10, y0 + H * 0.38);
        // cavity length label + mode number q = number of half-wavelengths
        const q = modes ? '(many)' : String(nNow);
        ctx.fillStyle = GOLD; ctx.font = '12px ui-monospace, monospace';
        ctx.fillText(`cavity length L = q·(λ/2),  mode q = ${q}`, (x0 + x1) / 2, H - 16);
        ctx.textAlign = 'left';
      }

      // equilibrium axis
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();

      // faint envelopes for a pure single mode (nodes/antinodes made obvious)
      if (!modes) {
        ctx.strokeStyle = 'rgba(139,140,142,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        [1, -1].forEach((s) => {
          ctx.beginPath();
          for (let i = 0; i <= STANDING_SAMPLES; i++) {
            const u = i / STANDING_SAMPLES;
            const px = x0 + u * span;
            const py = y0 - s * A * Math.sin(nNow * Math.PI * u);
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke();
        });
        ctx.setLineDash([]);

        // nodes (fixed) and antinodes
        for (let kk = 0; kk <= nNow; kk++) {
          const px = x0 + (kk / nNow) * span;
          ctx.fillStyle = BLUE;
          ctx.beginPath(); ctx.arc(px, y0, 3.5, 0, 2 * Math.PI); ctx.fill();
        }
      }

      // the live string, coloured by whether we're at the flat instant
      let maxAbs = 0, maxSpeed = 0;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.8;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 9;
      ctx.beginPath();
      for (let i = 0; i <= STANDING_SAMPLES; i++) {
        const u = i / STANDING_SAMPLES;
        const yv = shape(u);
        const sv = Math.abs(vel(u));
        if (Math.abs(yv) > maxAbs) maxAbs = Math.abs(yv);
        if (sv > maxSpeed) maxSpeed = sv;
        const px = x0 + u * span;
        const py = y0 - A * yv;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // when nearly flat, splash green velocity arrows to show it's all kinetic.
      // For a single mode maxAbs→0 exactly; for a pluck it bottoms out at a
      // small residual (the higher harmonics), and we still draw the arrows to
      // show "almost all kinetic".
      if (maxAbs < 0.12) {
        ctx.strokeStyle = GREEN; ctx.lineWidth = 1.6; ctx.fillStyle = GREEN;
        for (let g = 1; g < 9; g++) {
          const u = g / 9;
          const px = x0 + u * span;
          const vv = vel(u);
          const len = Math.max(-60, Math.min(60, A * vv * 0.5));
          if (Math.abs(len) < 2) continue;
          ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y0 - len); ctx.stroke();
          const dir = len > 0 ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(px, y0 - len);
          ctx.lineTo(px - 4, y0 - len - dir * 6);
          ctx.lineTo(px + 4, y0 - len - dir * 6);
          ctx.closePath(); ctx.fill();
        }
      }

      // anchor blocks at fixed ends (skip when cavity draws its own mirrors)
      if (!showCavity) {
        ctx.fillStyle = MUTED;
        ctx.fillRect(x0 - 6, y0 - 14, 6, 28);
        ctx.fillRect(x1, y0 - 14, 6, 28);
      }

      if (readoutAccum > 0.016) {   // ~60/s so the KE↔PE energy bars stay smooth
        readoutAccum = 0;
        const en = energyNow(modes, nNow, tEff);
        const kf = en.total > 0 ? en.ke / en.total : 0;
        setLive({
          maxSpeed,
          flatness: 1 - Math.min(1, maxAbs),
          ke: kf,
          pe: 1 - kf,
          flatResidual: maxAbs, // used for the pluck-honesty caption
        });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // "Freeze at flat" — find the instant the string is flattest and pause there.
  //
  //   • Single mode: exact. cos(ω t)=0 at ω t = π/2, so t = π/(2ω); the string
  //     is dead flat and moving fastest everywhere.
  //   • Pluck: NOT exact. The mode phases m·ω₁·t generally can't all be at their
  //     zero-crossing simultaneously, so the string never truly flattens. We
  //     scan one fundamental period for the instant that minimises the peak
  //     |displacement| and freeze there — the flattest the string ever gets.
  const freezeAtFlat = () => {
    const w1 = 2 * Math.PI * STAND_F1_SIM;
    const modes = activeModes(pluckModes, enabled);
    if (!modes) {
      const omega = n * w1;
      freezeTimeRef.current = Math.PI / (2 * omega);
      setFrozen(true);
      return;
    }
    // numerically scan t over one fundamental period T1 = 2π/ω1 for min peak
    const T1 = (2 * Math.PI) / w1;
    const STEPS = 720, USAMP = 60;
    let bestT = 0, bestPeak = Infinity;
    for (let s = 0; s < STEPS; s++) {
      const t = (s / STEPS) * T1;
      let peak = 0;
      for (let j = 1; j < USAMP; j++) {
        const u = j / USAMP;
        let y = 0;
        for (let m = 1; m <= modes.length; m++) {
          y += modes[m - 1] * Math.sin(m * Math.PI * u) * Math.cos(m * w1 * t);
        }
        const ay = Math.abs(y);
        if (ay > peak) peak = ay;
      }
      if (peak < bestPeak) { bestPeak = peak; bestT = t; }
    }
    freezeTimeRef.current = bestT;
    setFrozen(true);
  };

  const clearPluck = () => {
    setPluckModes(null); setPluckPos(null); setFrozen(false);
    setEnabled(Array(PLUCK_MODES).fill(true));
    freezeTimeRef.current = null;
  };

  const reset = () => {
    setN(STANDING_DEFAULTS.n); setL(STANDING_DEFAULTS.L); setV(STANDING_DEFAULTS.waveSpeed);
    setAmpFrac(STANDING_DEFAULTS.ampFrac); setFrozen(false);
    setPluckModes(null); setPluckPos(null); setCavity(false);
    setEnabled(Array(PLUCK_MODES).fill(true));
    freezeTimeRef.current = null;
  };

  // KE/PE bars, scaled to the total (constant) mechanical energy so the two
  // bars trade height and their sum stays pinned at the marker line.
  const barItems = [
    { label: 'KE', value: live.ke, color: GREEN },
    { label: 'PE', value: live.pe, color: 'rgba(197,183,131,0.55)' },
  ];

  // spectrum display: normalised |b_m| of the current pluck (for the bar chart)
  const specMax = pluckModes ? Math.max(...pluckModes.map((b) => Math.abs(b)), 1e-9) : 1;

  // is the pluck freeze only approximate right now? (more than one active mode)
  const activeCount = pluckModes ? enabled.filter(Boolean).length : 0;
  const pluckApprox = pluckModes && activeCount > 1;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Harmonic (snaps f_n = n·v/2L)</div>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: MAX_HARMONIC }, (_, i) => i + 1).map((k) => (
              <button
                key={k}
                onClick={() => { setN(k); clearPluck(); }}
                className={`py-1.5 rounded text-sm border transition-colors ${
                  !pluckModes && n === k
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <Slider label="String length L" value={Number(L.toFixed(2))} min={0.5} max={2} step={0.05} unit="m" onChange={(x) => { setL(x); }} />
        <Slider label="Wave speed v" value={Number(v.toFixed(0))} min={5} max={60} step={1} unit="m/s" onChange={(x) => { setV(x); }} />
        <Slider label="Amplitude" value={Number(ampFrac.toFixed(2))} min={0.1} max={1} step={0.05} unit="" onChange={setAmpFrac} />

        <div className="border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">Pluck the string</div>
          <p className="text-usna-muted text-xs mb-2">Click/tap the string to pinch and release; it decomposes into harmonics.</p>
          {pluckModes && (
            <button
              onClick={clearPluck}
              className="w-full px-3 py-1.5 rounded text-sm border border-usna-grid bg-usna-deep text-usna-text hover:border-usna-gold hover:text-usna-gold transition-colors mb-2"
            >
              ← back to single mode
            </button>
          )}
        </div>

        <div className="border-t border-usna-grid pt-3">
          <button
            onClick={() => (frozen ? setFrozen(false) : freezeAtFlat())}
            className={`w-full px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              frozen ? 'bg-usna-gold text-usna-navy' : 'bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {frozen ? '▶ Resume' : '❄ Freeze at flat instant'}
          </button>
          {frozen && pluckApprox ? (
            <p className="text-[#7FB77E] text-xs mt-2 leading-snug">
              Flattest ≠ flat: residual peak {(live.flatResidual * 100).toFixed(0)}% of full
              scale. A real plucked string never fully flattens: when the
              fundamental crosses zero the higher harmonics do not.
            </p>
          ) : (
            <p className="text-usna-muted text-xs mt-2">The string is flat: where did the energy go?</p>
          )}
        </div>

        <div className="border-t border-usna-grid pt-3">
          <label className="flex items-center gap-2 text-sm text-usna-text cursor-pointer select-none">
            <input type="checkbox" checked={cavity} onChange={(e) => setCavity(e.target.checked)} className="accent-[#C5B783]" />
            Laser-cavity / LIGO overlay
          </label>
          <p className="text-usna-muted text-xs mt-1 leading-snug">Bracket the string with two mirrors: this IS a laser cavity / interferometer arm.</p>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          {!pluckModes ? (
            <>
              <Readout label="Harmonic n" value={String(n)} unit="" />
              <Readout label="Frequency f_n" value={fN.toFixed(1)} unit="Hz" />
              <Readout label="Wavelength λ_n" value={((2 * L) / n).toFixed(2)} unit="m" />
              <Readout label="Nodes" value={String(n + 1)} unit="" />
            </>
          ) : (
            <>
              <Readout label="Pluck at" value={pluckPos != null ? (pluckPos * 100).toFixed(0) : '—'} unit="%" />
              <Readout label="Active harmonics" value={`${activeCount}/${PLUCK_MODES}`} unit="" />
            </>
          )}
          <Readout label="Flatness" value={(live.flatness * 100).toFixed(0)} unit="%" />
          <Readout label="Kinetic fraction" value={(live.ke * 100).toFixed(0)} unit="%" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          onPointerDown={onCanvasPointer}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative cursor-crosshair touch-none"
          style={{ height: 420, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            {pluckModes ? (
              <div>plucked · Fourier sum ({activeCount}/{PLUCK_MODES} harmonics)</div>
            ) : (
              <>
                <div>n = {n}&nbsp;&nbsp;f_n = {fN.toFixed(1)} Hz</div>
                <div>nodes {n + 1} · antinodes {n}</div>
              </>
            )}
            {frozen && !pluckApprox && <div className="text-[#7FB77E]">Frozen · flat · all kinetic energy</div>}
            {frozen && pluckApprox && <div className="text-[#7FB77E]">Frozen · flattest · nearly all kinetic</div>}
            {cavity && <div className="text-[#5B9BD5]">standing wave in a two-mirror cavity</div>}
          </div>
        </div>

        {/* KE/PE breathing bars + (for a pluck) the live harmonic spectrum */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0">
            <div className="text-usna-text text-sm font-medium mb-2">Energy (KE ↔ PE)</div>
            <EnergyBars items={barItems} max={1} total={1} height={150} />
            <p className="text-usna-muted text-xs mt-2 leading-snug">
              KE and PE trade 90° out of phase; KE peaks exactly at the flat
              instant. Their sum is constant (the marker line).
            </p>
          </div>

          {pluckModes && (
            <div className="bg-usna-card border border-usna-grid rounded-lg p-3 flex-1 min-w-0">
              <div className="text-usna-text text-sm font-medium mb-2">Harmonic spectrum · tap to toggle</div>
              <div className="flex items-end gap-1.5" style={{ height: 130 }}>
                {pluckModes.map((b, i) => {
                  const frac = Math.abs(b) / specMax;
                  const on = enabled[i];
                  return (
                    <button
                      key={i}
                      onClick={() => toggleHarmonic(i)}
                      title={`harmonic ${i + 1}`}
                      className="flex flex-col items-center justify-end h-full flex-1 min-w-0 group"
                    >
                      <div className="relative w-full h-full flex items-end bg-usna-deep border border-usna-grid rounded-sm overflow-hidden">
                        <div
                          className="w-full transition-all"
                          style={{
                            height: `${Math.max(2, frac * 100)}%`,
                            background: on ? GOLD : 'rgba(139,140,142,0.35)',
                          }}
                        />
                      </div>
                      <span className={`text-[10px] mt-1 font-mono ${on ? 'text-usna-gold' : 'text-usna-muted line-through'}`}>
                        {i + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-usna-muted text-xs mt-2 leading-snug">
                Triangular pluck → odd/even mix falling as 1/m². Toggle harmonics
                off and watch the triangle lose its corner and round off.
              </p>
            </div>
          )}
        </div>

        <InfoPanel {...INFO.standing} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
const INFO = {
  beats: {
    title: 'Beats: superposition you can hear',
    description:
      'The output is the literal sum of two tones, y = y₁ + y₂, played by two real oscillators. With equal frequencies the result depends only on the relative phase δ: in step the tones reinforce to twice the amplitude, and a half-wavelength path difference (δ = π) makes them arrive antiphase and cancel to silence. Detune them slightly and the two tones drift in and out of phase on their own, so the amplitude breathes at the beat frequency f_beat = |f₁ − f₂|, heard as a throb. Widen the gap and the throb outruns the ear, which then stops hearing one pulsing tone and hears two separate pitches. Beats are the small-gap limit of a chord; the operation is the same sum throughout. The canvas is drawn in slow motion with the pitch difference exaggerated so the waveform stays visible, while the audio plays the true frequencies. Flip on "moving beats" to give the components different wavenumbers and make the beat nodes travel.',
    equation: String.raw`y = y_1 + y_2,\qquad \text{equal } f:\ 2A\cos\tfrac{\delta}{2},\qquad f_{\text{beat}} = |f_1 - f_2|`,
  },
  beatsMoving: {
    title: 'Moving beats: group velocity vs phase velocity',
    description:
      'Give the two components slightly different wavenumbers as well as frequencies and the beat envelope acquires spatial structure: 2A·cos(½Δk·x − ½Δω·t). Now the beat nodes (blue dots) are real points on the string, and they travel at the group velocity v_g = Δω/Δk, while the fast ripple underneath slides along at the phase velocity v_p = ω̄/k̄. Energy and information ride the envelope, so v_g is the speed that matters for a wave packet or a signal. When v_g ≠ v_p the medium is dispersive; when Δk → 0 you recover the uniform temporal beat of the previous view. This split is the seed of every wave-packet and dispersion discussion to come.',
    equation: String.raw`y = 2A\cos\!\Big(\tfrac{\Delta k}{2}x - \tfrac{\Delta\omega}{2}t\Big)\sin(\bar k\,x - \bar\omega\,t),\quad v_p=\frac{\bar\omega}{\bar k},\ \ v_g=\frac{\Delta\omega}{\Delta k}`,
  },
  standing: {
    title: 'Standing waves: motion everywhere, travel nowhere',
    description:
      'Two identical waves running in opposite directions sum to sin(kx)·cos(ωt): the position sin(kx) freezes the nodes and antinodes in place while cos(ωt) makes the whole pattern breathe. Fixed ends force whole numbers of half-wavelengths, so only the harmonics f_n = n·v/2L survive. Freeze the frame at the instant the string is dead flat: displacement is zero, so potential energy is zero, yet the string is moving fastest everywhere and the energy is entirely kinetic (watch the KE/PE bars: KE peaks exactly there). A subtlety worth the pause: this dead-flat instant is exact only for a single mode. A real plucked string is a sum of harmonics with incommensurate-looking phases, and when the fundamental crosses zero the higher harmonics generally do not, so a pluck never truly flattens; "freeze at flat" lands on the flattest instant, not a flat one. Scale the whole picture into a two-mirror cavity and you have the physics of a laser, the mode structure a Michelson interferometer reads out, and the kilometre-scale standing waves LIGO uses to feel a gravitational wave.',
    equation: String.raw`y(x,t) = 2A\sin(kx)\cos(\omega t), \qquad f_n = \frac{n\,v}{2L}`,
  },
};
