import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * StandingWaves — Act IV "standing waves".
 *
 * A string fixed at both ends vibrating in its n-th harmonic. The slider picks
 * the harmonic n (1..6). Nodes stay pinned; antinodes swing between the two
 * envelope curves as y(x,t) = A·sin(nπx/L)·cos(ω_n t), with ω_n ∝ n. These are
 * the building blocks of every musical note and every resonating cavity.
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design
 * system. Motion advances off an accumulated, bounded-step sim clock (mirrors
 * DopplerWavefronts) rather than raw wall-clock timestamps.
 */
const F1 = 0.25;   // fundamental temporal frequency (Hz of the sim clock) — slow enough to watch
const SAMPLES = 200; // x-samples across the string for the live waveform

export default function StandingWaves({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [n, setN] = useState(3);
  const nRef = useRef(n);
  nRef.current = n;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    const padX = 40;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      if (sim === undefined) { sim = 0; lastNow = now; }
      // accumulate our own clock so the sim advances by a bounded step every
      // frame — robust to tab throttling and non-advancing timestamps.
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;

      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const nNow = nRef.current;

      const x0 = padX;
      const x1 = W - padX;
      const L = x1 - x0;
      const y0 = H / 2;
      const A = Math.min(H * 0.34, 120);           // px amplitude
      const omega = 2 * Math.PI * F1 * nNow;        // ω_n ∝ n
      const phase = Math.cos(omega * sim);          // temporal oscillation

      // shape at a given fraction u = x/L along the string
      const shape = (u) => Math.sin(nNow * Math.PI * u);

      ctx.clearRect(0, 0, W, H);

      // equilibrium axis (the string at rest)
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.stroke();

      // faint dashed envelopes: +A·sin(nπx/L) and −A·sin(nπx/L)
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      [1, -1].forEach((s) => {
        ctx.beginPath();
        for (let i = 0; i <= SAMPLES; i++) {
          const u = i / SAMPLES;
          const px = x0 + u * L;
          const py = y0 - s * A * shape(u);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // nodes: fixed points where sin(nπx/L) = 0 (n + 1 of them, ends included)
      for (let k = 0; k <= nNow; k++) {
        const px = x0 + (k / nNow) * L;
        ctx.fillStyle = muted;
        ctx.beginPath();
        ctx.arc(px, y0, 3, 0, 2 * Math.PI);
        ctx.fill();
      }

      // antinodes: midpoints of each half-wavelength, marked subtly at current y
      for (let k = 0; k < nNow; k++) {
        const u = (k + 0.5) / nNow;
        const px = x0 + u * L;
        const py = y0 - A * shape(u) * phase;
        ctx.strokeStyle = `rgba(197,183,131,0.35)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // live waveform: glowing gold curve, y(x,t) = A·sin(nπx/L)·cos(ω_n t)
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (let i = 0; i <= SAMPLES; i++) {
        const u = i / SAMPLES;
        const px = x0 + u * L;
        const py = y0 - A * shape(u) * phase;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // anchor blocks at the fixed ends
      ctx.fillStyle = muted;
      ctx.fillRect(x0 - 6, y0 - 12, 6, 24);
      ctx.fillRect(x1, y0 - 12, 6, 24);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full gap-3">
      <div ref={wrapRef} className="relative flex-1 min-h-0 rounded-lg overflow-hidden" style={{ background: '#0D1321' }}>
        <canvas ref={canvasRef} className="block" />
        <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5">
          <div>harmonic&nbsp;&nbsp;n = {n}</div>
          <div>nodes&nbsp;&nbsp;{n + 1}</div>
          <div>freq&nbsp;&nbsp;{n} &times; f&#8321;</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Harmonic (n)</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">n = {n}</span>
        </div>
        <input
          type="range" min={1} max={6} step={1} value={n}
          onInput={(e) => setN(parseInt(e.target.value, 10))}
          aria-label="Harmonic (n)" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Fixed ends force whole numbers of half-wavelengths: the harmonics.
          </p>
        )}
      </div>
    </div>
  );
}
