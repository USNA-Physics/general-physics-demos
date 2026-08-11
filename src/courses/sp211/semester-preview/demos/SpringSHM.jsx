import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * SpringSHM — Unit IV "simple harmonic motion" (Ch 14).
 *
 * A mass on a spring bobs as x(t) = A cos(omega t), omega = sqrt(k/m). A slider
 * sets the spring stiffness k, which changes the PERIOD T = 2*pi/omega — but not
 * the amplitude. That invariance (period fixed by k and m, independent of how far
 * you pull it) is exactly what makes an oscillator a clock. Naval tie: a ship
 * rolls about upright like a mass on a spring.
 *
 * Motion advances on an accumulated-sim / bounded-dt clock (not raw timestamps),
 * so it stays smooth under tab throttling. Self-contained (canvas + rAF +
 * ResizeObserver); matches the shared design system.
 */
const MASS = 1;        // fixed mass (scaled units)
const AMP = 1;         // fixed amplitude (scaled units — mapped to pixels on draw)
const TIME_SCALE = 1;  // sim seconds map 1:1 to displayed seconds

export default function SpringSHM({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [k, setK] = useState(1.0);
  const kRef = useRef(k);
  kRef.current = k;

  const omega = Math.sqrt(k / MASS);
  const period = (2 * Math.PI) / omega / TIME_SCALE;
  const freq = 1 / period;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow, trace = [];

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const reset = () => {
      sim = 0;          // seconds of simulation time (accumulated, not wall-clock)
      trace = [];
    };

    const draw = (now) => {
      if (sim === undefined) { reset(); lastNow = now; }
      // accumulate our own clock so the sim advances by a bounded step every
      // frame — robust to tab throttling and non-advancing timestamps.
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;

      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');

      const om = Math.sqrt(kRef.current / MASS);
      const x = AMP * Math.cos(om * sim);   // closed-form displacement, scaled units

      // ── layout ────────────────────────────────────────────────────────────
      const supportY = Math.round(H * 0.12);   // fixed support bar
      const eqY = Math.round(H * 0.52);         // equilibrium line (x = 0)
      const ampPx = Math.min(H * 0.30, 120);    // pixels per unit amplitude
      const springX = Math.round(W * 0.26);     // horizontal center of the spring/mass
      const massY = eqY - x * ampPx;            // +x drawn upward
      const massSize = Math.max(38, Math.min(56, W * 0.075));

      // trace panel to the right
      const traceX0 = Math.round(W * 0.50);
      const traceX1 = W - 18;
      const traceW = Math.max(1, traceX1 - traceX0);
      const traceMax = 6.0;                     // seconds of history shown
      trace.push({ t: sim, x });
      while (trace.length && sim - trace[0].t > traceMax) trace.shift();

      ctx.clearRect(0, 0, W, H);

      // ── equilibrium line (spans the full width) ──────────────────────────
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(18, eqY);
      ctx.lineTo(traceX1, eqY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = muted;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('equilibrium', 22, eqY - 6);

      // ── fixed support bar with hatching ──────────────────────────────────
      const barL = springX - massSize;
      const barR = springX + massSize;
      ctx.strokeStyle = muted;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(barL, supportY);
      ctx.lineTo(barR, supportY);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let hx = barL; hx <= barR; hx += 9) {
        ctx.beginPath();
        ctx.moveTo(hx, supportY);
        ctx.lineTo(hx - 8, supportY - 8);
        ctx.stroke();
      }

      // ── zig-zag spring from support to top of the mass ───────────────────
      const massTop = massY - massSize / 2;
      const coils = 11;
      const springW = massSize * 0.42;
      const lead = 10;                          // straight lead-in top & bottom
      const zigTop = supportY;
      const zigBot = massTop;
      const zigSpan = Math.max(1, zigBot - lead - (zigTop + lead));
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(springX, zigTop);
      ctx.lineTo(springX, zigTop + lead);
      for (let i = 0; i <= coils; i++) {
        const yy = zigTop + lead + (i / coils) * zigSpan;
        const side = i % 2 === 0 ? -1 : 1;
        const xx = i === 0 || i === coils ? springX : springX + side * springW;
        ctx.lineTo(xx, yy);
      }
      ctx.lineTo(springX, zigBot);
      ctx.stroke();

      // ── the mass: gold rounded square ────────────────────────────────────
      const mx = springX - massSize / 2;
      const my = massY - massSize / 2;
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(mx + r, my);
      ctx.arcTo(mx + massSize, my, mx + massSize, my + massSize, r);
      ctx.arcTo(mx + massSize, my + massSize, mx, my + massSize, r);
      ctx.arcTo(mx, my + massSize, mx, my, r);
      ctx.arcTo(mx, my, mx + massSize, my, r);
      ctx.closePath();
      ctx.fillStyle = gold;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── live x(t) trace to the right (scrolls, newest at the right edge) ──
      // separator
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(traceX0 - 12, supportY - 4);
      ctx.lineTo(traceX0 - 12, H - 18);
      ctx.stroke();

      ctx.strokeStyle = gold;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      trace.forEach((p, i) => {
        const px = traceX1 - ((sim - p.t) / traceMax) * traceW;
        const py = eqY - p.x * ampPx;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();

      // marker dot where the trace meets "now"
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(traceX1, eqY - x * ampPx, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = muted;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('x(t)', traceX0, supportY + 4);

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
          <div>k&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{k.toFixed(2)}</div>
          <div>period&nbsp;{period.toFixed(2)} s</div>
          <div>freq&nbsp;&nbsp;&nbsp;{freq.toFixed(2)} Hz</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Stiffness (k)</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{k.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0.2} max={6.0} step={0.05} value={k}
          onInput={(e) => setK(parseFloat(e.target.value))}
          aria-label="Spring stiffness k" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Change the stiffness and the period changes; the amplitude does not, which is what makes an oscillator a clock.
          </p>
        )}
      </div>
    </div>
  );
}
