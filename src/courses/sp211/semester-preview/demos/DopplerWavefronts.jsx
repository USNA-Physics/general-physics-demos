import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * DopplerWavefronts — Act IV "waves" (Master Plan D39).
 *
 * A source moves through a medium, emitting circular wavefronts at a fixed rate.
 * Ahead of it the crests bunch (higher frequency); behind, they stretch (lower).
 * That frequency shift is how Doppler sonar reads a target's speed. Push the
 * source past the wave speed (Mach > 1) and the crests pile into a cone: the bow
 * shock / sonic boom, with half-angle sin(a) = 1/Mach.
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design system.
 */
const C = 150;        // wave speed, px/s
const T_EMIT = 0.42;  // seconds between emitted wavefronts (source period)

export default function DopplerWavefronts({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [mach, setMach] = useState(0.6);
  const machRef = useRef(mach);
  machRef.current = mach;

  const f0 = 1 / T_EMIT;
  const ahead = mach < 1 ? f0 / (1 - mach) : Infinity;
  const behind = f0 / (1 + mach);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow, lastEmit, wavefronts = [], srcX0;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const reset = () => {
      sim = 0;          // seconds of simulation time (accumulated, not wall-clock)
      lastEmit = 0;
      wavefronts = [];
      srcX0 = -40;
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
      const mNow = machRef.current;
      const v = mNow * C;
      const y = H / 2;
      const srcX = srcX0 + v * sim;

      // emit new wavefronts at the source's live position
      while (sim - lastEmit >= T_EMIT) {
        lastEmit += T_EMIT;
        wavefronts.push({ x: srcX0 + v * lastEmit, y, te: lastEmit });
      }
      // drop wavefronts that have expanded off-screen
      const diag = Math.hypot(W, H) * 1.15;
      wavefronts = wavefronts.filter((w) => C * (sim - w.te) < diag);
      // loop once the source leaves the frame
      if (srcX > W + 60) { reset(); return (raf = requestAnimationFrame(draw)); }

      ctx.clearRect(0, 0, W, H);

      // baseline (medium)
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();

      // wavefronts: expand at wave speed C, drawn as glowing gold rings that
      // fade with age so the compressed front reads bright and dense.
      ctx.shadowColor = gold;
      wavefronts.forEach((w) => {
        const r = C * (sim - w.te);
        if (r <= 0) return;
        const age = Math.min(1, r / diag);
        ctx.strokeStyle = `rgba(197,183,131,${(0.6 * (1 - age) + 0.08).toFixed(3)})`;
        ctx.shadowBlur = 9 * (1 - age);
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, 2 * Math.PI);
        ctx.stroke();
      });
      ctx.shadowBlur = 0;

      // Mach cone when supersonic: half-angle a, sin a = 1/Mach
      if (mNow > 1.001) {
        const a = Math.asin(1 / mNow);
        const L = Math.hypot(W, H);
        ctx.strokeStyle = gold;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        [-1, 1].forEach((s) => {
          ctx.beginPath();
          ctx.moveTo(srcX, y);
          ctx.lineTo(srcX - L * Math.cos(a), y + s * L * Math.sin(a));
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // source (bright, strongly glowing)
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(srcX, y, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(srcX, y, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // labels: front (compressed) vs back (stretched)
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      if (srcX > 60 && srcX < W - 60) {
        ctx.fillText('compressed →', Math.min(W - 50, srcX + 60), y - 10);
        ctx.fillText('← stretched', Math.max(50, srcX - 60), y - 10);
      }

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
          <div>Mach&nbsp;&nbsp;{mach.toFixed(2)}</div>
          <div>f&nbsp;ahead&nbsp;&nbsp;{ahead === Infinity ? 'shock' : ahead.toFixed(2) + ' Hz'}</div>
          <div>f&nbsp;behind&nbsp;{behind.toFixed(2)} Hz</div>
        </div>
        {mach > 1.001 && (
          <div className="absolute top-2 right-3 text-xs font-mono text-usna-gold font-semibold">
            BOW SHOCK
          </div>
        )}
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Source speed</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">Mach {mach.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0} max={1.4} step={0.01} value={mach}
          onInput={(e) => setMach(parseFloat(e.target.value))}
          aria-label="Source speed in Mach" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Below Mach&nbsp;1: pitch rises ahead, drops behind. Past Mach&nbsp;1: the crests form a shock cone.
          </p>
        )}
      </div>
    </div>
  );
}
