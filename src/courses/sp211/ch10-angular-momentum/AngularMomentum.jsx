import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import EnergyBars from '@shared/components/EnergyBars';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D30 · Angular Momentum Conservation — L29 (vector), L30 (skater).
 *
 * VECTOR mode makes L = r × p tangible for the case students trip over most:
 * a particle in STRAIGHT-LINE motion still has angular momentum about an
 * off-axis pivot, and that L is CONSTANT the whole way past. We draw r (pivot →
 * particle) and p (mass·velocity) live, shade the parallelogram whose area is
 * |r × p|, and annotate L = r·p·sin(phi) = p·(perpendicular distance). The
 * perpendicular ("lever arm") distance never changes for straight-line motion,
 * so L holds flat even though r, phi, and |r| all swing wildly.
 *
 *   · DRAG THE PIVOT O anywhere on the canvas: L is unchanged when O slides
 *     ALONG the line of motion (b is fixed → same lever arm), and scales when O
 *     moves PERPENDICULAR to it (b changes). This is the "L depends on the axis"
 *     lesson, made physical with a finger.
 *   · τ=0 ⟹ dL/dt=0 toggle: switch on gravity and the path curves (projectile).
 *     Now there IS a torque about O, so L is no longer constant — a live dL/dt
 *     readout tracks the instantaneous torque τ = r × F exactly.
 *
 * SKATER mode is the exam-question moment: pull the arms in, I drops, omega
 * rises so that L = I·omega is pinned, but rotational KE = 1/2 I omega^2 = L²/2I
 * RISES. A "Where did the energy come from?" button reveals the answer — the
 * skater's muscles do work pulling mass inward against the centripetal demand.
 * A stacked KE_before + work_in = KE_after audit bar makes the energy come from
 * somewhere. Presets swap the story onto a merry-go-round (person walks to the
 * center) and a neutron star, whose slider reads a real radius in km calibrated
 * to the Crab pulsar (Sun-like core, 25-day spin → ~20 km → ~1000 rev/s).
 *
 * FIX (visual spin ↔ ω): the on-screen spin is now driven from the TRUE ω for
 * every scenario (one uniform mapping ω_vis = ω, in rev/s), capped for the
 * strobing regime with an explicit "spin not to scale above N rev/s" note. The
 * old ad-hoc 0.35/r neutron-star hack (off by orders of magnitude) is gone.
 *
 * Wrapper is hook-free and branches by mode; each child owns its own hooks so
 * the Rules of Hooks hold across the very different mode UIs.
 */

const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const RED = '#E06C75';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const BG = '#0D1321';

// Bounded frame dt (survives tab throttling): clamp to a sane ceiling.
function frameDt(now, last) {
  if (!last) return 1 / 60;
  return Math.min(0.05, Math.max(0, (now - last) / 1000));
}

export default function AngularMomentum({ mode = 'vector' }) {
  if (mode === 'skater') return <SkaterMode />;
  return <VectorMode />;
}

/* ══════════════════════════════════════════════════════════════════════════
 * VECTOR MODE (L29) — L = r × p for straight-line motion past a pivot.
 * ════════════════════════════════════════════════════════════════════════ */

const V_DEFAULTS = {
  speed: 3.5, mass: 2, offset: 2.2, playing: true,
  pivotX: 0, pivotY: 0,   // pivot O world position (m); default at origin
  gravity: false,
};

// World window (m). Pivot origin (0,0) sits mid-canvas.
const X_MIN = -6, X_MAX = 6;

function VectorMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [speed, setSpeed] = useState(V_DEFAULTS.speed);     // m/s
  const [mass, setMass] = useState(V_DEFAULTS.mass);        // kg
  const [offset, setOffset] = useState(V_DEFAULTS.offset);  // m, initial lever arm b when pivot at origin
  const [playing, setPlaying] = useState(V_DEFAULTS.playing);
  const [showParallelogram, setShowParallelogram] = useState(true);
  const [gravity, setGravity] = useState(V_DEFAULTS.gravity);

  // Pivot O world position (m). Draggable.
  const [pivot, setPivot] = useState({ x: V_DEFAULTS.pivotX, y: V_DEFAULTS.pivotY });

  // Live readouts published from the rAF loop at a throttled cadence.
  const [live, setLive] = useState({
    r: 0, phi: 0, b: 0, L: 0, xPart: 0, dLdt: 0, tau: 0,
  });

  // Refs mirror state so the animation loop reads current values without
  // re-subscribing (loop is set up once).
  const speedRef = useRef(speed); speedRef.current = speed;
  const massRef = useRef(mass); massRef.current = mass;
  const offsetRef = useRef(offset); offsetRef.current = offset;
  const playRef = useRef(playing); playRef.current = playing;
  const paraRef = useRef(showParallelogram); paraRef.current = showParallelogram;
  const gravRef = useRef(gravity); gravRef.current = gravity;
  const pivotRef = useRef(pivot); pivotRef.current = pivot;

  // Particle world state. In straight-line mode it rides y = offset with vy=0.
  // In gravity mode it's a projectile launched from the left with an upward vy.
  const partRef = useRef({ x: -6, y: V_DEFAULTS.offset, vx: V_DEFAULTS.speed, vy: 0 });

  // Screen↔world transform, kept in a ref so pointer handlers can invert it.
  const xformRef = useRef({ X0: 0, Y0: 0, pxPerM: 1 });

  const g = 9.8; // m/s²

  // (Re)launch the particle for the current mode/params.
  const launch = () => {
    const b = offsetRef.current;
    if (gravRef.current) {
      // Projectile: start bottom-left, arc up and across so it curves visibly.
      partRef.current = { x: X_MIN - 0.5, y: -2.6, vx: speedRef.current, vy: 6.5 };
    } else {
      partRef.current = { x: X_MIN - 1, y: b, vx: speedRef.current, vy: 0 };
    }
  };

  const reset = () => {
    setSpeed(V_DEFAULTS.speed); setMass(V_DEFAULTS.mass); setOffset(V_DEFAULTS.offset);
    setPlaying(V_DEFAULTS.playing); setShowParallelogram(true); setGravity(false);
    setPivot({ x: V_DEFAULTS.pivotX, y: V_DEFAULTS.pivotY });
    gravRef.current = false; offsetRef.current = V_DEFAULTS.offset; speedRef.current = V_DEFAULTS.speed;
    launch();
  };

  // Re-launch whenever we flip gravity on/off (the trajectory family changes).
  useEffect(() => { launch(); /* eslint-disable-next-line */ }, [gravity]);
  // Keep the straight-line track pinned to the current lever arm when idle.
  useEffect(() => {
    if (!gravity) partRef.current.y = offset;
  }, [offset, gravity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, last, lastPub = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      const dt = frameDt(now, last);
      last = now;

      const v0 = speedRef.current;
      const m = massRef.current;
      const b0 = offsetRef.current;
      const grav = gravRef.current;
      const P = pivotRef.current;   // pivot O in world coords (m)
      const part = partRef.current;

      // ─── integrate the particle ───
      if (playRef.current) {
        part.x += part.vx * dt;
        if (grav) {
          part.vy -= g * dt;          // gravity pulls -y (world y-up)
          part.y += part.vy * dt;
        }
        // Wrap / relaunch when it leaves the window.
        const gone = grav ? (part.x > X_MAX + 1.5 || part.y < -6) : (part.x > X_MAX + 1);
        if (gone) {
          if (grav) { part.x = X_MIN - 0.5; part.y = -2.6; part.vx = v0; part.vy = 6.5; }
          else { part.x = X_MIN - 1; part.y = b0; part.vx = v0; part.vy = 0; }
        }
      }
      // Straight-line mode: keep speed/track synced to sliders while idle.
      if (!grav) { part.vx = v0; part.vy = 0; part.y = b0; }

      // World→screen. Pivot origin drawn from world (0,0); +y up.
      const X0 = W / 2;
      const Y0 = H * 0.60;
      const pxPerM = Math.min(W / (X_MAX - X_MIN) * 0.92, H * 0.11);
      xformRef.current = { X0, Y0, pxPerM };
      const sx = (xm) => X0 + xm * pxPerM;
      const sy = (ym) => Y0 - ym * pxPerM;

      // ─── physics about pivot O (SI, world y-up) ───
      // r = particle − pivot ; p = m·v ; L_z = m (rx·vy − ry·vx).
      const rx = part.x - P.x, ry = part.y - P.y;
      const rMag = Math.hypot(rx, ry);
      const vMag = Math.hypot(part.vx, part.vy);
      const Lz = m * (rx * part.vy - ry * part.vx);   // signed, out of page = +
      const L = Lz;
      // phi = angle between r and p.
      const pdotr = rx * part.vx + ry * part.vy;
      const cosPhi = rMag > 1e-9 && vMag > 1e-9 ? pdotr / (rMag * vMag) : 1;
      const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
      // Perpendicular lever arm b = |L| / p = |r × p̂|.  Published EXACTLY so the
      // "r·sinφ = b" readout equals this (no float drift off the slider).
      const p = m * vMag;
      const b = p > 1e-9 ? Math.abs(Lz) / p : 0;
      // Torque about O and dL/dt.  Only gravity contributes: F = (0, −mg).
      // τ_z = rx·Fy − ry·Fx = rx·(−mg).  In straight-line mode F=0 ⟹ τ=0.
      const Fy = grav ? -m * g : 0;
      const tau = rx * Fy;            // = dL/dt (N·m)
      const dLdt = tau;

      const px = sx(part.x), py = sy(part.y);
      const Opx = sx(P.x), Opy = sy(P.y);

      // ─── render ───
      ctx.clearRect(0, 0, W, H);

      // Ground reference in gravity mode.
      if (grav) {
        ctx.strokeStyle = 'rgba(139,140,142,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, sy(-6)); ctx.lineTo(W, sy(-6));
        ctx.stroke();
      }

      // Path the particle rides: straight dashed line, or the parabolic arc.
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (!grav) {
        ctx.moveTo(sx(X_MIN), sy(b0));
        ctx.lineTo(sx(X_MAX), sy(b0));
      } else {
        // Trace the parabola from the launch state across the window.
        const vx = v0, vy0 = 6.5, x0 = X_MIN - 0.5, y0 = -2.6;
        let first = true;
        for (let t = 0; t <= 4; t += 0.03) {
          const xx = x0 + vx * t;
          const yy = y0 + vy0 * t - 0.5 * g * t * t;
          if (xx > X_MAX + 1.5 || yy < -6) break;
          const X = sx(xx), Y = sy(yy);
          if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Lever arm b: perpendicular from pivot O to the line/velocity of motion.
      // Foot of perpendicular = O + ((particle−O)·v̂) v̂  ... draw O → foot.
      if (vMag > 1e-9) {
        const vhx = part.vx / vMag, vhy = part.vy / vMag;
        const proj = rx * vhx + ry * vhy;
        const footX = P.x + proj * vhx, footY = P.y + proj * vhy;
        ctx.strokeStyle = 'rgba(139,140,142,0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(Opx, Opy);
        ctx.lineTo(sx(footX), sy(footY));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = MUTED;
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`b = ${b.toFixed(2)} m`, (Opx + sx(footX)) / 2 + 6, (Opy + sy(footY)) / 2);
      }

      // Parallelogram whose AREA = |r × p| (visual proof L = base × height).
      if (paraRef.current && vMag > 1e-9) {
        const pLenPx = Math.min(150, p * 9);
        const vhx = part.vx / vMag, vhy = part.vy / vMag;
        // corners: O, particle P, P+p, O+p  (p drawn along v̂ scaled to px)
        const dxp = vhx * pLenPx, dyp = -vhy * pLenPx;  // screen: +y down
        ctx.beginPath();
        ctx.moveTo(Opx, Opy);
        ctx.lineTo(px, py);
        ctx.lineTo(px + dxp, py + dyp);
        ctx.lineTo(Opx + dxp, Opy + dyp);
        ctx.closePath();
        ctx.fillStyle = 'rgba(127,183,126,0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(127,183,126,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(127,183,126,0.9)';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('area = |r × p| = L', (2 * Opx + dxp) / 2, Opy + 16);
      }

      // r vector: pivot → particle (gold).
      drawArrow(ctx, {
        x: Opx, y: Opy, dx: px - Opx, dy: py - Opy,
        color: GOLD, width: 3, label: 'r',
      });

      // p vector: momentum, along v from the particle (blue). Length ∝ p.
      if (vMag > 1e-9) {
        const pLenPx = Math.min(150, p * 9);
        drawArrow(ctx, {
          x: px, y: py, dx: (part.vx / vMag) * pLenPx, dy: -(part.vy / vMag) * pLenPx,
          color: BLUE, width: 3, label: 'p',
        });
      }

      // Force arrow (gravity) from the particle so students see what makes τ≠0.
      if (grav) {
        drawArrow(ctx, {
          x: px, y: py, dx: 0, dy: Math.min(90, m * g * 3),
          color: RED, width: 2.5, label: 'F = mg',
        });
      }

      // Pivot dot + label + draggable ring.
      ctx.strokeStyle = 'rgba(197,183,131,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(Opx, Opy, 12, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = TEXT;
      ctx.beginPath();
      ctx.arc(Opx, Opy, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = MUTED;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('drag pivot O', Opx, Opy + 26);

      // L direction indicator: out of page (⊙) or into page (⊗) by sign.
      const outward = Lz >= 0;
      ctx.strokeStyle = GREEN; ctx.fillStyle = GREEN; ctx.lineWidth = 2;
      const lcx = W - 46, lcy = 34, lr = 12;
      ctx.beginPath(); ctx.arc(lcx, lcy, lr, 0, 2 * Math.PI); ctx.stroke();
      if (outward) {
        ctx.beginPath(); ctx.arc(lcx, lcy, 3, 0, 2 * Math.PI); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(lcx - lr * 0.7, lcy - lr * 0.7); ctx.lineTo(lcx + lr * 0.7, lcy + lr * 0.7);
        ctx.moveTo(lcx + lr * 0.7, lcy - lr * 0.7); ctx.lineTo(lcx - lr * 0.7, lcy + lr * 0.7);
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(outward ? 'L out of page' : 'L into page', lcx - lr - 6, lcy + 4);

      // Particle (on top).
      ctx.fillStyle = BLUE;
      ctx.shadowColor = BLUE;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Publish readouts at ~12 Hz.  b is published exactly.
      if (now - lastPub > 80) {
        lastPub = now;
        setLive({
          r: rMag, phi: phi * 180 / Math.PI, b,
          L, xPart: part.x, dLdt, tau,
        });
      }

      raf = requestAnimationFrame(draw);
    };

    // ── pointer drag: move the pivot O ──
    let dragging = false;
    const worldFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const { X0, Y0, pxPerM } = xformRef.current;
      return { x: (cx - X0) / pxPerM, y: (Y0 - cy) / pxPerM };
    };
    const near = (e) => {
      const w = worldFromEvent(e);
      const P = pivotRef.current;
      return Math.hypot(w.x - P.x, w.y - P.y) < 0.9;   // within ~0.9 m grabs O
    };
    const onDown = (e) => {
      if (near(e)) { dragging = true; e.preventDefault(); }
    };
    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const w = worldFromEvent(e);
      const clamped = {
        x: Math.max(X_MIN, Math.min(X_MAX, w.x)),
        y: Math.max(-5.5, Math.min(5.5, w.y)),
      };
      pivotRef.current = clamped;
      setPivot(clamped);
    };
    const onUp = () => { dragging = false; };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    resize();
    launch();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="text-usna-muted text-xs">particle glides past the pivot</span>
        </div>

        <Slider label="Speed |v|" value={speed} min={0.5} max={6} step={0.1} unit="m/s" onChange={setSpeed} />
        <Slider label="Mass m" value={mass} min={0.5} max={5} step={0.1} unit="kg" onChange={setMass} />
        <Slider label="Lever arm b" value={offset} min={0.4} max={4} step={0.1} unit="m" onChange={setOffset} />

        <label className="flex items-center gap-2 mt-1 mb-2 text-usna-muted text-xs cursor-pointer select-none">
          <input type="checkbox" checked={showParallelogram}
                 onChange={(e) => setShowParallelogram(e.target.checked)}
                 className="accent-usna-gold" />
          Show |r × p| parallelogram
        </label>

        <label className="flex items-center gap-2 mb-3 text-usna-muted text-xs cursor-pointer select-none">
          <input type="checkbox" checked={gravity}
                 onChange={(e) => setGravity(e.target.checked)}
                 className="accent-usna-gold" />
          Turn on gravity (τ ≠ 0 → dL/dt ≠ 0)
        </label>

        <div className="mt-1 border-t border-usna-grid pt-3">
          <Readout label="|r| (swings)" value={live.r.toFixed(2)} unit="m" />
          <Readout label="φ (swings)" value={live.phi.toFixed(0)} unit="°" />
          <Readout label="r · sin φ = b" value={live.b.toFixed(2)} unit="m" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label={gravity ? 'L = r × p (changing)' : 'L = m v b (constant)'}
                     value={live.L.toFixed(2)} unit="kg·m²/s" />
            <Readout label="dL/dt = τ = r × F" value={live.dLdt.toFixed(2)} unit="N·m" />
            <span className="block text-right text-[11px]" style={{ color: Math.abs(live.dLdt) > 0.05 ? RED : GREEN }}>
              {Math.abs(live.dLdt) > 0.05 ? '↕ L is changing' : 'τ = 0 → L constant'}
            </span>
          </div>
          <p className="text-usna-muted text-xs mt-2 leading-snug">
            {gravity
              ? 'Gravity exerts a torque about O, so dL/dt = τ = r × F is nonzero and L changes as the particle arcs. Drag O onto the line straight below the peak and τ momentarily vanishes.'
              : 'Drag pivot O along the line of motion: b is unchanged, so L holds. Drag it perpendicular to that line and b (and L) scale. |r| and φ change every frame, but r·sin φ stays pinned at b.'}
          </p>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef}
             className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 420, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...V_INFO} />
      </div>
    </div>
  );
}

const V_INFO = {
  title: 'Straight-line motion still has angular momentum',
  description:
    'A particle moving in a straight line, with no rotation anywhere, still carries angular momentum about any point off its path. As it glides past the pivot, |r| and the angle φ change a great deal, yet L = r·p·sin φ = p·b stays flat because the perpendicular lever arm b never changes. Drag the pivot O to see that L depends on the axis you choose: slide O along the line of motion and L is unchanged; move it perpendicular and L scales with b. Turn on gravity and there is a torque about O, so the path curves and L is no longer conserved, with dL/dt equal to the instantaneous torque τ = r × F. No torque means constant angular momentum.',
  equation: String.raw`\vec{L} = \vec{r} \times \vec{p}, \quad L = p\,b = mvb, \qquad \frac{d\vec L}{dt} = \vec\tau = \vec r \times \vec F`,
};

/* ══════════════════════════════════════════════════════════════════════════
 * SKATER MODE (L30) — L = I·omega conserved; KE = L²/2I rises as I drops.
 * ════════════════════════════════════════════════════════════════════════ */

// Scenario presets. Each defines how "arm fraction" a∈[0,1] maps the moment of
// inertia, plus display framing. We model I(a) as a fixed core plus a movable
// mass at a variable radius: I = Icore + mArm * r(a)², with r(a) in METERS.
// L is set once (from the initial extended state) and held constant; omega and
// KE follow.  The on-screen spin is driven from the TRUE omega for every
// scenario (see draw loop) so the animation never lies about the readout.
const SCENARIOS = {
  skater: {
    key: 'skater',
    label: 'Figure skater',
    blurb: 'Arms out → arms in. I drops, spin climbs, KE rises.',
    Icore: 1.4,           // kg·m² (torso + legs)
    mArm: 4.0,            // kg (both arms + any held weights, lumped)
    rMin: 0.15, rMax: 0.85,   // m, mass radius arms-in vs arms-out
    omega0: 2.0,          // rad/s at fully extended (start)
    startA: 1,
    revUnit: false,
    control: 'Arm extension',
    inLabel: 'arms in', outLabel: 'arms out',
    accent: GOLD,
  },
  merrygoround: {
    key: 'merrygoround',
    label: 'Merry-go-round',
    blurb: 'A person walks from the rim toward the center; the platform speeds up.',
    Icore: 30.0,          // platform disk (kg·m²)
    mArm: 60.0,           // the person (kg)
    rMin: 0.2, rMax: 2.2, // m, person's distance from the axis
    omega0: 1.2,          // rad/s with person at the rim
    startA: 1,
    revUnit: false,
    control: 'Person distance from center',
    inLabel: 'at center', outLabel: 'at rim',
    accent: GREEN,
  },
  neutronstar: {
    key: 'neutronstar',
    label: 'Neutron star (Crab)',
    blurb: 'A Sun-like core collapses to ~20 km; conservation of L spins it up to ~1000 rev/s.',
    // REAL-SCALE, Crab-pulsar calibrated. Uniform sphere I = (2/5) M R².
    // Slider a maps the RADIUS in km: r(a) = rMin + a(rMax − rMin).
    //   full size  a=1:  R ≈ 7×10^5 km (~Sun), spin ≈ 1 turn / 25 days
    //   collapsed a=0:   R ≈ 20 km,            spin ≈ 1000 rev/s (Crab-ish)
    // We store radii in km and fold (2/5)M into mArm; only the RATIO of I's
    // matters for omega, and (R_full/R_collapse)² ≈ (7e5/20)² ≈ 1.2e9, times
    // the base spin (2π/(25·86400) ≈ 2.9e-6 rad/s) gives ≈ 3.5e3 rad/s ≈
    // 560 rev/s — right order of magnitude for the Crab (30 rev/s today, but
    // ~1000 rev/s at birth). Reported honestly in rev/s.
    Icore: 0.0,
    mArm: 0.4,            // (2/5) with M normalized to 1
    rMin: 20, rMax: 700000,   // km  (collapsed → Sun-scale)
    omega0: 2 * Math.PI / (25 * 86400),  // rad/s: one turn per ~25 days
    startA: 1,
    revUnit: true,        // report rev/s
    control: 'Core radius',
    inLabel: '≈20 km', outLabel: '≈7×10⁵ km',
    accent: BLUE,
    realScale: true,
    // The radius spans 20 km → 7×10⁵ km, a factor of 35,000. A linear slider would
    // keep r near the top for almost its whole travel (ω ∝ 1/r² stays ~0) and then
    // spike only in the last sliver. Map the radius logarithmically instead, so
    // each slider step multiplies r (and ω) by a constant factor and the spin-up
    // reads as a smooth ramp across the slider.
    logRadius: true,
  },
};

// r(a) in the scenario's radius units (m for skater/mgr, km for star). Scenarios
// with a huge radius ratio (the neutron star) map logarithmically so equal slider
// steps scale the radius by a constant factor; the rest stay linear.
function radiusOf(sc, a) {
  if (sc.logRadius) return sc.rMin * Math.pow(sc.rMax / sc.rMin, a);
  return sc.rMin + a * (sc.rMax - sc.rMin);
}
// I as a function of arm fraction a for a scenario.
function inertiaOf(sc, a) {
  const r = radiusOf(sc, a);
  return sc.Icore + sc.mArm * r * r;
}

// Visible spin cap (rev/s) so hundreds-of-rev/s don't strobe on screen.
const VIS_CAP = 3.2;

function SkaterMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [scenarioKey, setScenarioKey] = useState('skater');
  const sc = SCENARIOS[scenarioKey];

  // Arm fraction a (1 = extended/out, 0 = pulled in). Starts extended.
  const [armA, setArmA] = useState(1);
  const [showAnswer, setShowAnswer] = useState(false);

  // Conserved L, fixed from the scenario's extended starting state.
  const L0 = inertiaOf(sc, sc.startA) * sc.omega0;

  // Current physics.
  const I = inertiaOf(sc, armA);
  const omega = L0 / I;                     // rad/s
  const omegaRev = omega / (2 * Math.PI);   // rev/s (for display + visual spin)
  const KE = 0.5 * L0 * omega;              // = L²/2I = 1/2 I omega²
  const KE0 = 0.5 * L0 * sc.omega0;         // KE when extended (baseline)
  const workIn = KE - KE0;                  // work done pulling mass in (J)
  const keRatio = KE0 > 0 ? KE / KE0 : 1;

  // Refs for the animation loop.
  const armRef = useRef(armA); armRef.current = armA;
  const scRef = useRef(sc); scRef.current = sc;
  const omegaRef = useRef(omega); omegaRef.current = omega;
  const phaseRef = useRef(0);
  const keyRef = useRef(scenarioKey); keyRef.current = scenarioKey;

  const switchScenario = (key) => {
    setScenarioKey(key);
    setArmA(SCENARIOS[key].startA);
    setShowAnswer(false);
    phaseRef.current = 0;
  };

  const reset = () => {
    setScenarioKey('skater');
    setArmA(1);
    setShowAnswer(false);
    phaseRef.current = 0;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, last;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      const dt = frameDt(now, last);
      last = now;

      const s = scRef.current;
      const a = armRef.current;
      const om = omegaRef.current;            // TRUE angular rate (rad/s)

      const trueRev = om / (2 * Math.PI);
      const heat = 1 - a;   // 0 extended → 1 fully collapsed (glow/trails + spin scale)

      // Visual spin. The skater and merry-go-round run at a few rev/s, so their
      // on-screen spin is the literal rate (capped at VIS_CAP against strobing).
      // The neutron star's true rate spans ~9 orders of magnitude, so a literal
      // mapping sits still and then blurs. Drive its spin on a compressed scale
      // (∝ how many orders of magnitude it has spun up, which is linear in the
      // slider here) so the collapse reads as a smooth ramp; the readout and the
      // on-canvas note still report the true rate.
      const visRev = s.realScale
        ? VIS_CAP * heat
        : Math.min(VIS_CAP, trueRev);
      const capped = trueRev > VIS_CAP + 1e-6;
      phaseRef.current += visRev * 2 * Math.PI * dt;
      const phase = phaseRef.current;

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.50;
      const R = Math.min(W, H) * 0.32;

      // Reference ring at max extension so the shrink reads.
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current mass radius as a fraction of R (visual), in pixels.
      const rFrac = radiusOf(s, a) / s.rMax;   // 0..1 of R
      const rNow = R * rFrac;

      if (keyRef.current === 'neutronstar') {
        drawStar(ctx, cx, cy, R, Math.max(0.05, rFrac), phase, heat);
      } else if (keyRef.current === 'merrygoround') {
        drawMerryGoRound(ctx, cx, cy, R, rNow, phase, heat, s.accent);
      } else {
        drawSkater(ctx, cx, cy, R, a, phase, heat, s.accent);
      }

      // Note the scale caveat: the star runs on a compressed spin scale, and the
      // other scenarios flag when the literal rate is capped against strobing.
      if (s.realScale || capped) {
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        const trueTxt = trueRev >= 100 ? trueRev.toFixed(0) : trueRev >= 1 ? trueRev.toFixed(1) : trueRev.toExponential(1);
        if (s.realScale) {
          ctx.fillText('spin shown on a compressed scale', 10, 18);
          ctx.fillText(`true rate ≈ ${trueTxt} rev/s`, 10, 33);
        } else {
          ctx.fillText(`spin not to scale above ${VIS_CAP.toFixed(1)} rev/s`, 10, 18);
          ctx.fillText(`(true ω ≈ ${trueTxt} rev/s)`, 10, 33);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── readout formatting ──
  const omegaDisp = sc.revUnit
    ? (omegaRev >= 100 ? omegaRev.toFixed(0) : omegaRev >= 10 ? omegaRev.toFixed(1) : omegaRev.toFixed(3))
    : omega.toFixed(2);
  const omegaUnit = sc.revUnit ? 'rev/s' : 'rad/s';
  const Ldisp = sc.revUnit ? L0.toExponential(2) : L0.toFixed(2);
  const Lunit = 'kg·m²/s';
  const radiusDisp = sc.realScale
    ? (radiusOf(sc, armA) >= 1000
        ? radiusOf(sc, armA).toExponential(2)
        : radiusOf(sc, armA).toFixed(0))
    : radiusOf(sc, armA).toFixed(2);
  const radiusUnit = sc.realScale ? 'km' : 'm';

  // ── energy audit bars: KE_before + work_in = KE_after ──
  // Left bar = KE_after as a single filled bar; middle = the explicit stack
  // (KE_before at the bottom + work_in on top) proving KE_after = KE_before +
  // W; right bar = the conserved L pinned at its baseline for contrast.
  // Values normalized to KE_before so the eye reads the change.
  const keBeforeN = 1;
  const workN = KE0 > 0 ? workIn / KE0 : 0;
  const keAfterN = keBeforeN + workN;
  const barMax = Math.max(keAfterN, 1) * 1.08;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Scenario</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <button
                key={key}
                onClick={() => switchScenario(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  scenarioKey === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-usna-muted text-xs mt-2 leading-snug">{sc.blurb}</p>
        </div>

        <Slider
          label={sc.control}
          value={Number(armA.toFixed(2))}
          min={0} max={1} step={0.01}
          unit={armA < 0.03 ? sc.inLabel : armA > 0.97 ? sc.outLabel : ''}
          onChange={setArmA}
        />
        <div className="flex justify-between text-usna-muted text-[11px] -mt-2 mb-1">
          <span>{sc.inLabel}</span><span>{sc.outLabel}</span>
        </div>
        {sc.realScale && (
          <div className="text-usna-muted text-[11px] mb-2">
            radius R = <span className="font-mono text-usna-gold">{radiusDisp}</span> {radiusUnit}
            {radiusOf(sc, armA) <= 30 && <span className="text-usna-gold"> · neutron-star scale</span>}
          </div>
        )}

        <div className="mt-1 border-t border-usna-grid pt-3">
          <Readout label="Moment of inertia I" value={sc.revUnit ? I.toExponential(2) : I.toFixed(2)} unit="kg·m²" />
          <Readout label="Spin ω" value={omegaDisp} unit={omegaUnit} />
          {sc.realScale && (
            <span className="block text-right text-[11px] text-usna-muted -mt-1">
              period T = {(1 / Math.max(1e-12, omegaRev)) >= 3600
                ? `${((1 / omegaRev) / 86400).toFixed(1)} days`
                : `${(1 / omegaRev).toExponential(1)} s`}
            </span>
          )}
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Angular momentum L" value={Ldisp} unit={Lunit} />
            <span className="block text-right text-[11px] text-usna-muted -mt-1">↑ does not change</span>
          </div>
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Rotational KE" value={sc.revUnit ? KE.toExponential(2) : KE.toFixed(2)} unit="J*" />
            <Readout label="KE vs extended" value={`×${keRatio.toFixed(2)}`} unit="" />
            <span className="block text-right text-[11px]" style={{ color: keRatio > 1.001 ? GOLD : MUTED }}>
              {keRatio > 1.001 ? '↑ rises' : 'baseline'}
            </span>
          </div>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <button
            onClick={() => setShowAnswer((v) => !v)}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-usna-deep text-usna-gold border border-usna-gold hover:bg-usna-gold hover:text-usna-navy transition-colors"
          >
            Where did the energy come from?
          </button>
          {showAnswer && (
            <p className="text-usna-text text-xs mt-2 leading-snug bg-usna-deep border border-usna-grid rounded p-2">
              {sc.key === 'neutronstar'
                ? 'Gravity does the work. As the core collapses, gravity pulls the mass inward against its own centripetal demand, and that work becomes the extra rotational KE; the star spins up at the expense of gravitational potential energy.'
                : 'Muscles (or the motor) do the work. Pulling the mass inward takes force against the centripetal direction over a distance, which is work, W = ΔKE. Angular momentum is conserved because that force is radial and exerts no torque, but it still adds energy. Since KE = L²/2I, shrinking I with L fixed must raise KE.'}
            </p>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef}
             className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 340, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0">
          <div className="text-usna-muted text-xs mb-2 font-mono">energy audit (normalized to KE before = 1)</div>
          <StackedEnergyAudit keBefore={keBeforeN} work={workN} keAfter={keAfterN} max={barMax} />
          <div className="text-usna-muted text-xs mt-3 leading-snug">
            KE<sub>after</sub> = KE<sub>before</sub> + W<sub>in</sub>. The middle bar stacks the
            starting KE (dim) plus the work you did pulling the mass in (bright), and it exactly
            reaches KE<sub>after</sub>. Angular momentum L is unchanged throughout; the extra
            energy came from work, not from L.
          </div>
        </div>

        <InfoPanel {...S_INFO} />
      </div>
    </div>
  );
}

/**
 * StackedEnergyAudit — the explicit "KE_before + work = KE_after" bookkeeping.
 * Three bars: KE_after (single), the stack (KE_before dim + work bright), and a
 * pinned L reference. Built on the same bar grammar as EnergyBars but with one
 * stacked column, so the audit is visual and load-bearing (local component).
 */
function StackedEnergyAudit({ keBefore, work, keAfter, max }) {
  const scale = max > 0 ? max : 1;
  const h = 180;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className="flex items-end gap-5" style={{ height: h }}>
      {/* KE after (result) */}
      <Column label="KE after" value={keAfter} unit="×">
        <div className="w-full" style={{ height: pct(keAfter), background: GOLD }} />
      </Column>
      {/* stacked before + work */}
      <Column label="before + W" value={keAfter} unit="×">
        <div className="w-full absolute left-0 right-0 bottom-0" style={{ height: pct(keBefore), background: 'rgba(197,183,131,0.40)' }} />
        <div className="w-full absolute left-0 right-0"
             style={{ bottom: pct(keBefore), height: pct(work), background: GREEN }} />
      </Column>
      {/* conserved L reference (pinned at 1) */}
      <Column label="L" value={1} unit="×" valueColor="rgba(197,183,131,0.7)">
        <div className="w-full" style={{ height: pct(1), background: 'rgba(197,183,131,0.30)' }} />
        <div className="absolute left-0 right-0 border-t border-usna-text/80" style={{ bottom: pct(1) }} />
      </Column>
    </div>
  );
}

function Column({ label, value, unit, valueColor, children }) {
  return (
    <div className="flex flex-col items-center justify-end h-full">
      <span className="font-mono text-xs tabular-nums mb-1" style={{ color: valueColor || GOLD }}>
        {value.toFixed(2)}{unit}
      </span>
      <div className="relative w-10 h-full bg-usna-deep border border-usna-grid rounded-sm overflow-hidden flex items-end">
        {children}
      </div>
      <span className="text-usna-muted text-xs mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

const S_INFO = {
  title: 'Same L, but more energy',
  description:
    'Pull the arms in and the moment of inertia I drops. Angular momentum L = Iω is conserved (there is no external torque), so ω rises to compensate and the L readout does not change. Rotational KE = ½Iω² = L²/2I is inversely proportional to I, so it rises. A common exam question asks whether conserved L means energy is conserved too; it does not. The skater\'s muscles do work pulling the mass inward, and that work is exactly the increase in KE (KE_before + W_in = KE_after). Conserving angular momentum does not conserve kinetic energy. The Crab-pulsar preset pushes this to the extreme: a Sun-scale core turning once every ~25 days collapses to about 20 km and, with L fixed, spins up to hundreds of rev/s.',
  equation: String.raw`L = I\omega = \text{const} \;\Rightarrow\; \omega = \frac{L}{I}, \quad KE = \frac{L^2}{2I}\uparrow, \quad KE_{\text{after}} = KE_{\text{before}} + W_{\text{in}}`,
};

/* ── canvas figure helpers (local; not in shared libs) ──────────────────── */

// Figure skater: torso at center, arms whose length tracks arm fraction a.
function drawSkater(ctx, cx, cy, R, a, phase, heat, accent) {
  ctx.save();
  ctx.translate(cx, cy);

  const nGhosts = Math.round(3 + heat * 14);
  const span = 0.3 + heat * 1.3;
  const armLen = (0.2 + 0.8 * a) * R;

  const drawArms = (rot, alpha) => {
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-armLen, 0);
    ctx.lineTo(armLen, 0);
    ctx.stroke();
    ctx.fillStyle = accent;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sgn * armLen, 0, 9, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  };

  for (let g = nGhosts; g >= 1; g--) {
    const back = (g / nGhosts) * span;
    drawArms(phase - back, 0.10 * (1 - g / (nGhosts + 1)));
  }
  ctx.globalAlpha = 1;

  const glow = 8 + heat * 40;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = glow;
  ctx.fillStyle = '#F0ECE3';
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();

  drawArms(phase, 1);
  ctx.restore();

  ctx.fillStyle = MUTED;
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(heat > 0.7 ? 'arms in · fast' : heat < 0.2 ? 'arms out · slow' : 'pulling in…', cx, cy + R + 24);
}

// Merry-go-round: a platform disk with a person dot at radius rNow, walking in.
function drawMerryGoRound(ctx, cx, cy, R, rNow, phase, heat, accent) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(phase);

  const grad = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  grad.addColorStop(0, 'rgba(91,155,213,0.35)');
  grad.addColorStop(1, 'rgba(91,155,213,0.10)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240,236,227,0.25)';
  ctx.lineWidth = 1.5;
  for (let s = 0; s < 6; s++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  const nGhosts = Math.round(3 + heat * 12);
  const span = 0.3 + heat * 1.2;
  const drawPerson = (rot, alpha, r) => {
    const hx = Math.cos(rot) * r, hy = Math.sin(rot) * r;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6 + heat * 20;
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;
  };
  for (let g = nGhosts; g >= 1; g--) {
    drawPerson(phase - (g / nGhosts) * span, 0.10 * (1 - g / (nGhosts + 1)), rNow);
  }
  ctx.globalAlpha = 1;
  drawPerson(phase, 1, rNow);
  ctx.restore();

  ctx.fillStyle = MUTED;
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(heat > 0.7 ? 'at the center · fast' : heat < 0.2 ? 'at the rim · slow' : 'walking inward…', cx, cy + R + 24);
}

// Neutron star: shrinking glowing sphere with orbiting hotspots + trails.
function drawStar(ctx, cx, cy, R, rFrac, phase, heat) {
  const rNow = Math.max(R * 0.05, R * rFrac);

  const nGhosts = Math.round(3 + heat * 18);
  const span = 0.35 + heat * 1.5;
  const N = 5;
  const spotRing = rNow * 0.82;
  const drawSpots = (rot, alpha) => {
    for (let k = 0; k < N; k++) {
      const ang = rot + (k / N) * 2 * Math.PI;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * spotRing, cy + Math.sin(ang) * spotRing, Math.max(2, rNow * 0.09), 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  for (let g = nGhosts; g >= 1; g--) {
    drawSpots(phase - (g / nGhosts) * span, 0.12 * (1 - g / (nGhosts + 1)));
  }

  const glow = 10 + heat * 55;
  const grad = ctx.createRadialGradient(cx, cy, rNow * 0.1, cx, cy, rNow);
  grad.addColorStop(0, heat > 0.6 ? '#FFFFFF' : '#D4C99E');
  grad.addColorStop(0.6, GOLD);
  grad.addColorStop(1, 'rgba(90,79,34,0.9)');
  ctx.save();
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = glow;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, rNow, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();

  drawSpots(phase, 0.95);

  if (heat > 0.55) {
    const beamAlpha = (heat - 0.55) / 0.45 * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phase * 0.6);
    for (const dir of [0, Math.PI]) {
      const bg = ctx.createLinearGradient(0, 0, Math.cos(dir) * R * 1.6, Math.sin(dir) * R * 1.6);
      bg.addColorStop(0, `rgba(197,183,131,${beamAlpha})`);
      bg.addColorStop(1, 'rgba(197,183,131,0)');
      ctx.fillStyle = bg;
      const spread = 0.12;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(dir - spread) * R * 1.6, Math.sin(dir - spread) * R * 1.6);
      ctx.lineTo(Math.cos(dir + spread) * R * 1.6, Math.sin(dir + spread) * R * 1.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.fillStyle = MUTED;
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(heat > 0.85 ? 'neutron star / pulsar' : heat < 0.15 ? 'stellar core' : 'collapsing…', cx, cy + R + 24);
}
