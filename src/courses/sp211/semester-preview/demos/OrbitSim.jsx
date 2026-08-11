import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * OrbitSim — Act III "Gravity & orbits" wow demo (bound vs. unbound).
 *
 * A body is launched from a fixed perigee to the right of a central mass, moving
 * straight up (tangential). One slider sets its launch speed. Sweep it and the
 * orbit morphs: sub-circular (a tight ellipse that falls back toward the center),
 * through the circular speed v_c = sqrt(GM/r0), out to a wide ellipse, and finally
 * past escape speed v_esc = sqrt(2) v_c — where the conic opens into a hyperbola
 * and the body leaves for good. One number, speed, decides bound vs. unbound: the
 * physics behind every satellite insertion and every escape burn.
 *
 * Physics (scaled canvas units, NOT SI): central body fixed at canvas center,
 * inverse-square gravity with a small softening so it never blows up:
 *   a = -GM r / (|r|^2 + soft^2)^(3/2)
 * Integration uses velocity-Verlet (leapfrog) so bound ellipses close cleanly
 * instead of precessing/spiraling the way plain Euler would. A fading trail traces
 * the conic. The sim resets when the body escapes far off-screen or after it
 * completes a couple of bound orbits, to refresh the trail.
 *
 * Self-contained (own canvas + rAF + ResizeObserver); fills its parent. Palette +
 * setupCanvas match the shared design system so it reads as one app.
 */
const GM = 400000;        // gravitational parameter (arbitrary units)
const R0 = 160;           // perigee radius (px) — launch point right of center
const SOFT = 6;           // softening length (px) — guards the singularity
const DT = 1 / 480;       // integration step (s)
const SUBSTEPS = 36;      // substeps per drawn frame — also sets the time rate
                         // (more substeps = accurate integration AND faster orbits)
const TRAIL_MAX = 900;    // number of trail points kept

// Circular speed at r0, and escape speed. v_c = sqrt(GM/r0); v_esc = sqrt(2) v_c.
const V_C = Math.sqrt(GM / R0);
const V_ESC = Math.SQRT2 * V_C;
const V_MIN = 0.6 * V_C;   // slider low end — deep sub-circular
const V_MAX = 1.25 * V_ESC; // slider high end — comfortably hyperbolic

export default function OrbitSim({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  // launch speed as a multiple of circular speed (×v_c)
  const [mult, setMult] = useState(1.0);
  const multRef = useRef(mult);
  multRef.current = mult;

  // live readouts, updated from inside the loop
  const [readout, setReadout] = useState({ mult: 1.0, escape: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    // Simulation state (closure vars, no window globals)
    let cx, cy, body, trail, ax, ay, escaped, angleAccum, prevAngle, prevMult;

    const accel = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const r2 = dx * dx + dy * dy;
      const denom = Math.pow(r2 + SOFT * SOFT, 1.5);
      return [-GM * dx / denom, -GM * dy / denom];
    };

    const reset = () => {
      cx = W * 0.5;
      cy = H * 0.5;
      const v = multRef.current * V_C;      // launch speed from slider
      // Launch at perigee to the right of center, moving straight up (tangential).
      body = { x: cx + R0, y: cy, vx: 0, vy: -v };
      const a = accel(body.x, body.y);
      ax = a[0];
      ay = a[1];
      trail = [];
      escaped = false;
      angleAccum = 0;
      prevAngle = Math.atan2(body.y - cy, body.x - cx);
      prevMult = null; // force a readout push on first frame
    };

    // Velocity-Verlet (leapfrog): a closed integrator for bound conics.
    const step = (dt) => {
      body.x += body.vx * dt + 0.5 * ax * dt * dt;
      body.y += body.vy * dt + 0.5 * ay * dt * dt;
      const a = accel(body.x, body.y);
      body.vx += 0.5 * (ax + a[0]) * dt;
      body.vy += 0.5 * (ay + a[1]) * dt;
      ax = a[0];
      ay = a[1];

      // accumulate swept angle to detect completed bound orbits
      const ang = Math.atan2(body.y - cy, body.x - cx);
      let d = ang - prevAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      angleAccum += d;
      prevAngle = ang;
    };

    const dist = () => Math.hypot(body.x - cx, body.y - cy);

    const draw = () => {
      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const navy = '#00205B';

      const v = multRef.current * V_C;
      const isEscape = v >= V_ESC;

      // integrate a bounded batch of substeps per frame
      for (let i = 0; i < SUBSTEPS; i++) step(DT);
      trail.push([body.x, body.y]);
      if (trail.length > TRAIL_MAX) trail.shift();

      // push readouts when the launch multiple changes (limits React churn)
      const m = multRef.current;
      if (prevMult === null || Math.abs(m - prevMult) > 0.001 || isEscape !== readout.escape) {
        prevMult = m;
        setReadout({ mult: m, escape: isEscape });
      }

      // Reset conditions: escaped far off-screen, or a couple of bound orbits done.
      const r = dist();
      const far = 2.4 * Math.hypot(W, H);
      if (r > far) escaped = true;
      const wentOffCanvas =
        body.x < -200 || body.x > W + 200 || body.y < -200 || body.y > H + 200;
      if ((escaped && wentOffCanvas) || Math.abs(angleAccum) > 2 * 2 * Math.PI) reset();

      ctx.clearRect(0, 0, W, H);

      // faint grid dots for depth
      ctx.fillStyle = grid;
      const gs = 46;
      for (let gx = gs; gx < W; gx += gs)
        for (let gy = gs; gy < H; gy += gs) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.8, 0, 2 * Math.PI);
          ctx.fill();
        }

      // reference circle at the circular-orbit radius (faint dashed)
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(139,140,142,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // central mass soft glow
      const R = 18;
      const glow = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 3.6);
      glow.addColorStop(0, 'rgba(197,183,131,0.34)');
      glow.addColorStop(1, 'rgba(197,183,131,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3.6, 0, 2 * Math.PI);
      ctx.fill();

      // central mass body — glowing gold/navy radial gradient
      const bodyGrad = ctx.createRadialGradient(
        cx - R * 0.35, cy - R * 0.35, R * 0.2,
        cx, cy, R,
      );
      bodyGrad.addColorStop(0, gold);
      bodyGrad.addColorStop(1, navy);
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.fill();

      // orbiter trail (long fading conic)
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = `rgba(240,236,227,${(a * 0.55).toFixed(3)})`;
        ctx.lineWidth = 0.8 + a * 1.4;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
        ctx.lineTo(trail[i][0], trail[i][1]);
        ctx.stroke();
      }

      // orbiter body — bright white dot with gold glow
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(body.x, body.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(body.x, body.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      reset();
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
          <div>speed&nbsp;&nbsp;{readout.mult.toFixed(2)} v_c</div>
          <div>orbit&nbsp;&nbsp;{readout.escape ? 'ESCAPE' : 'bound'}</div>
          <div>v_esc&nbsp;&nbsp;{Math.SQRT2.toFixed(2)} v_c</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Launch speed</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{mult.toFixed(2)}&times;v_c</span>
        </div>
        <input
          type="range" min={(V_MIN / V_C).toFixed(2)} max={(V_MAX / V_C).toFixed(2)} step={0.01} value={mult}
          onInput={(e) => setMult(parseFloat(e.target.value))}
          aria-label="Launch speed" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Below &radic;2 &times; circular speed the orbit is bound; above it, the body escapes.
          </p>
        )}
      </div>
    </div>
  );
}
