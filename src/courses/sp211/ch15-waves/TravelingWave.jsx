import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { sampleWave, k_of, omega_of, waveSpeed } from '@shared/lib/waveEngine';

/**
 * D37 · Traveling Wave Explorer — L37 (transverse), L38 (longitudinal).
 *
 * The one idea this demo exists to kill: *the medium does not travel with the
 * wave*. A traveling wave y(x,t) = A·sin(kx − ωt) carries a pattern (phase and
 * energy) to the right while every piece of the medium only oscillates in place.
 *
 *   transverse (L37) : a string. Marked medium-particles bob purely vertically
 *                      while the waveform sails horizontally. Click any particle
 *                      to lock a trace on it and watch it move up/down only. A
 *                      tension/density pair drives v = √(F_T/μ); an f/λ pair
 *                      drives v = f·λ. THE MOMENT: what moves right is the shape,
 *                      not the stuff. Two overlays sharpen it:
 *                        • ghost-trail — fading vertical smears at each marked
 *                          particle's past positions; the medium's history is a
 *                          set of vertical bars while the gold shape glides right.
 *                        • energy shading — local power P = −F_T (∂y/∂x)(∂y/∂t),
 *                          which is one-signed for a rightward wave: energy flows
 *                          right even though every particle only bobs in place.
 *   longitudinal (L38): a column of air particles compressing/rarefying as the
 *                      wave passes, shown three ways —
 *                        • particles     (compressions = crowding of dots)
 *                        • displacement curve s(x,t)  AND  pressure curve p(x,t),
 *                          with p ∝ −∂s/∂x so the two are 90° out of phase (the
 *                          classic exam trap: pressure maxima land on displacement
 *                          *zeros*), plus a draggable cursor reading s, p, and
 *                          local density at one x with a live callout, and
 *                        • an intensity sub-view: a point source with 1/r²
 *                          falloff rings and two draggable listeners showing each
 *                          sound level in dB and the dB *difference* between them.
 *
 * Wrapper is hook-free and branches by mode; each child owns its own hooks
 * (Rules of Hooks). Canvas work uses setupCanvas + ResizeObserver + a bounded-dt
 * rAF loop; the wave math comes from @shared/lib/waveEngine.
 */

// ── palette (hex for canvas; tailwind classes for DOM) ─────────────────────
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BLUE = '#5B9BD5';
const RED = '#E06C6C';
const GRID = '#1A2332';
const BG = '#0D1321';

// One radian of sim time per (2π·f) seconds; we run a slow display frequency so
// the eye can track individual particles rather than a blur.
const F_DISPLAY = 0.35; // Hz of the on-screen animation clock (independent of physics f)

export default function TravelingWave({ mode = 'transverse' }) {
  // Thin wrapper: no hooks here so switching modes can never reorder hooks.
  if (mode === 'longitudinal') return <Longitudinal />;
  return <Transverse />;
}

/* ========================================================================== *
 *  TRANSVERSE (L37)                                                           *
 * ========================================================================== */

const TX_DEFAULTS = { A: 0.4, lambda: 2.0, freq: 0.8, tension: 40, mu: 4 };

function Transverse() {
  const [A, setA] = useState(TX_DEFAULTS.A);           // m
  const [lambda, setLambda] = useState(TX_DEFAULTS.lambda); // m
  const [freq, setFreq] = useState(TX_DEFAULTS.freq);  // Hz (physics)
  const [tension, setTension] = useState(TX_DEFAULTS.tension); // N
  const [mu, setMu] = useState(TX_DEFAULTS.mu);        // g/m entered; kg/m internal
  const [driveBy, setDriveBy] = useState('fλ');        // 'fλ' or 'string' (v = √(F_T/μ))
  const [paused, setPaused] = useState(false);
  const [showParticles, setShowParticles] = useState(true);
  const [showGhost, setShowGhost] = useState(false);   // fading vertical smears of particle history
  const [showEnergy, setShowEnergy] = useState(false); // local power P(x,t) shading
  const [selected, setSelected] = useState(null);      // index of tracked particle, or null

  // live readouts published from the rAF loop without per-frame React churn
  const [live, setLive] = useState({ y: 0, vy: 0 });

  const reset = () => {
    setA(TX_DEFAULTS.A); setLambda(TX_DEFAULTS.lambda); setFreq(TX_DEFAULTS.freq);
    setTension(TX_DEFAULTS.tension); setMu(TX_DEFAULTS.mu); setDriveBy('fλ');
    setPaused(false); setShowParticles(true); setShowGhost(false); setShowEnergy(false);
    setSelected(null);
  };

  // μ slider is in g/m for a friendly range; convert to kg/m for physics.
  const muSI = mu / 1000;
  // Wave speed & derived quantities depend on which pair the user is driving.
  const vString = waveSpeed(tension, muSI);      // √(F_T/μ)
  const v = driveBy === 'string' ? vString : freq * lambda;
  const fEff = driveBy === 'string' ? v / lambda : freq;    // f that actually animates
  const lambdaEff = lambda;
  const k = k_of(lambdaEff);
  const period = fEff > 0 ? 1 / fEff : Infinity;
  // effective tension used for the power overlay: the string pair sets F_T
  // directly; the f·λ pair implies F_T = μ v² so the energy shading still means
  // something physical.
  const F_T_eff = driveBy === 'string' ? tension : muSI * v * v;

  // ── refs mirror state for the animation loop ─────────────────────────────
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const paramRef = useRef({});
  paramRef.current = { A, k, showParticles, showGhost, showEnergy, selected, paused, F_T_eff };
  const selectedRef = useRef(selected); selectedRef.current = selected;
  // number of marked particles across the visible span
  const N_PART = 21;
  const geomRef = useRef({ x0: 0, x1: 0, y0: 0, W: 0 });
  // ghost history: for each marked particle, a ring buffer of recent y-pixels
  const GHOST_LEN = 26; // how many past frames of history to keep per particle
  const ghostRef = useRef(null);

  // Angular frequency for the *display* clock, scaled so the pattern moves at a
  // watchable pace but still respects the relative f the sliders imply.
  const omegaDispRef = useRef(0);
  omegaDispRef.current = omega_of(F_DISPLAY) * (fEff / TX_DEFAULTS.freq);

  // Map physics x (m) → pixels. We show a fixed physical window (X_MAX meters).
  const X_MAX = 6; // m of string on screen

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim = 0, lastNow;
    const padX = 24;

    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // pointer → nearest marked particle (click to track)
    const pick = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const { x0, x1 } = geomRef.current;
      const span = x1 - x0;
      if (span <= 0) return;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < N_PART; i++) {
        const gx = x0 + (i / (N_PART - 1)) * span;
        const d = Math.abs(gx - px);
        if (d < bestD) { bestD = d; best = i; }
      }
      setSelected((s) => (s === best ? null : best));
    };
    const onPointerDown = (e) => { pick(e.clientX); };
    canvas.addEventListener('pointerdown', onPointerDown);

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000; lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      const p = paramRef.current;
      if (!p.paused) sim += dt;

      const x0 = padX, x1 = W - padX;
      const y0 = H / 2;
      const span = x1 - x0;
      geomRef.current = { x0, x1, y0, W };

      const Apx = Math.min(H * 0.36, p.A / 0.5 * (H * 0.30)); // scale amplitude to canvas
      const omega = omegaDispRef.current;

      // physics: y(x,t) = A sin(kx − ωt); here x in meters, ω is display ω.
      const yAt = (xMeters) => sampleWave({ A: p.A, k: p.k, omega, phase: 0 }, xMeters, sim);
      const yToPx = (yVal) => y0 - (yVal / 0.5) * (H * 0.30);
      // partial derivatives of y(x,t) for the energy-transport overlay.
      //   ∂y/∂x =  A k cos(kx − ωt)
      //   ∂y/∂t = −A ω cos(kx − ωt)
      const dydx = (xm) => p.A * p.k * Math.cos(p.k * xm - omega * sim);
      const dydt = (xm) => -p.A * omega * Math.cos(p.k * xm - omega * sim);

      ctx.clearRect(0, 0, W, H);

      // ── energy-transport shading (behind everything) ─────────────────────
      // Local power carried past x:  P(x,t) = −F_T (∂y/∂x)(∂y/∂t).
      // For a rightward wave the two cosines multiply to a square, so with the
      // leading minus P ≥ 0 everywhere — energy always flows *right* even though
      // each particle only bobs in place. We shade P as a green haze above/below
      // the axis; its magnitude is largest where the string moves fastest (the
      // zero-crossings), not at the crests.
      if (p.showEnergy) {
        const SAMP_E = 120;
        // normalize by the peak possible power so the haze scale is stable
        const Ppeak = Math.max(1e-9, p.F_T_eff * p.A * p.k * p.A * omega);
        const step = span / SAMP_E;
        for (let i = 0; i < SAMP_E; i++) {
          const xm = (i / SAMP_E) * X_MAX;
          const gx = x0 + (i / SAMP_E) * span;
          const P = -p.F_T_eff * dydx(xm) * dydt(xm); // ≥ 0 for rightward wave
          const frac = Math.max(0, Math.min(1, P / Ppeak));
          if (frac < 0.02) continue;
          // column of green haze from axis, height ∝ instantaneous power
          const colH = frac * (Apx + 14);
          ctx.fillStyle = `rgba(127,183,126,${0.10 + 0.34 * frac})`;
          ctx.fillRect(gx, y0 - colH, step + 1, 2 * colH);
        }
        // a right-pointing arrow reminding that the net flow is one-directional
        const ay = y0 - Apx - 18;
        ctx.strokeStyle = 'rgba(127,183,126,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x1 - 74, ay); ctx.lineTo(x1 - 30, ay); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 - 30, ay); ctx.lineTo(x1 - 38, ay - 4); ctx.lineTo(x1 - 38, ay + 4);
        ctx.closePath(); ctx.fillStyle = 'rgba(127,183,126,0.9)'; ctx.fill();
        ctx.fillStyle = 'rgba(127,183,126,0.9)'; ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('energy →', x1 - 78, ay + 4);
        ctx.textAlign = 'left';
      }

      // equilibrium axis
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();

      // ── ghost-trail: fading vertical smears of each particle's past ──────
      // We keep, per marked particle, a short history of its screen y. Drawing
      // it as a vertical bar of fading dots makes the medium's motion read as a
      // set of *vertical* streaks while the gold shape glides horizontally — the
      // pattern-vs-medium contrast in one glance.
      if (p.showGhost && p.showParticles) {
        if (!ghostRef.current) ghostRef.current = new Array(N_PART).fill(null).map(() => []);
        const hist = ghostRef.current;
        for (let i = 0; i < N_PART; i++) {
          const frac = i / (N_PART - 1);
          const xm = frac * X_MAX;
          const gx = x0 + frac * span;
          const gy = yToPx(yAt(xm));
          if (!p.paused) {
            const h = hist[i];
            h.push(gy);
            if (h.length > GHOST_LEN) h.shift();
          }
          const h = hist[i];
          // draw oldest→newest so the newest sits on top and is brightest
          for (let j = 0; j < h.length; j++) {
            const age = j / GHOST_LEN;          // 0 = oldest, →1 newest
            const a = 0.05 + 0.30 * age;        // fade with age
            ctx.fillStyle = `rgba(197,183,131,${a})`;
            ctx.fillRect(gx - 1.4, h[j] - 1.4, 2.8, 2.8);
          }
        }
      } else if (ghostRef.current) {
        // clear stored history when the trail is turned off so it doesn't jump
        ghostRef.current = null;
      }

      // the string / waveform
      const SAMP = 220;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i <= SAMP; i++) {
        const xm = (i / SAMP) * X_MAX;
        const gx = x0 + (i / SAMP) * span;
        const gy = yToPx(yAt(xm));
        i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // a moving phase marker: a small vertical guide riding an actual CREST, to
      // make the *pattern's* rightward travel unmistakable (crest speed = v).
      // A crest is where y is maximal → sin(kx − ωt) = +1 → kx − ωt = π/2, so
      //   x_crest = (π/2 + ω t) / k .  (The old code used kx − ωt = 0, which is a
      // phase *zero*, not a crest.)
      const crestXm = (Math.PI / 2 + omega * sim) / p.k;
      let cxm = crestXm % X_MAX; if (cxm < 0) cxm += X_MAX;
      const cgx = x0 + (cxm / X_MAX) * span;
      const cgy = yToPx(yAt(cxm)); // should land at the top of the waveform
      ctx.strokeStyle = 'rgba(91,155,213,0.55)';
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cgx, y0 + Apx + 6); ctx.lineTo(cgx, cgy - 6); ctx.stroke();
      ctx.setLineDash([]);
      // a little tick + label sitting on the crest itself
      ctx.fillStyle = 'rgba(91,155,213,0.9)'; ctx.font = '10px monospace';
      ctx.fillText('crest → (speed v)', Math.min(cgx + 4, x1 - 90), cgy - 8);

      // marked medium-particles: each bobs purely vertically at its fixed x.
      if (p.showParticles) {
        for (let i = 0; i < N_PART; i++) {
          const frac = i / (N_PART - 1);
          const xm = frac * X_MAX;
          const gx = x0 + frac * span;
          const gy = yToPx(yAt(xm));
          const isSel = i === p.selected;

          // faint vertical "rail" showing the particle is confined to one x
          if (isSel) {
            ctx.strokeStyle = 'rgba(224,108,108,0.35)';
            ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
            ctx.beginPath(); ctx.moveTo(gx, y0 - Apx - 8); ctx.lineTo(gx, y0 + Apx + 8); ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.arc(gx, gy, isSel ? 6 : 3.4, 0, 2 * Math.PI);
          ctx.fillStyle = isSel ? RED : 'rgba(240,236,227,0.85)';
          ctx.fill();
          if (isSel) {
            // velocity arrow (vertical only) — the direction it's actually going
            const vy = dydt(xm); // ∂y/∂t
            const arrLen = Math.max(-40, Math.min(40, -(vy / 0.5) * (H * 0.30) * 0.12));
            ctx.strokeStyle = RED; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + arrLen); ctx.stroke();
            // arrowhead
            const dir = Math.sign(arrLen) || 1;
            ctx.beginPath();
            ctx.moveTo(gx, gy + arrLen);
            ctx.lineTo(gx - 4, gy + arrLen - dir * 6);
            ctx.lineTo(gx + 4, gy + arrLen - dir * 6);
            ctx.closePath(); ctx.fillStyle = RED; ctx.fill();
          }
        }
      }

      // hint text
      ctx.fillStyle = MUTED; ctx.font = '12px monospace';
      ctx.fillText(p.selected == null ? 'tap a dot to track a particle' : 'this dot moves ↕ only — the shape moves →', x0, H - 8);

      // publish live readout for the tracked particle
      if (p.selected != null) {
        const frac = p.selected / (N_PART - 1);
        const xm = frac * X_MAX;
        const yv = yAt(xm);
        const vy = dydt(xm);
        // throttle: only push a couple times/sec
        if ((now | 0) % 4 === 0) setLive({ y: yv, vy });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Drive the speed by</div>
          <div className="flex gap-1.5">
            {[['fλ', 'f · λ'], ['string', '√(F_T/μ)']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDriveBy(key)}
                className={`flex-1 px-2 py-1.5 rounded text-sm border transition-colors ${
                  driveBy === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Slider label="Amplitude (A)" value={A} min={0.1} max={0.5} step={0.01} unit="m" onChange={setA} />
        <Slider label="Wavelength (λ)" value={lambda} min={0.5} max={4} step={0.1} unit="m" onChange={setLambda} />

        {driveBy === 'fλ' ? (
          <Slider label="Frequency (f)" value={freq} min={0.2} max={2} step={0.05} unit="Hz" onChange={setFreq} />
        ) : (
          <>
            <Slider label="Tension (F_T)" value={tension} min={5} max={120} step={1} unit="N" onChange={setTension} />
            <Slider label="Linear density (μ)" value={mu} min={1} max={20} step={0.5} unit="g/m" onChange={setMu} />
          </>
        )}

        <div className="mt-1 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaused((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
            >
              {paused ? '▶ Play' : '❚❚ Pause'}
            </button>
            <label className="flex items-center gap-1.5 text-usna-text text-sm cursor-pointer select-none">
              <input type="checkbox" checked={showParticles} onChange={(e) => setShowParticles(e.target.checked)} />
              particles
            </label>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-usna-text text-sm cursor-pointer select-none">
              <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
              ghost trail
            </label>
            <label className="flex items-center gap-1.5 text-usna-text text-sm cursor-pointer select-none">
              <input type="checkbox" checked={showEnergy} onChange={(e) => setShowEnergy(e.target.checked)} />
              energy flow
            </label>
          </div>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Wave speed v" value={v.toFixed(2)} unit="m/s" />
          <Readout label="Frequency f" value={fEff.toFixed(2)} unit="Hz" />
          <Readout label="Period T" value={isFinite(period) ? period.toFixed(2) : '∞'} unit="s" />
          <Readout label="v = f · λ  check" value={(fEff * lambdaEff).toFixed(2)} unit="m/s" />
          {driveBy === 'string' && (
            <Readout label="√(F_T/μ)" value={vString.toFixed(2)} unit="m/s" />
          )}
          {selected != null && (
            <div className="mt-2 pt-2 border-t border-usna-grid">
              <div className="text-usna-muted text-xs mb-1">tracked particle</div>
              <Readout label="displacement y" value={live.y.toFixed(2)} unit="m" />
              <Readout label="transverse v_y" value={live.vy.toFixed(2)} unit="m/s" />
              <Readout label="horizontal motion" value="0.00" unit="m" />
            </div>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
             style={{ height: 360, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ cursor: 'pointer', touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="What actually travels?"
          description="The gold waveform sails to the right at speed v, but every marked dot only bobs straight up and down — track one and its horizontal displacement stays exactly zero. Turn on the ghost trail: each particle's history is a vertical smear, so the medium's motion is a picket fence of vertical bars while the shape glides through. Turn on energy flow: the local power P = −F_T (∂y/∂x)(∂y/∂t) is positive everywhere for a rightward wave, so energy is carried steadily to the right even though no particle goes anywhere. Note that v is set by the string (F_T and μ) — you cannot make the wave faster by shaking harder; a bigger frequency just shortens the wavelength so that v = f·λ still holds."
          equation={String.raw`y(x,t) = A\sin(kx - \omega t), \quad v = f\lambda = \sqrt{\tfrac{F_T}{\mu}}, \quad P = -F_T\,\tfrac{\partial y}{\partial x}\,\tfrac{\partial y}{\partial t}`}
        />
      </div>
    </div>
  );
}

/* ========================================================================== *
 *  LONGITUDINAL (L38)                                                         *
 * ========================================================================== */

const LG_DEFAULTS = { freq: 0.7, amp: 0.55, power: 1.0 };
const REF_DB = 1e-12; // reference intensity (W/m²) for the dB scale

function Longitudinal() {
  const [freq, setFreq] = useState(LG_DEFAULTS.freq);   // display frequency knob
  const [amp, setAmp] = useState(LG_DEFAULTS.amp);      // displacement amplitude (0..1)
  const [power, setPower] = useState(LG_DEFAULTS.power); // acoustic source power (W), for dB view
  const [view, setView] = useState('column');           // 'column' | 'intensity'
  const [paused, setPaused] = useState(false);
  const [listenerR, setListenerR] = useState(3.0);      // m from source (listener A)
  const [listenerR2, setListenerR2] = useState(6.0);    // m from source (listener B)
  const [live, setLive] = useState({ dB: 0, I: 0, dB2: 0, I2: 0 });

  const reset = () => {
    setFreq(LG_DEFAULTS.freq); setAmp(LG_DEFAULTS.amp); setPower(LG_DEFAULTS.power);
    setView('column'); setPaused(false); setListenerR(3.0); setListenerR2(6.0);
  };

  const dBdiff = live.dB2 - live.dB; // level at B minus level at A

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">View</div>
          <div className="flex gap-1.5">
            {[['column', 'Column + curves'], ['intensity', 'Intensity (1/r²)']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex-1 px-2 py-1.5 rounded text-sm border transition-colors ${
                  view === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {view === 'column' ? (
          <>
            <Slider label="Frequency (f)" value={freq} min={0.2} max={1.6} step={0.05} unit="Hz" onChange={setFreq} />
            <Slider label="Displacement amp" value={amp} min={0.2} max={1} step={0.05} unit="rel" onChange={setAmp} />
            <div className="mt-1 border-t border-usna-grid pt-3 flex items-center gap-2">
              <button
                onClick={() => setPaused((p) => !p)}
                className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
              >
                {paused ? '▶ Play' : '❚❚ Pause'}
              </button>
            </div>
          </>
        ) : (
          <>
            <Slider label="Source power (P)" value={power} min={0.01} max={5} step={0.01} unit="W" onChange={setPower} />
            <Slider label="Listener A (r₁)" value={listenerR} min={0.5} max={10} step={0.1} unit="m" onChange={setListenerR} />
            <Slider label="Listener B (r₂)" value={listenerR2} min={0.5} max={10} step={0.1} unit="m" onChange={setListenerR2} />
            <p className="text-usna-muted text-xs mt-2">Or drag either listener on the canvas.</p>
          </>
        )}

        <div className="mt-3 border-t border-usna-grid pt-3">
          {view === 'column' ? (
            <>
              <Readout label="Frequency f" value={freq.toFixed(2)} unit="Hz" />
              <Readout label="Displ. / pressure lag" value="90" unit="°" />
              <p className="text-usna-muted text-xs mt-2 leading-relaxed">
                Compressions (crowded dots) sit where displacement crosses zero — right where pressure peaks. Drag the cursor on the plot to read s, p, and density at one point.
              </p>
            </>
          ) : (
            <>
              <div className="text-usna-muted text-xs mb-1">Listener A</div>
              <Readout label="Distance r₁" value={listenerR.toFixed(2)} unit="m" />
              <Readout label="Level β₁" value={live.dB.toFixed(1)} unit="dB" />
              <div className="text-usna-muted text-xs mb-1 mt-2">Listener B</div>
              <Readout label="Distance r₂" value={listenerR2.toFixed(2)} unit="m" />
              <Readout label="Level β₂" value={live.dB2.toFixed(1)} unit="dB" />
              <div className="mt-2 pt-2 border-t border-usna-grid">
                <Readout label="Δβ  (B − A)" value={(dBdiff >= 0 ? '+' : '') + dBdiff.toFixed(1)} unit="dB" />
                <p className="text-usna-muted text-xs mt-2 leading-relaxed">
                  {listenerR.toFixed(1)} m → {listenerR2.toFixed(1)} m:
                  {' '}{(dBdiff >= 0 ? '+' : '') + dBdiff.toFixed(1)} dB. Doubling r is −6 dB, not −50%.
                </p>
              </div>
            </>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {view === 'column' ? (
          <ColumnView freq={freq} amp={amp} paused={paused} />
        ) : (
          <IntensityView
            power={power}
            listenerR={listenerR} setListenerR={setListenerR}
            listenerR2={listenerR2} setListenerR2={setListenerR2}
            setLive={setLive}
          />
        )}
        <InfoPanel {...(view === 'column' ? LG_INFO.column : LG_INFO.intensity)} />
      </div>
    </div>
  );
}

const LG_INFO = {
  column: {
    title: 'Displacement vs. pressure: 90° apart',
    description: 'The dots are the air molecules; the wave passes left-to-right as a train of compressions (crowding) and rarefactions (thinning). The blue curve is molecular displacement s(x,t); the red curve is the pressure variation, which is p ∝ −∂s/∂x — the negative slope of the displacement. That derivative relation puts them exactly a quarter-wavelength out of phase: pressure is largest where displacement is zero and its slope steepest (the center of a compression), and pressure is zero at the displacement extremes. Reading a compression as "maximum displacement" is the classic exam trap — it is maximum pressure and zero displacement. Drag the vertical cursor to read s, p, and the local crowding at any point.',
    equation: String.raw`s(x,t)=s_m\cos(kx-\omega t),\qquad p=-B\frac{\partial s}{\partial x}=p_m\sin(kx-\omega t)`,
  },
  intensity: {
    title: 'Sound spreads: the 1/r² falloff',
    description: 'A point source radiates power P over an expanding sphere, so the intensity through each ring falls as I = P/(4πr²). Drag the two listeners and read the difference: every doubling of distance quarters the intensity, which is a drop of only 6 dB because the decibel scale is logarithmic. Loudness does not fall off linearly with distance — moving from 3 m to 6 m is −6 dB, not −50%.',
    equation: String.raw`I=\frac{P}{4\pi r^2},\quad \beta = 10\log_{10}\!\frac{I}{I_0},\quad \Delta\beta = 20\log_{10}\!\frac{r_1}{r_2}`,
  },
};

/* ── Column + dual-representation view ───────────────────────────────────── */
function ColumnView({ freq, amp, paused }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pRef = useRef({});
  pRef.current = { freq, amp, paused };
  // draggable cursor: fraction of the column width [0,1] where the reader sits
  const cursorFracRef = useRef(0.5);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim = 0, lastNow;
    const padX = 24;
    const N_MOL = 90;            // air molecules along the column
    const X_MAX = 4;             // meters of column shown
    const lambda = 1.0;          // fixed wavelength (m) for a clean picture
    const k = k_of(lambda);
    const sMaxM = 0.02;          // physical displacement amplitude (m) at amp = 1

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    // pointer x → cursor fraction across the plotting span
    const setCursorFromClient = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const x0 = padX, x1 = W - padX, span = x1 - x0;
      if (span <= 0) return;
      cursorFracRef.current = Math.max(0, Math.min(1, (px - x0) / span));
    };
    const onDown = (e) => { draggingRef.current = true; setCursorFromClient(e.clientX); };
    const onMove = (e) => { if (draggingRef.current) setCursorFromClient(e.clientX); };
    const onUp = () => { draggingRef.current = false; };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000; lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      const p = pRef.current;
      if (!p.paused) sim += dt;

      const omega = omega_of(F_DISPLAY) * (p.freq / LG_DEFAULTS.freq);
      const x0 = padX, x1 = W - padX, span = x1 - x0;

      // three horizontal bands: particle column, displacement curve, pressure curve
      const bandParticles = H * 0.30;   // center y of particle strip
      const bandDisp = H * 0.60;
      const bandPress = H * 0.85;
      const curveAmp = H * 0.10;
      const dispPx = 26 * p.amp;        // how far a molecule shifts on screen (px)

      // ── wave field, expressed once so every representation stays consistent.
      //   displacement  s(x,t) = s_m cos(kx − ωt)
      //   pressure      p(x,t) = −B ∂s/∂x  ∝  +s_m k sin(kx − ωt)
      // (The pressure is the NEGATIVE displacement-gradient, so a compression —
      //  where molecules pile up, ∂s/∂x < 0 — is a positive pressure. That fixes
      //  the earlier hardcoded sign, which put the compression on the wrong zero.)
      const sOf = (xm) => Math.cos(k * xm - omega * sim);            // unit displacement
      const pOf = (xm) => Math.sin(k * xm - omega * sim);            // ∝ −∂s/∂x, unit pressure
      // local fractional density excess ∝ −∂s/∂x ∝ +sin: crowding where p > 0.
      const densOf = (xm) => pOf(xm);

      ctx.clearRect(0, 0, W, H);

      // ---- particle column: each molecule sits at x + s(x,t) -------------
      for (let i = 0; i < N_MOL; i++) {
        const frac = i / (N_MOL - 1);
        const xm = frac * X_MAX;
        const s = sOf(xm);
        const gx = x0 + frac * span + s * dispPx;
        // color-code local crowding (density excess): near a compression, gold.
        const crowd = Math.max(0, densOf(xm));
        ctx.beginPath();
        ctx.arc(gx, bandParticles, 3, 0, 2 * Math.PI);
        ctx.fillStyle = crowd > 0.5 ? GOLD : 'rgba(240,236,227,0.8)';
        ctx.fill();
      }
      ctx.fillStyle = MUTED; ctx.font = '11px monospace';
      ctx.fillText('air molecules (compressions ↔ rarefactions travel →)', x0, bandParticles - 26);

      // reference zero lines for the two curves
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      [bandDisp, bandPress].forEach((yb) => {
        ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.stroke();
      });

      // ---- displacement curve s(x,t)  (BLUE) ----------------------------
      const SAMP = 200;
      ctx.strokeStyle = BLUE; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= SAMP; i++) {
        const xm = (i / SAMP) * X_MAX;
        const gx = x0 + (i / SAMP) * span;
        const gy = bandDisp - p.amp * curveAmp * sOf(xm);
        i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
      }
      ctx.stroke();
      ctx.fillStyle = BLUE; ctx.font = '11px monospace';
      ctx.fillText('displacement  s(x,t)', x0, bandDisp - curveAmp - 6);

      // ---- pressure curve p(x,t) = −∂s/∂x  (RED) — 90° shifted -----------
      ctx.strokeStyle = RED; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= SAMP; i++) {
        const xm = (i / SAMP) * X_MAX;
        const gx = x0 + (i / SAMP) * span;
        const gy = bandPress - p.amp * curveAmp * pOf(xm);
        i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy);
      }
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.fillText('pressure  p(x,t) = −B ∂s/∂x   (90° out of phase)', x0, bandPress - curveAmp - 6);

      // ---- guide line linking a compression center to both curves --------
      // A compression is a pressure MAX: p = sin() = 1 → kx − ωt = π/2. Find the
      // in-view x nearest screen center. There the displacement s = cos(π/2) = 0.
      const midXm = X_MAX / 2;
      const phaseMid = k * midXm - omega * sim;
      const nWrap = Math.round((phaseMid - Math.PI / 2) / (2 * Math.PI));
      const xc = (Math.PI / 2 + 2 * Math.PI * nWrap + omega * sim) / k;
      if (xc >= 0 && xc <= X_MAX) {
        const gx = x0 + (xc / X_MAX) * span;
        ctx.strokeStyle = 'rgba(197,183,131,0.5)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, bandParticles + 10); ctx.lineTo(gx, bandPress + curveAmp + 4); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = GOLD; ctx.font = '10px monospace';
        ctx.fillText('compression (p max, s = 0)', gx + 4, bandParticles + 22);
      }

      // ---- draggable reader cursor --------------------------------------
      // A vertical line the user drags to inspect s, p, and local density at one
      // x, with a callout naming the physical situation ("displacement zero,
      // pressure max", etc.).
      const cfrac = cursorFracRef.current;
      const cxm = cfrac * X_MAX;
      const cgx = x0 + cfrac * span;
      const sVal = sOf(cxm);           // unit displacement
      const pVal = pOf(cxm);           // unit pressure
      const dVal = densOf(cxm);        // unit density excess
      ctx.strokeStyle = draggingRef.current ? TEXT : 'rgba(240,236,227,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cgx, bandParticles - 20); ctx.lineTo(cgx, bandPress + curveAmp + 6); ctx.stroke();
      // dots on each curve at the cursor
      const sy = bandDisp - p.amp * curveAmp * sVal;
      const py = bandPress - p.amp * curveAmp * pVal;
      ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(cgx, sy, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(cgx, py, 4, 0, 2 * Math.PI); ctx.fill();
      // handle at top of the cursor
      ctx.fillStyle = draggingRef.current ? GOLD : TEXT;
      ctx.beginPath(); ctx.arc(cgx, bandParticles - 20, 5, 0, 2 * Math.PI); ctx.fill();

      // callout box (physical descriptions from the near-extremes)
      const near = (val, target) => Math.abs(val - target) < 0.25;
      let sWord = near(sVal, 0) ? 'displacement ≈ zero'
        : near(sVal, 1) ? 'displacement MAX (+)'
        : near(sVal, -1) ? 'displacement MAX (−)'
        : (sVal > 0 ? 'displacement + ' : 'displacement − ');
      let pWord = near(pVal, 1) ? 'pressure MAX → compression'
        : near(pVal, -1) ? 'pressure MIN → rarefaction'
        : near(pVal, 0) ? 'pressure ≈ zero'
        : (pVal > 0 ? 'pressure + (compressing)' : 'pressure − (rarefying)');
      const densWord = dVal > 0.35 ? 'dense (crowded)'
        : dVal < -0.35 ? 'thin (spread out)' : 'near ambient';
      const lines = [
        `here:  ${sWord}`,
        `       ${pWord}`,
        `s = ${sVal.toFixed(2)}·s_m   p = ${pVal.toFixed(2)}·p_m`,
        `density: ${densWord}`,
      ];
      ctx.font = '11px monospace';
      const boxW = 262, boxH = 4 + lines.length * 15;
      let bx = cgx + 10; if (bx + boxW > x1) bx = cgx - 10 - boxW; if (bx < x0) bx = x0;
      const by = 8;
      ctx.fillStyle = 'rgba(13,19,33,0.9)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = 'rgba(240,236,227,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, boxW, boxH);
      lines.forEach((ln, i) => {
        ctx.fillStyle = i === 0 ? GOLD : i === 1 ? RED : TEXT;
        ctx.fillText(ln, bx + 6, by + 15 + i * 15);
      });

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
         style={{ height: 420, background: BG }}>
      <canvas ref={canvasRef} className="block" style={{ cursor: 'ew-resize', touchAction: 'none' }} />
    </div>
  );
}

/* ── Intensity / 1-over-r² view with two draggable listeners ─────────────── */
function IntensityView({ power, listenerR, setListenerR, listenerR2, setListenerR2, setLive }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pRef = useRef({});
  pRef.current = { power, listenerR, listenerR2 };
  const rRef = useRef(listenerR); rRef.current = listenerR;
  const r2Ref = useRef(listenerR2); r2Ref.current = listenerR2;
  const draggingRef = useRef(null); // 'A' | 'B' | null
  const geomRef = useRef({ cx: 0, cy: 0, pxPerM: 1, maxR: 10 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim = 0, lastNow;
    const MAX_R = 10; // m mapped to the canvas half-width

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    // Listener A sits on the +x axis (right of source); B sits on −x axis (left)
    // so the two never overlap and each can be grabbed independently.
    const clientToR = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const g = geomRef.current;
      const px = clientX - rect.left;
      const dxM = Math.abs(px - g.cx) / g.pxPerM;
      return Math.max(0.5, Math.min(MAX_R, dxM));
    };
    const onDown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const g = geomRef.current;
      const px = e.clientX - rect.left;
      const aPx = g.cx + rRef.current * g.pxPerM;   // A to the right
      const bPx = g.cx - r2Ref.current * g.pxPerM;  // B to the left
      // choose the nearer listener to grab; ties broken by which side of source
      const dA = Math.abs(px - aPx), dB = Math.abs(px - bPx);
      const target = px >= g.cx ? (dA < dB + 60 ? 'A' : 'B') : (dB < dA + 60 ? 'B' : 'A');
      draggingRef.current = target;
      if (target === 'A') setListenerR(clientToR(e.clientX));
      else setListenerR2(clientToR(e.clientX));
    };
    const onMove = (e) => {
      if (!draggingRef.current) return;
      if (draggingRef.current === 'A') setListenerR(clientToR(e.clientX));
      else setListenerR2(clientToR(e.clientX));
    };
    const onUp = () => { draggingRef.current = null; };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    const drawListener = (lx, ly, lr, tag, color) => {
      ctx.beginPath(); ctx.arc(lx, ly, 9, 0, 2 * Math.PI);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = TEXT; ctx.font = '12px monospace';
      const label = tag + '  r = ' + lr.toFixed(2) + ' m';
      const tw = ctx.measureText(label).width;
      const tx = lx + 12 + tw > W ? lx - 12 - tw : lx + 12;
      ctx.fillText(label, tx, ly + 4);
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000; lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;
      const p = pRef.current;

      const cx = W * 0.5, cy = H * 0.5;
      const pxPerM = (Math.min(W, H) * 0.46) / MAX_R;
      geomRef.current = { cx, cy, pxPerM, maxR: MAX_R };

      ctx.clearRect(0, 0, W, H);

      // expanding wavefront rings (animated) — a few concentric circles moving out
      const ringSpacingM = 1.0;
      const speedM = 1.2; // m/s visual
      const phase = (sim * speedM) % ringSpacingM;
      ctx.lineWidth = 1.5;
      for (let rM = phase; rM < MAX_R; rM += ringSpacingM) {
        const rPx = rM * pxPerM;
        // brightness ∝ 1/r² (energy per unit area drops)
        const bright = Math.min(1, 1 / Math.max(0.25, rM * rM));
        ctx.strokeStyle = `rgba(197,183,131,${0.15 + 0.55 * bright})`;
        ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, 2 * Math.PI); ctx.stroke();
      }

      // the source
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      ctx.fillStyle = GOLD; ctx.shadowColor = GOLD; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = MUTED; ctx.font = '11px monospace';
      ctx.fillText('source  P = ' + p.power.toFixed(2) + ' W', cx + 10, cy - 12);

      // listener A on +x, listener B on −x
      const lr = p.listenerR, lr2 = p.listenerR2;
      const aX = cx + lr * pxPerM, aY = cy;
      const bX = cx - lr2 * pxPerM, bY = cy;
      ctx.strokeStyle = 'rgba(240,236,227,0.3)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(aX, aY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bX, bY); ctx.stroke();
      ctx.setLineDash([]);
      drawListener(aX, aY, lr, '🎧A', draggingRef.current === 'A' ? RED : BLUE);
      drawListener(bX, bY, lr2, '🎧B', draggingRef.current === 'B' ? RED : GOLD);

      // physics: I = P / (4π r²);  β = 10 log10(I / I0)
      const I = p.power / (4 * Math.PI * lr * lr);
      const dB = 10 * Math.log10(Math.max(I, 1e-30) / REF_DB);
      const I2 = p.power / (4 * Math.PI * lr2 * lr2);
      const dB2 = 10 * Math.log10(Math.max(I2, 1e-30) / REF_DB);
      const diff = dB2 - dB;

      // live dB-difference callout near the source
      ctx.font = '12px monospace';
      const diffStr = `${lr.toFixed(1)} m → ${lr2.toFixed(1)} m:  ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} dB`;
      ctx.fillStyle = 'rgba(13,19,33,0.85)';
      const dw = ctx.measureText(diffStr).width + 14;
      ctx.fillRect(cx - dw / 2, cy + 16, dw, 22);
      ctx.strokeStyle = 'rgba(240,236,227,0.3)'; ctx.lineWidth = 1;
      ctx.strokeRect(cx - dw / 2, cy + 16, dw, 22);
      ctx.fillStyle = GOLD;
      ctx.fillText(diffStr, cx - dw / 2 + 7, cy + 31);

      if ((now | 0) % 4 === 0) setLive({ I, dB, I2, dB2 });

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
         style={{ height: 420, background: BG }}>
      <canvas ref={canvasRef} className="block" style={{ cursor: 'grab', touchAction: 'none' }} />
    </div>
  );
}
