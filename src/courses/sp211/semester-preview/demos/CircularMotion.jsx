import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * CircularMotion — Unit I "uniform circular motion" (Ch 3.3 / 5.3).
 *
 * A mass runs around a circle at CONSTANT speed, yet it is accelerating the
 * whole time, because its velocity keeps changing direction. The gold tangential
 * velocity arrow keeps a fixed length but forever rotates; the inward centripetal
 * acceleration arrow (a = v^2/r) points at the center and visibly grows as the
 * speed climbs. Naval tie: a fighter pulling g in a hard turn.
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design system.
 */
const V_REF = 1.2;   // arbitrary speed units per second (angular scaling)
const G_CAL = 0.7;   // calibration: a = v^2/r reported as (v^2/r)/G_CAL "g".
                     // Tuned so the top of the speed range reads ~9 g, a hard
                     // fighter turn, matching the slide's "several g".

export default function CircularMotion({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [speed, setSpeed] = useState(1.2);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // reported centripetal acceleration in "g" (radius normalized to 1 world unit)
  const aG = (speed * speed) / G_CAL;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow, theta, R, cx, cy;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      cx = W / 2;
      cy = H / 2;
      R = Math.min(W, H) * 0.34;   // circle sized to the canvas
    };

    // draw an arrowhead-tipped vector from (x0,y0) to (x1,y1)
    const arrow = (x0, y0, x1, y1, color, width) => {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = 11;
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
    };

    const draw = (now) => {
      if (sim === undefined) { sim = 0; theta = -Math.PI / 2; lastNow = now; }
      // accumulate our own clock so the sim advances by a bounded step every
      // frame — robust to tab throttling and non-advancing timestamps.
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;

      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const text = col('--color-text', '#F0ECE3');

      const v = speedRef.current;      // arbitrary speed units
      const omega = (v * V_REF) / 1.0; // rad/s; angular rate = v/r (r ≡ 1 world unit)
      theta += omega * dt;

      // mass position on the ring
      const px = cx + R * Math.cos(theta);
      const py = cy + R * Math.sin(theta);

      ctx.clearRect(0, 0, W, H);

      // faint dashed gold ring (the circular path)
      ctx.strokeStyle = 'rgba(197,183,131,0.35)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // center dot
      ctx.fillStyle = grid;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fill();

      // faint radius line from center to the mass
      ctx.strokeStyle = 'rgba(139,140,142,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.setLineDash([]);

      // unit vectors: radial (outward) and tangential (direction of travel)
      const rx = Math.cos(theta), ry = Math.sin(theta);
      const tx = -Math.sin(theta), ty = Math.cos(theta);

      // centripetal acceleration arrow — inward, length ∝ a = v^2/r (grows with v)
      const aLen = (v * v) * (R * 0.30);
      arrow(px, py, px - rx * aLen, py - ry * aLen, text, 3);
      ctx.font = 'bold 15px JetBrains Mono, monospace';
      ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('a', px - rx * (aLen + 14), py - ry * (aLen + 14));

      // velocity arrow — tangent, FIXED visual length, forever rotating
      const vLen = R * 0.62;
      arrow(px, py, px + tx * vLen, py + ty * vLen, gold, 3);
      ctx.fillStyle = gold;
      ctx.fillText('v', px + tx * (vLen + 14), py + ty * (vLen + 14));

      // the moving mass — bright white dot with a gold glow
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

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
          <div>speed&nbsp;&nbsp;{speed.toFixed(2)}</div>
          <div>radius&nbsp;1.00</div>
          <div>a = v&sup2;/r&nbsp;&nbsp;{aG.toFixed(2)} g</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Speed</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{speed.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0.4} max={2.5} step={0.01} value={speed}
          onInput={(e) => setSpeed(parseFloat(e.target.value))}
          aria-label="Speed" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Constant speed, but never constant velocity: the acceleration points to the center and grows as v squared.
          </p>
        )}
      </div>
    </div>
  );
}
