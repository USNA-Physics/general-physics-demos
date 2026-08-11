import { useState, useMemo, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { drawArrow, resultant } from '@shared/lib/vectorArrow';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * D05 · Relative Motion / Riverboat (L5) — vector addition of velocities.
 *
 * A boat drives across a river of width W at a constant velocity RELATIVE TO THE
 * WATER (speed + heading), while the water itself moves downstream at the
 * current velocity. The boat's velocity over the GROUND is the vector sum
 *
 *     v_bg = v_bw + v_wg           (boat/ground = boat/water + water/ground)
 *
 * which is exactly the Galilean velocity-addition rule. Everything the student
 * sees — the tip-to-tail arrow triangle, the animated crossing, the ground track,
 * the readouts — is derived from that single sum. The FRAME choice is not a
 * second simulation: it is the same trajectory viewed from a different observer.
 * In the ground frame the banks are fixed and the boat "crabs" diagonally across;
 * in the water frame we ride along with the current, so the boat goes dead
 * straight along its heading while the banks and dock slide upstream past it.
 *
 * THE MOMENTS
 *   (1) Point the boat "straight across" (heading 90°) and you STILL drift
 *       downstream — the current adds a sideways component you never asked for.
 *   (2) The frame view shows one motion looking completely different. Same
 *       vectors, different observer. That is the whole idea of relative motion.
 *       The SPLIT view puts both observers on screen at once so you never have
 *       to hold one in memory.
 *
 * Single mode ('default'). Canvas + rAF + ResizeObserver, SI units internally.
 *
 * ── D05 maxed pass ──────────────────────────────────────────────────────────
 *  FIX  In the WATER frame the flow streaks now FREEZE (you ride the water, so
 *       the water is motionless relative to you) while the banks/dock slide
 *       upstream. In the GROUND frame the streaks scroll downstream as before.
 *       Previously the streaks scrolled in both frames, contradicting the idea.
 *  WOW  A "Split" view renders the ground frame and water frame side by side
 *       simultaneously — same motion, two observers, seen at once.
 *  INT  Drag the blue v_bw arrow tip directly on the canvas to rotate the
 *       heading; the velocity triangle reforms live.
 *  PHY  "Fastest crossing" preset (heading 90°) — quickest across even though
 *       you miss the dock — contrasted with the crab "hit the dock" solution.
 *  CUST River width is a slider; drift scales with the resulting crossing time.
 *  EXPL A live component-equation overlay shows v_bg = v_bw + v_wg with the
 *       current numbers plugged in, per axis.
 */

// ── palette (hex for canvas; tailwind classes elsewhere) ──────────────────────
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const BLUE = '#5B9BD5';   // boat-through-water vector
const CURRENT = '#7FB77E'; // current vector
const TRACK = '#E8A0A0';   // ground-track / resultant

// River geometry (SI). Bank-to-bank width is now user-controlled; the dock sits
// on the far bank directly opposite the launch point, so "downstream drift" is
// the miss distance.
const RIVER_W_DEFAULT = 80; // m, bank-to-bank

const DEG = Math.PI / 180;

// Presets set boat heading to make the teaching moments land.
//   fastest  → aim 90° across: quickest crossing (max cross-stream speed) but
//              the current sweeps you downstream so you MISS the dock.
//   dock     → crab upstream just enough that the cross-stream sum cancels the
//              current → you land on the dock (but the crossing takes longer).
const PRESETS = {
  fastest: { label: 'Fastest crossing (aim 90°)' },
  dock: { label: 'Hit the dock (crab upstream)' },
};

const DEFAULTS = {
  boatSpeed: 4,     // m/s relative to water
  heading: 90,      // deg, measured CCW from downstream (+x). 90° = straight across
  current: 2,       // m/s magnitude of the current
  currentDir: 0,    // deg, direction the water flows (0° = downstream, +x)
  riverW: RIVER_W_DEFAULT, // m
  view: 'ground',   // 'ground' | 'water' | 'split'
};

// Given boat speed/heading, current speed/direction and river width (all SI,
// degrees), return every derived quantity in one place so canvas + readouts
// agree.
function solve(boatSpeed, headingDeg, current, currentDirDeg, riverW) {
  const h = headingDeg * DEG;
  const c = currentDirDeg * DEG;
  // Physics convention: +x downstream, +y across toward the far bank.
  const bw = { x: boatSpeed * Math.cos(h), y: boatSpeed * Math.sin(h) };   // boat rel water
  const wg = { x: current * Math.cos(c), y: current * Math.sin(c) };       // water rel ground
  const bg = { x: bw.x + wg.x, y: bw.y + wg.y };                           // boat rel ground

  // Cross-stream progress is bg.y; without it the boat never lands.
  const vCross = bg.y;
  const crossingTime = vCross > 1e-6 ? riverW / vCross : Infinity;
  // Net downstream position when the far bank is reached (the miss distance).
  const drift = Number.isFinite(crossingTime) ? bg.x * crossingTime : Infinity;
  const groundSpeed = Math.hypot(bg.x, bg.y);
  // Course = bearing of the ground track, measured from "straight across" (the
  // intended line). Positive = pushed downstream.
  const courseFromAcross = Math.atan2(bg.x, bg.y) / DEG;

  return { bw, wg, bg, crossingTime, drift, groundSpeed, courseFromAcross, vCross, riverW };
}

// For the "hit the dock" preset: choose the heading so the downstream component
// of the boat's water-velocity exactly cancels the current's downstream push,
// while keeping the chosen boat speed. Requires boatSpeed > |current_x|.
function crabHeading(boatSpeed, current, currentDirDeg) {
  const wgx = current * Math.cos(currentDirDeg * DEG);
  // Need bw.x = -wgx  →  cos(h) = -wgx / boatSpeed, with sin(h) > 0 (cross the river).
  const ratio = -wgx / boatSpeed;
  if (Math.abs(ratio) >= 1) return 90; // can't fully compensate; best effort = straight
  // pick the solution with positive cross-stream component
  const h = Math.acos(Math.max(-1, Math.min(1, ratio)));
  return h / DEG;
}

export default function RelativeMotion({ mode = 'default' }) {
  void mode; // single-mode demo; router still passes the prop

  const [boatSpeed, setBoatSpeed] = useState(DEFAULTS.boatSpeed);
  const [heading, setHeading] = useState(DEFAULTS.heading);
  const [current, setCurrent] = useState(DEFAULTS.current);
  const [currentDir, setCurrentDir] = useState(DEFAULTS.currentDir);
  const [riverW, setRiverW] = useState(DEFAULTS.riverW);
  const [view, setView] = useState(DEFAULTS.view);
  const [playing, setPlaying] = useState(true);

  const reset = () => {
    setBoatSpeed(DEFAULTS.boatSpeed);
    setHeading(DEFAULTS.heading);
    setCurrent(DEFAULTS.current);
    setCurrentDir(DEFAULTS.currentDir);
    setRiverW(DEFAULTS.riverW);
    setView(DEFAULTS.view);
    setPlaying(true);
  };

  const applyPreset = (key) => {
    if (key === 'fastest') {
      setHeading(90);
    } else if (key === 'dock') {
      setHeading(crabHeading(boatSpeed, current, currentDir));
    }
    setPlaying(true);
  };

  // Single source of truth for all derived numbers (SI).
  const sol = useMemo(
    () => solve(boatSpeed, heading, current, currentDir, riverW),
    [boatSpeed, heading, current, currentDir, riverW],
  );

  // Are we (approximately) landing on the dock? Used for the readout badge.
  const onDock = Number.isFinite(sol.drift) && Math.abs(sol.drift) < 1.0;

  // ── refs the animation loop reads without re-subscribing ────────────────────
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const solRef = useRef(sol);
  const viewRef = useRef(view);
  const playingRef = useRef(playing);
  solRef.current = sol;
  viewRef.current = view;
  playingRef.current = playing;

  // Live setter for the heading, read by the pointer-drag handler without
  // re-subscribing the effect. Also pauses on grab so the triangle is steady.
  const setHeadingRef = useRef(setHeading);
  setHeadingRef.current = setHeading;
  const setPlayingRef = useRef(setPlaying);
  setPlayingRef.current = setPlaying;

  // Layout metrics for the CURRENT render, stashed so pointer math can map a
  // screen point back to a heading (the drag geometry lives in whatever pane
  // holds the interactive boat). Written every frame by draw().
  const hitRef = useRef(null); // { boatX, boatY, mAlong, mAcross, vScale, tipX, tipY }
  const draggingRef = useRef(false);

  // Progress of the crossing, 0 → 1, kept in a ref so React doesn't re-render
  // per frame. We publish a throttled copy to state for the live progress bar.
  const progRef = useRef(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    let lastPublish = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    /**
     * Render ONE river view into a rectangle [x0..x0+w] × [0..H] of the canvas.
     *
     * @param frame     'ground' | 'water'
     * @param x0,w      left edge and width of this pane (px)
     * @param p         crossing progress 0→1 (shared across panes)
     * @param now       timestamp (ms), for streak animation
     * @param interactive  whether this pane owns the drag hit-target; when true
     *                     we stash the boat/arrow geometry into hitRef.
     */
    const drawScene = (frame, x0, w, p, now, interactive) => {
      const s = solRef.current;
      const riverWm = s.riverW;

      // ---- world → screen mapping for THIS pane ----
      const marginX = Math.max(30, w * 0.10);
      const topBank = 46;              // screen-y of the far bank (dock side)
      const botBank = H - 60;          // screen-y of the near bank (launch side)
      const acrossPx = botBank - topBank;
      const mAcross = acrossPx / riverWm;          // px per metre (across)
      const mAlong = mAcross;                      // isotropic scale
      const originX = x0 + marginX;                // launch point screen-x

      const launch = { x: originX, y: botBank };
      const dockWorldY = riverWm;                  // far bank

      // metres travelled at prog p (ground-frame displacement of the boat) and
      // the displacement the water has carried in that time.
      const tNow = Number.isFinite(s.crossingTime) ? p * s.crossingTime : 0;
      const groundX = s.bg.x * tNow;   // m downstream (ground frame)
      const groundY = s.bg.y * tNow;   // m across
      const waterShiftX = s.wg.x * tNow; // how far the water has carried downstream
      const waterShiftY = s.wg.y * tNow;

      // In the WATER frame we sit on the water: fixed ground features (banks,
      // dock, launch) appear displaced by -waterShift.
      const sceneDX = frame === 'water' ? -waterShiftX * mAlong : 0;
      const sceneDY = frame === 'water' ? waterShiftY * mAcross : 0; // +y up → screen up

      // ---- clip to this pane so split panes never bleed ----
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, w, H);
      ctx.clip();

      // ---- water body ----
      ctx.fillStyle = '#0B1A33';
      ctx.fillRect(x0, topBank, w, botBank - topBank);

      // ---- flow streaks ----------------------------------------------------
      // FIX: streaks represent the WATER's own motion. In the ground frame the
      // water flows past, so the streaks scroll downstream. In the water frame
      // we RIDE the water — the water is motionless relative to us — so the
      // streaks FREEZE. (The banks slide upstream instead; see sceneDX below.)
      const flowPhase = frame === 'water'
        ? 0
        : (now / 1000) * s.wg.x * mAlong * 0.6;
      ctx.strokeStyle = 'rgba(127,183,126,0.18)';
      ctx.lineWidth = 1.5;
      const streakGap = 34;
      for (let yy = topBank + 16; yy < botBank; yy += 20) {
        for (let k = -2; k < w / streakGap + 2; k++) {
          const sx = x0 + (((k * streakGap + flowPhase) % (w + streakGap) + (w + streakGap)) % (w + streakGap) - streakGap);
          ctx.beginPath();
          ctx.moveTo(sx, yy);
          ctx.lineTo(sx + 14, yy);
          ctx.stroke();
        }
      }

      // ---- banks (slide in water frame) ----
      const bankY = (worldY) => botBank - worldY * mAcross + sceneDY;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, bankY(0)); ctx.lineTo(x0 + w, bankY(0)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, bankY(riverWm)); ctx.lineTo(x0 + w, bankY(riverWm)); ctx.stroke();

      // grass tint above the far bank / below the near bank
      ctx.fillStyle = 'rgba(80,90,70,0.25)';
      ctx.fillRect(x0, 0, w, Math.max(0, bankY(riverWm)));
      ctx.fillRect(x0, bankY(0), w, H - bankY(0));

      // ---- dock on the far bank, directly opposite the launch (slides in water frame) ----
      const dockScreenX = launch.x + sceneDX;
      const dockScreenY = bankY(dockWorldY);
      ctx.fillStyle = GOLD;
      ctx.fillRect(dockScreenX - 16, dockScreenY - 5, 32, 10);
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('DOCK', dockScreenX, dockScreenY - 8);

      // launch marker (a fixed ground point → slides in water frame too)
      const launchScreenX = launch.x + sceneDX;
      const launchScreenY = bankY(0);
      ctx.fillStyle = MUTED;
      ctx.beginPath();
      ctx.arc(launchScreenX, launchScreenY, 4, 0, 2 * Math.PI);
      ctx.fill();

      // ---- intended straight-across line (launch → dock), a ground reference ----
      ctx.strokeStyle = 'rgba(197,183,131,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(launchScreenX, launchScreenY);
      ctx.lineTo(dockScreenX, dockScreenY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ---- boat screen position depends on the frame ----
      //   ground frame: boat = launch + ground displacement (crabs diagonally)
      //   water frame : boat = launch + (ground disp − water shift), i.e. the
      //                 boat's displacement THROUGH the water → dead straight up
      //                 its heading, from a launch point that itself slides.
      const boatDispX = frame === 'water' ? (groundX - waterShiftX) : groundX;
      const boatDispY = frame === 'water' ? (groundY - waterShiftY) : groundY;
      // Anchor the boat to the (possibly shifted) launch point so that in the
      // water frame the boat runs straight while the launch/banks slide together.
      const boatX = launchScreenX + boatDispX * mAlong;
      const boatY = launchScreenY - boatDispY * mAcross;

      // ---- travelled track (the crab path in this frame) ----
      ctx.strokeStyle = TRACK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const STEPS = 48;
      for (let i = 0; i <= Math.max(1, Math.round(p * STEPS)); i++) {
        const f = (i / STEPS);
        const tt = Number.isFinite(s.crossingTime) ? f * s.crossingTime : 0;
        const gx = s.bg.x * tt, gy = s.bg.y * tt;
        const wx = s.wg.x * tt, wy = s.wg.y * tt;
        const dispX = frame === 'water' ? (gx - wx) : gx;
        const dispY = frame === 'water' ? (gy - wy) : gy;
        const scrX = launchScreenX + dispX * mAlong;
        const scrY = launchScreenY - dispY * mAcross;
        if (i === 0) ctx.moveTo(scrX, scrY); else ctx.lineTo(scrX, scrY);
      }
      ctx.stroke();

      // ---- the boat hull, pointing along its HEADING through the water ----
      const screenHeading = Math.atan2(-s.bw.y, s.bw.x); // +y-up world → screen
      ctx.save();
      ctx.translate(boatX, boatY);
      ctx.rotate(screenHeading);
      ctx.fillStyle = TEXT;
      ctx.strokeStyle = NAVY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();       // simple pointed hull, nose along +x (local)
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, 7);
      ctx.lineTo(-8, -7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // ---- live velocity triangle, tip-to-tail, anchored at the boat ----
      const vScale = 14; // px per (m/s)
      const a1 = { dx: s.bw.x * vScale, dy: -s.bw.y * vScale };  // boat/water (blue)
      const a2 = { dx: s.wg.x * vScale, dy: -s.wg.y * vScale };  // current (green), tip-to-tail
      const res = resultant([a1, a2]);                           // boat/ground (track)

      drawArrow(ctx, { x: boatX, y: boatY, dx: a1.dx, dy: a1.dy, color: BLUE, width: 3, label: 'v_bw' });
      drawArrow(ctx, { x: boatX + a1.dx, y: boatY + a1.dy, dx: a2.dx, dy: a2.dy, color: CURRENT, width: 3, label: 'v_wg' });
      drawArrow(ctx, { x: boatX, y: boatY, dx: res.dx, dy: res.dy, color: TRACK, width: 3.5, label: 'v_bg' });

      // ---- drag handle on the v_bw tip (interactive pane only) ----
      const tipX = boatX + a1.dx, tipY = boatY + a1.dy;
      if (interactive) {
        // a grabbable ring so it reads as a handle on a phone
        ctx.beginPath();
        ctx.arc(tipX, tipY, 9, 0, 2 * Math.PI);
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(91,155,213,0.25)';
        ctx.fill();
        // stash geometry for the pointer handler
        hitRef.current = { boatX, boatY, tipX, tipY };
      }

      // ---- pane label ----
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = MUTED;
      ctx.fillText(
        frame === 'ground'
          ? 'GROUND FRAME · banks fixed, boat crabs'
          : 'WATER FRAME · water frozen, banks drift',
        x0 + 12, topBank + 8,
      );

      ctx.restore(); // undo clip
      return { x0, w };
    };

    const draw = (now) => {
      if (lastNow === undefined) lastNow = now;
      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60; // bounded step: survives tab throttling

      const s = solRef.current;
      const v = viewRef.current;

      // Advance the crossing. Sped so a crossing takes ~6 s regardless of
      // geometry; loops when the far bank is reached. Frozen while dragging.
      if (playingRef.current && !draggingRef.current && Number.isFinite(s.crossingTime)) {
        const speedup = 6 / s.crossingTime;
        progRef.current += dt * speedup;
        if (progRef.current >= 1) progRef.current = 0;
      }
      const p = progRef.current;

      ctx.clearRect(0, 0, W, H);
      hitRef.current = null; // recomputed by the interactive pane each frame

      if (v === 'split') {
        // WOW: both observers on screen at once. Left = ground (interactive),
        // right = water. A divider makes the split obvious.
        const half = W / 2;
        drawScene('ground', 0, half, p, now, true);
        drawScene('water', half, W - half, p, now, false);
        ctx.strokeStyle = GRID;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(half, 0);
        ctx.lineTo(half, H);
        ctx.stroke();
      } else {
        drawScene(v, 0, W, p, now, true);
      }

      if (now - lastPublish > 100) {
        lastPublish = now;
        setProgress(progRef.current);
      }

      raf = requestAnimationFrame(draw);
    };

    // ── pointer drag: grab the v_bw tip and rotate the heading ──────────────
    const pointFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const applyHeadingFromPoint = (pt) => {
      const h = hitRef.current;
      if (!h) return;
      // Heading angle = direction from the boat to the pointer. Screen +y is
      // down, so world dy = -(screen dy). Measured CCW from downstream (+x),
      // clamped to the slider's crossing range so the boat still reaches the
      // far bank (matching the 20°–160° control).
      const dxs = pt.x - h.boatX;
      const dys = pt.y - h.boatY;
      let deg = Math.atan2(-dys, dxs) / DEG;
      deg = Math.max(20, Math.min(160, deg));
      setHeadingRef.current(Math.round(deg));
    };

    const onDown = (e) => {
      const h = hitRef.current;
      if (!h) return;
      const pt = pointFromEvent(e);
      // grab if the press lands near the v_bw tip handle
      const grabR = 22;
      if (Math.hypot(pt.x - h.tipX, pt.y - h.tipY) <= grabR) {
        draggingRef.current = true;
        setPlayingRef.current(false); // hold the crossing still while steering
        canvas.setPointerCapture?.(e.pointerId);
        applyHeadingFromPoint(pt);
        e.preventDefault();
      }
    };
    const onMove = (e) => {
      if (!draggingRef.current) return;
      applyHeadingFromPoint(pointFromEvent(e));
      e.preventDefault();
    };
    const onUp = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // Restart the crossing animation whenever the geometry changes materially.
  useEffect(() => {
    progRef.current = 0;
    setProgress(0);
  }, [boatSpeed, heading, current, currentDir, riverW]);

  // ── formatted readouts ──────────────────────────────────────────────────────
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const sgn = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const crossingStr = Number.isFinite(sol.crossingTime) ? fmt(sol.crossingTime) : 'never';
  const driftStr = Number.isFinite(sol.drift) ? fmt(sol.drift) : '—';
  const courseStr = Number.isFinite(sol.courseFromAcross) ? fmt(Math.abs(sol.courseFromAcross)) : '—';
  const courseSide = sol.courseFromAcross >= 0 ? 'downstream' : 'upstream';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {/* View / frame — the deep idea, put it first */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Observer view</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              ['ground', 'Ground'],
              ['water', 'Water'],
              ['split', 'Split'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`px-2 py-1.5 rounded text-sm border transition-colors ${
                  view === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-usna-muted text-xs mt-1.5">
            {view === 'ground'
              ? 'Banks fixed; the boat crabs diagonally, the current flows past.'
              : view === 'water'
                ? 'Ride the current: the water is frozen, the boat runs straight, the banks drift upstream.'
                : 'Both observers at once — same motion, side by side.'}
          </p>
        </div>

        {/* Presets */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Presets</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="px-3 py-1.5 rounded text-sm text-left border bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Boat controls */}
        <div className="border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">Boat (relative to water)</div>
          <Slider label="Boat speed" value={boatSpeed} min={0.5} max={8} step={0.1} unit="m/s" onChange={setBoatSpeed} />
          <Slider label="Heading" value={Number(heading.toFixed(0))} min={20} max={160} step={1} unit="° from downstream" onChange={setHeading} />
          <p className="text-usna-muted text-xs -mt-1">Tip: drag the blue v_bw arrow tip on the canvas to steer.</p>
        </div>

        {/* Current controls */}
        <div className="border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">Current (water over ground)</div>
          <Slider label="Current speed" value={current} min={0} max={6} step={0.1} unit="m/s" onChange={setCurrent} />
          <Slider label="Current direction" value={Number(currentDir.toFixed(0))} min={-40} max={40} step={1} unit="° from downstream" onChange={setCurrentDir} />
        </div>

        {/* River geometry */}
        <div className="border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-2">River</div>
          <Slider label="Width" value={riverW} min={20} max={200} step={5} unit="m" onChange={setRiverW} />
          <p className="text-usna-muted text-xs -mt-1">Wider river → longer crossing → more drift.</p>
        </div>

        {/* Play / pause */}
        <div className="border-t border-usna-grid pt-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause crossing' : '▶ Play crossing'}
          </button>
        </div>

        {/* Readouts */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Crossing time" value={crossingStr} unit="s" />
          <Readout label="Downstream drift" value={driftStr} unit="m" />
          <Readout label="Ground speed" value={fmt(sol.groundSpeed)} unit="m/s" />
          <Readout label={`Course (${courseSide})`} value={courseStr} unit="°" />
          <div className={`mt-2 text-xs font-mono px-2 py-1 rounded ${onDock ? 'bg-usna-gold/20 text-usna-gold' : 'bg-usna-deep text-usna-muted'}`}>
            {Number.isFinite(sol.drift)
              ? (onDock ? 'ON THE DOCK — cross-stream sum cancels the current' : `Missing the dock by ${driftStr} m ${sol.drift >= 0 ? 'downstream' : 'upstream'}`)
              : 'Boat cannot reach the far bank (no cross-stream velocity)'}
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 480 }}
        >
          <canvas ref={canvasRef} className="block" />

          {/* EXPLAIN: live component-equation overlay, numbers plugged in per axis */}
          <div className="absolute top-2 right-3 text-[11px] font-mono leading-tight text-right bg-usna-navy/70 rounded px-2 py-1.5 pointer-events-none">
            <div className="text-usna-text/90 mb-0.5">
              <span style={{ color: TRACK }}>v_bg</span> = <span style={{ color: BLUE }}>v_bw</span> + <span style={{ color: CURRENT }}>v_wg</span>
            </div>
            <div>
              <span style={{ color: MUTED }}>x:</span>{' '}
              <span style={{ color: TRACK }}>{sgn(sol.bg.x)}</span> ={' '}
              <span style={{ color: BLUE }}>{sgn(sol.bw.x)}</span> +{' '}
              <span style={{ color: CURRENT }}>{sgn(sol.wg.x)}</span>
            </div>
            <div>
              <span style={{ color: MUTED }}>y:</span>{' '}
              <span style={{ color: TRACK }}>{sgn(sol.bg.y)}</span> ={' '}
              <span style={{ color: BLUE }}>{sgn(sol.bw.y)}</span> +{' '}
              <span style={{ color: CURRENT }}>{sgn(sol.wg.y)}</span>
            </div>
            <div style={{ color: MUTED }} className="mt-0.5">m/s (x=downstream, y=across)</div>
          </div>

          {/* legend chips */}
          <div className="absolute bottom-2 right-3 text-[11px] font-mono space-y-0.5 text-right pointer-events-none">
            <div style={{ color: BLUE }}>v_bw — boat through water</div>
            <div style={{ color: CURRENT }}>v_wg — current</div>
            <div style={{ color: TRACK }}>v_bg — track over ground</div>
          </div>
          {/* crossing progress */}
          <div className="absolute bottom-2 left-3 w-40 h-1.5 rounded bg-usna-deep overflow-hidden">
            <div className="h-full bg-usna-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>

        <InfoPanel {...INFO} />
      </div>
    </div>
  );
}

const INFO = {
  title: 'Relative motion is vector addition',
  description:
    'The boat\'s velocity over the ground is the vector sum of its velocity through the water and the water\'s velocity over the ground. Aim the boat "straight across" (90°) and it still lands downstream, because the current quietly adds a sideways component you never steered — that is the "fastest crossing" preset: you reach the far bank in the least time (maximum cross-stream speed) but you miss. To hit the dock you must crab upstream until the boat\'s upstream component exactly cancels the current, which costs you crossing time — that is the "hit the dock" preset. Steer by dragging the blue v_bw arrow tip and watch the triangle reform. The deepest move is the observer view: in the ground frame the boat crabs diagonally while the banks stand still and the current flows past; in the water frame you ride the current, so the water is frozen and the boat runs dead straight up its heading while the whole shoreline slides upstream. The split view shows both at once — same motion, two observers. Naval hook: this is the geometry of ship-relative (apparent) wind and of an UNREP approach — a replenishment ship matches the receiving ship\'s course and speed so that, in the ship-to-ship frame, the two vessels appear motionless and lines can be passed across a fixed gap even though both are making 12+ knots over the ground.',
  equation: String.raw`\vec v_{bg} = \vec v_{bw} + \vec v_{wg}`,
};
