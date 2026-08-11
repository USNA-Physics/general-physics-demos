import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * ProjectileArc — Act I "things that fly" (Master Plan D06).
 *
 * A live launch-angle demo: drag the angle and watch the trajectory. The ghost
 * arc at the complementary angle (90 - theta) lands at the same range, the
 * counterintuitive result L6 will prove. A gold shell flies the chosen arc on a
 * loop. Self-contained (own canvas + rAF + ResizeObserver); fills its parent.
 *
 * Palette + setupCanvas match the shared design system so it reads as one app.
 */
const G = 9.81;      // m/s^2
const V0 = 30;       // m/s, fixed launch speed
const WORLD_W = 105; // meters mapped across the canvas width (equal x/y scale)

export default function ProjectileArc({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [angle, setAngle] = useState(45);
  const angleRef = useRef(angle);
  angleRef.current = angle;

  const range = (V0 * V0 * Math.sin((2 * angle * Math.PI) / 180)) / G;
  const tFlight = (2 * V0 * Math.sin((angle * Math.PI) / 180)) / G;
  const apex = (V0 * V0 * Math.sin((angle * Math.PI) / 180) ** 2) / (2 * G);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, sc, groundY, raf, t0;
    const padX = 26, padBottom = 30;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      sc = (W - 2 * padX) / WORLD_W;       // px per meter (equal scale both axes)
      groundY = H - padBottom;
    };

    const toX = (x) => padX + x * sc;
    const toY = (y) => groundY - y * sc;

    const arc = (theta, samples = 96) => {
      const th = (theta * Math.PI) / 180;
      const tf = (2 * V0 * Math.sin(th)) / G;
      const pts = [];
      for (let i = 0; i <= samples; i++) {
        const t = (i / samples) * tf;
        pts.push([V0 * Math.cos(th) * t, V0 * Math.sin(th) * t - 0.5 * G * t * t]);
      }
      return pts;
    };

    const stroke = (pts, color, width, dash = []) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y))));
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const draw = (now) => {
      if (!t0) t0 = now;
      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const theta = angleRef.current;

      ctx.clearRect(0, 0, W, H);

      // ground
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, groundY);
      ctx.lineTo(W - padX, groundY);
      ctx.stroke();

      // range tick marks every 20 m
      ctx.fillStyle = muted;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      for (let m = 0; m <= 100; m += 20) {
        ctx.fillRect(toX(m), groundY - 3, 1, 6);
        ctx.fillText(`${m}`, toX(m), groundY + 16);
      }

      // complementary-angle ghost arc (same range)
      const comp = 90 - theta;
      if (Math.abs(comp - theta) > 0.5) stroke(arc(comp), muted, 1.5, [5, 5]);

      // chosen arc
      const pts = arc(theta);
      stroke(pts, gold, 2.6);

      // launch vector
      const th = (theta * Math.PI) / 180;
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      ctx.lineTo(toX(6 * Math.cos(th)), toY(6 * Math.sin(th)));
      ctx.stroke();

      // range marker
      const R = (V0 * V0 * Math.sin((2 * theta * Math.PI) / 180)) / G;
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(toX(R), toY(0), 3.5, 0, 2 * Math.PI);
      ctx.fill();

      // flying shell, looping along the chosen arc
      const tf = (2 * V0 * Math.sin(th)) / G;
      const phase = ((now - t0) / 1000) % (tf + 0.5);
      if (phase <= tf) {
        const x = V0 * Math.cos(th) * phase;
        const y = V0 * Math.sin(th) * phase - 0.5 * G * phase * phase;
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = gold;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(toX(x), toY(y), 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;
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
          <div>range&nbsp;&nbsp;{range.toFixed(1)} m</div>
          <div>apex&nbsp;&nbsp;&nbsp;{apex.toFixed(1)} m</div>
          <div>flight&nbsp;{tFlight.toFixed(1)} s</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Launch angle</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{angle}&deg;</span>
        </div>
        <input
          type="range" min={10} max={80} step={1} value={angle}
          onInput={(e) => setAngle(parseFloat(e.target.value))}
          aria-label="Launch angle" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Dashed arc is the complementary angle {90 - angle}&deg;, the same range every time.
          </p>
        )}
      </div>
    </div>
  );
}
