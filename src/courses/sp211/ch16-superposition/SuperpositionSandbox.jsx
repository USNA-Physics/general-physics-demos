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

const BEAT_DEFAULTS = { f1: 4.0, f2: 4.0, volume: 0.25 };
// The slider frequencies (Hz) are low so the beat is watchable on-screen. For
// the *ear* we transpose both up by this factor into the audible band; the beat
// frequency |f1−f2| is preserved because the transpose is a common multiplier.
const AUDIO_SCALE = 90;   // 4 Hz → 360 Hz, a comfortable tone
const BEAT_XMAX = 12;     // metres of string shown
const BEAT_SAMPLES = 600;
const BEAT_SPEED = 1.0;   // wave phase speed used to turn f into ω on-screen
// Base spatial wavelength (m) used for both components in the classic (equal-k)
// beat. λ = BEAT_XMAX/3 → three ripples across the window.
const BEAT_LAMBDA = BEAT_XMAX / 3;
// In "moving beats" the second component's wavenumber is detuned by this fraction
// of k so the two k's differ, giving spatial (traveling) beat nodes.
const K_DETUNE = 0.12;

function BeatsMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [f1, setF1] = useState(BEAT_DEFAULTS.f1);
  const [f2, setF2] = useState(BEAT_DEFAULTS.f2);
  const [volume, setVolume] = useState(BEAT_DEFAULTS.volume);
  const [playing, setPlaying] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  const [moving, setMoving] = useState(false); // "moving beats": detune k too

  // live values published from the rAF loop (throttled to avoid per-frame churn)
  const [live, setLive] = useState({ env: 1, vp: 0, vg: 0 });

  // refs the animation + audio read every frame (no re-subscribe on change)
  const f1Ref = useRef(f1); f1Ref.current = f1;
  const f2Ref = useRef(f2); f2Ref.current = f2;
  const showRef = useRef(showComponents); showRef.current = showComponents;
  const movingRef = useRef(moving); movingRef.current = moving;

  const fBeat = beatFreq(f1, f2);

  // ── Web Audio: two oscillators through a gain node ────────────────────────
  const audioRef = useRef({ ctx: null, osc1: null, osc2: null, gain: null });

  const stopAudio = () => {
    const a = audioRef.current;
    try { a.osc1 && a.osc1.stop(); } catch (e) { /* already stopped */ }
    try { a.osc2 && a.osc2.stop(); } catch (e) { /* already stopped */ }
    a.osc1 = a.osc2 = null;
  };

  const startAudio = () => {
    const a = audioRef.current;
    // Create/resume the context only inside this user-gesture handler.
    if (!a.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      a.ctx = new AC();
      a.gain = a.ctx.createGain();
      a.gain.connect(a.ctx.destination);
    }
    if (a.ctx.state === 'suspended') a.ctx.resume();
    a.gain.gain.setValueAtTime(volume, a.ctx.currentTime);

    const mk = (freq) => {
      const o = a.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * AUDIO_SCALE, a.ctx.currentTime);
      o.connect(a.gain);
      o.start();
      return o;
    };
    a.osc1 = mk(f1Ref.current);
    a.osc2 = mk(f2Ref.current);
  };

  const toggleAudio = () => {
    if (playing) { stopAudio(); setPlaying(false); }
    else { startAudio(); setPlaying(true); }
  };

  // keep running oscillators tuned to the current sliders
  useEffect(() => {
    const a = audioRef.current;
    if (!playing || !a.ctx) return;
    if (a.osc1) a.osc1.frequency.setTargetAtTime(f1 * AUDIO_SCALE, a.ctx.currentTime, 0.02);
    if (a.osc2) a.osc2.frequency.setTargetAtTime(f2 * AUDIO_SCALE, a.ctx.currentTime, 0.02);
  }, [f1, f2, playing]);

  useEffect(() => {
    const a = audioRef.current;
    if (a.ctx && a.gain) a.gain.gain.setTargetAtTime(volume, a.ctx.currentTime, 0.02);
  }, [volume]);

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

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
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
      const ampPx = Math.min(H * 0.2, 70);

      const kBase = k_of(BEAT_LAMBDA);
      // classic beat: both share k (temporal beats only). moving beat: detune k.
      const kA = kBase;
      const kB = isMoving ? kBase * (1 + K_DETUNE) : kBase;
      const omA = omega_of(fA) * BEAT_SPEED;
      const omB = omega_of(fB) * BEAT_SPEED;

      const wA = { A: ampPx, k: kA, omega: omA, phase: 0 };
      const wB = { A: ampPx, k: kB, omega: omB, phase: 0 };

      ctx.clearRect(0, 0, W, H);

      // equilibrium axis
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, H / 2); ctx.lineTo(W - padX, H / 2); ctx.stroke();

      const yA = superpose([wA], xs, sim);
      const yB = superpose([wB], xs, sim);
      const ySum = superpose([wA, wB], xs, sim);

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
      if (isMoving && Math.abs(dk) > 1e-9) {
        const envFn = (s) => (x) =>
          s * 2 * ampPx * Math.abs(Math.cos(0.5 * dk * x - 0.5 * dOm * sim));
        // draw both envelope rails as smooth curves
        drawFn(envFn(1), 'rgba(197,183,131,0.32)', 1.4, 1, [5, 6]);
        drawFn(envFn(-1), 'rgba(197,183,131,0.32)', 1.4, 1, [5, 6]);
        // mark the traveling beat nodes (envelope zeros) with small ticks
        ctx.fillStyle = 'rgba(91,155,213,0.9)';
        for (let m = -6; m <= 12; m++) {
          // cos(Δk x/2 − Δω t/2) = 0  →  Δk x/2 − Δω t/2 = (m+½)π
          const x = (2 / dk) * ((m + 0.5) * Math.PI + 0.5 * dOm * sim);
          if (x < 0 || x > BEAT_XMAX) continue;
          const px = padX + (x / BEAT_XMAX) * (W - 2 * padX);
          ctx.beginPath(); ctx.arc(px, H / 2, 3, 0, 2 * Math.PI); ctx.fill();
        }
      } else {
        // classic temporal envelope: flat rails that breathe up/down in time
        const envAmp = Math.abs(2 * ampPx * Math.cos(0.5 * dOm * sim));
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

      if (readoutAccum > 0.12) {
        readoutAccum = 0;
        // for the readouts: phase & group velocity (only meaningful when moving)
        const kbar = 0.5 * (kA + kB);
        const ombar = 0.5 * (omA + omB);
        const vp = kbar !== 0 ? ombar / kbar : 0;
        const vg = Math.abs(dk) > 1e-9 ? dOm / dk : NaN;
        // a representative envelope "now" fraction for the classic case
        const envNow = isMoving ? 1 : Math.abs(Math.cos(0.5 * dOm * sim));
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

  const reset = () => {
    stopAudio(); setPlaying(false);
    setF1(BEAT_DEFAULTS.f1); setF2(BEAT_DEFAULTS.f2);
    setVolume(BEAT_DEFAULTS.volume); setShowComponents(true); setMoving(false);
  };

  const beatPeriod = fBeat > 1e-6 ? 1 / fBeat : Infinity;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Frequency f₁" value={Number(f1.toFixed(2))} min={1} max={8} step={0.05} unit="Hz" onChange={setF1} />
        <Slider label="Frequency f₂" value={Number(f2.toFixed(2))} min={1} max={8} step={0.05} unit="Hz" onChange={setF2} />

        <div className="mb-4">
          <button
            onClick={() => setF2(f1)}
            className="w-full px-3 py-1.5 rounded text-sm border border-usna-grid bg-usna-deep text-usna-text hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            Match f₂ = f₁ (then detune)
          </button>
        </div>

        <div className="border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={toggleAudio}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                playing ? 'bg-usna-gold text-usna-navy' : 'bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold'
              }`}
            >
              {playing ? '❚❚ Mute' : '🔊 Play beats'}
            </button>
            <span className="text-usna-muted text-xs">hear the wah-wah</span>
          </div>
          <Slider label="Volume" value={Number(volume.toFixed(2))} min={0} max={0.6} step={0.01} unit="" onChange={setVolume} />
        </div>

        <div className="border-t border-usna-grid pt-3 space-y-2">
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
              : 'Same k for both waves: the envelope breathes uniformly in time — temporal beats, no traveling nodes.'}
          </p>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Beat frequency" value={fBeat.toFixed(2)} unit="Hz" />
          <Readout label="Beat period" value={isFinite(beatPeriod) ? beatPeriod.toFixed(2) : '∞'} unit="s" />
          {!moving && <Readout label="Envelope now" value={(live.env * 100).toFixed(0)} unit="%" />}
          {moving && (
            <>
              <Readout label="Phase velocity vp" value={live.vp.toFixed(1)} unit="m/s" />
              <Readout label="Group velocity vg" value={isFinite(live.vg) ? live.vg.toFixed(1) : '—'} unit="m/s" />
            </>
          )}
          <Readout label="Audible f₁" value={(f1 * AUDIO_SCALE).toFixed(0)} unit="Hz" />
          <Readout label="Audible f₂" value={(f2 * AUDIO_SCALE).toFixed(0)} unit="Hz" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 420, background: BG }}>
          <canvas ref={canvasRef} className="block" />
          <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5 pointer-events-none">
            <div>f₁ = {f1.toFixed(2)} Hz&nbsp;&nbsp;f₂ = {f2.toFixed(2)} Hz</div>
            <div>f_beat = |f₁ − f₂| = {fBeat.toFixed(2)} Hz</div>
            {moving && <div className="text-[#5B9BD5]">moving beats · nodes travel at vg</div>}
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
const STAND_F1_SIM = 0.28;   // fundamental temporal frequency of the sim clock (slow, watchable)
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

      if (readoutAccum > 0.1) {
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
          <p className="text-usna-muted text-xs mb-2">Click/tap the string to pinch and release — it decomposes into harmonics.</p>
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
              scale. A real plucked string never fully flattens — when the
              fundamental crosses zero the higher harmonics do not.
            </p>
          ) : (
            <p className="text-usna-muted text-xs mt-2">The string is flat — where did the energy go?</p>
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
            {frozen && !pluckApprox && <div className="text-[#7FB77E]">FROZEN · flat · all kinetic energy</div>}
            {frozen && pluckApprox && <div className="text-[#7FB77E]">FROZEN · flattest · nearly all kinetic</div>}
            {cavity && <div className="text-[#5B9BD5]">standing wave in a two-mirror cavity</div>}
          </div>
        </div>

        {/* KE/PE breathing bars + (for a pluck) the live harmonic spectrum */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0">
            <div className="text-usna-text text-sm font-medium mb-2">Energy (breathing)</div>
            <EnergyBars items={barItems} max={1} total={1} height={150} />
            <p className="text-usna-muted text-xs mt-2 leading-snug">
              KE and PE trade 90° out of phase; KE peaks exactly at the flat
              instant. Their sum is constant (the marker line).
            </p>
          </div>

          {pluckModes && (
            <div className="bg-usna-card border border-usna-grid rounded-lg p-3 flex-1 min-w-0">
              <div className="text-usna-text text-sm font-medium mb-2">Harmonic spectrum — tap to toggle</div>
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
    title: 'Beats — the sum has a slow pulse',
    description:
      'Add two traveling waves whose frequencies are almost equal and the sum acquires a slowly breathing amplitude envelope. Where the two waves are momentarily in phase the sum is loud; a moment later they drift out of phase and cancel. That loud-soft-loud cycle repeats at the beat frequency f_beat = |f₁ − f₂| — read it right off the screen, and hear it as the wah-wah in the audio. Because both components here share the same wavenumber k, the envelope has no spatial structure: it breathes uniformly in time (a purely temporal beat). Set f₂ = f₁ (silence in the envelope, one steady tone), then detune by a hair and watch the pulse crawl into existence — then flip on "moving beats" to give the components different k and make the beat nodes travel.',
    equation: String.raw`\sin(\omega_1 t) + \sin(\omega_2 t) = 2\cos\!\Big(\tfrac{\omega_1-\omega_2}{2}t\Big)\sin\!\Big(\tfrac{\omega_1+\omega_2}{2}t\Big),\quad f_{\text{beat}} = |f_1 - f_2|`,
  },
  beatsMoving: {
    title: 'Moving beats — group velocity vs phase velocity',
    description:
      'Give the two components slightly different wavenumbers as well as frequencies and the beat envelope acquires spatial structure: 2A·cos(½Δk·x − ½Δω·t). Now the beat NODES (blue dots) are real points on the string, and they travel — at the group velocity v_g = Δω/Δk — while the fast ripple underneath slides along at the phase velocity v_p = ω̄/k̄. Energy and information ride the envelope, so v_g is the speed that matters for a wave packet or a signal. When v_g ≠ v_p the medium is dispersive; when Δk → 0 you recover the uniform temporal beat of the previous view. This split is the seed of every wave-packet and dispersion discussion to come.',
    equation: String.raw`y = 2A\cos\!\Big(\tfrac{\Delta k}{2}x - \tfrac{\Delta\omega}{2}t\Big)\sin(\bar k\,x - \bar\omega\,t),\quad v_p=\frac{\bar\omega}{\bar k},\ \ v_g=\frac{\Delta\omega}{\Delta k}`,
  },
  standing: {
    title: 'Standing waves — motion everywhere, travel nowhere',
    description:
      'Two identical waves running in opposite directions sum to sin(kx)·cos(ωt): the position sin(kx) freezes the nodes and antinodes in place while cos(ωt) makes the whole pattern breathe. Fixed ends force whole numbers of half-wavelengths, so only the harmonics f_n = n·v/2L survive. Freeze the frame at the instant the string is dead flat: displacement is zero, so potential energy is zero — yet the string is moving fastest everywhere, and the energy is entirely kinetic (watch the KE/PE bars: KE peaks exactly there). A subtlety worth the pause: this dead-flat instant is exact only for a SINGLE mode. A real plucked string is a sum of harmonics with incommensurate-looking phases, and when the fundamental crosses zero the higher harmonics generally do not — so a pluck never truly flattens; "freeze at flat" lands on the flattest instant, not a flat one. Scale the whole picture into a two-mirror cavity and you have the physics of a laser, the mode structure a Michelson interferometer reads out, and the kilometre-scale standing waves LIGO uses to feel a gravitational wave.',
    equation: String.raw`y(x,t) = 2A\sin(kx)\cos(\omega t), \qquad f_n = \frac{n\,v}{2L}`,
  },
};
