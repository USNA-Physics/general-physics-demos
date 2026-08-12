import { useState, useRef, useEffect, useCallback } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';

/**
 * D14 · Center of Mass Playground — L14. Modes: 'default', 'tumbling'.
 *
 * The two modes share one idea from two directions: the center of mass is the
 * mass-weighted average position, R_cm = (Σ m_i r_i) / M, and F_ext = M a_cm.
 *
 *   default  : an editable point-mass playground. Click to add a mass, drag to
 *              move it, resize each mass with a slider; the CM marker (★) tracks
 *              the mass-weighted average live. Presets include a "boomerang"
 *              whose CM sits OUTSIDE the material — the average of where the mass
 *              is need not be where any mass is. You can also DRAG the ★ itself:
 *              the selected mass repositions to inverse-solve for the CM you
 *              want, making "where does the average go?" a two-way question.
 *   tumbling : launch an extended rigid body (an L-shape / dumbbell of point
 *              masses) as a projectile. In flight it spins at constant angular
 *              velocity (no torque) while the CM follows a = -g. Toggle the
 *              CM-trail on: the visual chaos of the tumbling body resolves into
 *              L6's clean parabola — the messy object is secretly a point
 *              particle at the CM, plus rotation about it. A stroboscope stamps
 *              faint whole-body snapshots so the messy copies and the CM stars
 *              are visible at once. Two contrasts drive the idea home:
 *                • Throw-and-explode: burst the body at apex into two fragments
 *                  that fly apart, yet the CM ★ keeps sailing the SAME parabola —
 *                  internal forces cannot move the center of mass.
 *                • Spin about a non-CM pivot: force the body to rotate about an
 *                  offset point and the "CM" you were watching now loops a
 *                  cycloid — only rotation about the true CM leaves it clean.
 *
 * Wrapper is hook-free and branches by mode; each child owns its own hooks so
 * the Rules of Hooks hold even though the two UIs are completely different.
 */

// ── palette (hex for canvas) ─────────────────────────────────────────────────
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const DEEP = '#0D1321';
const BLUE = '#5B9BD5';
const CORAL = '#E27D60';
const G = 9.81; // m/s^2

// ── thin hook-free wrapper ───────────────────────────────────────────────────
export default function CenterOfMass({ mode = 'default' }) {
  if (mode === 'tumbling') return <TumblingMode />;
  return <PlaygroundMode />;
}

// =============================================================================
// DEFAULT MODE — point-mass playground
// =============================================================================

// Presets are lists of {x, y, m} in world meters (origin at canvas center-ish).
// The boomerang's CM deliberately lands in the empty notch (outside the body).
const PLAY_PRESETS = {
  dumbbell: {
    label: 'Dumbbell',
    masses: [
      { x: -3.0, y: 0, m: 4 },
      { x: 3.0, y: 0, m: 4 },
    ],
  },
  lshape: {
    label: 'L-shape',
    masses: [
      { x: -3.0, y: 2.5, m: 2 },
      { x: -3.0, y: 0, m: 2 },
      { x: -3.0, y: -2.5, m: 2 },
      { x: 0, y: -2.5, m: 2 },
      { x: 3.0, y: -2.5, m: 2 },
    ],
  },
  boomerang: {
    label: 'Boomerang (CM outside!)',
    masses: [
      { x: -4.0, y: 3.2, m: 2 },
      { x: -2.2, y: 1.4, m: 2 },
      { x: -0.6, y: 0, m: 3 },
      { x: -2.2, y: -1.4, m: 2 },
      { x: -4.0, y: -3.2, m: 2 },
    ],
  },
};

const clone = (arr) => arr.map((p) => ({ ...p }));

function computeCM(masses) {
  let M = 0, sx = 0, sy = 0;
  for (const p of masses) {
    M += p.m;
    sx += p.m * p.x;
    sy += p.m * p.y;
  }
  if (M === 0) return { x: 0, y: 0, M: 0 };
  return { x: sx / M, y: sy / M, M };
}

function PlaygroundMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [masses, setMasses] = useState(() => clone(PLAY_PRESETS.dumbbell.masses));
  const [selected, setSelected] = useState(0);
  const [presetKey, setPresetKey] = useState('dumbbell');
  // When the ★ is being dragged we briefly annotate the readout so the student
  // sees the inverse-solve happening (which mass is doing the moving).
  const [cmDragging, setCmDragging] = useState(false);

  // Refs mirror state so the rAF/pointer handlers read the latest without
  // re-binding listeners every render.
  const massesRef = useRef(masses);
  massesRef.current = masses;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Pointer drag bookkeeping (screen<->world transforms live inside the effect).
  const dragRef = useRef({ active: false, idx: -1, moved: false });
  const xformRef = useRef({ toX: (x) => x, toY: (y) => y, fromX: (px) => px, fromY: (py) => py, sc: 1 });

  const cm = computeCM(masses);

  const applyPreset = (key) => {
    setPresetKey(key);
    setMasses(clone(PLAY_PRESETS[key].masses));
    setSelected(0);
  };

  const reset = () => applyPreset('dumbbell');

  const clearAll = () => {
    setMasses([]);
    setSelected(-1);
    setPresetKey('');
  };

  const setSelectedMass = (m) => {
    setMasses((prev) => {
      if (selectedRef.current < 0 || selectedRef.current >= prev.length) return prev;
      const next = clone(prev);
      next[selectedRef.current] = { ...next[selectedRef.current], m };
      return next;
    });
    setPresetKey('');
  };

  // FIX: derive the new selection from the deleted index inside a single
  // functional update so it can never lag behind `masses` (the old version read
  // `masses.length` from a stale render closure, which mis-highlighted the wrong
  // body whenever a non-last mass was deleted).
  const deleteSelected = () => {
    const del = selectedRef.current;
    if (del < 0 || del >= massesRef.current.length) return;
    setMasses((prev) => prev.filter((_, i) => i !== del));
    setSelected((s) => {
      // nothing selected -> stay nothing; deleting below the selection shifts it
      // down by one; deleting the selection lands on the previous neighbor.
      if (s < 0) return -1;
      const remaining = massesRef.current.length - 1;
      if (remaining <= 0) return -1;
      let ns = s;
      if (del < s) ns = s - 1;
      else if (del === s) ns = Math.min(s, remaining - 1);
      return Math.max(0, Math.min(ns, remaining - 1));
    });
    setPresetKey('');
  };

  // ── inverse-solve: move the selected mass so the CM lands on target ─────────
  // Fix R_cm = (m_sel r_sel + Σ_others m r) / M for r_sel:
  //   r_sel = (M * R_cm - Σ_others m r) / m_sel
  // i.e. the selected body must sit wherever it takes to pull the average to the
  // requested spot. Internal to a single-frame drag; no allocation storms.
  const solveSelectedForCM = (targetX, targetY) => {
    setMasses((prev) => {
      const sel = selectedRef.current;
      if (sel < 0 || sel >= prev.length) return prev;
      let M = 0, ox = 0, oy = 0;
      for (let i = 0; i < prev.length; i++) {
        M += prev[i].m;
        if (i === sel) continue;
        ox += prev[i].m * prev[i].x;
        oy += prev[i].m * prev[i].y;
      }
      const ms = prev[sel].m;
      if (ms <= 0) return prev;
      const rx = (M * targetX - ox) / ms;
      const ry = (M * targetY - oy) / ms;
      const next = clone(prev);
      next[sel] = { ...next[sel], x: clampWorld(rx), y: clampWorld(ry) };
      return next;
    });
    setPresetKey('');
  };

  // ── canvas: setup + pointer handling + rAF render ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;
    const pad = 24;
    const WORLD_W = 14; // meters shown across width (equal x/y scale)

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas2D(canvas, W, H);
      const sc = (W - 2 * pad) / WORLD_W; // px per meter
      const cx = W / 2, cy = H / 2;
      xformRef.current = {
        sc,
        toX: (x) => cx + x * sc,
        toY: (y) => cy - y * sc, // +y up in world
        fromX: (px) => (px - cx) / sc,
        fromY: (py) => (cy - py) / sc,
      };
    };

    const hitTest = (px, py) => {
      const ms = massesRef.current;
      const { toX, toY } = xformRef.current;
      // largest first-ish: test all, pick nearest within radius
      let best = -1, bestD = Infinity;
      for (let i = 0; i < ms.length; i++) {
        const r = massRadiusPx(ms[i].m);
        const dx = px - toX(ms[i].x);
        const dy = py - toY(ms[i].y);
        const d = Math.hypot(dx, dy);
        if (d <= r + 6 && d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    // Hit-test the CM ★ (so it can be grabbed to inverse-solve). Only grabbable
    // when a mass is selected AND that mass carries some weight to move with.
    const hitCM = (px, py) => {
      const ms = massesRef.current;
      const sel = selectedRef.current;
      if (ms.length === 0 || sel < 0 || sel >= ms.length || ms[sel].m <= 0) return false;
      const cmNow = computeCM(ms);
      const { toX, toY } = xformRef.current;
      const d = Math.hypot(px - toX(cmNow.x), py - toY(cmNow.y));
      return d <= 18;
    };

    const localXY = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };

    const onDown = (e) => {
      const [px, py] = localXY(e);
      // Priority: grabbing the ★ beats hitting a mass underneath it.
      if (hitCM(px, py)) {
        dragRef.current = { active: true, idx: -3, moved: false }; // -3 == CM drag
        setCmDragging(true);
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      const idx = hitTest(px, py);
      if (idx >= 0) {
        dragRef.current = { active: true, idx, moved: false };
        setSelected(idx);
        canvas.setPointerCapture?.(e.pointerId);
      } else {
        // click empty space -> add a new mass at that point
        const { fromX, fromY } = xformRef.current;
        const nx = clampWorld(fromX(px));
        const ny = clampWorld(fromY(py));
        setMasses((prev) => {
          const next = [...prev, { x: nx, y: ny, m: 3 }];
          setSelected(next.length - 1);
          return next;
        });
        setPresetKey('');
        dragRef.current = { active: true, idx: -2, moved: false, pending: true };
      }
    };

    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const [px, py] = localXY(e);
      const { fromX, fromY } = xformRef.current;
      const nx = clampWorld(fromX(px));
      const ny = clampWorld(fromY(py));
      d.moved = true;
      if (d.idx === -3) {
        // dragging the ★ — inverse-solve the selected mass's position.
        solveSelectedForCM(fromX(px), fromY(py));
        return;
      }
      // idx -2 means we just added the newest mass; keep dragging it.
      setMasses((prev) => {
        if (prev.length === 0) return prev;
        const i = d.idx === -2 ? prev.length - 1 : d.idx;
        if (i < 0 || i >= prev.length) return prev;
        const next = clone(prev);
        next[i] = { ...next[i], x: nx, y: ny };
        return next;
      });
    };

    const onUp = (e) => {
      if (dragRef.current.idx === -3) setCmDragging(false);
      dragRef.current.active = false;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    const draw = () => {
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      const ms = massesRef.current;
      const { toX, toY, sc } = xformRef.current;
      const sel = selectedRef.current;

      ctx.clearRect(0, 0, W, H);

      // grid + axes
      drawGrid(ctx, W, H, toX, toY, WORLD_W, sc);

      // faint hull connecting the masses (helps read the "body")
      if (ms.length >= 2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(139,140,142,0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ms.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // point masses
      for (let i = 0; i < ms.length; i++) {
        const p = ms[i];
        const r = massRadiusPx(p.m);
        const x = toX(p.x), y = toY(p.y);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = i === sel ? GOLD : BLUE;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = i === sel ? 3 : 1.5;
        ctx.strokeStyle = i === sel ? TEXT : 'rgba(240,236,227,0.6)';
        ctx.stroke();
        // mass label
        ctx.fillStyle = NAVY;
        ctx.font = 'bold 12px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${p.m}`, x, y);
      }

      // center of mass marker (★) with crosshair
      const cmNow = computeCM(ms);
      if (ms.length > 0) {
        const cx = toX(cmNow.x), cy = toY(cmNow.y);
        const grab = dragRef.current.idx === -3 && dragRef.current.active;
        ctx.save();
        // a soft "grab ring" when draggable/being dragged, so the affordance is
        // discoverable on a phone (no hover state to lean on)
        const canGrab = sel >= 0 && sel < ms.length && ms[sel].m > 0;
        if (canGrab) {
          ctx.strokeStyle = grab ? 'rgba(197,183,131,0.85)' : 'rgba(197,183,131,0.30)';
          ctx.lineWidth = grab ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(226,125,96,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy); ctx.lineTo(cx + 22, cy);
        ctx.moveTo(cx, cy - 22); ctx.lineTo(cx, cy + 22);
        ctx.stroke();
        ctx.setLineDash([]);
        drawStar(ctx, cx, cy, 5, grab ? 13 : 11, grab ? 6.5 : 5.5, CORAL, NAVY);
        ctx.fillStyle = CORAL;
        ctx.font = 'bold 12px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('CM', cx + 14, cy - 10);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const selMass = selected >= 0 && selected < masses.length ? masses[selected] : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Configuration</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(PLAY_PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  presetKey === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 border-t border-usna-grid pt-3">
          <Slider
            label={selMass ? `Selected mass` : 'Selected mass'}
            value={selMass ? selMass.m : 3}
            min={1}
            max={10}
            step={1}
            unit="kg"
            onChange={setSelectedMass}
          />
          <div className="flex gap-2">
            <button
              onClick={deleteSelected}
              disabled={!selMass}
              className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete
            </button>
            <button
              onClick={clearAll}
              className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
            >
              Clear all
            </button>
          </div>
          <p className="text-usna-muted text-xs mt-2 leading-relaxed">
            Tap empty space to add a mass, drag any circle to move it, tap one to
            select and resize. Drag the ★ itself and the selected mass slides to
            put the CM wherever you drop it.
          </p>
        </div>

        <div className="border-t border-usna-grid pt-3">
          <Readout label="Total mass M" value={cm.M.toFixed(0)} unit="kg" />
          <Readout label="Bodies N" value={String(masses.length)} unit="" />
          <Readout label="CM  x" value={cm.x.toFixed(2)} unit="m" />
          <Readout label="CM  y" value={cm.y.toFixed(2)} unit="m" />
          {cmDragging && selMass && (
            <p className="text-usna-gold text-xs mt-2 leading-relaxed">
              Inverse-solving: mass #{selected + 1} ({selMass.m} kg) is moving to
              anchor the average here.
            </p>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 480, background: DEEP, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.default} />
      </div>
    </div>
  );
}

// =============================================================================
// TUMBLING MODE — extended rigid body as a projectile
// =============================================================================

// A rigid body is a set of point masses given in BODY coordinates (meters),
// measured from the body's own center of mass. We rotate + translate them.
const BODIES = {
  dumbbell: {
    label: 'Dumbbell',
    // two heavy ends on a light bar
    make: () => balanceAboutCM([
      { bx: -1.4, by: 0, m: 4 },
      { bx: 1.4, by: 0, m: 4 },
      { bx: 0, by: 0, m: 0.6 },
    ]),
  },
  ell: {
    label: 'L-shape (lopsided)',
    // a right-angle bracket: a vertical arm and a horizontal arm meeting at a
    // heavier corner, so the CM sits off toward the corner (not at any mass).
    // Points are listed in path order so the connector traces the "L".
    make: () => balanceAboutCM([
      { bx: -1.4, by: 1.6, m: 2 },    // top of the vertical arm
      { bx: -1.4, by: 0.4, m: 2 },
      { bx: -1.4, by: -0.8, m: 3.5 }, // corner (heaviest)
      { bx: -0.2, by: -0.8, m: 2 },
      { bx: 1.0, by: -0.8, m: 2 },
      { bx: 2.2, by: -0.8, m: 2 },    // end of the horizontal arm
    ]),
  },
  triangle: {
    label: 'Triple mass',
    make: () => balanceAboutCM([
      { bx: 0, by: 1.4, m: 3 },
      { bx: -1.3, by: -1.0, m: 3 },
      { bx: 1.3, by: -1.0, m: 3 },
    ]),
  },
};

// Recenter a body's points so the CM is at the local origin (0,0).
function balanceAboutCM(pts) {
  let M = 0, sx = 0, sy = 0;
  for (const p of pts) { M += p.m; sx += p.m * p.bx; sy += p.m * p.by; }
  const cx = sx / M, cy = sy / M;
  return pts.map((p) => ({ bx: p.bx - cx, by: p.by - cy, m: p.m }));
}

function TumblingMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [speed, setSpeed] = useState(22);      // m/s launch speed
  const [angle, setAngle] = useState(60);      // deg launch angle
  const [spin, setSpin] = useState(180);       // deg/s angular velocity in flight
  const [bodyKey, setBodyKey] = useState('ell');
  const [trail, setTrail] = useState(false);
  const [strobe, setStrobe] = useState(false); // WOW: stamp whole-body snapshots
  const [explode, setExplode] = useState(false); // PHYSICS: burst at apex
  const [offPivot, setOffPivot] = useState(false); // PHYSICS: spin about non-CM
  const [running, setRunning] = useState(true);

  // live readout published from the rAF loop (throttled), not per-frame state.
  const [readout, setReadout] = useState({ x: 0, y: 0, vx: 0, vy: 0, t: 0, tf: 0, exploded: false });

  // refs the animation loop reads
  const speedRef = useRef(speed); speedRef.current = speed;
  const angleRef = useRef(angle); angleRef.current = angle;
  const spinRef = useRef(spin); spinRef.current = spin;
  const bodyKeyRef = useRef(bodyKey); bodyKeyRef.current = bodyKey;
  const trailRef = useRef(trail); trailRef.current = trail;
  const strobeRef = useRef(strobe); strobeRef.current = strobe;
  const explodeRef = useRef(explode); explodeRef.current = explode;
  const offPivotRef = useRef(offPivot); offPivotRef.current = offPivot;
  const runningRef = useRef(running); runningRef.current = running;

  // launch-signal: a monotonically increasing counter forces a fresh flight.
  const launchTokenRef = useRef(0);
  const relaunch = useCallback(() => { launchTokenRef.current += 1; }, []);

  const reset = () => {
    setSpeed(22); setAngle(60); setSpin(180);
    setBodyKey('ell'); setTrail(false); setStrobe(false);
    setExplode(false); setOffPivot(false); setRunning(true);
    relaunch();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, last;
    const pad = 30;
    const groundFrac = 0.86; // ground line position

    // world mapping: fit a reasonable range, equal x/y scale.
    let sc = 6, originX = pad, groundY = 0;

    // ── flight state ─────────────────────────────────────────────────────────
    // flight.pivotOff is the (body-frame) offset the body rotates about when the
    // "non-CM pivot" toggle is on. With it, the marker we draw at flight.x is no
    // longer the true CM of the material, so its path becomes a cycloid.
    let flight = null;         // { x, y, vx, vy, theta, t, apex, exploded, ... }
    let trailPts = [];         // CM positions (world) while trail is on
    let strobePts = [];        // {x,y,theta} whole-body snapshots for stroboscope
    let frags = null;          // explosion fragments (each its own body + kin)
    let restTimer = 0;         // pause after landing before auto-relaunch
    let seenToken = -1;
    let lastStrobeT = -1;      // flight-time of the last strobe stamp
    const STROBE_DT = 0.16;    // seconds between stamps

    const worldRange = () => {
      // choose scale so the full parabola of the current launch fits the width
      const v = speedRef.current;
      const th = (angleRef.current * Math.PI) / 180;
      const R = (v * v * Math.sin(2 * th)) / G;
      const apex = (v * v * Math.sin(th) ** 2) / (2 * G);
      const worldW = Math.max(R * 1.12, 20);
      const worldH = Math.max(apex * 1.25, 12);
      const scX = (W - 2 * pad) / worldW;
      const scY = (H * groundFrac - pad) / worldH;
      sc = Math.min(scX, scY);
      originX = pad;
      groundY = H * groundFrac;
    };

    const toX = (x) => originX + x * sc;
    const toY = (y) => groundY - y * sc;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas2D(canvas, W, H);
      worldRange();
    };

    const timeOfFlight = () => {
      const v = speedRef.current;
      const th = (angleRef.current * Math.PI) / 180;
      return (2 * v * Math.sin(th)) / G;
    };

    const startFlight = () => {
      worldRange();
      const v = speedRef.current;
      const th = (angleRef.current * Math.PI) / 180;
      const tf = timeOfFlight();
      // The point we translate is the ROTATION anchor. When off-pivot is on we
      // anchor at an edge mass of the body instead of the CM, so the drawn "CM"
      // is really the pivot and the true material CM swings around it → cycloid.
      const body = getBody(bodyKeyRef.current);
      let pivotOff = { bx: 0, by: 0 };
      if (offPivotRef.current) {
        // pick the body point farthest from the CM as a dramatic pivot
        let far = body[0], fd = -1;
        for (const p of body) { const d = Math.hypot(p.bx, p.by); if (d > fd) { fd = d; far = p; } }
        pivotOff = { bx: far.bx, by: far.by };
      }
      flight = {
        x: 0,
        y: 0.001,
        vx: v * Math.cos(th),
        vy: v * Math.sin(th),
        theta: 0,
        t: 0,
        tf,
        apexT: tf / 2,
        exploded: false,
        pivotOff,
      };
      trailPts = [];
      strobePts = [];
      frags = null;
      restTimer = 0;
      lastStrobeT = -1;
    };

    const analyticArc = () => {
      // sampled ideal parabola for the current launch (for the "ghost" guide)
      const v = speedRef.current;
      const th = (angleRef.current * Math.PI) / 180;
      const tf = timeOfFlight();
      const pts = [];
      const nS = 80;
      for (let i = 0; i <= nS; i++) {
        const t = (i / nS) * tf;
        pts.push([v * Math.cos(th) * t, v * Math.sin(th) * t - 0.5 * G * t * t]);
      }
      return pts;
    };

    // Trigger the explosion: split the body into two fragments that fly apart
    // with equal-and-opposite momentum, so their combined CM keeps flight's
    // velocity exactly. Internal forces cannot shift the CM.
    const detonate = () => {
      const body = getBody(bodyKeyRef.current);
      // partition points left/right of the body-frame y-axis into two lumps
      const A = [], B = [];
      for (const p of body) (p.bx <= 0 ? A : B).push(p);
      // guard: if one side is empty (symmetric split failed), split by index
      if (A.length === 0 || B.length === 0) {
        A.length = 0; B.length = 0;
        body.forEach((p, i) => (i % 2 === 0 ? A : B).push(p));
      }
      const lump = (pts) => {
        // rebuild each lump around its own CM so it tumbles believably
        let m = 0, sx = 0, sy = 0;
        for (const p of pts) { m += p.m; sx += p.m * p.bx; sy += p.m * p.by; }
        const cx = sx / m, cy = sy / m;
        return {
          m,
          cmBx: cx, cmBy: cy, // lump CM in body frame (rel to whole-body CM)
          pts: pts.map((p) => ({ bx: p.bx - cx, by: p.by - cy, m: p.m })),
        };
      };
      const lA = lump(A), lB = lump(B);
      const Mtot = lA.m + lB.m;
      // choose a separation impulse along the line joining the lump CMs
      const dx = lB.cmBx - lA.cmBx, dy = lB.cmBy - lA.cmBy;
      const dlen = Math.hypot(dx, dy) || 1;
      const ux = dx / dlen, uy = dy / dlen;
      const J = 7 * Math.min(lA.m, lB.m); // impulse magnitude (m·(Δv)); tuned
      // momentum-conserving: Δv_A = -J u / m_A, Δv_B = +J u / m_B
      const cosT = Math.cos(flight.theta), sinT = Math.sin(flight.theta);
      const rot = (bx, by) => [bx * cosT - by * sinT, bx * sinT + by * cosT];
      // world positions of each lump CM at the moment of the burst
      const [aOffX, aOffY] = rot(lA.cmBx - flight.pivotOff.bx, lA.cmBy - flight.pivotOff.by);
      const [bOffX, bOffY] = rot(lB.cmBx - flight.pivotOff.bx, lB.cmBy - flight.pivotOff.by);
      const [wux, wuy] = rot(ux, uy); // separation direction in world frame
      frags = [
        {
          m: lA.m, pts: lA.pts,
          x: flight.x + aOffX, y: flight.y + aOffY,
          vx: flight.vx - (J * wux) / lA.m, vy: flight.vy - (J * wuy) / lA.m,
          theta: flight.theta, omega: (spinRef.current * Math.PI / 180) - 3.0,
        },
        {
          m: lB.m, pts: lB.pts,
          x: flight.x + bOffX, y: flight.y + bOffY,
          vx: flight.vx + (J * wux) / lB.m, vy: flight.vy + (J * wuy) / lB.m,
          theta: flight.theta, omega: (spinRef.current * Math.PI / 180) + 3.0,
        },
      ];
      flight.exploded = true;
      flight.Mtot = Mtot;
    };

    // The CM of the fragment system (must equal the undisturbed parabola point).
    const fragCM = () => {
      if (!frags) return { x: flight.x, y: flight.y };
      let M = 0, sx = 0, sy = 0;
      for (const f of frags) { M += f.m; sx += f.m * f.x; sy += f.m * f.y; }
      return { x: sx / M, y: sy / M };
    };

    const draw = (now) => {
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      if (last == null) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.05) dt = 1 / 60; // bounded dt, survives throttling

      // handle relaunch signal / first launch
      if (seenToken !== launchTokenRef.current || flight == null) {
        seenToken = launchTokenRef.current;
        startFlight();
      }

      // integrate flight (CM: a = -g; body: constant omega, no torque)
      if (runningRef.current && flight) {
        const airborne = flight.y > 0 || flight.vy > 0;
        if (airborne) {
          if (!flight.exploded) {
            // ── single rigid body still in one piece ──────────────────────────
            flight.vy += -G * dt;
            flight.x += flight.vx * dt;
            flight.y += flight.vy * dt;
            flight.theta += (spinRef.current * Math.PI / 180) * dt;
            flight.t += dt;

            // trigger the burst at (or just past) apex if armed
            if (explodeRef.current && !flight.exploded && flight.t >= flight.apexT) {
              detonate();
            }

            // record the true-CM trail point (see cmMarker below for off-pivot)
            const marker = markerWorld();
            if (trailRef.current) {
              trailPts.push([marker.x, marker.y]);
              if (trailPts.length > 2000) trailPts.shift();
            }
            // stroboscope stamps of the whole tumbling body
            if (strobeRef.current && flight.t - lastStrobeT >= STROBE_DT) {
              lastStrobeT = flight.t;
              strobePts.push({ x: flight.x, y: flight.y, theta: flight.theta, cm: { ...marker } });
              if (strobePts.length > 200) strobePts.shift();
            }
          } else {
            // ── fragments: each is its own free body ──────────────────────────
            let anyUp = false;
            for (const f of frags) {
              if (f.y > 0 || f.vy > 0) {
                f.vy += -G * dt;
                f.x += f.vx * dt;
                f.y += f.vy * dt;
                f.theta += f.omega * dt;
                if (f.y < 0) f.y = 0;
                anyUp = anyUp || f.y > 0 || f.vy > 0;
              }
            }
            flight.t += dt;
            const cm = fragCM();
            // the fragment-system CM must trace the SAME clean parabola
            if (trailRef.current) {
              trailPts.push([cm.x, cm.y]);
              if (trailPts.length > 2000) trailPts.shift();
            }
            if (strobeRef.current && flight.t - lastStrobeT >= STROBE_DT) {
              lastStrobeT = flight.t;
              strobePts.push({ frags: frags.map((f) => ({ x: f.x, y: f.y, theta: f.theta, pts: f.pts })), cm: { ...cm } });
              if (strobePts.length > 200) strobePts.shift();
            }
            // consider the flight "landed" when neither fragment is aloft
            if (!anyUp) { flight.y = 0; flight.vy = -1; }
          }
        } else {
          // landed: brief rest then auto-relaunch for a clean loop
          restTimer += dt;
          if (restTimer > 1.1) { startFlight(); }
        }
      }

      // ── render ───────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ground line + range ticks
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad * 0.4, groundY);
      ctx.lineTo(W - pad * 0.4, groundY);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      const R = (speedRef.current ** 2 * Math.sin(2 * angleRef.current * Math.PI / 180)) / G;
      const tickStep = R > 60 ? 20 : R > 30 ? 10 : 5;
      for (let m = 0; m <= R + tickStep; m += tickStep) {
        const px = toX(m);
        if (px > W - pad * 0.4) break;
        ctx.fillRect(px, groundY - 3, 1, 6);
        ctx.fillText(`${m}`, px, groundY + 15);
      }

      // ideal analytic parabola (always shown faint, so the trail lands on it)
      const arc = analyticArc();
      ctx.save();
      ctx.strokeStyle = 'rgba(197,183,131,0.22)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      arc.forEach(([x, y], i) => (i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y))));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // stroboscope: faint whole-body copies + a bright CM star at each stamp
      if (strobeRef.current && strobePts.length) {
        for (const snap of strobePts) {
          if (snap.frags) {
            // fragment snapshots
            ctx.save();
            ctx.globalAlpha = 0.22;
            for (const fs of snap.frags) drawBodyShape(ctx, fs.pts, fs.x, fs.y, fs.theta, toX, toY, 'rgba(91,155,213,0.9)');
            ctx.restore();
          } else {
            ctx.save();
            ctx.globalAlpha = 0.18;
            drawBodyShape(ctx, getBody(bodyKeyRef.current), snap.x, snap.y, snap.theta, toX, toY, 'rgba(91,155,213,0.9)', flight?.pivotOff);
            ctx.restore();
          }
          // CM star for this stamp — lined up on the parabola
          const cs = snap.cm || { x: snap.x, y: snap.y };
          drawStar(ctx, toX(cs.x), toY(cs.y), 5, 6, 3, CORAL, NAVY);
        }
      }

      // CM trail (the reveal): a clean parabola traced by the CM
      if (trailRef.current && trailPts.length > 1) {
        ctx.save();
        ctx.strokeStyle = CORAL;
        ctx.lineWidth = 3;
        ctx.shadowColor = CORAL;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        trailPts.forEach(([x, y], i) => (i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y))));
        ctx.stroke();
        ctx.restore();
      }

      // ── live body/fragments ────────────────────────────────────────────────
      if (flight) {
        if (!flight.exploded) {
          const body = getBody(bodyKeyRef.current);
          drawBody(ctx, body, flight.x, flight.y, flight.theta, toX, toY, flight.pivotOff);

          const marker = markerWorld();
          const mx = toX(marker.x), my = toY(marker.y);
          drawStar(ctx, mx, my, 5, 10, 5, offPivotRef.current ? MUTED : CORAL, NAVY);
          if (offPivotRef.current) {
            // label the drawn point as the PIVOT, not the CM, to sell the contrast
            ctx.fillStyle = MUTED;
            ctx.font = 'bold 11px JetBrains Mono, monospace';
            ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText('pivot', mx + 12, my - 8);
          }

          publishReadout(readoutFromFlight(marker));
        } else {
          // draw each fragment
          for (const f of frags) {
            drawBody(ctx, f.pts, f.x, f.y, f.theta, toX, toY);
          }
          // the system CM — still exactly on the parabola
          const cm = fragCM();
          drawStar(ctx, toX(cm.x), toY(cm.y), 5, 11, 5.5, CORAL, NAVY);
          ctx.fillStyle = CORAL;
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText('CM (unmoved)', toX(cm.x) + 12, toY(cm.y) - 10);
          publishReadout(readoutFromFlight(cm, true));
        }
      }

      raf = requestAnimationFrame(draw);
    };

    // Where is the drawn ★? For a normal launch this is the true CM (flight.x,y).
    // With an off-pivot, the point we integrate is the pivot; the true material
    // CM sits at pivot + R(theta)·(-pivotOff), which loops a cycloid.
    const markerWorld = () => {
      if (!flight) return { x: 0, y: 0 };
      if (!offPivotRef.current) return { x: flight.x, y: flight.y };
      const cosT = Math.cos(flight.theta), sinT = Math.sin(flight.theta);
      // CM offset from pivot in body frame is (0 - pivotOff)
      const ox = -flight.pivotOff.bx, oy = -flight.pivotOff.by;
      return {
        x: flight.x + (ox * cosT - oy * sinT),
        y: flight.y + (ox * sinT + oy * cosT),
      };
    };

    const readoutFromFlight = (marker, exploded = false) => ({
      x: marker.x,
      y: Math.max(0, marker.y),
      vx: flight.vx,
      vy: flight.vy,
      t: flight.t,
      tf: flight.tf,
      exploded,
    });

    // throttle readout publishing to ~10 Hz
    let lastPub = 0;
    const publishReadout = (rd) => {
      const t = performance.now();
      if (t - lastPub < 100) return;
      lastPub = t;
      setReadout({
        x: Number(rd.x.toFixed(1)),
        y: Number(rd.y.toFixed(1)),
        vx: Number(rd.vx.toFixed(1)),
        vy: Number(rd.vy.toFixed(1)),
        t: Number(rd.t.toFixed(2)),
        tf: Number(rd.tf.toFixed(2)),
        exploded: rd.exploded,
      });
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

  // changing launch params / toggles that alter the flight should restart it so
  // the parabola and the pivot geometry match.
  useEffect(() => { relaunch(); }, [speed, angle, spin, bodyKey, explode, offPivot, relaunch]);

  const vMag = Math.hypot(readout.vx, readout.vy);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Rigid body</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(BODIES).map(([key, b]) => (
              <button
                key={key}
                onClick={() => setBodyKey(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  bodyKey === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-usna-grid pt-3">
          <Slider label="Launch speed" value={speed} min={8} max={35} step={1} unit="m/s" onChange={setSpeed} />
          <Slider label="Launch angle" value={angle} min={20} max={85} step={1} unit="°" onChange={setAngle} />
          <Slider label="Spin rate" value={spin} min={-540} max={540} step={20} unit="°/s" onChange={setSpin} />
        </div>

        <div className="border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={() => setTrail((t) => !t)}
            className={`w-full px-3 py-2 rounded text-sm font-semibold border transition-colors ${
              trail
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {trail ? '● CM trail ON — see the parabola' : '○ Show CM trail'}
          </button>
          <button
            onClick={() => setStrobe((s) => !s)}
            className={`w-full px-3 py-2 rounded text-sm font-semibold border transition-colors ${
              strobe
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {strobe ? '● Stroboscope ON' : '○ Stroboscope'}
          </button>
          <button
            onClick={() => setExplode((e) => !e)}
            className={`w-full px-3 py-2 rounded text-sm font-semibold border transition-colors ${
              explode
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {explode ? '● Explode at apex ON' : '○ Throw & explode'}
          </button>
          <button
            onClick={() => setOffPivot((p) => !p)}
            disabled={explode}
            className={`w-full px-3 py-2 rounded text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              offPivot
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {offPivot ? '● Spinning about a non-CM pivot' : '○ Spin about non-CM pivot'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setRunning((r) => !r)}
              className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
            >
              {running ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              onClick={relaunch}
              className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
            >
              ⟲ Relaunch
            </button>
          </div>
        </div>

        <div className="border-t border-usna-grid pt-3 mt-3">
          <Readout label={readout.exploded ? 'System CM  x' : offPivot ? 'Pivot  x' : 'CM  x'} value={readout.x.toFixed(1)} unit="m" />
          <Readout label={readout.exploded ? 'System CM  y' : offPivot ? 'Pivot  y' : 'CM  height y'} value={readout.y.toFixed(1)} unit="m" />
          <Readout label="CM  vₓ" value={readout.vx.toFixed(1)} unit="m/s" />
          <Readout label="CM  v_y" value={readout.vy.toFixed(1)} unit="m/s" />
          <Readout label="CM  |v|" value={vMag.toFixed(1)} unit="m/s" />
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Elapsed t" value={readout.t.toFixed(2)} unit="s" />
            <Readout label="Time of flight" value={readout.tf.toFixed(2)} unit="s" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 480, background: DEEP }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...(offPivot ? INFO.tumblingPivot : explode ? INFO.tumblingExplode : INFO.tumbling)} />
      </div>
    </div>
  );
}

// cache built bodies so we don't rebuild every frame
const _bodyCache = {};
function getBody(key) {
  if (!_bodyCache[key]) _bodyCache[key] = BODIES[key].make();
  return _bodyCache[key];
}

// =============================================================================
// SHARED LOCAL HELPERS
// =============================================================================

// Local retina canvas setup (mirrors @shared/lib/canvas setupCanvas so this file
// stays self-contained; DPR-aware and re-callable on resize).
function setupCanvas2D(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Marker radius grows with the square root of mass (area ∝ mass reads honestly).
function massRadiusPx(m) {
  return 10 + Math.sqrt(Math.max(0.1, m)) * 5.5;
}

// Clamp a world coordinate to the playground viewport.
const PLAY_WORLD_W = 14;
function clampWorld(v) {
  return Math.max(-PLAY_WORLD_W / 2 + 0.3, Math.min(PLAY_WORLD_W / 2 - 0.3, v));
}

// Map body-frame points to screen given a translation of the rotation anchor.
// `pivotOff` (optional) is the body-frame point that is being translated to
// (wx,wy); when omitted the body's own CM (origin) is the anchor.
function bodyToScreen(pts, wx, wy, theta, toX, toY, pivotOff) {
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const ax = pivotOff ? pivotOff.bx : 0;
  const ay = pivotOff ? pivotOff.by : 0;
  return pts.map((p) => {
    const rx = p.bx - ax, ry = p.by - ay;
    const worldX = wx + (rx * cosT - ry * sinT);
    const worldY = wy + (rx * sinT + ry * cosT);
    return { sx: toX(worldX), sy: toY(worldY), m: p.m };
  });
}

// Full solid draw of a body (connectors + filled masses) at world (wx,wy).
function drawBody(ctx, pts, wx, wy, theta, toX, toY, pivotOff) {
  const scr = bodyToScreen(pts, wx, wy, theta, toX, toY, pivotOff);
  ctx.save();
  ctx.strokeStyle = 'rgba(91,155,213,0.85)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  scr.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.stroke();
  ctx.restore();
  for (const p of scr) {
    const r = massRadiusPx(p.m) * 0.85;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, 2 * Math.PI);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(240,236,227,0.7)';
    ctx.stroke();
  }
}

// Lightweight body outline for stroboscope stamps (connectors + small dots),
// meant to be drawn under a reduced globalAlpha.
function drawBodyShape(ctx, pts, wx, wy, theta, toX, toY, stroke, pivotOff) {
  const scr = bodyToScreen(pts, wx, wy, theta, toX, toY, pivotOff);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  scr.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.stroke();
  for (const p of scr) {
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, massRadiusPx(p.m) * 0.55, 0, 2 * Math.PI);
    ctx.fillStyle = stroke;
    ctx.fill();
  }
  ctx.restore();
}

// Draw a filled star (used for the CM marker).
function drawStar(ctx, cx, cy, points, rOuter, rInner, fill, stroke) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.shadowColor = fill;
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

// Light background grid + world axes through the origin.
function drawGrid(ctx, W, H, toX, toY, worldW, sc) {
  ctx.save();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const step = 2; // meters
  const half = worldW / 2;
  for (let x = -half; x <= half + 0.001; x += step) {
    ctx.globalAlpha = Math.abs(x) < 0.01 ? 0.9 : 0.35;
    ctx.beginPath();
    ctx.moveTo(toX(x), 0);
    ctx.lineTo(toX(x), H);
    ctx.stroke();
  }
  const halfH = (H / sc) / 2;
  for (let y = -halfH; y <= halfH; y += step) {
    ctx.globalAlpha = Math.abs(y) < 0.01 ? 0.9 : 0.35;
    ctx.beginPath();
    ctx.moveTo(0, toY(y));
    ctx.lineTo(W, toY(y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// =============================================================================
// INFO PANELS
// =============================================================================
const INFO = {
  default: {
    title: 'The mass-weighted average point',
    description:
      'The center of mass is the average position of the material, weighted by how much mass sits at each spot. Drag the masses or change one value and the ★ slides toward the heavier side. Load the "Boomerang" preset: the ★ lands in the empty notch — the average of where the mass is need not be anywhere the object actually is. You can also grab the ★ and drag it: the selected mass repositions to inverse-solve for the CM you asked for, and a light mass has to travel much farther than a heavy one to move the average the same amount.',
    equation: String.raw`\vec{R}_{cm} = \frac{1}{M}\sum_i m_i\,\vec{r}_i, \qquad M=\sum_i m_i`,
  },
  tumbling: {
    title: 'A tumbling body is a point particle in disguise',
    description:
      'Launch the L-shaped body and it cartwheels through the air, and every point traces a different messy loop. Now flip on the CM trail (and the stroboscope). The chaos collapses into a single clean parabola: the ★ ignores the spin entirely and falls exactly like a thrown ball, because gravity provides no torque about the center of mass. F_ext = M a_cm means the whole extended object moves as if all its mass were concentrated at that one point, with the rotation just decorating the ride.',
    equation: String.raw`\sum \vec{F}_{ext} = M\,\vec{a}_{cm}`,
  },
  tumblingExplode: {
    title: 'Internal forces cannot move the center of mass',
    description:
      'At the top of the arc the body bursts into two fragments that hurl apart in opposite directions. Watch the ★: the fragments scatter, but their combined center of mass keeps sailing along the exact same parabola it was on before the blast. The explosion is an internal force — equal and opposite on the two pieces — so it adds zero net external force and cannot change a_cm. Only gravity, an external force, bends the CM path. (Turn on the CM trail to see it stay glued to the dashed guide curve.)',
    equation: String.raw`\vec{F}_{int}\ \text{cancels} \implies \vec{a}_{cm}=\frac{\sum\vec{F}_{ext}}{M}=-g\,\hat{y}`,
  },
  tumblingPivot: {
    title: 'Only the true CM traces the clean parabola',
    description:
      'Here the body is forced to spin about an off-center pivot instead of its own center of mass. The gray ★ we track is that pivot — and its path is no longer a parabola but a looping cycloid, because the true CM is orbiting the pivot even as the whole thing falls. Turn the CM trail on to see the mess. The clean projectile parabola is special to one point: the mass-weighted average. Spin about anything else and the point wobbles. Toggle back to CM-spin and the parabola snaps clean again.',
    equation: String.raw`\vec{r}_{pivot}(t)=\vec{R}_{cm}(t)-R(\theta)\,\vec{d}_{cm\to pivot}`,
  },
};
