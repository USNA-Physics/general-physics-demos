import { useRef, useEffect, useState } from 'react';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * EnergyWell — Unit II "conservation of energy" (Ch 6-7).
 *
 * A ball released inside a smooth parabolic valley rolls down and up the far side
 * forever, trading kinetic for potential energy and back. A parabolic potential
 * gives simple-harmonic motion, so the horizontal coordinate is an oscillator:
 * x(t) = A*cos(w*t). The ball rides the track at (x, k*x^2). Because the track is
 * frictionless the total mechanical energy E = KE + PE is conserved — the point of
 * the demo. Two live bars show KE and PE trading while a marker holds their
 * constant sum flat.
 *
 * Self-contained (canvas + rAF + ResizeObserver); matches the shared design system.
 */
const K = 1.0;   // bowl curvature: track is y = K*x^2 (world units)
const G = 0.15;  // scaled gravity, tuned low so the oscillation is slow enough to follow
                 // (period 2*pi/sqrt(2*G*K) ~ 11 s); it scales every energy equally,
                 // so the KE/PE split and their constant sum are unchanged.
const M = 1.0;   // ball mass
const HALF_W = 1.0; // half-width of the bowl in world x-units (x runs -1..1)

export default function EnergyWell({ compact = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [release, setRelease] = useState(0.8); // release height as fraction of bowl
  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim, lastNow;
    const padX = 26, padTop = 24, padBottom = 30;
    const barW = 40; // width of each energy bar

    const col = (name, fallback) =>
      (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const reset = () => {
      sim = 0; // seconds of simulation time (accumulated, not wall-clock)
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

      // ── physics ────────────────────────────────────────────────────────────
      // Released from rest at height h = frac * (top of bowl). The top of the
      // bowl (x = HALF_W) sits at height K*HALF_W^2, so h = frac*K*HALF_W^2 and
      // the turning-point amplitude is A = sqrt(h / K). A parabolic potential
      // U = M*g*K*x^2 gives SHM with w = sqrt(2*g*K); the ball starts at rest at
      // x = A, so x(t) = A*cos(w*t).
      const frac = releaseRef.current;
      const hRelease = frac * K * HALF_W * HALF_W;      // release height (world)
      const A = Math.sqrt(hRelease / K);                // amplitude in x
      const w = Math.sqrt(2 * G * K);                   // angular frequency
      const x = A * Math.cos(w * sim);
      const yBall = K * x * x;                          // height on the track

      const Etot = M * G * hRelease;                    // conserved total energy
      const PE = M * G * yBall;                         // potential energy
      const KE = Math.max(0, Etot - PE);                // kinetic energy (sums to E)
      const speed = Math.sqrt(2 * KE / M);              // scalar speed

      ctx.clearRect(0, 0, W, H);

      // ── world-to-screen mapping for the bowl ────────────────────────────────
      // Reserve the right strip for the energy bars; center the bowl in the rest.
      const barsLeft = W - padX - (2 * barW + 34);
      const plotL = padX;
      const plotR = barsLeft - 20;
      const cx = (plotL + plotR) / 2;
      const yTop = K * HALF_W * HALF_W;                 // world height at bowl rim
      const sx = (plotR - plotL) / (2 * HALF_W);        // px per world x-unit
      const sy = (H - padTop - padBottom) / yTop;       // px per world y-unit
      const groundY = H - padBottom;                    // screen y of bowl bottom
      const toX = (wx) => cx + wx * sx;
      const toY = (wy) => groundY - wy * sy;

      // ── the parabolic bowl (gold curve) ─────────────────────────────────────
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const N = 80;
      for (let i = 0; i <= N; i++) {
        const wx = -HALF_W + (i / N) * (2 * HALF_W);
        const wy = K * wx * wx;
        i ? ctx.lineTo(toX(wx), toY(wy)) : ctx.moveTo(toX(wx), toY(wy));
      }
      ctx.stroke();

      // ── energy-level line at the release height (turning point) ──────────────
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(toX(-HALF_W), toY(hRelease));
      ctx.lineTo(toX(HALF_W), toY(hRelease));
      ctx.stroke();
      ctx.setLineDash([]);

      // ── the ball (bright white dot, gold glow) ───────────────────────────────
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = gold;
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(toX(x), toY(yBall), 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(toX(x), toY(yBall), 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── energy bars: KE and PE trade while the total marker holds flat ──────
      const bx0 = barsLeft;                 // left edge of the KE bar
      const bx1 = barsLeft + barW + 14;     // left edge of the PE bar
      const barBottom = groundY;
      const barTop = padTop + 6;
      const barH = barBottom - barTop;      // full-scale height == total energy E
      const eScale = barH / Etot;           // px per unit energy

      // bar backgrounds (the well the energy fills)
      ctx.fillStyle = grid;
      ctx.fillRect(bx0, barTop, barW, barH);
      ctx.fillRect(bx1, barTop, barW, barH);

      // KE bar (bright white/gold — kinetic)
      const keH = KE * eScale;
      ctx.fillStyle = gold;
      ctx.fillRect(bx0, barBottom - keH, barW, keH);
      // PE bar (softer muted gold — potential)
      const peH = PE * eScale;
      ctx.fillStyle = 'rgba(197,183,131,0.45)';
      ctx.fillRect(bx1, barBottom - peH, barW, peH);

      // constant-total marker: a thin bright line across both bars at height E,
      // sitting flat while KE and PE swap beneath it.
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx0 - 4, barTop);
      ctx.lineTo(bx1 + barW + 4, barTop);
      ctx.stroke();

      // bar labels
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText('KE', bx0 + barW / 2, barBottom + 15);
      ctx.fillText('PE', bx1 + barW / 2, barBottom + 15);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('E', bx0 - 6, barTop + 4);

      // stash live readouts for the overlay
      readout.KE = KE; readout.PE = PE; readout.E = Etot; readout.speed = speed;

      raf = requestAnimationFrame(draw);
    };

    // shared object the overlay reads from (avoids per-frame React state churn)
    const readout = { KE: 0, PE: 0, E: 0, speed: 0 };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // drive the top-left overlay text from the same closure at a light cadence
    const overlay = wrap.querySelector('[data-readout]');
    const tick = setInterval(() => {
      if (!overlay) return;
      overlay.children[0].textContent = `KE     ${readout.KE.toFixed(2)}`;
      overlay.children[1].textContent = `PE     ${readout.PE.toFixed(2)}`;
      overlay.children[2].textContent = `total  ${readout.E.toFixed(2)}`;
      overlay.children[3].textContent = `speed  ${readout.speed.toFixed(2)}`;
    }, 80);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full gap-3">
      <div ref={wrapRef} className="relative flex-1 min-h-0 rounded-lg overflow-hidden" style={{ background: '#0D1321' }}>
        <canvas ref={canvasRef} className="block" />
        <div data-readout className="absolute top-2 left-3 text-xs font-mono text-usna-gold/90 space-y-0.5">
          <div>KE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0.00</div>
          <div>PE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0.00</div>
          <div>total&nbsp;&nbsp;0.00</div>
          <div>speed&nbsp;&nbsp;0.00</div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-usna-text text-sm font-medium">Release height</span>
          <span className="font-mono text-lg text-usna-gold tabular-nums">{release.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0.15} max={1.0} step={0.01} value={release}
          onInput={(e) => setRelease(parseFloat(e.target.value))}
          aria-label="Release height" className="w-full"
        />
        {!compact && (
          <p className="text-usna-muted text-xs mt-2">
            Kinetic and potential energy trade back and forth, but their total never changes.
          </p>
        )}
      </div>
    </div>
  );
}
