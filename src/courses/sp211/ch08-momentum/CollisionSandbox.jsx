import { useState, useMemo, useEffect, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import EnergyBars from '@shared/components/EnergyBars';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D22 · Collision Sandbox — L21 (1d), L22 (impulse), L23 (2d).
 *
 * Three conservation-of-momentum lessons that share one idea and differ in the
 * counterintuitive punchline:
 *
 *   1d       : two carts on a track; per-cart mass/velocity sliders and an
 *              elasticity slider e ∈ [0,1]. The TOTAL-MOMENTUM bar never moves
 *              as e changes; the KE bar collapses. Drag e mid-collision and the
 *              KE loss grows while momentum conservation doesn't flinch — the
 *              asymmetry between the two conservation laws (the L21 moment).
 *              A center-of-mass-frame toggle redraws the track where total
 *              momentum is literally zero — the carts approach and recede
 *              symmetrically, yet KE still drops.
 *   impulse  : a slow-motion contact with F(t) plotted live. The area under
 *              F(t) is Δp (the impulse–momentum theorem). A "cushion" slider
 *              stretches the SAME area over more time → a much lower peak force.
 *              An occupant g-force gauge with a survivable band quantifies the
 *              airbag / crumple-zone argument (the L22 moment). Alternate
 *              same-area force profiles (rigid / half-sine / triangle) overlay
 *              as ghosts: peak force depends on shape, not just duration.
 *   2d       : overhead glancing collision with an adjustable impact parameter.
 *              Momentum decomposes into x and y components, each conserved on
 *              its own — verified for every e and any mass ratio. A vector-sum
 *              inset shows p₁_out and p₂_out laid tip-to-tail landing exactly on
 *              p_in (one triangle = conservation). Equal-mass elastic head-glance
 *              → a 90° opening angle, the billiards fact (the L23 moment).
 *
 * The default export is a thin, hook-free wrapper that branches by mode so each
 * child owns its own hooks (Rules of Hooks). SI units internally.
 */

const GOLD = '#C5B783';
const GOLD_DIM = 'rgba(197,183,131,0.45)';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const RED = '#E06666';
const AMBER = '#E0A85B';
const NAVY_CART = '#3E5C8A';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const DEEP = '#0D1321';

// A short synthesized "click" at contact (Web Audio). Lazily created & shared.
let _audioCtx = null;
function clickSound(gainScale = 1) {
  try {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.05);
    const g = Math.max(0.02, Math.min(0.28, 0.22 * gainScale));
    gain.gain.setValueAtTime(g, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    /* audio is a nicety; never let it break the sim */
  }
}

// ── shared canvas helpers (local; the shared arrow lib is used for vectors) ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════════════════
// Wrapper — hook-free, branches by mode.
// ═══════════════════════════════════════════════════════════════════════════
export default function CollisionSandbox({ mode = '1d' }) {
  if (mode === 'impulse') return <ImpulseMode />;
  if (mode === '2d') return <TwoDMode />;
  return <OneDMode />;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE 1 · 1D carts — momentum bar frozen, KE bar collapses with e.
// ═══════════════════════════════════════════════════════════════════════════
const D1 = { mA: 1, mB: 2, vA: 5, vB: -1, e: 1 };

// Restitution outcome for a 1D pair, given pre-collision speeds. Kept as a pure
// helper so the analytic readouts and the live resolver agree exactly.
function resolve1D(mA, mB, uA, uB, e) {
  const rel = uA - uB;
  const p = mA * uA + mB * uB;
  const M = mA + mB;
  return {
    vAf: (p - mB * e * rel) / M,
    vBf: (p + mA * e * rel) / M,
  };
}

function OneDMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [mA, setMA] = useState(D1.mA);
  const [mB, setMB] = useState(D1.mB);
  const [vA, setVA] = useState(D1.vA);
  const [vB, setVB] = useState(D1.vB);
  const [e, setE] = useState(D1.e);
  const [playing, setPlaying] = useState(true);
  const [trails, setTrails] = useState(true);
  const [comFrame, setComFrame] = useState(false); // WOW: center-of-mass frame

  // Live post-collision velocities pushed from the rAF loop (throttled).
  const [live, setLive] = useState({ vA: D1.vA, vB: D1.vB, collided: false });

  // Everything the loop needs, without re-subscribing the effect each keystroke.
  const paramRef = useRef();
  paramRef.current = { mA, mB, vA, vB, e, playing, trails, comFrame };

  const reset = () => {
    setMA(D1.mA); setMB(D1.mB); setVA(D1.vA); setVB(D1.vB);
    setE(D1.e); setPlaying(true); setTrails(true); setComFrame(false);
    resetSimRef.current && resetSimRef.current();
  };
  const resetSimRef = useRef(null);

  // ── restitution algebra (also drives the analytic bar readouts) ──
  const pTotal = mA * vA + mB * vB;
  const keBefore = 0.5 * mA * vA * vA + 0.5 * mB * vB * vB;
  const { vAf, vBf } = resolve1D(mA, mB, vA, vB, e);
  const keAfter = 0.5 * mA * vAf * vAf + 0.5 * mB * vBf * vBf;
  const keLostPct = keBefore > 0 ? (100 * (keBefore - keAfter)) / keBefore : 0;

  // center-of-mass velocity: in this frame the total momentum is identically 0.
  const vCom = pTotal / (mA + mB);

  // Bars reflect the CURRENT sim state (before → after as the carts collide).
  const pA = mA * live.vA, pB = mB * live.vB;
  const pNow = pA + pB;
  const keA = 0.5 * mA * live.vA * live.vA;
  const keB = 0.5 * mB * live.vB * live.vB;
  const keNow = keA + keB;

  const pScale = Math.max(1, Math.abs(pA) + Math.abs(pB), Math.abs(pTotal)) * 1.05;
  const keScale = Math.max(0.001, keBefore) * 1.05;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, sim = 0, lastNow;
    let xA, xB, uA, uB, collided, flash, trackY;
    // dwell: after contact resolves we hold a brief window during which the
    // impulse is (re)applied continuously, so dragging e mid-collision reads.
    let dwell = 0;         // seconds remaining in the contact window
    let preA, preB;        // the pre-collision speeds cached at first touch
    const DWELL_T = 0.32;  // s of "contact" the resolver stays live for
    const CART_H = 44;
    let lastPublish = 0;
    // motion trails: recent (x, side) samples
    const trailA = [];
    const trailB = [];

    // pixels-per-metre so a ~10 m/s cart crosses the frame in a couple seconds
    const PPM = () => W / 20;
    const cartWidth = (m) => 34 + 12 * Math.min(3, m); // heavier looks bigger

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      trackY = Math.round(H * 0.5);
    };

    const doReset = () => {
      const p = paramRef.current;
      sim = 0;
      xA = W * 0.28;
      xB = W * 0.62;
      uA = p.vA;
      uB = p.vB;
      collided = false;
      dwell = 0;
      preA = p.vA; preB = p.vB;
      flash = 0;
      trailA.length = 0;
      trailB.length = 0;
    };
    resetSimRef.current = doReset;

    const draw = (now) => {
      if (xA === undefined) { doReset(); lastNow = now; }
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const p = paramRef.current;
      const ppm = PPM();
      const wA = cartWidth(p.mA), wB = cartWidth(p.mB);

      // In the COM frame we subtract the drift so the readout says "p = 0" and
      // both carts approach/recede symmetrically about the center of mass.
      const vFrame = p.comFrame ? (p.mA * p.vA + p.mB * p.vB) / (p.mA + p.mB) : 0;

      if (p.playing) {
        // advance in small substeps to prevent tunneling at high v / low fps:
        // never let a cart move more than ~1/3 of the smaller cart per substep.
        const maxStepPx = Math.max(6, Math.min(wA, wB) / 3);
        const speedPx = Math.max(Math.abs(uA), Math.abs(uB)) * ppm;
        const nSub = Math.max(1, Math.min(64, Math.ceil((speedPx * dt) / maxStepPx)));
        const sub = dt / nSub;

        for (let s = 0; s < nSub; s++) {
          xA += uA * ppm * sub;
          xB += uB * ppm * sub;
          const gap = (xB - wB / 2) - (xA + wA / 2);

          if (!collided && gap <= 0 && uA > uB) {
            // first contact: cache pre-collision speeds, open the dwell window,
            // and back the carts out of the overlap that the step created.
            preA = uA; preB = uB;
            collided = true;
            dwell = DWELL_T;
            flash = 1;
            const overlap = -gap;
            xA -= overlap / 2;
            xB += overlap / 2;
            clickSound(Math.min(1.4, Math.abs(preA - preB) / 6));
          }
        }
        sim += dt;

        // While the contact dwell is open, re-resolve from the CACHED pre-speeds
        // every frame using the CURRENT slider e — so scrubbing e mid-collision
        // actually changes the outcome instead of being locked at first touch.
        if (dwell > 0) {
          const r = resolve1D(p.mA, p.mB, preA, preB, p.e);
          uA = r.vAf;
          uB = r.vBf;
          dwell = Math.max(0, dwell - dt);
        }
      }

      // loop when both carts have left the frame (or safety time)
      const offR = xA - wA / 2 > W + 40 && xB - wB / 2 > W + 40;
      const offL = xA + wA / 2 < -40 && xB + wB / 2 < -40;
      const mixed = (xA + wA / 2 < -60) || (xB - wB / 2 > W + 60);
      if (sim > 6 || offR || offL || mixed) { doReset(); }

      flash = Math.max(0, flash - dt * 3.2);

      // trails (store frame-relative positions so the COM view trails cleanly)
      if (p.trails && p.playing) {
        trailA.push(xA); trailB.push(xB);
        if (trailA.length > 42) trailA.shift();
        if (trailB.length > 42) trailB.shift();
      }

      // publish live velocities ~20 Hz for the React bars (lab-frame values;
      // momentum/KE bookkeeping is always reported in the lab frame)
      if (now - lastPublish > 50) {
        lastPublish = now;
        setLive({ vA: uA, vB: uB, collided });
      }

      // ── render ──
      ctx.clearRect(0, 0, W, H);

      // screen-space transform: in the COM frame every drawn x is shifted so the
      // center of mass sits still at screen center; carts drift symmetrically.
      const comX = (p.mA * xA + p.mB * xB) / (p.mA + p.mB);
      const shift = p.comFrame ? (W * 0.5 - comX) : 0;
      const SX = (x) => x + shift;
      // displayed velocity (for arrows + readouts) is measured in the chosen frame
      const dispA = uA - vFrame;
      const dispB = uB - vFrame;

      // track
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, trackY + CART_H / 2 + 8);
      ctx.lineTo(W, trackY + CART_H / 2 + 8);
      ctx.stroke();
      // tick marks (1 m spacing) for a sense of scale
      ctx.fillStyle = GRID;
      for (let x = 0; x < W; x += ppm) ctx.fillRect(x, trackY + CART_H / 2 + 8, 1, 6);

      // COM marker: a bright vertical line the carts stay symmetric about
      if (p.comFrame) {
        ctx.strokeStyle = 'rgba(127,183,126,0.5)';
        ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(W * 0.5, trackY - CART_H); ctx.lineTo(W * 0.5, trackY + CART_H); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = GREEN; ctx.textAlign = 'center';
        ctx.fillText('center of mass · Σp = 0', W * 0.5, trackY - CART_H - 4);
      }

      // motion trails — a faint, slim central streak so the boxes' edges stay clear
      if (p.trails) {
        const th = CART_H * 0.42;
        const ty = trackY - th / 2;
        for (let i = 0; i < trailA.length; i++) {
          const a = (i / trailA.length) * 0.14;
          ctx.fillStyle = `rgba(197,183,131,${a.toFixed(3)})`;
          ctx.fillRect(SX(trailA[i]) - wA / 2, ty, wA, th);
          ctx.fillStyle = `rgba(62,92,138,${a.toFixed(3)})`;
          ctx.fillRect(SX(trailB[i]) - wB / 2, ty, wB, th);
        }
      }

      // contact flash
      if (flash > 0.01) {
        const mx = SX((xA + xB) / 2);
        const rad = 28 + 34 * (1 - flash);
        const g = ctx.createRadialGradient(mx, trackY, 0, mx, trackY, rad);
        g.addColorStop(0, `rgba(255,255,255,${(0.5 * flash).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, trackY, rad, 0, 2 * Math.PI);
        ctx.fill();
      }

      // carts (solid fill + a crisp outline so the box edges read over the trail)
      const yTop = trackY - CART_H / 2;
      roundRect(ctx, SX(xA) - wA / 2, yTop, wA, CART_H, 8);
      ctx.fillStyle = GOLD; ctx.fill();
      ctx.strokeStyle = 'rgba(13,19,33,0.85)'; ctx.lineWidth = 2; ctx.stroke();
      roundRect(ctx, SX(xB) - wB / 2, yTop, wB, CART_H, 8);
      ctx.fillStyle = NAVY_CART; ctx.fill();
      ctx.strokeStyle = 'rgba(240,236,227,0.55)'; ctx.lineWidth = 2; ctx.stroke();

      // velocity arrows (screen +x = physics +x here) drawn in the chosen frame
      drawArrow(ctx, { x: SX(xA), y: trackY, dx: clampArrow(dispA * ppm * 0.22), dy: 0, color: DEEP, width: 2.6, head: 8 });
      drawArrow(ctx, { x: SX(xB), y: trackY, dx: clampArrow(dispB * ppm * 0.22), dy: 0, color: TEXT, width: 2.6, head: 8 });

      // labels
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = GOLD;
      ctx.fillText(`A · ${p.mA} kg`, SX(xA), yTop - 8);
      ctx.fillStyle = MUTED;
      ctx.fillText(`B · ${p.mB} kg`, SX(xB), yTop - 8);

      raf = requestAnimationFrame(draw);
    };

    const clampArrow = (v) => Math.sign(v) * Math.max(0, Math.min(70, Math.abs(v)));

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => { resize(); doReset(); });
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Mass A" value={mA} min={0.5} max={5} step={0.5} unit="kg" onChange={setMA} />
        <Slider label="Velocity A" value={vA} min={-8} max={8} step={0.5} unit="m/s" onChange={setVA} />
        <Slider label="Mass B" value={mB} min={0.5} max={5} step={0.5} unit="kg" onChange={setMB} />
        <Slider label="Velocity B" value={vB} min={-8} max={8} step={0.5} unit="m/s" onChange={setVB} />
        <div className="border-t border-usna-grid pt-3">
          <Slider label="Elasticity (e)" value={e} min={0} max={1} step={0.01} unit="" onChange={setE} />
          <p className="text-usna-muted text-xs -mt-2 mb-3">
            1 = perfectly elastic · 0 = perfectly inelastic (they stick) · drag it while they touch
          </p>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            onClick={() => resetSimRef.current && resetSimRef.current()}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:text-usna-gold transition-colors"
          >
            ↺ Replay
          </button>
        </div>
        <label className="flex items-center gap-2 text-usna-text text-sm mb-1 cursor-pointer">
          <input type="checkbox" checked={trails} onChange={(ev) => setTrails(ev.target.checked)} className="accent-usna-gold" />
          Motion trails
        </label>
        <label className="flex items-center gap-2 text-usna-text text-sm mb-1 cursor-pointer">
          <input type="checkbox" checked={comFrame} onChange={(ev) => setComFrame(ev.target.checked)} className="accent-usna-gold" />
          Center-of-mass frame (Σp ≡ 0)
        </label>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Total p (lab, any e)" value={pTotal.toFixed(2)} unit="kg·m/s" />
          {comFrame && <Readout label="Total p (COM frame)" value="0.00" unit="kg·m/s" />}
          {comFrame && <Readout label="Frame speed v_cm" value={vCom.toFixed(2)} unit="m/s" />}
          <Readout label="KE before" value={keBefore.toFixed(2)} unit="J" />
          <Readout label="KE after (e set)" value={keAfter.toFixed(2)} unit="J" />
          <Readout label="KE lost" value={keLostPct.toFixed(0)} unit="%" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 300, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {/* momentum: per-cart signed contributions + a constant-total marker */}
          <div className="flex-1 bg-usna-card border border-usna-grid rounded-lg p-4">
            <div className="text-usna-text text-sm font-medium mb-3">Momentum (kg·m/s)</div>
            <EnergyBars
              items={[
                { label: 'A', value: Math.abs(pA), color: GOLD },
                { label: 'B', value: Math.abs(pB), color: NAVY_CART },
                { label: 'Σp', value: Math.abs(pNow), color: GREEN },
              ]}
              max={pScale}
              total={Math.abs(pTotal)}
              height={180}
            />
            <p className="text-usna-muted text-xs mt-2">
              The Σp bar sits on the constant-total line for every e.
              {comFrame && ' In the COM frame the total is zero — yet KE still drops.'}
            </p>
          </div>
          {/* kinetic energy: per-cart + total, no constant marker (it drops) */}
          <div className="flex-1 bg-usna-card border border-usna-grid rounded-lg p-4">
            <div className="text-usna-text text-sm font-medium mb-3">Kinetic energy (J)</div>
            <EnergyBars
              items={[
                { label: 'A', value: keA, color: GOLD_DIM },
                { label: 'B', value: keB, color: 'rgba(62,92,138,0.7)' },
                { label: 'ΣK', value: keNow, color: BLUE },
              ]}
              max={keScale}
              total={keBefore}
              height={180}
            />
            <p className="text-usna-muted text-xs mt-2">
              ΣK falls below the pre-impact line whenever e &lt; 1.
            </p>
          </div>
        </div>

        <InfoPanel {...INFO['1d']} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE 2 · Impulse — F(t) area = Δp; cushion trades peak force for time.
// ═══════════════════════════════════════════════════════════════════════════
const D2 = { m: 1200, v0: 12, cushion: 0.15, shape: 'halfsine' };

// Same-area force profiles. Each is defined on τ ∈ [0,1] and normalized so that
// ∫₀¹ shape(τ) dτ = 1; multiplying by (Δp / T) then gives a curve whose true
// area over [0,T] is exactly Δp. Peak differs by shape even for identical area.
//   rectangle : constant     → peak = 1        (rigid: shortest, tallest wall)
//   halfsine  : sin(πτ)      → peak = π/2       (a cushioned bumper / airbag)
//   triangle  : tent         → peak = 2         (a crumple that stiffens to a spike)
const SHAPES = {
  rect: {
    label: 'Rigid (rectangular)',
    color: RED,
    f: () => 1,
    peak: 1,
  },
  halfsine: {
    label: 'Cushion (half-sine)',
    color: GREEN,
    f: (t) => Math.sin(Math.PI * t) * (Math.PI / 2),
    peak: Math.PI / 2,
  },
  triangle: {
    label: 'Crumple (triangular)',
    color: AMBER,
    f: (t) => (t < 0.5 ? 4 * t : 4 * (1 - t)),
    peak: 2,
  },
};

// Survivability thresholds for whole-body deceleration (g). ~25 g is a rough
// sustained-tolerance figure; brief peaks up to ~50 g are survivable with
// restraints; beyond that injury risk climbs steeply. Used for the gauge band.
const G_SAFE = 25;
const G_LIMIT = 50;

function ImpulseMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [m, setM] = useState(D2.m);            // kg (a small car)
  const [v0, setV0] = useState(D2.v0);         // m/s incoming speed
  const [cushion, setCushion] = useState(D2.cushion); // 0 stiff … 1 soft
  const [shape, setShape] = useState(D2.shape); // active force profile
  const [playing, setPlaying] = useState(true);

  const [scrub, setScrub] = useState(0);       // 0..1 fraction of contact done

  const reset = () => {
    setM(D2.m); setV0(D2.v0); setCushion(D2.cushion); setShape(D2.shape); setPlaying(true);
    scrubRef.current = 0; setScrub(0);
  };

  // Contact duration grows with the cushion; the impulse (area) is fixed at m·v0.
  const contactT = 0.03 + cushion * 0.27;      // s, stiff → soft
  const dpMag = m * v0;                          // |Δp| the wall must deliver
  const shapeDef = SHAPES[shape] || SHAPES.halfsine;
  // peak force for the ACTIVE profile: F_peak = (Δp/T)·peak_of_normalized_shape
  const Fpeak = (dpMag / contactT) * shapeDef.peak;
  // occupant deceleration in g at the force peak (a = F/m, in units of g)
  const gPeak = Fpeak / (m * 9.81);

  // Sampled F(t) for the plot (active profile + the other two as ghosts).
  const NF = 220;
  const { ts, curves, areaUpTo } = useMemo(() => {
    const ts = new Array(NF);
    const curves = {};
    for (const key of Object.keys(SHAPES)) curves[key] = new Array(NF);
    for (let i = 0; i < NF; i++) {
      const tau = i / (NF - 1);           // 0..1
      ts[i] = tau * contactT * 1000;      // ms for display
      for (const key of Object.keys(SHAPES)) {
        // true force in kN: (Δp/T)·shape(τ) / 1000
        curves[key][i] = (dpMag / contactT) * SHAPES[key].f(tau) / 1000;
      }
    }
    // cumulative impulse (kg·m/s) up to each index for the ACTIVE profile
    const areaUpTo = new Array(NF);
    areaUpTo[0] = 0;
    const dt = contactT / (NF - 1);
    for (let i = 1; i < NF; i++) {
      const fPrev = (dpMag / contactT) * shapeDef.f((i - 1) / (NF - 1));
      const fCur = (dpMag / contactT) * shapeDef.f(i / (NF - 1));
      areaUpTo[i] = areaUpTo[i - 1] + 0.5 * (fPrev + fCur) * dt;
    }
    return { ts, curves, areaUpTo };
  }, [contactT, dpMag, shape]); // shape switches which curve drives the fill

  // scrub fraction drives both the plot fill and the animation phase
  const scrubRef = useRef(0);
  scrubRef.current = scrub;
  const paramRef = useRef();
  paramRef.current = { m, v0, cushion, contactT, Fpeak, playing, shape, shapeDef };

  const idx = Math.max(0, Math.min(NF - 1, Math.round(scrub * (NF - 1))));
  const impulseSoFar = areaUpTo[idx];
  const vNow = v0 * (1 - impulseSoFar / dpMag); // decelerating during contact
  // instantaneous g right now (drives the live needle)
  const gNow = (dpMag / contactT) * shapeDef.f(scrub) / (m * 9.81);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    // phase machine: approach → contact (advances scrub) → recede → loop
    let phase = 'approach';
    let phaseT = 0;
    let carX = 0;
    let clicked = false;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      const p = paramRef.current;

      const wallX = W * 0.72;
      const carW = 96, carH = 52;
      const y = H * 0.5;
      const startX = W * 0.12;

      if (p.playing) {
        phaseT += dt;
        if (phase === 'approach') {
          // approach in ~0.9 s regardless
          const frac = Math.min(1, phaseT / 0.9);
          carX = startX + (wallX - carW - startX) * easeOut(frac);
          if (frac >= 1) { phase = 'contact'; phaseT = 0; clicked = false; scrubRef.current = 0; }
        } else if (phase === 'contact') {
          // slow-motion: play the contact over ~1.6 s of wall-clock
          const frac = Math.min(1, phaseT / 1.6);
          scrubRef.current = frac;
          if (!clicked) { clicked = true; clickSound(1 - p.cushion * 0.6); }
          // small crush toward the wall then back
          carX = (wallX - carW) + 6 * Math.sin(Math.PI * frac);
          if (frac >= 1) { phase = 'recede'; phaseT = 0; }
        } else {
          const frac = Math.min(1, phaseT / 0.9);
          carX = (wallX - carW) - (wallX - carW - startX) * easeOut(frac);
          if (frac >= 1) { phase = 'approach'; phaseT = 0; }
        }
        setScrubThrottled(scrubRef.current);
      }

      const contacting = phase === 'contact';
      // instantaneous normalized force (0..1 relative to this shape's own peak)
      const fFrac = contacting
        ? p.shapeDef.f(scrubRef.current) / p.shapeDef.peak
        : 0;

      // ── render ──
      ctx.clearRect(0, 0, W, H);

      // ground
      ctx.strokeStyle = GRID; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + carH / 2 + 6);
      ctx.lineTo(W, y + carH / 2 + 6);
      ctx.stroke();

      // wall
      ctx.fillStyle = '#243247';
      ctx.fillRect(wallX, y - carH * 1.4, 18, carH * 2.6);

      // cushion / bumper: thickness scales with the cushion slider
      const bumpW = 6 + p.cushion * 40;
      const compress = contacting ? bumpW * 0.4 * Math.sin(Math.PI * scrubRef.current) : 0;
      ctx.fillStyle = p.cushion > 0.5 ? GREEN : GOLD;
      roundRect(ctx, wallX - (bumpW - compress), y - carH * 0.6, bumpW - compress, carH * 1.2, 5);
      ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;

      // car
      roundRect(ctx, carX, y - carH / 2, carW, carH, 10);
      ctx.fillStyle = GOLD; ctx.fill();
      // windshield accent
      ctx.fillStyle = 'rgba(13,19,33,0.5)';
      roundRect(ctx, carX + carW * 0.5, y - carH / 2 + 6, carW * 0.36, carH * 0.42, 4);
      ctx.fill();
      // wheels
      ctx.fillStyle = DEEP;
      ctx.beginPath(); ctx.arc(carX + carW * 0.25, y + carH / 2, 9, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(carX + carW * 0.75, y + carH / 2, 9, 0, 2 * Math.PI); ctx.fill();

      // occupant dot lurches forward with the deceleration (restraint pulls back)
      const occX = carX + carW * 0.32 + fFrac * carW * 0.22;
      ctx.fillStyle = contacting ? RED : TEXT;
      ctx.beginPath(); ctx.arc(occX, y - carH * 0.05, 6, 0, 2 * Math.PI); ctx.fill();

      // live force arrow from wall on car (points left, into the car)
      if (contacting) {
        const arrowLen = 20 + 70 * fFrac;
        drawArrow(ctx, { x: carX + carW, y, dx: -arrowLen, dy: 0, color: RED, width: 4, head: 12, label: 'F' });
      }

      // velocity arrow on the car (shrinks as it decelerates during contact)
      const vFracVis = contacting
        ? (1 - scrubRef.current)
        : (phase === 'approach' ? 1 : -0.4);
      if (Math.abs(vFracVis) > 0.02) {
        drawArrow(ctx, { x: carX + carW / 2, y: y - carH / 2 - 16, dx: 46 * vFracVis, dy: 0, color: BLUE, width: 3, head: 9, label: 'v' });
      }

      raf = requestAnimationFrame(draw);
    };

    let lastScrubPush = 0;
    const setScrubThrottled = (val) => {
      const t = performance.now();
      if (t - lastScrubPush > 33) { lastScrubPush = t; setScrub(val); }
    };
    const easeOut = (x) => 1 - (1 - x) * (1 - x);

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── F(t) plot: active curve filled to the scrub + the other two as ghosts ──
  const activeCurve = curves[shape];
  const ghostTraces = Object.keys(SHAPES)
    .filter((k) => k !== shape)
    .map((k) => ({
      x: ts, y: curves[k], type: 'scatter', mode: 'lines',
      line: { color: SHAPES[k].color, width: 1.5, dash: 'dot' },
      opacity: 0.5, hoverinfo: 'skip', name: SHAPES[k].label,
    }));
  const traces = [
    ...ghostTraces,
    {
      x: ts.slice(0, idx + 1), y: activeCurve.slice(0, idx + 1), type: 'scatter', mode: 'lines',
      line: { width: 0 }, fill: 'tozeroy', fillcolor: 'rgba(224,102,102,0.28)', hoverinfo: 'skip',
    },
    {
      x: ts, y: activeCurve, type: 'scatter', mode: 'lines',
      line: { color: shapeDef.color, width: 2.6 }, hoverinfo: 'skip', name: shapeDef.label,
    },
    {
      x: [ts[idx]], y: [activeCurve[idx]], type: 'scatter', mode: 'markers',
      marker: { color: '#FFFFFF', size: 9, line: { color: shapeDef.color, width: 2 } }, hoverinfo: 'skip',
    },
  ];
  // shared y-range so the ghosts are comparable (all share the same area)
  const yMax = Math.max(...Object.keys(SHAPES).map((k) => (dpMag / contactT) * SHAPES[k].peak / 1000)) * 1.08;
  const layout = {
    showlegend: false,
    margin: { l: 58, r: 16, t: 12, b: 44 },
    xaxis: { title: { text: 'Contact time (ms)' }, range: [0, contactT * 1000], zeroline: false },
    yaxis: {
      title: { text: 'Force (kN)' }, range: [0, yMax], autorange: false,
      zeroline: true, zerolinecolor: '#2A3442',
    },
    annotations: [{
      x: (contactT * 1000) * 0.5, y: (Fpeak / 1000) * 0.35, xref: 'x', yref: 'y',
      text: 'area = Δp (same for all 3 shapes)', showarrow: false, font: { color: TEXT, size: 12 },
    }],
  };

  // g-gauge band segmentation (green → amber → red) and needle position
  const gaugeMax = Math.max(G_LIMIT * 1.4, gPeak * 1.05);
  const gPeakFrac = Math.min(1, gPeak / gaugeMax);
  const gNowFrac = Math.min(1, Math.max(0, gNow) / gaugeMax);
  const gVerdict = gPeak <= G_SAFE ? 'survivable' : gPeak <= G_LIMIT ? 'injury risk' : 'lethal';
  const gVerdictColor = gPeak <= G_SAFE ? GREEN : gPeak <= G_LIMIT ? AMBER : RED;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Vehicle mass" value={m} min={400} max={2500} step={100} unit="kg" onChange={setM} />
        <Slider label="Impact speed" value={v0} min={2} max={25} step={1} unit="m/s" onChange={setV0} />
        <div className="border-t border-usna-grid pt-3">
          <Slider label="Cushion (bumper)" value={Number(cushion.toFixed(2))} min={0} max={1} step={0.01} unit="" onChange={setCushion} />
          <p className="text-usna-muted text-xs -mt-2 mb-3">
            0 = rigid wall · 1 = soft crumple / airbag
          </p>
        </div>

        <div className="mb-3">
          <div className="text-usna-text text-sm mb-1">Force profile (same area)</div>
          <div className="flex flex-col gap-1">
            {Object.keys(SHAPES).map((k) => (
              <button
                key={k}
                onClick={() => setShape(k)}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors text-left ${
                  shape === k
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:text-usna-gold'
                }`}
              >
                {SHAPES[k].label}
              </button>
            ))}
          </div>
          <p className="text-usna-muted text-xs mt-1">Others show as ghosts — same Δp, different peak.</p>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="text-usna-muted text-xs">or scrub contact</span>
        </div>
        <Slider label="Contact progress" value={Number(scrub.toFixed(2))} min={0} max={1} step={0.01} unit=""
                onChange={(v) => { setPlaying(false); scrubRef.current = v; setScrub(v); }} />

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Δp = m·v₀" value={dpMag.toFixed(0)} unit="kg·m/s" />
          <Readout label="∫F dt so far" value={impulseSoFar.toFixed(0)} unit="kg·m/s" />
          <Readout label="Contact time" value={(contactT * 1000).toFixed(0)} unit="ms" />
          <Readout label="Peak force" value={(Fpeak / 1000).toFixed(1)} unit="kN" />
          <Readout label="Peak accel" value={gPeak.toFixed(1)} unit="g" />
          <Readout label="Speed now" value={vNow.toFixed(1)} unit="m/s" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 240, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>

        {/* Occupant g-force gauge with a survivable-threshold band */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-usna-text text-sm font-medium">Occupant g-force</div>
            <div className="font-mono text-sm" style={{ color: gVerdictColor }}>
              {gPeak.toFixed(0)} g · {gVerdict}
            </div>
          </div>
          {/* horizontal band: green up to G_SAFE, amber to G_LIMIT, red beyond */}
          <div className="relative h-6 rounded-sm overflow-hidden border border-usna-grid"
               style={{
                 background: `linear-gradient(to right,
                   ${GREEN} 0%, ${GREEN} ${(G_SAFE / gaugeMax) * 100}%,
                   ${AMBER} ${(G_SAFE / gaugeMax) * 100}%, ${AMBER} ${(G_LIMIT / gaugeMax) * 100}%,
                   ${RED} ${(G_LIMIT / gaugeMax) * 100}%, ${RED} 100%)`,
               }}>
            {/* peak marker (bright bar) */}
            <div className="absolute top-0 bottom-0" style={{ left: `${gPeakFrac * 100}%`, width: 3, background: TEXT }} />
            {/* live needle during a contact */}
            <div className="absolute top-0 bottom-0" style={{ left: `${gNowFrac * 100}%`, width: 2, background: 'rgba(13,19,33,0.85)' }} />
          </div>
          <div className="flex justify-between text-usna-muted text-xs mt-1">
            <span>0 g</span>
            <span style={{ color: GREEN }}>{G_SAFE} g safe</span>
            <span style={{ color: AMBER }}>{G_LIMIT} g limit</span>
            <span>{gaugeMax.toFixed(0)} g</span>
          </div>
          <p className="text-usna-muted text-xs mt-2">
            The peak marker slides left as you add cushion or soften the profile — the airbag argument, in g.
          </p>
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 300 }}>
          <IntensityPlot traces={traces} layoutOverrides={layout} />
        </div>
        <InfoPanel {...INFO.impulse} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE 3 · 2D glancing collision — components conserved; 90° for equal-mass.
// ═══════════════════════════════════════════════════════════════════════════
const D3 = { m1: 1, m2: 1, v0: 6, b: 0.4, e: 1 };

function TwoDMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const insetRef = useRef(null);
  const insetCanvasRef = useRef(null);

  const [m1, setM1] = useState(D3.m1);
  const [m2, setM2] = useState(D3.m2);
  const [v0, setV0] = useState(D3.v0);         // incoming speed of ball 1
  const [b, setB] = useState(D3.b);            // impact parameter, 0..1 (× radius sum)
  const [e, setE] = useState(D3.e);
  const [playing, setPlaying] = useState(true);

  const reset = () => {
    setM1(D3.m1); setM2(D3.m2); setV0(D3.v0); setB(D3.b); setE(D3.e); setPlaying(true);
    resetSimRef.current && resetSimRef.current();
  };
  const resetSimRef = useRef(null);
  const applyBilliards = () => { setM1(1); setM2(1); setE(1); setB(0.4); resetSimRef.current && resetSimRef.current(); };

  // Analytic 2D restitution outcome (ball 2 initially at rest). Returns the
  // post-collision velocity vectors and the opening angle between them.
  const R = 22; // px radius (also used for the impact-parameter geometry)
  const outcome = useMemo(() => computeOutcome(m1, m2, v0, b, e, R), [m1, m2, v0, b, e]);

  const paramRef = useRef();
  paramRef.current = { m1, m2, v0, b, e, playing, outcome };

  // momentum-component bookkeeping for the bars (analytic, always consistent)
  const pxIn = m1 * v0, pyIn = 0;
  const p1x = m1 * outcome.v1x, p1y = m1 * outcome.v1y;
  const p2x = m2 * outcome.v2x, p2y = m2 * outcome.v2y;
  const pxOut = p1x + p2x;
  const pyOut = p1y + p2y;
  const pScale = Math.max(1, Math.abs(pxIn)) * 1.1;

  // ── main overhead canvas ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    let x1, y1, x2, y2, vx1, vy1, vx2, vy2, collided, flash, sim;
    const trail1 = [], trail2 = [];

    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const doReset = () => {
      const p = paramRef.current;
      sim = 0; collided = false; flash = 0;
      trail1.length = 0; trail2.length = 0;
      const cy = H * 0.5;
      // ball 2 sits at rest near screen centre-right; ball 1 comes in from the
      // left offset vertically by the impact parameter so it glances ball 2.
      x2 = W * 0.62; y2 = cy;
      const impact = p.b * 2 * R;      // vertical offset of ball 1's line
      x1 = W * 0.1; y1 = cy - impact;
      vx1 = p.v0 * 60; vy1 = 0;        // scale to px/s
      vx2 = 0; vy2 = 0;
    };
    resetSimRef.current = doReset;

    // resolve the collision along the actual contact normal. This uses the SAME
    // restitution algebra as computeOutcome and conserves BOTH components of
    // momentum for every e and any mass ratio (verify: y-bar stays zero).
    const resolveContact = () => {
      const p = paramRef.current;
      const dx = x2 - x1, dy = y2 - y1;
      const dist = Math.hypot(dx, dy) || 1e-9;
      const nx = dx / dist, ny = dy / dist;             // contact normal
      const tx = -ny, ty = nx;                          // tangent
      // decompose both balls onto normal / tangent
      const v1n = vx1 * nx + vy1 * ny, v1t = vx1 * tx + vy1 * ty;
      const v2n = vx2 * nx + vy2 * ny, v2t = vx2 * tx + vy2 * ty;
      const M = p.m1 + p.m2;
      const pN = p.m1 * v1n + p.m2 * v2n;               // normal momentum
      // 1D restitution along the normal (tangential components unchanged)
      const v1nA = (pN - p.m2 * p.e * (v1n - v2n)) / M;
      const v2nA = (pN + p.m1 * p.e * (v1n - v2n)) / M;
      vx1 = v1nA * nx + v1t * tx; vy1 = v1nA * ny + v1t * ty;
      vx2 = v2nA * nx + v2t * tx; vy2 = v2nA * ny + v2t * ty;
      // separate to remove overlap
      const overlap = 2 * R - dist;
      if (overlap > 0) {
        x1 -= nx * overlap / 2; y1 -= ny * overlap / 2;
        x2 += nx * overlap / 2; y2 += ny * overlap / 2;
      }
    };

    const draw = (now) => {
      if (sim === undefined) { doReset(); lastNow = now; }
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      const p = paramRef.current;

      if (p.playing) {
        sim += dt;
        // substep the integration so a fast ball can't tunnel past ball 2 in a
        // single frame (continuous-collision guard): cap motion per substep to
        // a fraction of the radius.
        const speed = Math.max(Math.hypot(vx1, vy1), Math.hypot(vx2, vy2));
        const nSub = Math.max(1, Math.min(64, Math.ceil((speed * dt) / (R * 0.4))));
        const sub = dt / nSub;
        for (let s = 0; s < nSub && p.playing; s++) {
          x1 += vx1 * sub; y1 += vy1 * sub;
          x2 += vx2 * sub; y2 += vy2 * sub;
          const dx = x2 - x1, dy = y2 - y1;
          const dist = Math.hypot(dx, dy);
          if (!collided && dist <= 2 * R && (vx1 * dx + vy1 * dy) - (vx2 * dx + vy2 * dy) > 0) {
            resolveContact();
            collided = true; flash = 1;
            clickSound(Math.min(1.3, p.v0 / 8));
          }
        }
      }

      const off = (x, y) => x < -60 || x > W + 60 || y < -60 || y > H + 60;
      if (sim > 8 || (collided && off(x1, y1) && off(x2, y2))) doReset();
      flash = Math.max(0, flash - dt * 3);

      // trails
      if (p.playing) {
        trail1.push([x1, y1]); trail2.push([x2, y2]);
        if (trail1.length > 60) trail1.shift();
        if (trail2.length > 60) trail2.shift();
      }

      // ── render ──
      ctx.clearRect(0, 0, W, H);

      // faint grid
      ctx.strokeStyle = 'rgba(26,35,50,0.7)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // trails — faint, slim dots so the balls' edges stay clear
      const drawTrail = (tr, rgb) => {
        for (let i = 0; i < tr.length; i++) {
          const a = (i / tr.length) * 0.16;
          ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(tr[i][0], tr[i][1], R * 0.32, 0, 2 * Math.PI); ctx.fill();
        }
      };
      drawTrail(trail1, '197,183,131');
      drawTrail(trail2, '91,155,213');

      // flash
      if (flash > 0.01) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const rad = 20 + 40 * (1 - flash);
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, rad);
        g.addColorStop(0, `rgba(255,255,255,${(0.5 * flash).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(mx, my, rad, 0, 2 * Math.PI); ctx.fill();
      }

      // balls
      const ball = (x, y, color, label) => {
        ctx.beginPath(); ctx.arc(x, y, R, 0, 2 * Math.PI);
        ctx.fillStyle = color; ctx.fill();
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillStyle = DEEP; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
        ctx.textBaseline = 'alphabetic';
      };
      ball(x2, y2, BLUE, '2');
      ball(x1, y1, GOLD, '1');

      // momentum vectors with x/y component decomposition (post-collision only,
      // when both are moving, so the independent-component point lands)
      const drawP = (x, y, vx, vy, m, color) => {
        const sc = 0.14;
        const px = vx * m * sc, py = vy * m * sc;
        if (Math.hypot(px, py) < 4) return;
        // components (faint)
        ctx.strokeStyle = 'rgba(240,236,227,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + px, y); ctx.lineTo(x + px, y + py); ctx.stroke();
        ctx.setLineDash([]);
        drawArrow(ctx, { x, y, dx: px, dy: py, color, width: 3, head: 10 });
      };
      if (collided) {
        drawP(x1, y1, vx1, vy1, p.m1, GOLD);
        drawP(x2, y2, vx2, vy2, p.m2, BLUE);
      } else {
        // incoming momentum on ball 1
        drawP(x1, y1, vx1, vy1, p.m1, GOLD);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => { resize(); doReset(); });
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── vector-sum inset: p_in with p1_out and p2_out laid tip-to-tail on it ──
  // Rebuilds whenever the analytic momenta change; static (no animation loop).
  useEffect(() => {
    const canvas = insetCanvasRef.current;
    const wrap = insetRef.current;
    if (!canvas || !wrap) return;
    let ctx;

    const render = () => {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      ctx.clearRect(0, 0, W, H);

      // scale so p_in spans most of the width; +y up (physics) → negate for canvas
      const mag = Math.max(Math.abs(pxIn), Math.hypot(p1x, p1y) + Math.hypot(p2x, p2y), 1e-6);
      const sc = (W * 0.72) / mag;
      const ox = W * 0.14, oy = H * 0.5;   // origin (tail of p_in)
      const CY = (py) => oy - py * sc;     // physics +y up

      // faint axes
      ctx.strokeStyle = 'rgba(26,35,50,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();

      // p_in (the target the triangle must close on) — bright reference
      drawArrow(ctx, { x: ox, y: CY(0), dx: pxIn * sc, dy: 0, color: GREEN, width: 3.5, head: 12, label: 'p_in' });

      // p1_out from the origin
      drawArrow(ctx, { x: ox, y: CY(0), dx: p1x * sc, dy: -p1y * sc, color: GOLD, width: 3, head: 11, label: 'p₁' });
      // p2_out from the tip of p1_out (tip-to-tail) → lands on the tip of p_in
      const tipX = ox + p1x * sc, tipY = CY(p1y);
      drawArrow(ctx, { x: tipX, y: tipY, dx: p2x * sc, dy: -p2y * sc, color: BLUE, width: 3, head: 11, label: 'p₂' });

      // closure dot: where p1+p2 ends should coincide with p_in's tip
      const endX = tipX + p2x * sc, endY = tipY - p2y * sc;
      ctx.fillStyle = TEXT;
      ctx.beginPath(); ctx.arc(endX, endY, 4, 0, 2 * Math.PI); ctx.fill();

      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED; ctx.textAlign = 'left';
      ctx.fillText('p₁ + p₂ = p_in  (one closed triangle)', 8, H - 8);
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [pxIn, p1x, p1y, p2x, p2y]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Mass 1 (moving)" value={m1} min={0.5} max={4} step={0.5} unit="kg" onChange={setM1} />
        <Slider label="Mass 2 (at rest)" value={m2} min={0.5} max={4} step={0.5} unit="kg" onChange={setM2} />
        <Slider label="Speed of 1" value={v0} min={2} max={12} step={0.5} unit="m/s" onChange={setV0} />
        <Slider label="Impact parameter" value={Number(b.toFixed(2))} min={0} max={0.98} step={0.02} unit="" onChange={setB} />
        <p className="text-usna-muted text-xs -mt-2 mb-3">0 = dead-on · 1 = just grazing</p>
        <div className="border-t border-usna-grid pt-3">
          <Slider label="Elasticity (e)" value={e} min={0} max={1} step={0.01} unit="" onChange={setE} />
        </div>

        <button
          onClick={applyBilliards}
          className="w-full mb-3 px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
        >
          Preset: equal-mass elastic (90°)
        </button>

        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            onClick={() => resetSimRef.current && resetSimRef.current()}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:text-usna-gold transition-colors"
          >
            ↺ Replay
          </button>
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Opening angle" value={outcome.openAngle.toFixed(0)} unit="°" />
          <Readout label="Scatter of 1" value={outcome.a1.toFixed(0)} unit="°" />
          <Readout label="Recoil of 2" value={outcome.a2.toFixed(0)} unit="°" />
          <div className="mt-1 pt-1 border-t border-usna-grid">
            <Readout label="pₓ in → out" value={`${pxIn.toFixed(1)}→${pxOut.toFixed(1)}`} unit="" />
            <Readout label="p_y in → out" value={`${pyIn.toFixed(1)}→${pyOut.toFixed(1)}`} unit="" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 360, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>

        {/* vector-sum inset: the conservation triangle */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
          <div className="text-usna-text text-sm font-medium mb-2">Momentum triangle</div>
          <div ref={insetRef} className="relative min-w-0 overflow-hidden" style={{ height: 140 }}>
            <canvas ref={insetCanvasRef} className="block" />
          </div>
          <p className="text-usna-muted text-xs mt-2">
            Lay the two outgoing momenta tip-to-tail: they close exactly on the incoming p_in — momentum conservation as one triangle.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 bg-usna-card border border-usna-grid rounded-lg p-4">
            <div className="text-usna-text text-sm font-medium mb-3">x-momentum (kg·m/s)</div>
            <EnergyBars
              items={[
                { label: 'p₁ₓ', value: Math.abs(p1x), color: GOLD },
                { label: 'p₂ₓ', value: Math.abs(p2x), color: BLUE },
                { label: 'Σpₓ', value: Math.abs(pxOut), color: GREEN },
              ]}
              max={pScale}
              total={Math.abs(pxIn)}
              height={160}
            />
          </div>
          <div className="flex-1 bg-usna-card border border-usna-grid rounded-lg p-4">
            <div className="text-usna-text text-sm font-medium mb-3">y-momentum (kg·m/s)</div>
            <EnergyBars
              items={[
                { label: '|p₁ᵧ|', value: Math.abs(p1y), color: GOLD },
                { label: '|p₂ᵧ|', value: Math.abs(p2y), color: BLUE },
                { label: 'Σpᵧ', value: Math.abs(pyOut), color: GREEN },
              ]}
              max={pScale}
              total={0}
              height={160}
            />
            <p className="text-usna-muted text-xs mt-2">
              y started at zero and stays zero for every e and any mass ratio: the two vertical kicks cancel.
            </p>
          </div>
        </div>

        <InfoPanel {...INFO['2d']} />
      </div>
    </div>
  );
}

// Analytic outcome of a 2D collision, ball 2 initially at rest, ball 1 moving
// along +x at speed v0. `b` ∈ [0,1] scales the impact parameter by (R1+R2)=2R.
// Returns post velocities and the relevant angles (degrees). Conserves both
// momentum components for every e and any mass ratio.
function computeOutcome(m1, m2, v0, b, e, R) {
  // impact parameter distance
  const bDist = b * 2 * R;
  const sinPhi = Math.max(-1, Math.min(1, bDist / (2 * R))); // = b
  const phi = Math.asin(sinPhi);            // angle of collision normal to +x
  const nx = Math.cos(phi), ny = Math.sin(phi);
  const tx = -ny, ty = nx;                    // tangent unit
  // ball 1 incoming velocity (+x); components along normal / tangent
  const v1n = v0 * nx, v1t = v0 * tx;         // (v0,0)·n and (v0,0)·t
  const v2n = 0, v2t = 0;                     // ball 2 at rest
  const M = m1 + m2;
  const pN = m1 * v1n + m2 * v2n;
  // 1D restitution along the normal; tangential components ride through
  const v1nAfter = (pN - m2 * e * (v1n - v2n)) / M;
  const v2nAfter = (pN + m1 * e * (v1n - v2n)) / M;
  // back to xy
  const v1x = v1nAfter * nx + v1t * tx;
  const v1y = v1nAfter * ny + v1t * ty;
  const v2x = v2nAfter * nx + v2t * tx;
  const v2y = v2nAfter * ny + v2t * ty;

  const a1 = angleDeg(v1x, v1y);
  const a2 = angleDeg(v2x, v2y);
  const s1 = Math.hypot(v1x, v1y), s2 = Math.hypot(v2x, v2y);
  let openAngle = 0;
  if (s1 > 1e-6 && s2 > 1e-6) {
    const cosO = (v1x * v2x + v1y * v2y) / (s1 * s2);
    openAngle = (Math.acos(Math.max(-1, Math.min(1, cosO))) * 180) / Math.PI;
  }
  return { v1x, v1y, v2x, v2y, a1: Math.abs(a1), a2: Math.abs(a2), openAngle };
}

function angleDeg(x, y) {
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// ── info copy (names the counterintuitive moment + key equation per mode) ──
const INFO = {
  '1d': {
    title: 'Two conservation laws, two behaviors',
    description:
      'Momentum is conserved in every collision — the total-momentum (Σp) bar sits exactly on the constant-total line no matter how you set elasticity, and you can now drag the elasticity slider WHILE the carts are touching to watch the outcome re-resolve live. Kinetic energy is different: it is only conserved when e = 1. The stuck-together (e = 0) case loses the most energy, yet still carries the exact same momentum. Switch to the center-of-mass frame: there the total momentum is literally zero (the carts approach and recede symmetrically about the dashed line) and yet the KE bar STILL collapses — proof that the energy loss is frame-independent while the momentum "cancellation" is just a choice of reference frame.',
    equation: String.raw`\sum m_i v_i = \text{const always}, \qquad \sum \tfrac12 m_i v_i^2 = \text{const only if } e=1`,
  },
  impulse: {
    title: 'Same Δp, softer force — the airbag',
    description:
      'The shaded area under the force–time curve is the impulse, and it equals the change in momentum Δp = m·v₀. That area is fixed by the crash: the wall must remove all of the car\'s momentum. Slide the cushion from rigid to soft and the contact time stretches — but because the area is fixed, the curve gets lower and wider, so the PEAK force plummets. The occupant g-gauge turns that peak into a number and colors it against a survivable band: a soft, spread-out contact keeps you in the green. And the three same-area profiles show it is not just duration — a rigid rectangular pulse peaks lower than a triangular crumple of the same length, because peak force depends on the SHAPE of F(t), not merely how long contact lasts.',
    equation: String.raw`\vec{J} = \int \vec{F}\,dt = \Delta \vec{p} \;\Rightarrow\; F_{\text{peak}} \sim \frac{\Delta p}{\Delta t}`,
  },
  '2d': {
    title: 'x and y are conserved independently',
    description:
      'Momentum conservation is a vector statement: the x-components conserve on their own and the y-components conserve on their own — for any elasticity and any mass ratio. The incoming ball has zero y-momentum, so after the glance the two balls carry equal-and-opposite vertical kicks that sum back to zero (watch the y-bar stay pinned to zero even for e < 1 with unequal masses). The momentum triangle makes it geometric: laying p₁_out and p₂_out tip-to-tail closes exactly on p_in. Load the equal-mass elastic preset: for any impact parameter the two balls leave at a 90° opening angle — the classic billiards / cue-ball fact — because with equal masses the outgoing velocity vectors must be perpendicular.',
    equation: String.raw`\sum p_x = \text{const}, \quad \sum p_y = \text{const}; \quad m_1=m_2,\,e=1 \Rightarrow \theta_1+\theta_2 = 90^\circ`,
  },
};
