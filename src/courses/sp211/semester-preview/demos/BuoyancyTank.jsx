import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * BuoyancyTank — Unit III "buoyancy & Archimedes" (Ch 13.3).
 *
 * A tank of water holds an object whose average density (as a fraction of water)
 * you control. Below water density it floats up and rides the surface at the
 * correct submerged fraction; equal to water it hovers neutrally at mid-depth;
 * above it, it sinks to the bottom. This is exactly how a submarine dives,
 * hovers, and surfaces by flooding or blowing ballast.
 *
 * Physics (scaled units): buoyant force F_B = rho_water * V_sub * g (up), weight
 * W = rho_obj * V * g (down). With "ocean layering" on (default), the water density
 * rises with depth, rho_water = rho_water(h), so a denser hull sinks only until the
 * local water density matches it and then hovers at that neutral depth, the way a
 * submarine trims. With it off the water is one density and a denser hull sinks to
 * the floor. Motion uses an accumulated-sim / bounded-dt step plus linear drag.
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design system.
 */
const G = 30;         // gravity, scaled px/s^2 units
const DRAG = 1.1;     // linear drag coefficient so motion settles (lower = snappier)
const TIME_RATE = 3.5;// run the settling this many x wall-clock, so the hull reaches
                      // its new depth quickly when you change the density
const RHO_WATER = 1;      // surface water density (reference)
const RHO_GRADIENT = 0.6; // ocean layering on: density rises this much from surface to floor

export default function BuoyancyTank({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [density, setDensity] = useState(1.2);
  const densityRef = useRef(density);
  densityRef.current = density;
  const [layered, setLayered] = useState(true);   // ocean density layering, default on
  const layeredRef = useRef(layered);
  layeredRef.current = layered;

  // live force readouts (buoyancy varies with how much of the hull is submerged)
  const [forces, setForces] = useState({ buoyancy: G, weight: G, net: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow, pubKey = '';
    let objY, objVy;           // object center y (px) and vertical velocity
    const objW = 120, objH = 64;
    const padTop = 26, padBottom = 24, padX = 26;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // Water occupies the lower ~70% of the tank interior.
    const surfaceY = () => padTop + (H - padTop - padBottom) * 0.30;
    const bottomY = () => H - padBottom;

    const reset = () => {
      sim = 0;
      // start just at the surface so the settle is visible
      objY = surfaceY();
      objVy = 0;
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

      const rho = densityRef.current;
      const surf = surfaceY();
      const bot = bottomY();
      const waterCol = bot - surf;

      // Local water density. Uniform by default (Ch 13); with "ocean layering" on it
      // rises with depth, rho_water(h) = RHO_WATER + gradient * (depth fraction). The
      // buoyant force is still F = rho_water(h) * V_sub * g; letting rho depend on
      // depth is exactly what gives a denser hull a neutral depth to hover at.
      const centerDepthFrac = Math.min(1, Math.max(0, (objY - surf) / waterCol));
      const rhoLocal = RHO_WATER + (layeredRef.current ? RHO_GRADIENT * centerDepthFrac : 0);

      // Buoyancy follows the submerged fraction of the hull (Archimedes).
      const submerged = Math.min(1, Math.max(0, (objY + objH / 2 - surf) / objH));
      const buoyancyNow = rhoLocal * submerged * G; // rho_water(h) * V_submerged * g
      const weightNow = rho * G;                    // rho_obj * V * g
      const netUp = buoyancyNow - weightNow;        // + up, - down
      const aUp = netUp / rho;                      // divide by mass (= rho, V = 1)

      const pdt = dt * TIME_RATE;             // faster than wall-clock, for a snappy response
      objVy += (-aUp - DRAG * objVy) * pdt;   // up is -y
      objY += objVy * pdt;

      // stay inside the tank: rest on the floor, never leave the top
      const hardBottom = bot - objH / 2;
      if (objY > hardBottom) { objY = hardBottom; if (objVy > 0) objVy = 0; }
      const hardTop = padTop + objH / 2;
      if (objY < hardTop) { objY = hardTop; if (objVy < 0) objVy = 0; }

      // publish readouts only when the rounded values change (limits React churn)
      const key = `${buoyancyNow.toFixed(1)},${weightNow.toFixed(1)}`;
      if (key !== pubKey) { pubKey = key; setForces({ buoyancy: buoyancyNow, weight: weightNow, net: netUp }); }

      ctx.clearRect(0, 0, W, H);

      // ── air grid dots above the water surface ──────────────────────────
      ctx.fillStyle = grid;
      const step = 22;
      for (let gx = padX; gx <= W - padX; gx += step) {
        for (let gy = padTop; gy < surf - 2; gy += step) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // ── water: a depth gradient (darker deeper, where pressure is higher) ──
      const wg = ctx.createLinearGradient(0, surf, 0, bot);
      wg.addColorStop(0, 'rgba(40, 92, 165, 0.34)');
      wg.addColorStop(1, 'rgba(12, 42, 92, 0.72)');
      ctx.fillStyle = wg;
      ctx.fillRect(padX, surf, W - 2 * padX, bot - surf);
      // surface line
      ctx.strokeStyle = 'rgba(120, 170, 235, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, surf);
      ctx.lineTo(W - padX, surf);
      ctx.stroke();

      // ── ocean layering: faint density strata + the neutral-buoyancy depth ──
      if (layeredRef.current) {
        ctx.strokeStyle = 'rgba(120,170,235,0.16)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 4; i++) {
          const yy = surf + waterCol * (i / 5);
          ctx.beginPath(); ctx.moveTo(padX, yy); ctx.lineTo(W - padX, yy); ctx.stroke();
        }
        const nf = (rho - RHO_WATER) / RHO_GRADIENT;   // depth where rho_water(h) == rho_obj
        if (nf > 0 && nf < 1) {
          const ny = surf + waterCol * nf;
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(197,183,131,0.6)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(padX, ny); ctx.lineTo(W - padX, ny); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(197,183,131,0.85)';
          ctx.font = '10px JetBrains Mono, monospace';
          ctx.textAlign = 'right';
          ctx.fillText('neutral depth', W - padX - 5, ny - 4);
        }
      }

      // ── pressure-with-depth gauge on the left wall ─────────────────────
      // Pressure rises with depth, P = P0 + rho*g*h; the wedge widens with depth to
      // show it. The greater pressure on the bottom of a body than on its top is what
      // produces the buoyant force. (With ocean layering on, the water also grows
      // denser with depth, which is what gives a heavy hull a depth to hover at.)
      const gaugeMax = 44;
      ctx.fillStyle = 'rgba(197,183,131,0.12)';
      ctx.beginPath();
      ctx.moveTo(padX, surf);
      ctx.lineTo(padX + gaugeMax, bot);
      ctx.lineTo(padX, bot);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(197,183,131,0.6)';
      for (let i = 1; i <= 3; i++) {
        const yy = surf + (bot - surf) * (i / 3.4);
        const len = gaugeMax * (i / 3.4);
        ctx.strokeStyle = 'rgba(197,183,131,0.6)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(padX, yy);
        ctx.lineTo(padX + len, yy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(padX + len, yy);
        ctx.lineTo(padX + len - 5, yy - 3);
        ctx.lineTo(padX + len - 5, yy + 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = muted;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('pressure', padX + 3, surf + 12);

      // tank walls / floor
      ctx.strokeStyle = grid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, padTop);
      ctx.lineTo(padX, bot);
      ctx.lineTo(W - padX, bot);
      ctx.lineTo(W - padX, padTop);
      ctx.stroke();

      // ── the object: a stylized rounded hull / ballast body in gold ─────
      const cx = W / 2;
      const x = cx - objW / 2;
      const y = objY - objH / 2;
      const r = 16;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + objW - r, y);
      ctx.arcTo(x + objW, y, x + objW, y + r, r);
      ctx.lineTo(x + objW, y + objH - r);
      ctx.arcTo(x + objW, y + objH, x + objW - r, y + objH, r);
      ctx.lineTo(x + r, y + objH);
      ctx.arcTo(x, y + objH, x, y + objH - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fillStyle = gold;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── force arrows: weight down, buoyancy up, length ∝ force ─────────
      const kArrow = 3.4; // px per force unit
      const drawArrow = (x0, y0, dir, len, color, label) => {
        const yTip = y0 + dir * len;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, yTip);
        ctx.stroke();
        const hs = 8;
        ctx.beginPath();
        ctx.moveTo(x0, yTip);
        ctx.lineTo(x0 - hs, yTip - dir * hs * 1.4);
        ctx.lineTo(x0 + hs, yTip - dir * hs * 1.4);
        ctx.closePath();
        ctx.fill();
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x0, yTip + dir * 14);
      };

      // buoyancy arrow (up) on the left half of the hull, length tracks the
      // submerged volume, so it shrinks as the hull rides higher out of water
      drawArrow(cx - objW / 4, objY, -1, buoyancyNow * kArrow, 'rgba(120, 170, 235, 0.95)', 'buoyancy');
      // weight arrow (down) on the right half of the hull
      drawArrow(cx + objW / 4, objY, 1, weightNow * kArrow, '#E8B04B', 'weight');

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
          <div>density&nbsp;&nbsp;{density.toFixed(2)}x water</div>
          <div>buoyancy&nbsp;{forces.buoyancy.toFixed(1)}</div>
          <div>weight&nbsp;&nbsp;&nbsp;{forces.weight.toFixed(1)}</div>
          <div>net&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{forces.net.toFixed(1)}</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Density</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{density.toFixed(2)}x water</span>
        </div>
        <input
          type="range" min={0.3} max={1.8} step={0.01} value={density}
          onInput={(e) => setDensity(parseFloat(e.target.value))}
          aria-label="Object density as a fraction of water" className="w-full"
        />
        <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-usna-text select-none">
          <input
            type="checkbox" checked={layered}
            onChange={(e) => setLayered(e.target.checked)}
            className="w-4 h-4 accent-usna-gold"
          />
          Ocean density layering (rises with depth)
        </label>
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            {layered
              ? "Water thickens with depth, so a denser hull sinks only until the buoyancy climbs to match its weight, then hovers, like a submarine's trim."
              : "With one uniform density, buoyancy is the same at every depth, so a denser hull sinks all the way to the floor."}
          </p>
        )}
      </div>
    </div>
  );
}
