import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * The Fourier transform (math/fourier).
 *
 * A periodic signal has a twin in the frequency domain: a set of amplitudes and
 * phases on the discrete harmonics n·f₀. The same object appears three ways,
 * selected by ?mode=:
 *
 *   spectrum   (default) Two linked panels. Top: x(t), rebuilt live from the
 *              harmonic amplitudes. Bottom: the spectrum |c_n| as draggable
 *              stems. Drag a stem and x(t) rebuilds; a one-tone preset parks a
 *              single stem and is labelled as the SHM case.
 *
 *   synthesis  The target x(t) drawn faint; the partial sum S_N(t) (gold) drawn
 *              over it; an N slider adds harmonics one at a time. RMS error and,
 *              at a discontinuity, the Gibbs overshoot (~9% of the jump, which
 *              narrows but does not shrink) are called out.
 *
 *   epicycles  The complex series as a chain of nested rotating circles (each a
 *              mode: radius |c_n|, rate n·ω₀, start phase arg c_n). The last
 *              circle's rim carries a pen that traces a closed 2-D shape — a
 *              letter, a star, an anchor — exactly in the limit. Drawn shapes
 *              are decomposed by a small DFT computed once on load.
 *
 * Each mode runs one rAF loop that reads inputs from refs and draws imperatively;
 * readouts publish throttled (~10 Hz). No per-frame setState.
 */

const GOLD = '#C5B783';   // reconstruction / spectrum / pen trail (the "answer")
const BLUE = '#5B9BD5';   // the signal / target / circles
const GREEN = '#7FB77E';  // individual harmonic terms
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BG = '#0D1321';
const GRID = 'rgba(139,140,142,0.22)';
const FRAME = 'rgba(139,140,142,0.4)';

const TWO_PI = Math.PI * 2;
const NB = 48;            // harmonics shown in the spectrum stem plot (|n| ≤ NB)
const NMAX = 256;         // ceiling for the synthesis partial-sum slider

const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '--');

/* ───────────────────────── 1-D real signal presets ─────────────────────────
 * Each gives closed-form Fourier coefficients a_n, b_n for the series
 *   x(t) = dc + Σ_{n≥1} [a_n cos(2πnt) + b_n sin(2πnt)]   (period 1, ω₀ = 2π)
 * plus the analytic ideal waveform, so the partial sum can be compared against
 * the true signal (and overshoot the true discontinuity).                      */
const DUTY = 0.25;
const SIGNALS = {
  sine: {
    label: 'Sine (SHM)', dc: 0,
    ab: (n) => ({ a: 0, b: n === 1 ? 1 : 0 }),
    ideal: (t) => Math.sin(TWO_PI * t),
  },
  twotone: {
    label: 'Two-tone', dc: 0,
    ab: (n) => ({ a: 0, b: n === 1 ? 1 : n === 3 ? 0.5 : 0 }),
    ideal: (t) => Math.sin(TWO_PI * t) + 0.5 * Math.sin(3 * TWO_PI * t),
  },
  square: {
    label: 'Square', dc: 0,
    ab: (n) => ({ a: 0, b: n % 2 === 1 ? 4 / (n * Math.PI) : 0 }),
    ideal: (t) => (Math.sin(TWO_PI * t) >= 0 ? 1 : -1),
    gibbs: { at: 0.5, high: 1, jump: 2 },
  },
  sawtooth: {
    label: 'Sawtooth', dc: 0,
    ab: (n) => ({ a: 0, b: (2 / (n * Math.PI)) * (n % 2 === 1 ? 1 : -1) }),
    ideal: (t) => 2 * (t - Math.round(t)),
    gibbs: { at: 0.5, high: 1, jump: 2 },
  },
  triangle: {
    label: 'Triangle', dc: 0,
    ab: (n) => {
      if (n % 2 === 0) return { a: 0, b: 0 };
      const k = (n - 1) / 2;
      return { a: 0, b: (8 / (Math.PI * Math.PI)) * (k % 2 === 0 ? 1 : -1) / (n * n) };
    },
    ideal: (t) => (2 / Math.PI) * Math.asin(Math.sin(TWO_PI * t)),
  },
  pulse: {
    label: 'Pulse train', dc: DUTY,
    ab: (n) => ({ a: (2 / (n * Math.PI)) * Math.sin(n * Math.PI * DUTY), b: 0 }),
    ideal: (t) => { const u = t - Math.round(t); return Math.abs(u) < DUTY / 2 ? 1 : 0; },
    gibbs: { at: DUTY / 2 - 1e-3, high: 1, jump: 1 },
  },
  // a low-mass (long) inspiral chirp: many slow cycles sweeping monotonically up
  // in frequency and amplitude toward a merger at the end of the period, then cut
  // off. Only edge-windowed (short fade-in + merger cutoff) so it stays periodic.
  // No closed-form coefficients — found by numerical integration below.
  chirp: {
    label: 'GW chirp', dc: 0, oneCycle: true,
    ideal: (t) => {
      const eps = 0.015, fmin = 4.5, tau0 = 1 + eps, tau = tau0 - t; // merger at t = 1
      const f = fmin * Math.pow(tau0 / tau, 3 / 8);
      const phi = TWO_PI * fmin * Math.pow(tau0, 3 / 8) * (8 / 5) * (Math.pow(tau0, 5 / 8) - Math.pow(tau, 5 / 8));
      const amp = Math.pow(f / fmin, 2 / 3);
      const env = Math.min(1, t / 0.05) * Math.min(1, (1 - t) / 0.02); // slow fade-in, abrupt merger
      return 0.42 * env * amp * Math.cos(phi);
    },
  },
};

// Fourier coefficients a_n, b_n (series x = dc + Σ a_n cos + b_n sin). Closed form
// when the preset provides ab(n); otherwise numerical integration of ideal(t).
function coefArrays(sig, Nmax) {
  if (sig.ab) { const a = [0], b = [0]; for (let n = 1; n <= Nmax; n++) { const c = sig.ab(n); a[n] = c.a; b[n] = c.b; } return { dc: sig.dc, a, b }; }
  const M = 2048, xs = new Float64Array(M); let dc = 0;
  for (let k = 0; k < M; k++) { const v = sig.ideal(k / M); xs[k] = v; dc += v; }
  dc /= M;
  const a = [0], b = [0];
  for (let n = 1; n <= Nmax; n++) {
    let ca = 0, cb = 0;
    for (let k = 0; k < M; k++) { const ang = TWO_PI * n * k / M; ca += xs[k] * Math.cos(ang); cb += xs[k] * Math.sin(ang); }
    a[n] = 2 * ca / M; b[n] = 2 * cb / M;
  }
  return { dc, a, b };
}
const buildCoef = (sig) => coefArrays(sig, NB);
// S_N(t) from a coefficient set, summing harmonics 1..N.
const reconstruct = (coef, t, N) => {
  let s = coef.dc;
  for (let n = 1; n <= N; n++) s += coef.a[n] * Math.cos(TWO_PI * n * t) + coef.b[n] * Math.sin(TWO_PI * n * t);
  return s;
};
// two-sided (complex) magnitude |c_n| = ½|a_{|n|} − i b_{|n|}|, conjugate-symmetric
// for a real signal (c_{−n} = conj c_n); c_0 is the DC term. This is the symmetric
// functional-analysis normalization, x(t) = Σ_{n∈ℤ} c_n e^{i n ω₀ t}.
const cmag = (coef, n) => { const k = Math.abs(n); return k === 0 ? Math.abs(coef.dc) : 0.5 * Math.hypot(coef.a[k], coef.b[k]); };

/* shared plot chrome: a framed panel with an optional zero line */
function panelFrame(ctx, r, title) {
  ctx.strokeStyle = FRAME; ctx.lineWidth = 1;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  if (title) {
    ctx.font = '13px JetBrains Mono, monospace';
    ctx.fillStyle = MUTED; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, r.x + 6, r.y + 5);
  }
}

/* ══════════════════════════════ SPECTRUM MODE ═════════════════════════════ */
function SpectrumMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [preset, setPreset] = useState('square');
  const [ro, setRo] = useState({ modes: 2, peakN: 1 });

  const coefRef = useRef(buildCoef(SIGNALS.square));
  const presetRef = useRef(preset); presetRef.current = preset;
  const viewRef = useRef(null);
  const dragRef = useRef(null);

  const applyPreset = (id) => { coefRef.current = buildCoef(SIGNALS[id]); };
  useEffect(() => { applyPreset(preset); /* eslint-disable-next-line */ }, [preset]);
  const reset = () => { setPreset('square'); applyPreset('square'); };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastPub = 0;
    const CMAX = 0.8;            // two-sided magnitude ceiling |c_n|

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      const coef = coefRef.current;
      const left = 44, right = 16, top = 14, botPad = 26;
      const usableH = H - top - botPad, gap = 34;
      const topH = usableH * 0.5;
      const topR = { x: left, y: top, w: W - left - right, h: topH - gap * 0.5 };
      const botR = { x: left, y: top + topH + gap * 0.5, w: W - left - right, h: usableH - topH - gap * 0.5 };

      // top panel maps t∈[0,tMax] × y∈[-1.6,1.6] (one period for the chirp)
      const tMax = SIGNALS[presetRef.current].oneCycle ? 1 : 2, yR = 1.6;
      const xPix = (t) => topR.x + (t / tMax) * topR.w;
      const yTop = (y) => topR.y + ((yR - y) / (2 * yR)) * topR.h;
      // bottom panel: two-sided stems n = -NB..NB, DC at the centre
      const cxN = botR.x + botR.w / 2;
      const nX = (n) => cxN + (n / NB) * (botR.w / 2 - 14);
      const aPix = (A) => botR.y + botR.h - 6 - (A / (CMAX * 1.05)) * (botR.h - 16);
      viewRef.current = { botR, nX, cxN, aPix, CMAX };

      ctx.clearRect(0, 0, W, H);
      panelFrame(ctx, topR, 'x(t)  — real signal from the modes below');
      panelFrame(ctx, botR, 'two-sided spectrum  |c_n|,  n ∈ ℤ');

      // zero lines
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      const y0 = yTop(0); ctx.beginPath(); ctx.moveTo(topR.x, y0); ctx.lineTo(topR.x + topR.w, y0); ctx.stroke();
      // period boundary ticks on the top panel
      ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(139,140,142,0.3)';
      for (let p = 1; p <= tMax; p++) { const x = xPix(p); ctx.beginPath(); ctx.moveTo(x, topR.y); ctx.lineTo(x, topR.y + topR.h); ctx.stroke(); }
      ctx.setLineDash([]);

      // x(t): the real reconstruction Σ_{|n|≤NB} c_n e^{i n ω₀ t}
      ctx.strokeStyle = BLUE; ctx.lineWidth = 2.4;
      ctx.save(); ctx.beginPath(); ctx.rect(topR.x, topR.y, topR.w, topR.h); ctx.clip();
      ctx.beginPath();
      for (let i = 0; i <= 480; i++) { const t = (i / 480) * tMax; const py = yTop(reconstruct(coef, t, NB)); i === 0 ? ctx.moveTo(xPix(t), py) : ctx.lineTo(xPix(t), py); }
      ctx.stroke(); ctx.restore();

      // bottom baseline, centre (n=0) axis, n labels
      const base = aPix(0);
      ctx.strokeStyle = FRAME; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(botR.x + 10, base); ctx.lineTo(botR.x + botR.w - 10, base); ctx.stroke();
      ctx.strokeStyle = 'rgba(139,140,142,0.3)'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(cxN, botR.y + 6); ctx.lineTo(cxN, base); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = MUTED; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (let n = -NB; n <= NB; n += 8) ctx.fillText(String(n), nX(n), base + 5);

      // stems |c_n| (gold), conjugate-symmetric; count modes + find the fundamental
      let modes = 0, peakN = 0, peakA = 0;
      for (let n = -NB; n <= NB; n++) {
        const A = cmag(coef, n);
        if (A > 0.01) modes++;
        if (n >= 1 && A > peakA) { peakA = A; peakN = n; }
        const x = nX(n), yh = aPix(Math.min(A, CMAX * 1.05));
        ctx.strokeStyle = A > 0.01 ? GOLD : 'rgba(197,183,131,0.2)';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, yh); ctx.stroke();
        ctx.fillStyle = A > 0.01 ? GOLD : 'rgba(197,183,131,0.25)';
        ctx.beginPath(); ctx.arc(x, yh, 3.2, 0, TWO_PI); ctx.fill();
      }

      // a single real tone appears as the conjugate pair c_{±k} → SHM
      const posModes = [];
      for (let k = 1; k <= NB; k++) if (cmag(coef, k) > 0.01) posModes.push(k);
      if (posModes.length === 1 && cmag(coef, 0) < 0.01) {
        ctx.font = 'bold 12px JetBrains Mono, monospace'; ctx.fillStyle = GOLD;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`conjugate pair c±${posModes[0]} → simple harmonic motion`, cxN, botR.y + botR.h - 4);
      }
      ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = MUTED;
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('drag the stem heads', botR.x + botR.w - 8, botR.y + 5);

      if (now - lastPub > 120) { lastPub = now; setRo({ modes, peakN }); }
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []);

  // pointer: drag a stem head to set |c_n|; the conjugate partner c_{-n} follows
  // automatically, keeping x(t) real.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const pickN = (cssX) => {
      const v = viewRef.current; if (!v) return null;
      const sp = Math.abs(v.nX(1) - v.nX(0)) || 8;
      let best = null, bd = sp * 0.7;         // grab the nearest stem within ~half a bin
      for (let n = -NB; n <= NB; n++) { const d = Math.abs(cssX - v.nX(n)); if (d < bd) { bd = d; best = n; } }
      return best;
    };
    const applyMag = (cssY) => {
      const v = viewRef.current, d = dragRef.current; if (!v || !d) return;
      const rho = Math.max(0, Math.min(v.CMAX, (v.botR.y + v.botR.h - 6 - cssY) / (v.botR.h - 16) * (v.CMAX * 1.05)));
      const coef = coefRef.current, k = Math.abs(d.n);
      if (k === 0) { coef.dc = rho; return; }
      const A = 2 * rho;                                   // one-sided amplitude A_k = 2|c_k|
      const cur = Math.hypot(coef.a[k], coef.b[k]);
      if (cur > 1e-6) { const s = A / cur; coef.a[k] *= s; coef.b[k] *= s; } // preserve phase
      else { coef.a[k] = 0; coef.b[k] = A; }                                // start as a pure sine
    };
    const onDown = (e) => {
      const r = canvas.getBoundingClientRect(); const cssX = e.clientX - r.left, cssY = e.clientY - r.top;
      const v = viewRef.current; if (!v || cssY < v.botR.y - 10) return; // only the spectrum panel
      const n = pickN(cssX); if (n == null) return;
      dragRef.current = { n }; canvas.setPointerCapture?.(e.pointerId); applyMag(cssY); e.preventDefault();
    };
    const onMove = (e) => { if (!dragRef.current) return; const r = canvas.getBoundingClientRect(); applyMag(e.clientY - r.top); };
    const onUp = () => { dragRef.current = null; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <p className="text-usna-muted text-xs mb-3">
          Pick a signal, then drag the <span style={{ color: GOLD }}>spectrum stems</span> and
          watch <span style={{ color: BLUE }}>x(t)</span> rebuild. The spectrum is two-sided:
          each real tone is a conjugate pair c<sub>n</sub>, c<sub>−n</sub>.
        </p>
        <div className="mb-3">
          <label className="text-usna-text text-sm font-medium block mb-1.5">Signal</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SIGNALS).map(([id, s]) => (
              <button key={id} onClick={() => setPreset(id)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${preset === id ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-usna-grid pt-3">
          <Readout label="nonzero modes |c_n|" value={ro.modes} unit="" />
          <Readout label="fundamental |n|" value={ro.peakN} unit="" />
          <Readout label="shown" value={`−${NB}…${NB}`} unit="" />
        </div>
        <p className="mt-3 text-xs text-usna-text leading-snug">
          One conjugate pair c<sub>±1</sub> is exactly simple harmonic motion. A square or sawtooth
          needs a whole comb, symmetric about n = 0.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="A signal and its spectrum are one object"
          description="A periodic signal x(t) is equally a curve in time and a two-sided sequence of complex coefficients c_n on the integer harmonics n·ω₀. They are not two facts but one: drag any stem and x(t) rebuilds immediately, because the coefficients are the signal, expressed in the orthonormal basis of complex exponentials. Since x(t) is real the spectrum is conjugate-symmetric, c₋ₙ = c̄ₙ, so the stems come in mirror-image pairs; a single pair c±₁ is one sinusoid — simple harmonic motion, the L35–L36 oscillator — while a square or sawtooth is an entire comb. The normalization is the symmetric one of functional analysis: the factor 1/T sits on the analysis integral, and Parseval reads (1/T)∫|x|² dt = Σ|c_n|²."
          equation={String.raw`x(t)=\sum_{n=-\infty}^{\infty} c_n\,e^{\,i n\omega_0 t},\qquad c_n=\frac{1}{T}\int_0^{T} x(t)\,e^{-i n\omega_0 t}\,dt,\qquad \omega_0=\frac{2\pi}{T}`}
        />
      </div>
    </div>
  );
}

/* ═════════════════════════════ SYNTHESIS MODE ════════════════════════════ */
function SynthesisMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [preset, setPreset] = useState('square');
  const [N, setN] = useState(5);
  const [overlay, setOverlay] = useState(true);
  const [showTarget, setShowTarget] = useState(true);
  const [ro, setRo] = useState({ rms: 0, overshoot: null });

  const presetRef = useRef(preset); presetRef.current = preset;
  const nRef = useRef(N); nRef.current = N;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const targetRef = useRef(showTarget); targetRef.current = showTarget;
  const coefRef = useRef(buildCoefFull(SIGNALS.square));

  useEffect(() => { coefRef.current = buildCoefFull(SIGNALS[preset]); /* eslint-disable-next-line */ }, [preset]);
  const reset = () => { setPreset('square'); setN(5); setOverlay(true); setShowTarget(true); };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastPub = 0, sweep = 0, last;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now; let dt = (now - last) / 1000; last = now; if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sweep = (sweep + dt * 0.18) % 1;
      const sig = SIGNALS[presetRef.current], coef = coefRef.current, Nn = nRef.current;

      const left = 46, right = 16, top = 16, bot = 28;
      const R = { x: left, y: top, w: W - left - right, h: H - top - bot };
      const tMax = sig.oneCycle ? 1 : 2, yR = 1.45;
      const xPix = (t) => R.x + (t / tMax) * R.w;
      const yP = (y) => R.y + ((yR - y) / (2 * yR)) * R.h;

      ctx.clearRect(0, 0, W, H);
      panelFrame(ctx, R, null);
      // axes
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; const yz = yP(0);
      ctx.beginPath(); ctx.moveTo(R.x, yz); ctx.lineTo(R.x + R.w, yz); ctx.stroke();
      ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(139,140,142,0.3)';
      for (let p = 1; p <= tMax; p++) { const x = xPix(p); ctx.beginPath(); ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('0', xPix(0) + 6, R.y + R.h + 5);
      ctx.fillText('T', tMax === 1 ? xPix(1) - 6 : xPix(1), R.y + R.h + 5);
      if (tMax > 1) ctx.fillText('2T', xPix(2) - 6, R.y + R.h + 5);

      ctx.save(); ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();

      // target ideal (faint blue)
      if (targetRef.current) {
        ctx.strokeStyle = 'rgba(91,155,213,0.55)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]);
        ctx.beginPath(); for (let i = 0; i <= 600; i++) { const t = (i / 600) * tMax; const py = yP(sig.ideal(t)); i === 0 ? ctx.moveTo(xPix(t), py) : ctx.lineTo(xPix(t), py); } ctx.stroke(); ctx.setLineDash([]);
      }
      // individual harmonic terms (faint green), capped to keep it legible
      if (overlayRef.current) {
        const cap = Math.min(Nn, 10);
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(127,183,126,0.35)';
        for (let n = 1; n <= cap; n++) {
          ctx.beginPath();
          for (let i = 0; i <= 480; i++) { const t = (i / 480) * tMax; const py = yP(coef.a[n] * Math.cos(TWO_PI * n * t) + coef.b[n] * Math.sin(TWO_PI * n * t)); i === 0 ? ctx.moveTo(xPix(t), py) : ctx.lineTo(xPix(t), py); }
          ctx.stroke();
        }
      }
      // partial sum S_N (gold)
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6;
      ctx.beginPath(); for (let i = 0; i <= 720; i++) { const t = (i / 720) * tMax; const py = yP(reconstruct(coef, t, Nn)); i === 0 ? ctx.moveTo(xPix(t), py) : ctx.lineTo(xPix(t), py); } ctx.stroke();

      // Gibbs: inspect a discontinuity, mark the overshoot peak
      let overshoot = null;
      if (sig.gibbs) {
        const { at, high, jump } = sig.gibbs;
        let peak = -Infinity, tPeak = at;
        for (let i = 0; i <= 400; i++) { const t = at - 0.12 + (i / 400) * 0.12; const v = reconstruct(coef, t, Nn); if (v > peak) { peak = v; tPeak = t; } }
        overshoot = ((peak - high) / jump) * 100;
        const px = xPix(tPeak), py = yP(peak);
        ctx.strokeStyle = 'rgba(240,236,227,0.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(R.x, yP(high)); ctx.lineTo(R.x + R.w, yP(high)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = TEXT; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TWO_PI); ctx.fill();
        ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = TEXT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`Gibbs +${overshoot.toFixed(1)}%`, Math.min(px + 7, R.x + R.w - 90), py - 3);
      }
      // sweep marker (the only per-frame motion)
      const sx = xPix(sweep * tMax);
      ctx.strokeStyle = 'rgba(197,183,131,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, R.y); ctx.lineTo(sx, R.y + R.h); ctx.stroke();
      ctx.restore();

      // RMS error of S_N vs ideal
      let se = 0; const M = 800;
      for (let i = 0; i < M; i++) { const t = i / M; const e = reconstruct(coef, t, Nn) - sig.ideal(t); se += e * e; }
      const rms = Math.sqrt(se / M);

      ctx.font = 'bold 13px JetBrains Mono, monospace'; ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`S_N(t), N = ${Nn}`, R.x + 8, R.y + 6);

      if (now - lastPub > 120) { lastPub = now; setRo({ rms, overshoot }); }
      raf = requestAnimationFrame(draw);
    };

    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-3">
          <label className="text-usna-text text-sm font-medium block mb-1.5">Target signal</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SIGNALS).map(([id, s]) => (
              <button key={id} onClick={() => setPreset(id)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${preset === id ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Max harmonic N (|n| ≤ N)" value={N} min={1} max={NMAX} step={1} unit="" onChange={setN} />
        <div className="flex flex-col gap-2 mb-3">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showTarget} onChange={(e) => setShowTarget(e.target.checked)} /> Target x(t) (blue)
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Overlay each term (≤10)
          </label>
        </div>
        <div className="border-t border-usna-grid pt-3">
          <Readout label="RMS error" value={fmt(ro.rms, 4)} unit="" />
          {ro.overshoot != null
            ? <Readout label="Gibbs overshoot" value={`+${ro.overshoot.toFixed(1)}`} unit="% of jump" />
            : <Readout label="convergence" value="uniform" unit="" />}
        </div>
        <p className="mt-3 text-xs text-usna-text leading-snug">
          Raise N and S_N converges to the target. At a jump the overshoot narrows toward the
          discontinuity but its height stays near 9% of the jump — the Gibbs phenomenon.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="Building x(t) from its harmonics"
          description="The partial sum over the modes with |n| ≤ N approaches the target as N grows: each added conjugate pair c±ₙ sharpens an edge, and the RMS error falls steadily. For a smooth signal the convergence is uniform. At a jump discontinuity it is not — the partial sum overshoots by about 9% of the jump, and while that spike is pushed ever closer to the discontinuity as N increases, its height does not shrink. This is the Gibbs phenomenon, and it is why a finite sum of smooth exponentials can never perfectly square a corner."
          equation={String.raw`S_N(t)=\sum_{n=-N}^{N} c_n\,e^{\,i n\omega_0 t}\;\xrightarrow[N\to\infty]{}\;x(t)`}
        />
      </div>
    </div>
  );
}
// coefficients out to NMAX so S_N can use any N up to the slider ceiling
function buildCoefFull(sig) { return coefArrays(sig, NMAX); }

/* ══════════════════════════════ EPICYCLES MODE ════════════════════════════
 * A closed 2-D path z(t)=x(t)+i y(t) has complex coefficients
 *   c_n = ∫₀¹ z(t) e^{-i2πnt} dt,   z(t)=Σ_n c_n e^{i2πnt}.
 * Each term is a circle: radius |c_n|, rate n, start phase arg c_n. Chaining
 * them tip-to-tip, the last tip is a pen that draws the shape.                 */

// ── shape generators (raw point lists; resampled + normalised before the DFT) ──
function genCircle() { const p = []; for (let i = 0; i < 240; i++) { const a = (i / 240) * TWO_PI; p.push({ x: Math.cos(a), y: Math.sin(a) }); } return p; }
function genSquare() { return [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]; }
function genStar() {
  const p = []; const R = 1, r = 0.42;
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TWO_PI; const rad = i % 2 === 0 ? R : r; p.push({ x: rad * Math.cos(a), y: rad * Math.sin(a) }); }
  return p;
}
// block letter "N" outline (single closed polygon), Navy monogram
function genN() {
  return [
    { x: -1.2, y: -1.6 }, { x: -1.2, y: 1.6 }, { x: -0.55, y: 1.6 }, { x: 0.55, y: -0.35 },
    { x: 0.55, y: 1.6 }, { x: 1.2, y: 1.6 }, { x: 1.2, y: -1.6 }, { x: 0.55, y: -1.6 },
    { x: -0.55, y: 0.35 }, { x: -0.55, y: -1.6 },
  ];
}
function genHeart() { const p = []; for (let i = 0; i < 300; i++) { const t = (i / 300) * TWO_PI; p.push({ x: 16 * Math.pow(Math.sin(t), 3), y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) }); } return p; }
// admiralty-anchor silhouette: build the right half top→crown, then mirror
function genAnchor() {
  const half = [
    { x: 0.00, y: 1.75 }, { x: 0.18, y: 1.70 }, { x: 0.25, y: 1.55 }, { x: 0.18, y: 1.40 }, { x: 0.10, y: 1.32 },
    { x: 0.10, y: 1.14 }, { x: 0.78, y: 1.16 }, { x: 0.98, y: 1.06 }, { x: 0.80, y: 0.96 }, { x: 0.10, y: 0.98 },
    { x: 0.10, y: -0.35 }, { x: 0.30, y: -0.52 }, { x: 0.58, y: -0.66 }, { x: 0.86, y: -0.70 },
    { x: 1.10, y: -0.52 }, { x: 0.86, y: -0.92 }, { x: 0.52, y: -1.04 }, { x: 0.26, y: -1.12 }, { x: 0.00, y: -1.18 },
  ];
  const left = half.slice(1, -1).reverse().map((p) => ({ x: -p.x, y: p.y }));
  return half.concat(left);
}
// Moore-neighbour boundary tracing of a binary mask → ordered outer contour.
// Used to turn the USNA crest's alpha silhouette into a single closed path.
function traceContour(mask, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? mask[y * w + x] : 0;
  let sx = -1, sy = -1;
  for (let y = 0; y < h && sy < 0; y++) for (let x = 0; x < w; x++) if (at(x, y)) { sx = x; sy = y; break; }
  if (sx < 0) return [];
  const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // E,SE,S,SW,W,NW,N,NE
  const dirIndex = (ox, oy) => { for (let d = 0; d < 8; d++) if (N8[d][0] === ox && N8[d][1] === oy) return d; return 4; };
  const B = [];
  let px = sx, py = sy, bx = sx - 1, by = sy;   // backtrack starts to the west
  const max = 16 * w * h;
  for (let guard = 0; guard < max; guard++) {
    B.push({ x: px, y: py });
    const startD = dirIndex(bx - px, by - py);
    let fd = -1, lbx = bx, lby = by;
    for (let k = 0; k < 8; k++) {
      const d = (startD + k) % 8, nx = px + N8[d][0], ny = py + N8[d][1];
      if (at(nx, ny)) { fd = d; break; }
      lbx = nx; lby = ny;                         // last background before the hit
    }
    if (fd < 0) break;
    bx = lbx; by = lby; px += N8[fd][0]; py += N8[fd][1];
    if (px === sx && py === sy) break;
  }
  return B;
}
// periodic low-pass of a closed polygon (box smoothing, several passes ≈ Gaussian).
// Removes the single-pixel staircase a raster trace leaves on the baseline.
function smoothClosed(pts, passes, radius) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length, next = new Array(n);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0;
      for (let k = -radius; k <= radius; k++) { const q = cur[((i + k) % n + n) % n]; sx += q.x; sy += q.y; }
      next[i] = { x: sx / (2 * radius + 1), y: sy / (2 * radius + 1) };
    }
    cur = next;
  }
  return cur;
}
// load the crest PNG and trace its silhouette (cached). The image is upscaled
// with interpolation before thresholding so the alpha edge is sub-pixel, then
// the contour is resampled dense and low-passed — the baseline comes out smooth.
let usnaCache = null;
function loadUsna() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = 4, w = img.width * s, h = img.height * s;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(img, 0, 0, w, h);
        const data = c.getImageData(0, 0, w, h).data;
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
        const raw = traceContour(mask, w, h);
        if (raw.length < 8) { resolve(null); return; }
        const dense = smoothClosed(resampleClosed(raw, 1600), 3, 5);
        resolve(dense.map((p) => ({ x: p.x, y: h - 1 - p.y }))); // flip y up
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = './usna-logo-small.png';
  });
}

const SHAPES = {
  circle: { label: 'Circle', gen: genCircle }, square: { label: 'Square', gen: genSquare },
  star: { label: 'Star', gen: genStar }, letterN: { label: 'Letter N', gen: genN },
  heart: { label: 'Heart', gen: genHeart }, anchor: { label: 'Anchor', gen: genAnchor },
  usna: { label: 'USNA crest', async: true },
};

function resampleClosed(pts, M) {
  const n = pts.length, seg = []; let total = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; const d = Math.hypot(b.x - a.x, b.y - a.y); seg.push(d); total += d; }
  const out = [], step = total / M; let i = 0, acc = 0;
  for (let k = 0; k < M; k++) {
    const target = k * step;
    while (i < n - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const a = pts[i], b = pts[(i + 1) % n], f = seg[i] > 1e-9 ? (target - acc) / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}
function normalise(pts) {
  let cx = 0, cy = 0; pts.forEach((p) => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
  let mr = 0; pts.forEach((p) => { mr = Math.max(mr, Math.hypot(p.x - cx, p.y - cy)); });
  const k = 1.45 / (mr || 1);
  return pts.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }));
}
// complex Fourier coefficients for |n| ≤ K, sorted by ascending |n| (+n before −n)
function dftCoef(pts, K) {
  const M = pts.length, out = [];
  for (let n = -K; n <= K; n++) {
    let re = 0, im = 0;
    for (let m = 0; m < M; m++) { const ang = -TWO_PI * n * m / M, c = Math.cos(ang), s = Math.sin(ang); re += pts[m].x * c - pts[m].y * s; im += pts[m].x * s + pts[m].y * c; }
    re /= M; im /= M; out.push({ n, re, im, amp: Math.hypot(re, im) });
  }
  out.sort((p, q) => (Math.abs(p.n) - Math.abs(q.n)) || (q.n - p.n));
  return out;
}
const SHAPE_K = 160;    // coefficient bandwidth |n| ≤ SHAPE_K computed per shape
const SHAPE_M = 720;    // path resample count before the DFT

function EpicyclesMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [shape, setShape] = useState('letterN');
  const [N, setN] = useState(12);
  const [speed, setSpeed] = useState(0.12);
  const [playing, setPlaying] = useState(true);
  const [showCircles, setShowCircles] = useState(true);
  const [showTarget, setShowTarget] = useState(true);
  const [persist, setPersist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [ro, setRo] = useState({ circles: 25, angle: 0 });

  const coefRef = useRef(dftCoef(normalise(resampleClosed(SHAPES.letterN.gen(), SHAPE_M)), SHAPE_K));
  const shapeRef = useRef(normalise(resampleClosed(SHAPES.letterN.gen(), SHAPE_M)));
  const nRef = useRef(N); nRef.current = N;
  const speedRef = useRef(speed); speedRef.current = speed;
  const playRef = useRef(playing); playRef.current = playing;
  const circRef = useRef(showCircles); circRef.current = showCircles;
  const targetRef = useRef(showTarget); targetRef.current = showTarget;
  const persistRef = useRef(persist); persistRef.current = persist;
  const phaseRef = useRef(0);
  const trailRef = useRef([]);
  const loadTokenRef = useRef(0);

  const applyPts = (pts) => { shapeRef.current = pts; coefRef.current = dftCoef(pts, SHAPE_K); phaseRef.current = 0; trailRef.current = []; };
  const loadShape = (id) => {
    const tok = ++loadTokenRef.current;
    if (SHAPES[id].async) {                       // the crest: trace the PNG once, then cache
      if (usnaCache) { applyPts(usnaCache); return; }
      setLoading(true);
      loadUsna().then((raw) => {
        if (loadTokenRef.current !== tok) return;  // user switched away mid-load
        setLoading(false);
        const pts = (raw && raw.length >= 8) ? normalise(resampleClosed(raw, SHAPE_M)) : normalise(resampleClosed(SHAPES.letterN.gen(), SHAPE_M));
        usnaCache = pts; applyPts(pts);
      });
      return;
    }
    applyPts(normalise(resampleClosed(SHAPES[id].gen(), SHAPE_M)));
  };
  useEffect(() => { loadShape(shape); /* eslint-disable-next-line */ }, [shape]);
  // changing N restarts the trace cleanly (the traced curve is different)
  useEffect(() => { phaseRef.current = 0; trailRef.current = []; }, [N]);
  const reset = () => { setShape('letterN'); setN(12); setSpeed(0.12); setPlaying(true); setShowCircles(true); setShowTarget(true); setPersist(true); phaseRef.current = 0; trailRef.current = []; };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last, lastPub = 0, cx, cy, scale;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); cx = W / 2; cy = H / 2; scale = Math.min(W, H) * 0.30; };
    const used = () => { const N0 = nRef.current; return coefRef.current.filter((c) => Math.abs(c.n) <= N0); };
    const posAt = (list, t) => { let x = 0, y = 0; for (const c of list) { const a = TWO_PI * c.n * t, cs = Math.cos(a), sn = Math.sin(a); x += c.re * cs - c.im * sn; y += c.re * sn + c.im * cs; } return [x, y]; };

    const draw = (now) => {
      if (last === undefined) last = now; let dt = (now - last) / 1000; last = now; if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      if (playRef.current) phaseRef.current = (phaseRef.current + speedRef.current * dt) % 1;
      const t = phaseRef.current, list = used();

      ctx.clearRect(0, 0, W, H);
      const sx = (x) => cx + x * scale, sy = (y) => cy - y * scale;

      // faint target shape (the N→∞ limit)
      if (targetRef.current) {
        const pts = shapeRef.current;
        ctx.strokeStyle = 'rgba(91,155,213,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y)))); ctx.closePath(); ctx.stroke();
      }

      // the chain of circles
      let px = 0, py = 0;
      if (circRef.current) {
        for (const c of list) {
          if (c.n === 0) { px = c.re; py = c.im; continue; }
          const a = TWO_PI * c.n * t;
          const nx = px + c.re * Math.cos(a) - c.im * Math.sin(a);
          const ny = py + c.re * Math.sin(a) + c.im * Math.cos(a);
          if (c.amp * scale > 0.8) {
            ctx.strokeStyle = 'rgba(139,140,142,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(sx(px), sy(py), c.amp * scale, 0, TWO_PI); ctx.stroke();
            ctx.strokeStyle = 'rgba(91,155,213,0.8)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(sx(px), sy(py)); ctx.lineTo(sx(nx), sy(ny)); ctx.stroke();
          }
          px = nx; py = ny;
        }
      } else { const p = posAt(list, t); px = p[0]; py = p[1]; }

      // pen + trail
      const trail = trailRef.current;
      trail.push([px, py]);
      const cap = persistRef.current ? 1400 : 240;
      if (trail.length > cap) trail.splice(0, trail.length - cap);
      ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) { const p = trail[i]; i === 0 ? ctx.moveTo(sx(p[0]), sy(p[1])) : ctx.lineTo(sx(p[0]), sy(p[1])); }
      ctx.strokeStyle = GOLD; ctx.stroke();
      // pen head
      ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(sx(px), sy(py), 4.5, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = BG; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.font = 'bold 13px JetBrains Mono, monospace'; ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${2 * nRef.current + 1} circles`, 14, 12);

      if (now - lastPub > 120) { lastPub = now; setRo({ circles: 2 * nRef.current + 1, angle: (t * 360) % 360 }); }
      raf = requestAnimationFrame(draw);
    };

    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-3">
          <label className="text-usna-text text-sm font-medium block mb-1.5">Shape</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SHAPES).map(([id, s]) => (
              <button key={id} onClick={() => setShape(id)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${shape === id ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setPlaying((p) => !p)}
          className="mb-3 w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
          {playing ? 'Pause' : 'Play'}
        </button>
        <Slider label="Harmonics N" value={N} min={1} max={SHAPE_K} step={1} unit="" onChange={setN} />
        <Slider label="Speed" value={+speed.toFixed(2)} min={0.02} max={0.5} step={0.02} unit="" onChange={setSpeed} />
        <div className="flex flex-col gap-2 mb-1 mt-1">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showCircles} onChange={(e) => setShowCircles(e.target.checked)} /> Show circles
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showTarget} onChange={(e) => setShowTarget(e.target.checked)} /> Show target shape
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} /> Persist the trail
          </label>
        </div>
        <div className="border-t border-usna-grid pt-3 mt-3">
          <Readout label="circles (2N+1)" value={ro.circles} unit="" />
          <Readout label="N (max harmonic)" value={N} unit="" />
          <Readout label="phase" value={ro.angle.toFixed(0)} unit="°" />
        </div>
        <p className="mt-3 text-xs text-usna-text leading-snug">
          Each circle is one Fourier mode. Low N gives a loose, rounded trace; raise N and the pen
          locks onto the shape. The crest is traced from its silhouette; the letter and star need
          only a handful of circles, the crest many more.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 480, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-usna-gold text-sm font-mono pointer-events-none">
              tracing the crest…
            </div>
          )}
        </div>
        <InfoPanel
          title="Circles upon circles draw the shape"
          description="A closed path in the plane is a complex-valued periodic signal, so it too has a Fourier series — now with both positive and negative frequencies. Each coefficient is a circle: its radius is the magnitude |c_n|, it turns at rate n·ω₀, and it starts at the angle arg c_n. Mounted tip to tip, the circles chain into a single arm whose pen traces the path. Frequency content is literally the set of circle radii and turning rates. With few circles the trace is a rounded caricature; add more and it converges to the exact outline. A single circle is one frequency — simple harmonic motion carried into two dimensions."
          equation={String.raw`z(t)=\sum_{n=-N}^{N} c_n\,e^{\,i n\omega_0 t},\qquad c_n=\frac{1}{T}\int_0^T z(t)\,e^{-i n\omega_0 t}\,dt`}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════ CONTINUOUS FT MODE ═══════════════════════════
 * A non-periodic signal has a continuous spectrum X(f)=∫x(t)e^{-i2πft}dt — a
 * curve, not a line comb. This mode contrasts the two: a tunable pulse and its
 * transform, the width tradeoff Δt·Δf ≥ 1/4π, and an overlay of the discrete
 * Fourier-series lines you would get by periodising with period T_p, which only
 * SAMPLE this continuous curve at spacing 1/T_p and fill in as T_p → ∞.         */
const TW = 8;             // time half-window
const C_NT = 1024, C_NF = 400;
function chirpContinuous(t) {
  // fills the window: low, slow start at the left edge → merger near the right edge
  const t0 = -7.5, t1 = 7.0, eps = 0.03, fmin = 0.7;
  if (t <= t0 || t >= t1) return 0;
  const tau0 = (t1 + eps) - t0, tau = (t1 + eps) - t;   // time to merger
  const f = fmin * Math.pow(tau0 / tau, 3 / 8);
  const phi = TWO_PI * fmin * Math.pow(tau0, 3 / 8) * (8 / 5) * (Math.pow(tau0, 5 / 8) - Math.pow(tau, 5 / 8));
  const amp = Math.pow(f / fmin, 2 / 3);
  const env = Math.min(1, (t - t0) / 1.5) * Math.min(1, (t1 - t) / 0.12); // slow fade-in, abrupt merger cutoff
  return 0.14 * env * amp * Math.cos(phi);
}
const CSIGNALS = {
  gaussian: {
    label: 'Gaussian', fMax: 3, w0: 1,
    x: (t, w) => Math.exp(-(t * t) / (2 * w * w)),
    ref: (f, w) => w * Math.sqrt(TWO_PI) * Math.exp(-2 * Math.PI * Math.PI * w * w * f * f),
    note: 'Gaussian ↔ Gaussian — the unique minimum-uncertainty pair, Δt·Δf = 1/4π.',
  },
  rect: {
    label: 'Rect pulse', fMax: 4, w0: 2,
    x: (t, w) => (Math.abs(t) < w / 2 ? 1 : 0),
    ref: (f, w) => (Math.abs(f) < 1e-9 ? w : Math.abs(w * Math.sin(Math.PI * f * w) / (Math.PI * f * w))),
    note: 'Rectangular pulse ↔ sinc — hard edges spray energy into high-frequency sidelobes.',
  },
  exp: {
    label: 'Two-sided exp', fMax: 4, w0: 1,
    x: (t, w) => Math.exp(-Math.abs(t) / w),
    ref: (f, w) => 2 * w / (1 + (TWO_PI * f * w) * (TWO_PI * f * w)),
    note: 'e^{−|t|/τ} ↔ Lorentzian 2τ/(1+(2πfτ)²).',
  },
  gabor: {
    label: 'Cosine burst', fMax: 4, w0: 1.4,
    x: (t, w) => Math.exp(-(t * t) / (2 * w * w)) * Math.cos(TWO_PI * 1.5 * t),
    ref: null,
    note: 'A Gaussian times cos(2πf₀t): modulation shifts the spectrum to twin peaks at ±f₀.',
  },
  chirp: {
    label: 'GW chirp', fMax: 10, w0: 1, fixed: true,
    x: (t) => chirpContinuous(t),
    ref: null, spa: true,
    note: 'A low-mass (long) inspiral chirp. Stationary phase gives a smooth band with |X(f)| ∝ f^{−7/6}.',
  },
};

function ContinuousMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [preset, setPreset] = useState('gaussian');
  const [width, setWidth] = useState(1);
  const [periodize, setPeriodize] = useState(false);
  const [Tp, setTp] = useState(6);
  const [ro, setRo] = useState({ dt: 0, df: 0, prod: 0 });

  const dataRef = useRef(null);
  const periodizeRef = useRef(periodize); periodizeRef.current = periodize;
  const TpRef = useRef(Tp); TpRef.current = Tp;
  const sig = CSIGNALS[preset];

  const recompute = (presetId, w) => {
    const s = CSIGNALS[presetId];
    const dt = (2 * TW) / C_NT;
    const tArr = new Float64Array(C_NT), xArr = new Float64Array(C_NT);
    let sx2 = 0, st2 = 0, xAbs = 1e-3;
    for (let k = 0; k < C_NT; k++) {
      const t = -TW + k * dt; tArr[k] = t;
      const v = s.fixed ? s.x(t) : s.x(t, w);
      xArr[k] = v; sx2 += v * v; st2 += t * t * v * v; if (Math.abs(v) > xAbs) xAbs = Math.abs(v);
    }
    const dtW = Math.sqrt(st2 / (sx2 || 1));
    const fMax = s.fMax, fArr = new Float64Array(C_NF), XArr = new Float64Array(C_NF);
    let sX2 = 0, sf2 = 0, XMax = 1e-3;
    for (let j = 0; j < C_NF; j++) {
      const f = -fMax + (2 * fMax) * j / (C_NF - 1); fArr[j] = f;
      let re = 0, im = 0;
      for (let k = 0; k < C_NT; k++) { const ang = -TWO_PI * f * tArr[k]; re += xArr[k] * Math.cos(ang); im += xArr[k] * Math.sin(ang); }
      re *= dt; im *= dt;
      const mag = Math.hypot(re, im); XArr[j] = mag; sX2 += mag * mag; sf2 += f * f * mag * mag; if (mag > XMax) XMax = mag;
    }
    const dfW = Math.sqrt(sf2 / (sX2 || 1));
    dataRef.current = { tArr, xArr, fArr, XArr, fMax, xAbs, XMax };
    setRo({ dt: dtW, df: dfW, prod: dtW * dfW });
  };
  useEffect(() => { recompute(preset, width); /* eslint-disable-next-line */ }, [preset, width]);
  const reset = () => { setPreset('gaussian'); setWidth(1); setPeriodize(false); setTp(6); };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = () => {
      const d = dataRef.current;
      const left = 46, right = 16, top = 14, botPad = 26;
      const usableH = H - top - botPad, gap = 34, topH = usableH * 0.5;
      const topR = { x: left, y: top, w: W - left - right, h: topH - gap * 0.5 };
      const botR = { x: left, y: top + topH + gap * 0.5, w: W - left - right, h: usableH - topH - gap * 0.5 };

      ctx.clearRect(0, 0, W, H);
      panelFrame(ctx, topR, 'x(t)  — aperiodic pulse');
      panelFrame(ctx, botR, '|X(f)|  — continuous spectrum');
      if (!d) { raf = requestAnimationFrame(draw); return; }

      const xT = (t) => topR.x + ((t + TW) / (2 * TW)) * topR.w;
      const yT = (y) => topR.y + ((d.xAbs - y) / (2 * d.xAbs)) * topR.h;
      const xF = (f) => botR.x + ((f + d.fMax) / (2 * d.fMax)) * botR.w;
      const yF = (A) => botR.y + botR.h - 6 - (A / (d.XMax * 1.08)) * (botR.h - 14);
      const Xat = (f) => { const j = (f + d.fMax) / (2 * d.fMax) * (C_NF - 1); if (j < 0 || j > C_NF - 1) return 0; const j0 = Math.floor(j), fr = j - j0; return d.XArr[j0] * (1 - fr) + d.XArr[Math.min(C_NF - 1, j0 + 1)] * fr; };

      // zero lines
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      let z = yT(0); ctx.beginPath(); ctx.moveTo(topR.x, z); ctx.lineTo(topR.x + topR.w, z); ctx.stroke();
      const fz = xF(0); ctx.beginPath(); ctx.moveTo(fz, botR.y + 6); ctx.lineTo(fz, botR.y + botR.h - 6); ctx.stroke();

      // x(t)
      ctx.save(); ctx.beginPath(); ctx.rect(topR.x, topR.y, topR.w, topR.h); ctx.clip();
      ctx.strokeStyle = BLUE; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let k = 0; k < C_NT; k++) { const px = xT(d.tArr[k]), py = yT(d.xArr[k]); k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke(); ctx.restore();

      // periodised Fourier-series lines (sample the continuum at f = n/T_p)
      if (periodizeRef.current) {
        const TpV = TpRef.current, dfp = 1 / TpV, base = botR.y + botR.h - 6;
        ctx.strokeStyle = 'rgba(127,183,126,0.9)'; ctx.fillStyle = 'rgba(127,183,126,0.9)'; ctx.lineWidth = 1.5;
        for (let n = -Math.floor(d.fMax * TpV); n <= Math.floor(d.fMax * TpV); n++) {
          const f = n * dfp, yh = yF(Xat(f));
          ctx.beginPath(); ctx.moveTo(xF(f), base); ctx.lineTo(xF(f), yh); ctx.stroke();
          ctx.beginPath(); ctx.arc(xF(f), yh, 2.2, 0, TWO_PI); ctx.fill();
        }
        ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`series lines at f = n/T_p  (T_p = ${TpV})`, botR.x + 6, botR.y + 5);
      }

      // |X(f)| continuous curve
      ctx.save(); ctx.beginPath(); ctx.rect(botR.x, botR.y, botR.w, botR.h); ctx.clip();
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6; ctx.beginPath();
      for (let j = 0; j < C_NF; j++) { const px = xF(d.fArr[j]), py = yF(d.XArr[j]); j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();

      // analytic reference (dashed), where closed form is known
      if (sig.ref) {
        ctx.strokeStyle = 'rgba(240,236,227,0.5)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.4; ctx.beginPath();
        for (let j = 0; j < C_NF; j++) { const f = d.fArr[j], px = xF(f), py = yF(sig.ref(f, width)); j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      // SPA power law for the chirp: |X| ∝ f^{-7/6}
      if (sig.spa) {
        const Cc = Xat(1.5) * Math.pow(1.5, 7 / 6);
        ctx.strokeStyle = 'rgba(240,236,227,0.6)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.4;
        for (const sgn of [1, -1]) {
          ctx.beginPath();
          for (let j = 0; j < C_NF; j++) { const f = sgn * (0.4 + (d.fMax - 0.4) * j / (C_NF - 1)); const py = yF(Cc * Math.pow(Math.abs(f), -7 / 6)); j === 0 ? ctx.moveTo(xF(f), py) : ctx.lineTo(xF(f), py); }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(240,236,227,0.75)'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('∝ f^(−7/6)  (SPA)', botR.x + botR.w - 8, botR.y + 5);
      }
      ctx.restore();

      // f-axis ticks
      ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`−${d.fMax}`, xF(-d.fMax) + 10, botR.y + botR.h + 5);
      ctx.fillText('f = 0', fz, botR.y + botR.h + 5);
      ctx.fillText(`${d.fMax}`, xF(d.fMax) - 10, botR.y + botR.h + 5);

      raf = requestAnimationFrame(draw);
    };

    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, [preset, width]); // redraw refs rebind when the signal changes

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-3">
          <label className="text-usna-text text-sm font-medium block mb-1.5">Signal</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CSIGNALS).map(([id, s]) => (
              <button key={id} onClick={() => setPreset(id)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${preset === id ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {!sig.fixed && <Slider label="Width (time)" value={+width.toFixed(2)} min={0.3} max={3} step={0.05} unit="" onChange={setWidth} />}
        <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer mb-2">
          <input type="checkbox" checked={periodize} onChange={(e) => setPeriodize(e.target.checked)} /> Periodize (show series lines)
        </label>
        {periodize && <Slider label="Assumed period T_p" value={Tp} min={2} max={16} step={1} unit="" onChange={setTp} />}
        <div className="border-t border-usna-grid pt-3">
          <Readout label="Δt (time width)" value={fmt(ro.dt, 3)} unit="" />
          <Readout label="Δf (band width)" value={fmt(ro.df, 3)} unit="" />
          <Readout label="Δt · Δf" value={fmt(ro.prod, 3)} unit="≥ 0.080" />
        </div>
        <p className="mt-3 text-xs text-usna-text leading-snug">
          Narrow the pulse in time and its spectrum broadens: the product Δt·Δf cannot fall below
          1/4π ≈ 0.080, reached only by the Gaussian. Turn on <em>Periodize</em>: the green lines are
          the discrete Fourier-series coefficients of the repeated signal — they merely sample this
          curve at spacing 1/T_p and fill into the continuum as T_p grows.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 460, background: BG }}>
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <InfoPanel
          title="Aperiodic signals have a continuous spectrum"
          description={`Let the period go to infinity and the harmonics n·ω₀ crowd together until the spectrum is no longer a comb of lines but a continuous function X(f): the Fourier transform. The series becomes an integral, and the discrete coefficients become a density. ${sig.note} The time and frequency pictures trade width against each other — a signal localized in time is spread in frequency and vice versa, bounded below by the uncertainty relation Δt·Δf ≥ 1/4π. This is the same mathematics as the discrete modes, taken to the aperiodic limit.`}
          equation={String.raw`X(f)=\int_{-\infty}^{\infty} x(t)\,e^{-i2\pi f t}\,dt,\qquad x(t)=\int_{-\infty}^{\infty} X(f)\,e^{\,i2\pi f t}\,df,\qquad \Delta t\,\Delta f \ge \frac{1}{4\pi}`}
        />
      </div>
    </div>
  );
}

export default function FourierTransform({ mode = 'spectrum' }) {
  if (mode === 'synthesis') return <SynthesisMode />;
  if (mode === 'epicycles') return <EpicyclesMode />;
  if (mode === 'continuous') return <ContinuousMode />;
  return <SpectrumMode />;
}
