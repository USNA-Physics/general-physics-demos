import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * GravityAssist — Act II "Energy & collisions" wow demo (gravitational slingshot).
 *
 * A light spacecraft falls toward a massive, MOVING planet, whips around it, and
 * departs FASTER (in the sun/rest frame) than it arrived. No fuel is burned:
 * the boost is stolen momentum. In the planet's frame the flyby is a perfectly
 * elastic scatter — the craft leaves with the same speed it came in, but pointed
 * differently. Transform back to the rest frame (add the planet's velocity) and
 * that redirected speed adds to the planet's motion, so the craft speeds up.
 *
 * Pedagogical hook: this is the SAME conservation law as two carts colliding on a
 * track. A tiny cart bouncing elastically off a heavy cart moving toward it comes
 * away with up to ~2x the heavy cart's speed added on. Gravity is just the
 * "spring" that does the bouncing here. Momentum in, momentum out.
 *
 * Physics: numerically integrate the craft under Newtonian gravity from the
 * planet, with a softening length so the acceleration never blows up:
 *   a = -GM (r_craft - r_planet) / (|r_craft - r_planet|^2 + soft^2)^(3/2)
 * The planet is treated as infinitely heavy (constant velocity, unaffected by
 * the craft). Units are arbitrary scaled canvas units chosen to look good, NOT SI.
 *
 * Self-contained (own canvas + rAF + ResizeObserver); fills its parent. Palette +
 * setupCanvas match the shared design system so it reads as one app.
 */
const GM = 1000000;       // gravitational parameter (arbitrary units) — strong enough
                          // that a close pass turns the craft hard (turn ~ GM/(b v^2))
const SOFT = 15;          // softening length (px) — keeps the flyby stable near planet
const VP = 75;            // planet speed (px/s), moving rightward across the frame
const V_IN = 95;          // craft incoming speed (px/s), moving leftward (head-on)
const DT = 1 / 480;       // integration step (s)
const SUBSTEPS = 8;       // substeps per drawn frame for stability near closest approach
const TRAIL_MAX = 150;    // number of trail points kept

export default function GravityAssist({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [flyby, setFlyby] = useState(55); // impact parameter b (px)
  const flybyRef = useRef(flyby);
  flybyRef.current = flyby;

  // live readouts, updated from inside the loop
  const [readout, setReadout] = useState({ vIn: V_IN, vNow: V_IN, boost: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    // Planet sweeps rightward at constant velocity (treated as infinitely heavy).
    const planetVx = VP;
    const planetVy = 0;

    // Simulation state (closure vars, no window globals)
    let planet, craft, trail, prevBoost;

    const reset = () => {
      // Head-on setup: planet enters from the left moving right; craft enters from
      // the right moving left, offset vertically by the impact parameter b. The
      // craft whips around the back of the planet and is flung the other way,
      // faster — the strongest, clearest form of the slingshot.
      planet = { x: W * 0.06, y: H * 0.5 };
      const b = flybyRef.current;
      craft = {
        x: W + 40,
        y: H * 0.5 + b,
        vx: -V_IN,
        vy: 0,
      };
      trail = [];
      prevBoost = 0;
    };

    const speed = (o) => Math.hypot(o.vx, o.vy);

    const step = (dt) => {
      // advance planet (constant velocity — infinitely heavy)
      planet.x += planetVx * dt;
      planet.y += planetVy * dt;

      // gravity on craft from planet, with softening
      const dx = craft.x - planet.x;
      const dy = craft.y - planet.y;
      const r2 = dx * dx + dy * dy;
      const denom = Math.pow(r2 + SOFT * SOFT, 1.5);
      const ax = -GM * dx / denom;
      const ay = -GM * dy / denom;

      craft.vx += ax * dt;
      craft.vy += ay * dt;
      craft.x += craft.vx * dt;
      craft.y += craft.vy * dt;
    };

    const offscreen = () =>
      craft.x < -90 || craft.x > W + 130 || craft.y < -130 || craft.y > H + 130 ||
      planet.x > W + 130;

    const arrow = (x0, y0, x1, y1, color, width) => {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = 8;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - 0.4), y1 - head * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - head * Math.cos(ang + 0.4), y1 - head * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    };

    const draw = () => {
      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const navy = '#00205B';

      // integrate a few substeps per frame
      for (let i = 0; i < SUBSTEPS; i++) step(DT);
      trail.push([craft.x, craft.y]);
      if (trail.length > TRAIL_MAX) trail.shift();

      const v = speed(craft);
      const boost = v - V_IN;
      // push readouts (throttle via change threshold to limit React churn)
      if (Math.abs(boost - prevBoost) > 0.2) {
        prevBoost = boost;
        setReadout({ vIn: V_IN, vNow: v, boost });
      }

      if (offscreen()) reset();

      ctx.clearRect(0, 0, W, H);

      // faint starfield-ish grid dots for depth
      ctx.fillStyle = grid;
      const gs = 46;
      for (let gx = gs; gx < W; gx += gs)
        for (let gy = gs; gy < H; gy += gs) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.8, 0, 2 * Math.PI);
          ctx.fill();
        }

      // planet velocity arrow (faint)
      arrow(
        planet.x, planet.y,
        planet.x + planetVx * 0.55, planet.y + planetVy * 0.55,
        muted, 1.5,
      );

      // planet with soft glow
      const R = 20;
      const glow = ctx.createRadialGradient(planet.x, planet.y, R * 0.3, planet.x, planet.y, R * 3.4);
      glow.addColorStop(0, 'rgba(197,183,131,0.34)');
      glow.addColorStop(1, 'rgba(197,183,131,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, R * 3.4, 0, 2 * Math.PI);
      ctx.fill();

      const body = ctx.createRadialGradient(
        planet.x - R * 0.35, planet.y - R * 0.35, R * 0.2,
        planet.x, planet.y, R,
      );
      body.addColorStop(0, gold);
      body.addColorStop(1, navy);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, R, 0, 2 * Math.PI);
      ctx.fill();

      // craft trail (fading)
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = `rgba(240,236,227,${(a * 0.6).toFixed(3)})`;
        ctx.lineWidth = 1 + a * 1.5;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
        ctx.lineTo(trail[i][0], trail[i][1]);
        ctx.stroke();
      }

      // craft velocity vector (gold, scaled short)
      arrow(
        craft.x, craft.y,
        craft.x + craft.vx * 0.18, craft.y + craft.vy * 0.18,
        gold, 2,
      );

      // craft body (bright dot with a strong gold glow)
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(craft.x, craft.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(craft.x, craft.y, 4.5, 0, 2 * Math.PI);
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
          <div>v&nbsp;in&nbsp;&nbsp;&nbsp;{readout.vIn.toFixed(1)}</div>
          <div>v&nbsp;now&nbsp;&nbsp;{readout.vNow.toFixed(1)}</div>
          <div>&Delta;v&nbsp;boost&nbsp;{readout.boost >= 0 ? '+' : ''}{readout.boost.toFixed(1)}</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Flyby distance</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{flyby}</span>
        </div>
        <input
          type="range" min={42} max={120} step={1} value={flyby}
          onInput={(e) => setFlyby(parseFloat(e.target.value))}
          aria-label="Flyby distance" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Closer flyby means a bigger boost: the craft steals momentum from the moving planet, just like a light cart bouncing off a heavy one.
          </p>
        )}
      </div>
    </div>
  );
}
