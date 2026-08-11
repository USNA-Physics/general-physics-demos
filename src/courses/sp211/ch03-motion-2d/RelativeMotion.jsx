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

// Pick a "nice" grid step (1, 2, or 5 × 10^k) so axis ticks land on round metres.
function niceStep(range, target = 6) {
  const raw = Math.max(1e-6, range / target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

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

      // ---- fit the whole crossing into this pane (stable, isotropic) ---------
      // Work in metres, then map with one scale so nothing ever leaves the frame.
      // The scale depends only on the configuration (not the animation time), so
      // the view holds steady for a whole crossing and rescales when a control
      // changes.
      const T = Number.isFinite(s.crossingTime)
        ? s.crossingTime
        : (Math.abs(s.bg.y) > 1e-6 ? riverWm / Math.abs(s.bg.y) : 10);

      // Galilean frame shift: the water frame subtracts the water's displacement,
      // so every ground-fixed feature slides by −v_wg·t.
      const shiftAt = (tt) => (frame === 'water'
        ? { x: -s.wg.x * tt, y: -s.wg.y * tt }
        : { x: 0, y: 0 });

      // ground-fixed reference points and the boat's per-frame displacement
      const launchW = { x: 0, y: 0 };
      const dockW = { x: 0, y: riverWm };
      const buoyW = { x: riverWm * 0.32, y: riverWm * 0.55 }; // mid-channel hazard
      const boatDisp = (tt) => (frame === 'water'
        ? { x: s.bw.x * tt, y: s.bw.y * tt }   // straight up the heading
        : { x: s.bg.x * tt, y: s.bg.y * tt }); // crabs over the ground

      // bounding box over the whole crossing (t = 0 and t = T), including the
      // slide of the ground features in the water frame
      const cand = [{ x: 0, y: 0 }, { x: 0, y: riverWm }];
      for (const tt of [0, T]) {
        const sc = shiftAt(tt);
        cand.push({ x: launchW.x + sc.x, y: launchW.y + sc.y });
        cand.push({ x: dockW.x + sc.x, y: dockW.y + sc.y });
        cand.push({ x: buoyW.x + sc.x, y: buoyW.y + sc.y });
        cand.push(boatDisp(tt));
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of cand) {
        if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
      }
      let boxW = (maxX - minX) || riverWm, boxH = (maxY - minY) || riverWm;
      minX -= boxW * 0.12; maxX += boxW * 0.12;
      minY -= boxH * 0.12; maxY += boxH * 0.12;
      boxW = maxX - minX; boxH = maxY - minY;

      const mL = 48, mR = 16, mT = 26, mB = 38; // px margins (axis labels live here)
      const availW = Math.max(20, w - mL - mR);
      const availH = Math.max(20, H - mT - mB);
      const scale = Math.min(availW / boxW, availH / boxH);
      const cxW = (minX + maxX) / 2, cyW = (minY + maxY) / 2;
      const paneCX = x0 + mL + availW / 2;
      const paneCY = mT + availH / 2;
      const wx = (X) => paneCX + (X - cxW) * scale;   // metres → screen-x
      const wy = (Y) => paneCY - (Y - cyW) * scale;   // metres → screen-y (+y up)

      const t = p * T;
      const sh = shiftAt(t);
      const scr = (X, Y) => ({ x: wx(X + sh.x), y: wy(Y + sh.y) }); // ground-fixed point now

      // ---- clip to this pane so split panes never bleed ----
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, w, H);
      ctx.clip();

      // ---- banks and water body (banks are ground-fixed → slide in water frame) ----
      const nearY = scr(0, 0).y;          // near bank, world y = 0
      const farY = scr(0, riverWm).y;     // far bank, world y = riverW
      const bandTop = Math.min(nearY, farY), bandBot = Math.max(nearY, farY);
      ctx.fillStyle = '#0B1A33';
      ctx.fillRect(x0, bandTop, w, bandBot - bandTop);
      ctx.fillStyle = 'rgba(80,90,70,0.22)';
      ctx.fillRect(x0, 0, w, Math.max(0, bandTop));
      ctx.fillRect(x0, bandBot, w, H - bandBot);
      ctx.strokeStyle = GRID; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, nearY); ctx.lineTo(x0 + w, nearY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, farY); ctx.lineTo(x0 + w, farY); ctx.stroke();

      // ---- coordinate grid for this observer's frame (fixed metre lattice) ----
      // In the ground frame the grid is the ground; in the water frame it is the
      // water, and the ground features slide across it. The labels are metres.
      const visX0 = cxW - (availW / 2) / scale, visX1 = cxW + (availW / 2) / scale;
      const visY0 = cyW - (availH / 2) / scale, visY1 = cyW + (availH / 2) / scale;
      const gstep = niceStep(Math.max(visX1 - visX0, visY1 - visY0));
      ctx.strokeStyle = 'rgba(90,105,125,0.22)';
      ctx.lineWidth = 1;
      ctx.fillStyle = MUTED;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let gx = Math.ceil(visX0 / gstep) * gstep; gx <= visX1; gx += gstep) {
        const sx = wx(gx);
        ctx.beginPath(); ctx.moveTo(sx, mT); ctx.lineTo(sx, H - mB); ctx.stroke();
        ctx.fillText(String(Math.round(gx)), sx, H - mB + 4);
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let gy = Math.ceil(visY0 / gstep) * gstep; gy <= visY1; gy += gstep) {
        const sy = wy(gy);
        ctx.beginPath(); ctx.moveTo(x0 + mL, sy); ctx.lineTo(x0 + w - mR, sy); ctx.stroke();
        ctx.fillText(String(Math.round(gy)), x0 + mL - 5, sy);
      }
      ctx.fillStyle = 'rgba(139,140,142,0.9)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('downstream x (m)', x0 + mL + availW / 2, H - 1);
      ctx.save();
      ctx.translate(x0 + 11, mT + availH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('across y (m)', 0, 0);
      ctx.restore();

      // ---- flow streaks: the water's own motion (scroll in ground, still in water) ----
      ctx.strokeStyle = 'rgba(127,183,126,0.16)';
      ctx.lineWidth = 1.5;
      const flowPhase = frame === 'water' ? 0 : (now / 1000) * s.wg.x * scale * 0.6;
      const streakGap = 32;
      for (let yy = bandTop + 14; yy < bandBot; yy += 18) {
        for (let k = -2; k < w / streakGap + 2; k++) {
          const sx = x0 + (((k * streakGap + flowPhase) % (w + streakGap) + (w + streakGap)) % (w + streakGap) - streakGap);
          ctx.beginPath();
          ctx.moveTo(sx, yy);
          ctx.lineTo(sx + 13, yy);
          ctx.stroke();
        }
      }

      // ---- intended straight-across line (launch → dock), a ground reference ----
      const Lp = scr(launchW.x, launchW.y);
      const Dp = scr(dockW.x, dockW.y);
      ctx.strokeStyle = 'rgba(197,183,131,0.30)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.moveTo(Lp.x, Lp.y); ctx.lineTo(Dp.x, Dp.y); ctx.stroke();
      ctx.setLineDash([]);

      // ---- mid-channel buoy: a second ground-fixed hazard (drifts in water frame) ----
      const Bp = scr(buoyW.x, buoyW.y);
      ctx.fillStyle = '#D9843B';
      ctx.beginPath(); ctx.arc(Bp.x, Bp.y, 7, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = NAVY; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#D9843B'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(Bp.x, Bp.y - 7); ctx.lineTo(Bp.x, Bp.y - 19); ctx.stroke();
      ctx.fillStyle = '#D9843B';
      ctx.beginPath(); ctx.moveTo(Bp.x, Bp.y - 19); ctx.lineTo(Bp.x + 10, Bp.y - 16); ctx.lineTo(Bp.x, Bp.y - 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = MUTED; ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('buoy', Bp.x, Bp.y + 8);

      // ---- dock on the far bank, opposite the launch (large, clearly marked) ----
      ctx.fillStyle = GOLD;
      ctx.fillRect(Dp.x - 28, Dp.y - 7, 56, 14);
      ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
      ctx.strokeRect(Dp.x - 28, Dp.y - 7, 56, 14);
      ctx.fillStyle = '#7A5A2E';
      ctx.fillRect(Dp.x - 26, Dp.y - 7, 3, 14);
      ctx.fillRect(Dp.x + 23, Dp.y - 7, 3, 14);
      ctx.fillStyle = GOLD; ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('DOCK', Dp.x, Dp.y - 11);

      // ---- launch marker (a fixed ground point → slides in the water frame) ----
      ctx.fillStyle = MUTED;
      ctx.beginPath(); ctx.arc(Lp.x, Lp.y, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('launch', Lp.x, Lp.y + 6);

      // ---- travelled track in this observer's frame ----
      ctx.strokeStyle = TRACK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const STEPS = 60;
      const upto = Math.max(1, Math.round(p * STEPS));
      for (let i = 0; i <= upto; i++) {
        const d = boatDisp((i / STEPS) * T);
        const px = wx(d.x), py = wy(d.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // ---- the boat, positioned in this frame and pointed along its heading ----
      const bd = boatDisp(t);
      const boatX = wx(bd.x), boatY = wy(bd.y);
      const screenHeading = Math.atan2(-s.bw.y, s.bw.x); // +y-up world → screen
      ctx.save();
      ctx.translate(boatX, boatY);
      ctx.rotate(screenHeading);
      ctx.fillStyle = TEXT;
      ctx.strokeStyle = NAVY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();       // simple pointed hull, nose along +x (local)
      ctx.moveTo(15, 0);
      ctx.lineTo(-9, 8);
      ctx.lineTo(-9, -8);
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
        ctx.beginPath();
        ctx.arc(tipX, tipY, 9, 0, 2 * Math.PI);
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(91,155,213,0.25)';
        ctx.fill();
        hitRef.current = { boatX, boatY, tipX, tipY };
      }

      // ---- pane label ----
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = MUTED;
      ctx.fillText(
        frame === 'ground'
          ? 'Ground frame: banks fixed, boat crabs across'
          : 'Water frame: water at rest, banks drift',
        x0 + mL + 4, mT + 2,
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
                : 'Both observers at once: same motion, shown side by side.'}
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
              ? (onDock ? 'On the dock: the cross-stream components cancel the current' : `Missing the dock by ${driftStr} m ${sol.drift >= 0 ? 'downstream' : 'upstream'}`)
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
            <div style={{ color: BLUE }}>v_bw: boat through water</div>
            <div style={{ color: CURRENT }}>v_wg: current</div>
            <div style={{ color: TRACK }}>v_bg: track over ground</div>
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
    'The boat\'s velocity over the ground is the vector sum of its velocity through the water and the water\'s velocity over the ground. Aiming straight across (90 degrees) still lands the boat downstream, because the current contributes a cross-stream component. That is the "fastest crossing" preset: it reaches the far bank in the least time but misses the dock. Landing on the dock requires crabbing upstream until the boat\'s upstream component cancels the current, at the cost of a longer crossing. The observer view is the central idea. In the ground frame the banks are fixed, the boat crabs diagonally, and the current flows past. In the water frame the water is at rest, the boat runs straight along its heading, and the shoreline drifts upstream. The split view shows both frames at once. The same geometry governs apparent (ship-relative) wind and an underway replenishment approach, where a supply ship matches the receiving ship\'s course and speed so the two vessels appear motionless relative to each other while both make way over the ground.',
  equation: String.raw`\vec v_{bg} = \vec v_{bw} + \vec v_{wg}`,
};
