import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D34 · Buoyancy Tank — L33 (pressure), L34 (buoyancy).
 *
 * A tank of fluid, drawn in cross-section on a canvas, used for two lessons.
 *
 *   pressure : drag a depth probe through the fluid and read the absolute
 *              pressure P = P0 + ρgh. A small submerged test surface carries
 *              pressure arrows pushing in from EVERY direction (bigger from
 *              below than from above) — pressure is not "downward," it's the
 *              same in all directions at a point, and the up/down imbalance
 *              across a finite body is exactly what buoyancy is. The net of the
 *              four face arrows is drawn as a single upward resultant, labeled
 *              "= F_B for this element" — the top-minus-bottom mismatch, made
 *              into one vector. A fluid selector (fresh water / seawater /
 *              mercury) rescales the whole gradient and darkens with depth.
 *
 *   buoyancy : an object with an adjustable density is lowered in. It sinks,
 *              floats at the surface with the CORRECT submerged fraction
 *              (ρ_obj/ρ_fluid), or hovers neutrally when the densities match.
 *              The displaced volume is drawn as a "ghost" block beside the
 *              tank, and F_B = ρ_fluid · V_disp · g is read straight off it —
 *              Archimedes as bookkeeping. You can DRAG the object down and
 *              release it: it springs back to the equilibrium waterline (a
 *              restoring experiment, not a scripted animation). A submarine
 *              ballast slider slides the boat's mean density through neutral;
 *              a depth-compression toggle shrinks the hull with depth so the
 *              mean density climbs as it dives — the runaway sink real subs
 *              fight below neutral. An iceberg preset settles at ~90% in
 *              seawater; a steel-in-mercury preset bobs at ~58% — the
 *              density-is-relative punchline.
 *
 * SI units internally.
 *
 * FLOATING REST STATE (the fix that matters): a freely floating body must
 * settle so the *geometric* submerged fraction equals the *analytic* value
 * ρ_obj/ρ_fluid, with F_B = W and net force exactly 0 at rest. We enforce this
 * by (a) driving the block's vertical dynamics from the true geometric
 * submerged fraction, and (b) computing the reported F_B, W, submerged % and
 * net from that SAME geometric fraction — so once the motion stops there is no
 * residual mismatch between "what's drawn" and "what's labeled." The block's
 * physical height in meters is chosen so the equilibrium waterline for the
 * lightest preset (cork, ~24%) sits comfortably inside the object, and the
 * hard tank floor is never the thing that stops a floater.
 *
 * The settle uses an accumulated-sim / bounded-dt loop with mild linear drag so
 * the object comes to rest instead of oscillating forever.
 *
 * RULES OF HOOKS: the default export is a hook-free wrapper that dispatches to
 * per-mode child components; each child owns all of its hooks. No hook is ever
 * called conditionally or after an early return.
 */

// ── physics constants ───────────────────────────────────────────────────────
const G = 9.81; // m/s²
const P_ATM = 101325; // Pa (1 atm)

// Fluid densities (kg/m³). Ordered light → heavy for the gradient scaling.
const FLUIDS = {
  fresh: { key: 'fresh', label: 'Fresh water', rho: 1000, tint: [60, 130, 210] },
  sea: { key: 'sea', label: 'Seawater', rho: 1025, tint: [40, 150, 150] },
  mercury: { key: 'mercury', label: 'Mercury', rho: 13534, tint: [150, 155, 165] },
};

// Buoyancy presets: object mean density (kg/m³) + fluid.
// `steel-hg` is the WOW case — the same steel that sinks in water floats in
// mercury (13534) at ρ_obj/ρ_fl ≈ 7850/13534 ≈ 58% submerged.
const PRESETS = {
  cork: { label: 'Cork', rho: 240, fluid: 'fresh' },
  wood: { label: 'Pine wood', rho: 500, fluid: 'fresh' },
  ice: { label: 'Iceberg (seawater)', rho: 917, fluid: 'sea' },
  steel: { label: 'Steel (water)', rho: 7850, fluid: 'fresh' },
  'steel-hg': { label: 'Steel in mercury', rho: 7850, fluid: 'mercury' },
};

const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const NAVY = '#0D1321';
const BUOY_BLUE = '#5B9BD5';
const WEIGHT_AMBER = '#E8B04B';
const NET_GREEN = '#7FB77E';

// clamp helper
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Read a CSS custom property with fallback (lets canvas track the theme).
function cssVar(name, fallback) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ── hook-free wrapper: branch by mode ───────────────────────────────────────
export default function BuoyancyTank({ mode = 'pressure' }) {
  if (mode === 'buoyancy') return <BuoyancyMode />;
  return <PressureMode />;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  PRESSURE MODE (L33)
 * ════════════════════════════════════════════════════════════════════════ */
function PressureMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [fluidKey, setFluidKey] = useState('sea');
  const [depth, setDepth] = useState(10); // m below surface (probe)
  const [surfaceOffset, setSurfaceOffset] = useState(1); // atm at surface (multiplier of P_ATM)

  // refs mirror state so the rAF loop reads live values without re-subscribing
  const fluidRef = useRef(fluidKey); fluidRef.current = fluidKey;
  const depthRef = useRef(depth); depthRef.current = depth;
  const surfRef = useRef(surfaceOffset); surfRef.current = surfaceOffset;

  const MAX_DEPTH = 50; // m — tank models 50 m of water column

  const reset = () => { setFluidKey('sea'); setDepth(10); setSurfaceOffset(1); };

  // Derived readouts (recomputed on render; cheap).
  const fluid = FLUIDS[fluidKey];
  const P0 = surfaceOffset * P_ATM;
  const P = P0 + fluid.rho * G * depth; // absolute pressure at the probe
  const gauge = P - P_ATM; // gauge pressure
  const P_kPa = P / 1000;
  const atm = P / P_ATM;

  // The test element is a small cube; its physical side length sets both the
  // ΔP across its height and its displaced volume, so the drawn net resultant
  // and the reported F_B agree. Side chosen so numbers read cleanly (~0.2 m).
  const ELEM_SIDE = 0.2; // m
  const V_elem = ELEM_SIDE ** 3; // m³
  // Buoyant force on the element = ρ g V (Archimedes) = (P_bot − P_top)·A.
  const FB_elem = fluid.rho * G * V_elem;

  // Drag handling: map pointer y on the canvas to a depth. We stash the geometry
  // published from the draw loop so the pointer math matches what's on screen.
  const geomRef = useRef({ surfY: 0, botY: 0 });
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;
    const padTop = 30, padBottom = 30, padX = 30;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = () => {
      const grid = cssVar('--color-grid', '#1A2332');
      const fl = FLUIDS[fluidRef.current];
      const d = depthRef.current;
      const surfMult = surfRef.current;

      const surfY = padTop + (H - padTop - padBottom) * 0.16;
      const botY = H - padBottom;
      const waterH = botY - surfY;
      geomRef.current = { surfY, botY };

      const yOfDepth = (m) => surfY + (m / MAX_DEPTH) * waterH;
      const probeY = yOfDepth(d);

      ctx.clearRect(0, 0, W, H);

      // background
      ctx.fillStyle = NAVY;
      ctx.fillRect(0, 0, W, H);

      // air dots above surface
      ctx.fillStyle = grid;
      for (let gx = padX; gx <= W - padX; gx += 22)
        for (let gy = padTop; gy < surfY - 2; gy += 22) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, 2 * Math.PI); ctx.fill();
        }

      // water column: darker with depth (pressure grows). Density scales the
      // maximum darkness so mercury reads visibly "heavier" than fresh water.
      const [r, g, b] = fl.tint;
      const heavy = clamp(Math.log10(fl.rho / 1000 + 1) / Math.log10(14), 0.25, 1); // 0..1 by density
      const wg = ctx.createLinearGradient(0, surfY, 0, botY);
      wg.addColorStop(0, `rgba(${r},${g},${b},${0.28})`);
      wg.addColorStop(1, `rgba(${Math.round(r * 0.4)},${Math.round(g * 0.4)},${Math.round(b * 0.4)},${0.55 + 0.4 * heavy})`);
      ctx.fillStyle = wg;
      ctx.fillRect(padX, surfY, W - 2 * padX, waterH);

      // surface line
      ctx.strokeStyle = `rgba(${r + 60},${g + 60},${b + 40},0.9)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(padX, surfY); ctx.lineTo(W - padX, surfY); ctx.stroke();

      // depth tick marks + labels on the right wall
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let m = 0; m <= MAX_DEPTH; m += 10) {
        const y = yOfDepth(m);
        ctx.strokeStyle = 'rgba(240,236,227,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W - padX, y); ctx.lineTo(W - padX - 8, y); ctx.stroke();
        ctx.fillStyle = MUTED;
        ctx.fillText(`${m} m`, W - padX - 12, y);
      }

      // tank walls
      ctx.strokeStyle = grid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, padTop); ctx.lineTo(padX, botY);
      ctx.lineTo(W - padX, botY); ctx.lineTo(W - padX, padTop);
      ctx.stroke();

      // ── the test surface: a small square element at the probe depth, with
      //    pressure arrows pushing IN from all sides. Arrow length ∝ local P,
      //    and bottom > top (that difference is buoyancy). ────────────────────
      const cx = W * 0.42;
      const half = clamp(Math.min(W, H) * 0.05, 16, 34);
      const P0loc = surfMult * P_ATM;
      const Pcenter = P0loc + fl.rho * G * d;
      // ΔP across half the element height, using the element's PHYSICAL side so
      // the pressure difference matches the reported buoyant force.
      const dP = fl.rho * G * (ELEM_SIDE / 2);

      // normalize arrow lengths against the deepest, heaviest case so they stay
      // on-screen for mercury yet remain visible for fresh water near the top.
      const Pref = P0loc + FLUIDS.mercury.rho * G * MAX_DEPTH;
      const arrowScale = (p) => clamp((p / Pref), 0.06, 1) * (half * 2.6);

      const pTop = Pcenter - dP;
      const pBot = Pcenter + dP;
      const pSide = Pcenter;

      // element body
      ctx.fillStyle = 'rgba(197,183,131,0.16)';
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      ctx.fillRect(cx - half, probeY - half, half * 2, half * 2);
      ctx.strokeRect(cx - half, probeY - half, half * 2, half * 2);

      // arrows point inward toward the element; screen +y is DOWN.
      const aTop = arrowScale(pTop);
      const aBot = arrowScale(pBot);
      const aSide = arrowScale(pSide);
      // top face: fluid above pushes DOWN (into element)
      drawArrow(ctx, { x: cx, y: probeY - half - aTop, dx: 0, dy: aTop, color: BUOY_BLUE, width: 3, head: 8 });
      // bottom face: fluid below pushes UP (into element) — longest arrow
      drawArrow(ctx, { x: cx, y: probeY + half + aBot, dx: 0, dy: -aBot, color: BUOY_BLUE, width: 3, head: 8 });
      // left face: pushes RIGHT
      drawArrow(ctx, { x: cx - half - aSide, y: probeY, dx: aSide, dy: 0, color: 'rgba(91,155,213,0.7)', width: 2.5, head: 7 });
      // right face: pushes LEFT
      drawArrow(ctx, { x: cx + half + aSide, y: probeY, dx: -aSide, dy: 0, color: 'rgba(91,155,213,0.7)', width: 2.5, head: 7 });

      // ── NET upward resultant of the four face arrows ───────────────────────
      // Left/right cancel exactly; top pushes down, bottom pushes up, and the
      // bottom is bigger — so the sum is a single UPWARD vector. That vector is
      // the buoyant force on this element: F_B = (P_bot − P_top)·A = ρgV. We
      // draw it from the element's right side so it doesn't overlap the faces.
      const netLen = aBot - aTop; // upward magnitude in the same px scale
      if (netLen > 1) {
        const nx = cx + half + aSide + 34; // right of the side arrow
        drawArrow(ctx, {
          x: nx, y: probeY + netLen / 2,
          dx: 0, dy: -netLen,
          color: NET_GREEN, width: 4, head: 12,
        });
        ctx.fillStyle = NET_GREEN;
        ctx.font = 'bold 12px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('net ↑', nx + 12, probeY - netLen / 2 - 2);
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText('= F_B for', nx + 12, probeY);
        ctx.fillText('this element', nx + 12, probeY + 14);
      }

      // ── the draggable probe: a horizontal indicator line spanning the tank,
      //    with a grab handle on the left wall ────────────────────────────────
      ctx.strokeStyle = 'rgba(240,236,227,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, probeY); ctx.lineTo(W - padX, probeY); ctx.stroke();
      ctx.setLineDash([]);

      // handle
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(padX + 12, probeY, 9, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = NAVY;
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('↕', padX + 12, probeY + 0.5);

      // pressure label near the probe
      const Pkpa = Pcenter / 1000;
      ctx.fillStyle = TEXT;
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`P = ${Pkpa.toFixed(0)} kPa`, cx - half, probeY + half + 20);
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(`h = ${d.toFixed(1)} m`, cx - half, probeY + half + 24);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Pointer drag → depth. Uses the geometry published by the draw loop.
  const pointerToDepth = (clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    const { surfY, botY } = geomRef.current;
    if (botY <= surfY) return depthRef.current;
    const frac = clamp((y - surfY) / (botY - surfY), 0, 1);
    return frac * MAX_DEPTH;
  };
  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDepth(Number(pointerToDepth(e.clientY).toFixed(2)));
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    setDepth(Number(pointerToDepth(e.clientY).toFixed(2)));
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Fluid</div>
          <div className="flex flex-col gap-1.5">
            {Object.values(FLUIDS).map((f) => (
              <button
                key={f.key}
                onClick={() => setFluidKey(f.key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  fluidKey === f.key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {f.label} <span className="opacity-60">· {f.rho} kg/m³</span>
              </button>
            ))}
          </div>
        </div>

        <Slider label="Probe depth (h)" value={Number(depth.toFixed(1))} min={0} max={MAX_DEPTH} step={0.5} unit="m" onChange={setDepth} />
        <Slider label="Surface pressure (P₀)" value={surfaceOffset} min={1} max={5} step={0.5} unit="atm" onChange={setSurfaceOffset} />

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Absolute pressure P" value={P_kPa.toFixed(1)} unit="kPa" />
          <Readout label="…in atmospheres" value={atm.toFixed(2)} unit="atm" />
          <Readout label="Gauge pressure P − P₀ᵃᵗᵐ" value={(gauge / 1000).toFixed(1)} unit="kPa" />
          <Readout label="ρ g h term" value={((fluid.rho * G * depth) / 1000).toFixed(1)} unit="kPa" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label={`Net (F_B) on ${ELEM_SIDE} m cube`} value={FB_elem.toFixed(2)} unit="N" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 520 }}>
          <div ref={wrapRef} className="relative w-full h-full rounded-md overflow-hidden">
            <canvas
              ref={canvasRef}
              className="block touch-none cursor-ns-resize"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>
        <InfoPanel {...INFO.pressure} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 *  BUOYANCY MODE (L34)
 * ════════════════════════════════════════════════════════════════════════ */
function BuoyancyMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [fluidKey, setFluidKey] = useState('fresh');
  const [density, setDensity] = useState(500); // object mean density kg/m³
  const [ballast, setBallast] = useState(0); // submarine ballast fill 0..1 (adds to base hull density)
  const [subMode, setSubMode] = useState(false); // submarine framing on/off
  const [compress, setCompress] = useState(false); // depth-compression instability toggle
  const [readouts, setReadouts] = useState({ subFrac: 0, FB: 0, W: 0, net: 0, state: '—', effRho: 0 });

  const fluidRef = useRef(fluidKey); fluidRef.current = fluidKey;
  const densityRef = useRef(density); densityRef.current = density;
  const ballastRef = useRef(ballast); ballastRef.current = ballast;
  const subRef = useRef(subMode); subRef.current = subMode;
  const compressRef = useRef(compress); compressRef.current = compress;

  // Submarine model: dry hull is buoyant (~600), flooding ballast tanks pushes
  // the mean density up through the fluid density and beyond (dive).
  const SUB_DRY = 600, SUB_FLOODED = 1120;
  // Base (uncompressed) mean density before any depth-compression correction.
  const baseDensity = () =>
    subRef.current ? SUB_DRY + (SUB_FLOODED - SUB_DRY) * ballastRef.current : densityRef.current;

  // Depth-compression: a real hull is slightly compressible. As it dives, the
  // volume shrinks by a small fraction per meter, so with fixed mass the mean
  // density RISES with depth. Above neutral this is a stabilizing nudge toward
  // the surface; below neutral it is destabilizing — the deeper it goes, the
  // heavier (relatively) it gets, and the harder it sinks: the runaway dive.
  const COMPRESS_PER_M = 0.0015; // fractional volume loss per meter of depth
  const effDensityAtDepth = (depthM) => {
    const base = baseDensity();
    if (!(subRef.current && compressRef.current)) return base;
    const shrink = clamp(1 - COMPRESS_PER_M * Math.max(depthM, 0), 0.6, 1);
    return base / shrink; // ρ = m / (V·shrink)
  };

  const reset = () => {
    setFluidKey('fresh'); setDensity(500); setBallast(0);
    setSubMode(false); setCompress(false);
  };

  const applyPreset = (key) => {
    const p = PRESETS[key];
    setSubMode(false); setCompress(false);
    setFluidKey(p.fluid);
    setDensity(p.rho);
    setBallast(0);
  };

  const enterSub = () => {
    setSubMode(true);
    setFluidKey('sea');
    setBallast(0.35);
  };

  // Reported depth of the object's centroid (published from the loop) so DOM
  // readouts can show the compression state. Kept in a ref to avoid churn.
  const objDepthRef = useRef(0);

  // ── drag-to-release interaction ────────────────────────────────────────────
  // While dragging, the object is pinned to the pointer (velocity zeroed). On
  // release the simulation resumes and the restoring buoyant force springs it
  // back to equilibrium — an experiment, not a canned animation.
  const draggingRef = useRef(false);
  const objYRef = useRef(0);      // live center-y in px (shared with the loop)
  const objVyRef = useRef(0);     // live velocity in px/s (shared with the loop)
  const geomRef = useRef({ surf: 0, bot: 0, objHpx: 0, hardTop: 0, hardBot: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow, started = false, pubKey = '';
    const padTop = 26, padBottom = 26, padX = 26;

    // Object is a block; we track its center y in px. Its PHYSICAL height in
    // meters (OBJ_H_M) maps to px so the submerged fraction reads directly off
    // the geometry, and the meters↔px scale (PX_PER_M) sets the depth used by
    // depth-compression. The tank models a shallow test column.
    const objWpx = 130, objHpx = 74;
    const OBJ_H_M = 0.5; // object is 0.5 m tall physically

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const surfaceY = () => padTop + (H - padTop - padBottom) * 0.24;
    const bottomY = () => H - padBottom;
    const pxPerM = () => objHpx / OBJ_H_M; // px per meter (from the object height)

    const initPos = () => {
      // start floating high so light objects settle DOWN into equilibrium and
      // heavy ones sink — visually reads as "lowered in."
      objYRef.current = surfaceY() - objHpx * 0.1;
      objVyRef.current = 0;
      started = true;
    };

    const draw = (now) => {
      if (!started) { initPos(); lastNow = now; }
      let dt = (now - lastNow) / 1000; lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const grid = cssVar('--color-grid', '#1A2332');
      const fl = FLUIDS[fluidRef.current];
      const rhoFl = fl.rho;

      const surf = surfaceY();
      const bot = bottomY();
      const ppm = pxPerM();

      const hardBot = bot - objHpx / 2;
      const hardTop = padTop + objHpx / 2;

      let objY = objYRef.current;
      let objVy = objVyRef.current;

      // Submerged fraction FROM GEOMETRY (how much of the block is below surf).
      // This is the single source of truth: dynamics AND readouts use it, so at
      // rest the drawn waterline and the labeled fraction cannot disagree.
      const geomFrac = (yc) => {
        const topEdge = yc - objHpx / 2;
        const botEdge = yc + objHpx / 2;
        const subPx = clamp(botEdge - Math.max(surf, topEdge), 0, objHpx);
        return subPx / objHpx;
      };

      // Depth of the object centroid below the surface, in meters, for the
      // depth-compression model. Only positive when submerged.
      const objDepthM = Math.max(0, (objY - surf)) / ppm;
      objDepthRef.current = objDepthM;
      const rhoObj = effDensityAtDepth(objDepthM);

      // ── integrate the vertical dynamics (skip while the user is dragging) ──
      if (!draggingRef.current) {
        const subFrac = geomFrac(objY);
        // Newton per unit volume: a = g (ρ_fl · f_sub − ρ_obj) / ρ_obj (up +).
        // At the floating equilibrium f_sub = ρ_obj/ρ_fl this is exactly 0 —
        // so net force is genuinely zero at rest, not merely damped small.
        const aUp = G * (rhoFl * subFrac - rhoObj) / rhoObj; // m/s², +up
        const DRAG = 2.6;      // linear damping so it settles
        const TIME_RATE = 2.4; // settle faster than wall clock
        const pdt = dt * TIME_RATE;
        // screen +y is down; convert m/s² to px/s² with the true meters↔px scale
        objVy += (-aUp * ppm - DRAG * objVy) * pdt;
        objY += objVy * pdt;

        // constrain to tank
        if (objY > hardBot) { objY = hardBot; if (objVy > 0) objVy = 0; }
        if (objY < hardTop) { objY = hardTop; if (objVy < 0) objVy = 0; }
      } else {
        objVy = 0; // pinned to pointer
      }

      objYRef.current = objY;
      objVyRef.current = objVy;

      // publish geometry so pointer math matches the drawing
      geomRef.current = { surf, bot, objHpx, hardTop, hardBot };

      // ── reporting values, all from the SAME geometric fraction ────────────
      // (This is the fix: F_B, W, %, and net are computed from geomFrac, so at
      //  rest F_B = W and net → 0 with no residual mismatch.)
      const subFracGeom = geomFrac(objY);
      const V_total = 1; // reference m³ (consistent for the ghost + forces)
      const V_disp = subFracGeom * V_total;
      const FB = rhoFl * V_disp * G;   // Archimedes, from the drawn waterline
      const Wt = rhoObj * V_total * G;  // weight (uses depth-compressed density)
      const net = FB - Wt;

      // Analytic equilibrium fraction, for labeling the "should settle to" value.
      const eqFrac = clamp(rhoObj / rhoFl, 0, 1);

      let state;
      if (rhoObj > rhoFl + 1) state = 'sinks';
      else if (Math.abs(rhoObj - rhoFl) <= 1) state = 'neutral';
      else state = 'floats';

      const key = `${(subFracGeom * 100).toFixed(0)},${FB.toFixed(0)},${Wt.toFixed(0)},${state},${draggingRef.current ? 'd' : 'r'}`;
      if (key !== pubKey) {
        pubKey = key;
        setReadouts({
          subFrac: eqFrac, FB, W: Wt, net, state,
          liveFrac: subFracGeom, effRho: rhoObj,
        });
      }

      // ── render ────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);

      // tank region: leave the rightmost ~24% for the displaced-volume ghost panel
      const tankRight = W - Math.min(150, W * 0.26);

      // air dots
      ctx.fillStyle = grid;
      for (let gx = padX; gx <= tankRight - 10; gx += 22)
        for (let gy = padTop; gy < surf - 2; gy += 22) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, 2 * Math.PI); ctx.fill();
        }

      // water w/ depth gradient
      const [r, g, b] = fl.tint;
      const wg = ctx.createLinearGradient(0, surf, 0, bot);
      wg.addColorStop(0, `rgba(${r},${g},${b},0.30)`);
      wg.addColorStop(1, `rgba(${Math.round(r * 0.4)},${Math.round(g * 0.4)},${Math.round(b * 0.4)},0.66)`);
      ctx.fillStyle = wg;
      ctx.fillRect(padX, surf, tankRight - padX, bot - surf);
      ctx.strokeStyle = `rgba(${r + 60},${g + 60},${b + 40},0.9)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(padX, surf); ctx.lineTo(tankRight, surf); ctx.stroke();

      // tank walls
      ctx.strokeStyle = grid; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, padTop); ctx.lineTo(padX, bot);
      ctx.lineTo(tankRight, bot); ctx.lineTo(tankRight, padTop);
      ctx.stroke();

      // ── the object ──────────────────────────────────────────────────────
      const cx = (padX + tankRight) / 2;
      const ox = cx - objWpx / 2, oy = objY - objHpx / 2;
      const rr = 14;
      const roundRect = (x, y, w, h, rad) => {
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath();
      };
      roundRect(ox, oy, objWpx, objHpx, rr);
      ctx.fillStyle = draggingRef.current ? '#D8C48F' : GOLD;
      ctx.shadowColor = GOLD; ctx.shadowBlur = draggingRef.current ? 20 : 12; ctx.fill(); ctx.shadowBlur = 0;

      // submarine detailing
      if (subRef.current) {
        ctx.fillStyle = 'rgba(13,19,33,0.55)';
        // ballast fill inside hull grows from the bottom
        const fillH = objHpx * 0.55 * ballastRef.current;
        ctx.fillRect(ox + 8, oy + objHpx - 8 - fillH, objWpx - 16, fillH);
        // conning tower
        ctx.fillStyle = GOLD;
        ctx.fillRect(cx - 12, oy - 14, 24, 16);
        ctx.fillStyle = NAVY;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('SS', cx, oy + objHpx / 2);
      }

      // waterline clip line across the object (shows submerged part)
      if (surf > oy && surf < oy + objHpx) {
        ctx.strokeStyle = 'rgba(240,236,227,0.55)';
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ox - 4, surf); ctx.lineTo(ox + objWpx + 4, surf); ctx.stroke();
        ctx.setLineDash([]);
      }

      // grab hint when idle & not dragging
      if (!draggingRef.current) {
        ctx.fillStyle = 'rgba(13,19,33,0.7)';
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('drag me ↕', cx, objY);
      }

      // ── force arrows: F_B up, W down (length ∝ force, shared normalization) ──
      const Fref = Math.max(Wt, FB, rhoFl * V_total * G, 1);
      const arrowPx = (f) => clamp(f / Fref, 0.04, 1) * 90;
      // buoyancy up, on left half
      drawArrow(ctx, { x: cx - objWpx / 4, y: objY, dx: 0, dy: -arrowPx(FB), color: BUOY_BLUE, width: 3.5, label: 'F_B', head: 10 });
      // weight down, on right half
      drawArrow(ctx, { x: cx + objWpx / 4, y: objY, dx: 0, dy: arrowPx(Wt), color: WEIGHT_AMBER, width: 3.5, label: 'W', head: 10 });

      // ── displaced-volume "ghost" panel on the right ─────────────────────
      const ghostX = tankRight + 16;
      const ghostW = W - padX - ghostX;
      if (ghostW > 30) {
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('displaced', ghostX + ghostW / 2, padTop + 2);
        ctx.fillText('fluid', ghostX + ghostW / 2, padTop + 16);

        // a full-height reference box = full object volume
        const gTop = padTop + 40, gBot = bot - 30, gH = gBot - gTop;
        const gW = Math.min(ghostW - 6, 70);
        const gx0 = ghostX + (ghostW - gW) / 2;
        ctx.strokeStyle = 'rgba(240,236,227,0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gx0, gTop, gW, gH);
        // filled portion = submerged fraction (the displaced volume)
        const fillH = gH * subFracGeom;
        ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
        ctx.fillRect(gx0, gBot - fillH, gW, fillH);
        // hatch top of fill
        ctx.strokeStyle = `rgba(${r + 60},${g + 60},${b + 40},0.9)`;
        ctx.beginPath(); ctx.moveTo(gx0, gBot - fillH); ctx.lineTo(gx0 + gW, gBot - fillH); ctx.stroke();

        ctx.fillStyle = TEXT;
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(`${(subFracGeom * 100).toFixed(0)}%`, ghostX + ghostW / 2, gBot + 6);
        ctx.fillStyle = BUOY_BLUE;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(`F_B=${(FB / 1000).toFixed(1)}kN`, ghostX + ghostW / 2, gBot + 22);
      }

      // compression-instability banner
      if (subRef.current && compressRef.current && objDepthM > 0.02) {
        ctx.fillStyle = net < -1 ? '#D9534F' : NET_GREEN;
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(net < -1 ? 'runaway dive ↓' : 'stable', padX + 6, padTop + 6);
        ctx.fillStyle = MUTED;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`hull −${(COMPRESS_PER_M * objDepthM * 100).toFixed(1)}%`, padX + 6, padTop + 20);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── pointer handlers for drag-to-release ────────────────────────────────────
  const onPointerDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { objHpx } = geomRef.current;
    // only grab if the pointer is on the object
    if (Math.abs(y - objYRef.current) <= objHpx / 2 + 12) {
      draggingRef.current = true;
      objVyRef.current = 0;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // move immediately so the block follows the finger
      const { hardTop, hardBot } = geomRef.current;
      objYRef.current = clamp(y, hardTop, hardBot);
    }
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { hardTop, hardBot } = geomRef.current;
    objYRef.current = clamp(y, hardTop, hardBot);
  };
  const onPointerUp = (e) => {
    // release → the loop resumes integrating and it springs back to equilibrium
    draggingRef.current = false;
    objVyRef.current = 0;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
  };

  const fluid = FLUIDS[fluidKey];
  const shownDensity = readouts.effRho || (subMode ? SUB_DRY + (SUB_FLOODED - SUB_DRY) * ballast : density);
  const stateColor =
    readouts.state === 'floats' ? 'text-usna-gold'
      : readouts.state === 'sinks' ? 'text-red-400'
        : 'text-emerald-400';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Presets</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="px-2 py-1.5 rounded text-xs text-left border bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={enterSub}
            className={`mt-2 w-full px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
              subMode ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            ⚓ Submarine mode
          </button>
          {subMode && (
            <button
              onClick={() => setCompress((c) => !c)}
              className={`mt-1.5 w-full px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                compress ? 'bg-red-500/80 text-white border-red-500' : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
              }`}
            >
              {compress ? '⚠ Depth compression ON' : 'Depth compression'}
            </button>
          )}
        </div>

        <div className="mb-3">
          <div className="text-usna-text text-sm font-medium mb-2">Fluid</div>
          <div className="flex flex-col gap-1.5">
            {Object.values(FLUIDS).map((f) => (
              <button
                key={f.key}
                onClick={() => setFluidKey(f.key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  fluidKey === f.key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {f.label} <span className="opacity-60">· {f.rho}</span>
              </button>
            ))}
          </div>
        </div>

        {subMode ? (
          <Slider label="Ballast tank fill" value={Number(ballast.toFixed(2))} min={0} max={1} step={0.01} unit="" onChange={setBallast} />
        ) : (
          <Slider label="Object density (ρ_obj)" value={density} min={100} max={2000} step={10} unit="kg/m³" onChange={setDensity} />
        )}

        <div className="mt-2 border-t border-usna-grid pt-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-usna-text text-sm">State</span>
            <span className={`font-mono text-lg font-semibold ${stateColor}`}>{readouts.state}</span>
          </div>
          <Readout label="Mean density" value={shownDensity.toFixed(0)} unit="kg/m³" />
          <Readout label="Fluid density" value={fluid.rho.toFixed(0)} unit="kg/m³" />
          <Readout
            label={readouts.state === 'sinks' ? 'Submerged (fully)' : 'Equilibrium submerged'}
            value={`${(readouts.subFrac * 100).toFixed(0)}`}
            unit="%"
          />
          {typeof readouts.liveFrac === 'number' && (
            <Readout label="Now submerged" value={`${(readouts.liveFrac * 100).toFixed(0)}`} unit="%" />
          )}
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Buoyant force F_B" value={(readouts.FB / 1000).toFixed(2)} unit="kN" />
            <Readout label="Weight W" value={(readouts.W / 1000).toFixed(2)} unit="kN" />
            <Readout label="Net force" value={(readouts.net / 1000).toFixed(2)} unit="kN" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 520 }}>
          <div ref={wrapRef} className="relative w-full h-full rounded-md overflow-hidden">
            <canvas
              ref={canvasRef}
              className="block touch-none cursor-grab active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>
        <InfoPanel {...(subMode ? INFO.submarine : INFO.buoyancy)} />
      </div>
    </div>
  );
}

// ── InfoPanel copy ──────────────────────────────────────────────────────────
const INFO = {
  pressure: {
    title: 'Pressure pushes from every direction',
    description:
      'Absolute pressure grows linearly with depth, P = P₀ + ρgh, and at any point it acts equally in all directions — the arrows on the test surface push IN from top, bottom, and both sides, not just down. Left and right cancel exactly; the bottom arrow is longer than the top because the fluid there is deeper, and their difference is the single green NET vector: that is the buoyant force on this element, F_B = (P_bot − P_top)·A = ρgV. Switch to mercury and the same 10 m of depth adds more than thirteen times the pressure of water.',
    equation: String.raw`P = P_0 + \rho g h,\qquad F_B = (P_{\text{bot}}-P_{\text{top}})\,A = \rho g V`,
  },
  buoyancy: {
    title: 'A floating body sinks to exactly ρ_obj/ρ_fluid',
    description:
      'The buoyant force equals the weight of the fluid the object pushes aside — read F_B straight off the displaced-volume ghost, F_B = ρ_fluid V g. A floating object settles until the displaced fraction equals ρ_obj/ρ_fluid and F_B = W (net force zero); drag it down and release it and it springs right back to that waterline. Ice (917) in seawater (1025) rides with ~90% below the surface, and cork (240) shows only ~24% under. The punchline is that "float" is relative: steel sinks in water but the same steel bobs at ~58% in mercury — nothing changed but the fluid.',
    equation: String.raw`F_B = \rho_{\text{fluid}}\,V_{\text{disp}}\,g,\qquad f_{\text{sub}} = \frac{\rho_{\text{obj}}}{\rho_{\text{fluid}}}`,
  },
  submarine: {
    title: 'Ballast slides the mean density through neutral',
    description:
      'A submarine does not have a motor holding it down. Flooding the ballast tanks raises the boat’s MEAN density; blowing them with air lowers it. Drive the fill slider up and the boat crosses through ρ = ρ_seawater — the neutral point where F_B = W — and dives; back it off and it surfaces. Turn on depth compression and the hull shrinks slightly as it descends, so the same mass fills less volume and the mean density RISES with depth: below neutral that is a runaway dive (deeper → heavier → deeper), which is exactly why holding a real sub trimmed below neutral is hard.',
    equation: String.raw`\bar\rho = \frac{m_{\text{hull}} + m_{\text{ballast}}}{V_{\text{hull}}(z)},\qquad \text{dive when } \bar\rho > \rho_{\text{sea}}`,
  },
};
