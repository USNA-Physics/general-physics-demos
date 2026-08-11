import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * AirVacuumDrop — Act I "how things fall".
 *
 * Two identical balls drop side by side. The LEFT lane has air resistance
 * (quadratic drag a = g - k v^2, terminal speed v_t = sqrt(g/k)); the RIGHT lane
 * is a vacuum (constant g). The vacuum ball lands first. Turn the "Air resistance"
 * slider to zero and the air ball catches up — they land together, exactly the
 * Apollo hammer-and-feather result on the Moon.
 *
 * Frame-stepped: motion advances by a bounded dt accumulated into `sim` each
 * frame (robust to throttling), never off raw timestamps. Self-contained
 * (canvas + rAF + ResizeObserver); matches the shared design system.
 */
const G = 340;         // gravitational accel, canvas units/s^2
const K_MAX = 0.010;   // drag coefficient at full slider (1/unit)

export default function AirVacuumDrop({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [air, setAir] = useState(0.6); // 0..1, maps to drag coefficient k
  const airRef = useRef(air);
  airRef.current = air;
  // landing times surfaced from the animation closure for the overlay readouts
  const [times, setTimes] = useState({ air: 0, vac: 0 });

  const k = air * K_MAX;
  const vTerm = k > 0 ? Math.sqrt(G / k) : Infinity;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    let topY, groundY, laneAirX, laneVacX;
    // per-ball state: y position, v velocity, landed flag, land time
    let bAir, bVac, tAir, tVac, restUntil;
    const pad = 34, dropPad = 44;

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      topY = dropPad;
      groundY = H - pad;
      laneAirX = W * 0.34;
      laneVacX = W * 0.66;
    };

    const reset = () => {
      sim = 0;
      restUntil = null;
      tAir = null;
      tVac = null;
      bAir = { y: topY, v: 0, trail: [] };
      bVac = { y: topY, v: 0, trail: [] };
      setTimes({ air: 0, vac: 0 });
    };

    const step = (b, k, dt) => {
      if (b.y >= groundY) return true; // already landed
      // air ball: a = g - k v^2 (drag opposes downward motion). vacuum: k = 0.
      const a = G - k * b.v * b.v;
      b.v += a * dt;
      b.y += b.v * dt;
      if (b.y >= groundY) { b.y = groundY; return true; }
      return false;
    };

    const draw = (now) => {
      if (sim === undefined) { reset(); lastNow = now; }
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      sim += dt;

      const gold = col('--color-gold', '#C5B783');
      const grid = col('--color-grid', '#1A2332');
      const muted = col('--color-muted', '#8B8C8E');
      const text = col('--color-text', '#F0ECE3');
      const k = airRef.current * K_MAX;

      // integrate both balls with the bounded dt
      if (restUntil === null) {
        const airDone = step(bAir, k, dt);
        const vacDone = step(bVac, 0, dt);
        if (airDone && tAir === null) { tAir = sim; setTimes((s) => ({ ...s, air: sim })); }
        if (vacDone && tVac === null) { tVac = sim; setTimes((s) => ({ ...s, vac: sim })); }
        if (airDone && vacDone) restUntil = sim + 0.6; // pause before reset
      } else if (sim >= restUntil) {
        reset();
        return (raf = requestAnimationFrame(draw));
      }

      // record trails. For the air ball at terminal speed, the trail no longer
      // lengthens (constant spacing) — a visible signature of v_t.
      const pushTrail = (b, atTerminal) => {
        if (b.y >= groundY) return;
        b.trail.push(b.y);
        const cap = atTerminal ? 10 : Math.min(24, b.trail.length + 1);
        while (b.trail.length > cap) b.trail.shift();
      };
      const atTerm = k > 0 && bAir.v >= 0.985 * Math.sqrt(G / k);
      pushTrail(bAir, atTerm);
      pushTrail(bVac, false);

      ctx.clearRect(0, 0, W, H);

      // ground line
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad, groundY);
      ctx.lineTo(W - pad, groundY);
      ctx.stroke();

      // lane guides + labels
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      [[laneAirX, 'AIR'], [laneVacX, 'VACUUM']].forEach(([x, label]) => {
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.moveTo(x, topY - 14);
        ctx.lineTo(x, groundY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = muted;
        ctx.fillText(label, x, groundY + 18);
      });

      // draw a ball with a short fading trail
      const drawBall = (x, b) => {
        const n = b.trail.length;
        for (let i = 0; i < n; i++) {
          const alpha = (0.35 * (i + 1)) / n;
          ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, b.trail[i], 4 * ((i + 1) / n), 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = gold;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(x, b.y, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;
      };

      drawBall(laneAirX, bAir);
      drawBall(laneVacX, bVac);

      // small "landed" ticks so a settled ball still reads as present
      ctx.fillStyle = gold;
      if (tVac !== null) { ctx.beginPath(); ctx.arc(laneVacX, groundY, 8, 0, 2 * Math.PI); ctx.fill(); }
      if (tAir !== null) { ctx.beginPath(); ctx.arc(laneAirX, groundY, 8, 0, 2 * Math.PI); ctx.fill(); }

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
          <div>t&nbsp;vacuum&nbsp;{times.vac ? times.vac.toFixed(2) + 's' : '—'}</div>
          <div>t&nbsp;air&nbsp;&nbsp;&nbsp;&nbsp;{times.air ? times.air.toFixed(2) + 's' : '—'}</div>
          <div>v&nbsp;term&nbsp;&nbsp;{vTerm === Infinity ? '∞' : vTerm.toFixed(0)}</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Air resistance</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">
            {air === 0 ? 'none' : (air * 100).toFixed(0) + '%'}
          </span>
        </div>
        <input
          type="range" min={0} max={1} step={0.01} value={air}
          onInput={(e) => setAir(parseFloat(e.target.value))}
          aria-label="Air resistance" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Turn air resistance to zero and they land together. That is the Moon.
          </p>
        )}
      </div>
    </div>
  );
}
