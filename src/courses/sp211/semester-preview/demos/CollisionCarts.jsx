import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * CollisionCarts — Act II "collisions & impulse".
 *
 * Two carts on a horizontal track collide once and rebound. A slider sets the
 * coefficient of restitution e: at e = 0 they stick (perfectly inelastic), at
 * e = 1 they bounce with no energy lost (perfectly elastic). Two live bars read
 * out TOTAL MOMENTUM — constant width for every e, the thing that's always
 * conserved — and TOTAL KINETIC ENERGY, which shrinks after impact whenever
 * e < 1. This is the literal "two carts on a track" the gravity-assist slide
 * points at.
 *
 * Restitution collision (1D):
 *   vA' = (mA·vA + mB·vB − mB·e·(vA−vB)) / (mA+mB)
 *   vB' = (mA·vA + mB·vB + mA·e·(vA−vB)) / (mA+mB)
 * p = mA·vA + mB·vB is invariant; KE = ½mA·vA² + ½mB·vB².
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design
 * system. Uses accumulated-sim / bounded-dt integration (never raw timestamps).
 */
const MA = 1;         // mass of cart A (scaled units)
const MB = 2;         // mass of cart B
const VA0 = 130;      // px/s, cart A initial speed (rightward, the faster cart)
const VB0 = 30;       // px/s, cart B initial speed (rightward, slower)
const CART_W = 62;    // cart width, px
const CART_H = 40;    // cart height, px
const RESET_AFTER = 3.2; // seconds — safety loop reset

export default function CollisionCarts({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [e, setE] = useState(0.6);
  const eRef = useRef(e);
  eRef.current = e;

  // Momentum is invariant regardless of e; report it once for the readout.
  const p = MA * VA0 + MB * VB0;
  // Pre-collision KE vs. post-collision KE for the current e (overlay readout).
  const keBefore = 0.5 * MA * VA0 * VA0 + 0.5 * MB * VB0 * VB0;
  const relClose = VA0 - VB0;
  const vAafter = (MA * VA0 + MB * VB0 - MB * e * relClose) / (MA + MB);
  const vBafter = (MA * VA0 + MB * VB0 + MA * e * relClose) / (MA + MB);
  const keAfter = 0.5 * MA * vAafter * vAafter + 0.5 * MB * vBafter * vBafter;
  const keLostPct = keBefore > 0 ? (100 * (keBefore - keAfter)) / keBefore : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    let xA, xB, vA, vB, collided, flash, trackY;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      trackY = Math.round(H * 0.42);
    };

    const reset = () => {
      sim = 0;
      // start apart: A on the left, B ahead of it — A is faster and catches up
      xA = W * 0.16;
      xB = W * 0.52;
      vA = VA0;
      vB = VB0;
      collided = false;
      flash = 0;
    };

    const momentum = () => MA * vA + MB * vB;               // conserved every e
    const kinetic = () => 0.5 * MA * vA * vA + 0.5 * MB * vB * vB;

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const drawArrow = (cx, cy, vx, color) => {
      if (Math.abs(vx) < 1) return;
      const len = Math.max(10, Math.min(46, Math.abs(vx) * 0.28));
      const dir = Math.sign(vx);
      const tipX = cx + dir * len;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tipX, cy);
      ctx.lineTo(tipX - dir * 7, cy - 5);
      ctx.lineTo(tipX - dir * 7, cy + 5);
      ctx.closePath();
      ctx.fill();
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
      const text = col('--color-text', '#F0ECE3');
      const navy = '#3E5C8A';        // muted navy tone for cart B
      const eNow = eRef.current;

      // advance carts
      xA += vA * dt;
      xB += vB * dt;

      // collision: apply the restitution impulse exactly once per pass, when the
      // near faces touch and A is still closing on B.
      const gap = (xB - CART_W / 2) - (xA + CART_W / 2);
      if (!collided && gap <= 0 && vA > vB) {
        const rel = vA - vB;
        const nA = (MA * vA + MB * vB - MB * eNow * rel) / (MA + MB);
        const nB = (MA * vA + MB * vB + MA * eNow * rel) / (MA + MB);
        vA = nA;
        vB = nB;
        collided = true;
        flash = 1;
        // split the overlap so faces just touch — prevents re-trigger / tunneling
        const overlap = -gap;
        xA -= overlap / 2;
        xB += overlap / 2;
      }

      // loop: reset after a safety time or once the carts have left the frame
      const bothOffRight = xA - CART_W / 2 > W + 20 && xB - CART_W / 2 > W + 20;
      const eitherOff = xB - CART_W / 2 > W + 40 || xA + CART_W / 2 < -40;
      if (sim > RESET_AFTER || bothOffRight || eitherOff) {
        reset();
        return (raf = requestAnimationFrame(draw));
      }

      flash = Math.max(0, flash - dt * 3.2);

      ctx.clearRect(0, 0, W, H);

      // track line
      ctx.strokeStyle = grid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, trackY + CART_H / 2 + 6);
      ctx.lineTo(W, trackY + CART_H / 2 + 6);
      ctx.stroke();

      // contact flash — a subtle bright pulse at the point of impact
      if (flash > 0.01) {
        const mx = (xA + xB) / 2;
        const my = trackY;
        const rad = 26 + 30 * (1 - flash);
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, rad);
        g.addColorStop(0, `rgba(255,255,255,${(0.5 * flash).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, my, rad, 0, 2 * Math.PI);
        ctx.fill();
      }

      // carts: A gold, B muted navy
      const yTop = trackY - CART_H / 2;
      roundRect(xA - CART_W / 2, yTop, CART_W, CART_H, 8);
      ctx.fillStyle = gold;
      ctx.fill();
      roundRect(xB - CART_W / 2, yTop, CART_W, CART_H, 8);
      ctx.fillStyle = navy;
      ctx.fill();

      // velocity arrows (dark on the gold cart, light on the navy cart)
      drawArrow(xA, trackY, vA, '#0D1321');
      drawArrow(xB, trackY, vB, '#F0ECE3');

      // mass labels above each cart
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = gold;
      ctx.fillText(`m ${MA}`, xA, yTop - 7);
      ctx.fillStyle = muted;
      ctx.fillText(`m ${MB}`, xB, yTop - 7);

      // ── live bars: momentum (constant width) and KE (shrinks when e < 1) ──
      const barX = 24;
      const barMaxW = Math.min(W - 90, 320);
      const barH = 12;
      const baseY = H - (compact ? 40 : 54);

      const pNow = momentum();
      const keNow = kinetic();
      const pFull = MA * VA0 + MB * VB0;                       // reference scale
      const keFull = 0.5 * MA * VA0 * VA0 + 0.5 * MB * VB0 * VB0;
      const pW = barMaxW * Math.min(1, Math.abs(pNow) / pFull);
      const keW = barMaxW * Math.min(1, keNow / keFull);

      ctx.textAlign = 'left';
      ctx.font = '11px JetBrains Mono, monospace';

      // momentum bar — width does not change through the collision
      ctx.fillStyle = muted;
      ctx.fillText('momentum', barX, baseY - 5);
      ctx.fillStyle = grid;
      ctx.fillRect(barX, baseY, barMaxW, barH);
      ctx.fillStyle = gold;
      ctx.fillRect(barX, baseY, pW, barH);
      ctx.fillStyle = text;
      ctx.fillText(pNow.toFixed(0), barX + barMaxW + 10, baseY + barH - 1);

      // kinetic-energy bar — shrinks after impact when e < 1
      const keY = baseY + barH + 20;
      ctx.fillStyle = muted;
      ctx.fillText('kinetic energy', barX, keY - 5);
      ctx.fillStyle = grid;
      ctx.fillRect(barX, keY, barMaxW, barH);
      ctx.fillStyle = navy;
      ctx.fillRect(barX, keY, keW, barH);
      // ghost outline of the full (pre-collision) KE, so the loss reads visually
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, keY + 0.5, barMaxW - 1, barH - 1);
      ctx.fillStyle = text;
      ctx.fillText(keNow.toFixed(0), barX + barMaxW + 10, keY + barH - 1);

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
  }, [compact]);

  return (
    <div className="flex flex-col h-full w-full gap-3">
      <div ref={wrapRef} className="relative flex-1 min-h-0 rounded-lg overflow-hidden" style={{ background: '#0D1321' }}>
        <canvas ref={canvasRef} className="block" />
        <div className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5">
          <div>e&nbsp;&nbsp;&nbsp;&nbsp;{e.toFixed(2)}</div>
          <div>p&nbsp;&nbsp;&nbsp;&nbsp;{p.toFixed(0)} (before = after)</div>
          <div>KE lost&nbsp;&nbsp;{keLostPct.toFixed(0)}%</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Elasticity (e)</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{e.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0} max={1} step={0.01} value={e}
          onInput={(ev) => setE(parseFloat(ev.target.value))}
          aria-label="Coefficient of restitution e" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Momentum is always conserved; kinetic energy only when e&nbsp;=&nbsp;1.
          </p>
        )}
      </div>
    </div>
  );
}
