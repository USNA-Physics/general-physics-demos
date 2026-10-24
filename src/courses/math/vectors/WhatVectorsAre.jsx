import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * Vectors and their components (math / vectors).
 *
 * A vector is a geometric object with a magnitude and a direction, represented
 * by an arrow. Its components (aₓ, a_y) are the coordinates of that arrow in a
 * chosen frame. Rotating the frame changes the components while the arrow is
 * left fixed, so the components are a description of the vector in one frame,
 * not the vector itself.
 *
 *   components : a fixed arrow a with a rotatable coordinate frame. Rotating the
 *               frame by α varies the components through the rotation formulas
 *               while the arrow and |a| remain fixed. Invariants are drawn in
 *               gold; the frame-dependent components in blue.
 *
 *   addition  : two arrows a, b, the tip-to-tail construction, and the resultant
 *               a + b. Rotating the frame leaves every arrow, including the
 *               resultant, in place, so addition is independent of basis. The
 *               angle between a and b is likewise invariant.
 *
 * Each child owns its canvas and hooks, satisfying the Rules of Hooks across the
 * two interfaces; the default export is a thin wrapper.
 */

const GOLD = '#C5B783';          // the vector and the invariants
const GOLD_DIM = 'rgba(197,183,131,0.5)';
const COOL = '#5B9BD5';          // frame axes and components
const COOL_DIM = 'rgba(91,155,213,0.55)';
const GREEN = '#7FB77E';         // the resultant a + b
const MUTED = '#8B8C8E';
const TEXT = '#F0ECE3';
const BG = '#0D1321';

const UNITS = 6;                 // world half-extent: the view spans about ±6 units

// world (physics, +y up) → screen (px, +y down)
const w2s = (geom, x, y) => ({ x: geom.cx + x * geom.scale, y: geom.cy - y * geom.scale });

// ───────────────────────────────────────────────────────────────────────────
// Wrapper (hook-free): branch on mode.
// ───────────────────────────────────────────────────────────────────────────
export default function WhatVectorsAre({ mode = 'components' }) {
  if (mode === 'addition') return <Addition />;
  return <Components />;
}

// ───────────────────────────────────────────────────────────────────────────
// Shared drawing primitives
// ───────────────────────────────────────────────────────────────────────────

// faint world grid aligned to the FIXED lab axes (not the rotating frame), so
// the student has a stationary reference to see the arrow truly doesn't move.
function drawGrid(ctx, geom, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(139,140,142,0.14)';
  ctx.lineWidth = 1;
  for (let g = -UNITS; g <= UNITS; g++) {
    const v = w2s(geom, g, 0);
    ctx.beginPath(); ctx.moveTo(v.x, 0); ctx.lineTo(v.x, H); ctx.stroke();
    const h = w2s(geom, 0, g);
    ctx.beginPath(); ctx.moveTo(0, h.y); ctx.lineTo(W, h.y); ctx.stroke();
  }
  ctx.restore();
}

// the rotatable coordinate frame: axes x̂', ŷ' through the origin, rotated CCW
// by α. Returns the world-space unit vectors so callers can project onto them.
function drawFrame(ctx, geom, alpha) {
  const ex = { x: Math.cos(alpha), y: Math.sin(alpha) };       // x̂' in world coords
  const ey = { x: -Math.sin(alpha), y: Math.cos(alpha) };      // ŷ'
  const L = UNITS;
  ctx.save();
  ctx.strokeStyle = COOL_DIM;
  ctx.lineWidth = 1.6;
  // x̂' axis (full line through origin)
  const xp = w2s(geom, ex.x * L, ex.y * L), xm = w2s(geom, -ex.x * L, -ex.y * L);
  ctx.beginPath(); ctx.moveTo(xm.x, xm.y); ctx.lineTo(xp.x, xp.y); ctx.stroke();
  // ŷ' axis
  const yp = w2s(geom, ey.x * L, ey.y * L), ym = w2s(geom, -ey.x * L, -ey.y * L);
  ctx.beginPath(); ctx.moveTo(ym.x, ym.y); ctx.lineTo(yp.x, yp.y); ctx.stroke();
  // axis labels at the positive ends
  ctx.font = '13px JetBrains Mono, monospace';
  ctx.fillStyle = COOL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lx = w2s(geom, ex.x * (L - 0.5), ex.y * (L - 0.5));
  const ly = w2s(geom, ey.x * (L - 0.5), ey.y * (L - 0.5));
  ctx.fillText("x̂'", lx.x + 10 * ex.x, lx.y - 10 * ex.y);
  ctx.fillText("ŷ'", ly.x + 10 * ey.x, ly.y - 10 * ey.y);
  ctx.restore();
  return { ex, ey };
}

// origin marker
function drawOrigin(ctx, geom) {
  const o = w2s(geom, 0, 0);
  ctx.fillStyle = MUTED;
  ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, 2 * Math.PI); ctx.fill();
}

// Draw the signed projection of vector (vx,vy) onto a frame axis with unit
// vector u: a dashed line from the tip down to the foot, a solid tinted segment
// along the axis from the origin to the foot, and the component value label.
function drawProjection(ctx, geom, vx, vy, u, label, color) {
  const comp = vx * u.x + vy * u.y;            // signed component along u
  const foot = { x: comp * u.x, y: comp * u.y }; // foot of perpendicular (world)
  const tipS = w2s(geom, vx, vy);
  const footS = w2s(geom, foot.x, foot.y);
  const oS = w2s(geom, 0, 0);
  ctx.save();
  // solid component segment origin→foot
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(oS.x, oS.y); ctx.lineTo(footS.x, footS.y); ctx.stroke();
  // dashed drop line tip→foot
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(91,155,213,0.5)';
  ctx.beginPath(); ctx.moveTo(tipS.x, tipS.y); ctx.lineTo(footS.x, footS.y); ctx.stroke();
  ctx.setLineDash([]);
  // value label just past the foot, nudged off the axis
  ctx.font = 'bold 14px JetBrains Mono, monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nx = -u.y, ny = u.x; // perpendicular, for the label offset
  ctx.fillText(`${label}=${comp.toFixed(2)}`, footS.x + nx * 16, footS.y - ny * 16);
  ctx.restore();
  return comp;
}

// pointer→world helper, shared by both children
function pointerWorld(e, canvas, geom) {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  return { x: (px - geom.cx) / geom.scale, y: -(py - geom.cy) / geom.scale };
}

// ───────────────────────────────────────────────────────────────────────────
// COMPONENTS mode: one arrow, a rotating frame, varying components
// ───────────────────────────────────────────────────────────────────────────
const C_DEFAULT = { ax: 3.4, ay: 2.0, alphaDeg: 0 };

function Components() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [a, setA] = useState({ x: C_DEFAULT.ax, y: C_DEFAULT.ay });
  const [alphaDeg, setAlphaDeg] = useState(C_DEFAULT.alphaDeg);
  const [showComp, setShowComp] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showInvariants, setShowInvariants] = useState(true);

  const reset = () => {
    setA({ x: C_DEFAULT.ax, y: C_DEFAULT.ay });
    setAlphaDeg(C_DEFAULT.alphaDeg);
  };

  // invariants (identical in every frame)
  const mag = Math.hypot(a.x, a.y);
  const dirDeg = (Math.atan2(a.y, a.x) * 180) / Math.PI;
  // frame-dependent components (change as α turns)
  const alpha = (alphaDeg * Math.PI) / 180;
  const cx = a.x * Math.cos(alpha) + a.y * Math.sin(alpha);   // aₓ'
  const cy = -a.x * Math.sin(alpha) + a.y * Math.cos(alpha);  // a_y'

  // redraw on any input change (no animation ⇒ no rAF loop needed)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    canvas.style.touchAction = 'none';

    let geom = {};
    const resize = () => {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const ctx = setupCanvas(canvas, W, H);
      geom = { ctx, W, H, cx: W / 2, cy: H / 2, scale: (Math.min(W, H) * 0.44) / UNITS };
      draw();
    };

    const draw = () => {
      const { ctx, W, H } = geom;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (showGrid) drawGrid(ctx, geom, W, H);
      const { ex, ey } = drawFrame(ctx, geom, alpha);
      drawOrigin(ctx, geom);

      // projections / component read-off in the ROTATED frame
      if (showComp) {
        drawProjection(ctx, geom, a.x, a.y, ex, "aₓ'", COOL);
        drawProjection(ctx, geom, a.x, a.y, ey, "a_y'", GREEN);
      }

      // the vector itself, drawn in gold as the primary object
      const tip = w2s(geom, a.x, a.y);
      const o = w2s(geom, 0, 0);
      drawArrow(ctx, { x: o.x, y: o.y, dx: tip.x - o.x, dy: tip.y - o.y, color: GOLD, width: 4, label: 'a', head: 13, font: '16px JetBrains Mono, monospace' });
      // draggable tip handle
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 7, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0;

      // invariants overlay (gold), unchanged as α sweeps
      if (showInvariants) {
        ctx.font = 'bold 14px JetBrains Mono, monospace';
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`|a| = ${mag.toFixed(2)}  (invariant)`, 14, 12);
        ctx.fillStyle = COOL;
        ctx.fillText(`frame α = ${alphaDeg.toFixed(0)}°`, 14, 32);
        ctx.fillText(`(aₓ', a_y') = (${cx.toFixed(2)}, ${cy.toFixed(2)})`, 14, 52);
      }
      // hint
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Drag the gold tip; rotate the frame with α. The arrow does not move.', W / 2, H - 10);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // drag the arrow tip
    let dragging = false;
    const onDown = (e) => {
      const wld = pointerWorld(e, canvas, geom);
      if (Math.hypot(wld.x - a.x, wld.y - a.y) < 0.6) { dragging = true; canvas.setPointerCapture(e.pointerId); }
    };
    const onMove = (e) => {
      if (!dragging) return;
      const wld = pointerWorld(e, canvas, geom);
      const clamp = (v) => Math.max(-UNITS, Math.min(UNITS, v));
      setA({ x: clamp(wld.x), y: clamp(wld.y) });
    };
    const onUp = (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ } };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [a, alphaDeg, showComp, showGrid, showInvariants, alpha, mag, cx, cy]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Frame angle (α)" value={alphaDeg} min={-180} max={180} step={1} unit="°" onChange={setAlphaDeg} />

        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showComp} onChange={(e) => setShowComp(e.target.checked)} />
            Components &amp; projection lines
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            Lab grid
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showInvariants} onChange={(e) => setShowInvariants(e.target.checked)} />
            Invariants overlay
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-1">the vector (same in every frame):</div>
          <Readout label="|a|" value={mag.toFixed(2)} unit="" />
          <Readout label="direction" value={dirDeg.toFixed(1)} unit="° (lab)" />
          <div className="text-usna-muted text-xs mt-2 mb-1">its components in the α-frame:</div>
          <Readout label="aₓ'" value={cx.toFixed(2)} unit="" />
          <Readout label="a_y'" value={cy.toFixed(2)} unit="" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 460, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title="A vector is distinct from its components"
          description={
            "Rotating the coordinate frame with the α slider varies the components (aₓ', a_y') through the rotation formulas, while the arrow and its length |a| remain fixed. The components are the coordinates of the vector in a chosen frame; a different frame gives different coordinates for the same arrow. The magnitude |a| = √(aₓ² + a_y²), and the angle between two vectors, are invariant under a change of frame. Quantities such as torque and angular momentum are vectors first and component lists second, a distinction the rotation unit relies on."
          }
          equation={String.raw`\mathbf a = a_x\,\hat{x} + a_y\,\hat{y},\qquad \begin{aligned}a_x' &= a_x\cos\alpha + a_y\sin\alpha\\ a_y' &= -a_x\sin\alpha + a_y\cos\alpha\end{aligned},\qquad |\mathbf a|=\sqrt{a_x^2+a_y^2}\;(\text{invariant})`}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ADDITION mode: tip-to-tail, parallelogram, basis-independent resultant
// ───────────────────────────────────────────────────────────────────────────
const A_DEFAULT = { ax: 3.0, ay: 1.0, bx: 1.0, by: 2.8, alphaDeg: 0 };

function Addition() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [a, setA] = useState({ x: A_DEFAULT.ax, y: A_DEFAULT.ay });
  const [b, setB] = useState({ x: A_DEFAULT.bx, y: A_DEFAULT.by });
  const [alphaDeg, setAlphaDeg] = useState(A_DEFAULT.alphaDeg);
  const [showPara, setShowPara] = useState(true);
  const [showFrame, setShowFrame] = useState(true);

  const reset = () => {
    setA({ x: A_DEFAULT.ax, y: A_DEFAULT.ay });
    setB({ x: A_DEFAULT.bx, y: A_DEFAULT.by });
    setAlphaDeg(A_DEFAULT.alphaDeg);
  };

  const r = { x: a.x + b.x, y: a.y + b.y };     // the resultant (basis-free)
  const magR = Math.hypot(r.x, r.y);
  const magA = Math.hypot(a.x, a.y);
  const magB = Math.hypot(b.x, b.y);
  // angle between a and b, also invariant under frame rotation
  const between = (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (magA * magB)))) * 180) / Math.PI;
  const alpha = (alphaDeg * Math.PI) / 180;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    canvas.style.touchAction = 'none';

    let geom = {};
    const resize = () => {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const ctx = setupCanvas(canvas, W, H);
      geom = { ctx, W, H, cx: W / 2, cy: H / 2, scale: (Math.min(W, H) * 0.4) / UNITS };
      draw();
    };

    const draw = () => {
      const { ctx, W, H } = geom;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      drawGrid(ctx, geom, W, H);
      if (showFrame) drawFrame(ctx, geom, alpha);
      drawOrigin(ctx, geom);

      const o = w2s(geom, 0, 0);
      const aS = w2s(geom, a.x, a.y);
      const bFromA = w2s(geom, a.x + b.x, a.y + b.y); // b drawn from tip of a
      const rS = w2s(geom, r.x, r.y);
      const bS = w2s(geom, b.x, b.y);

      // parallelogram (faint) to show a+b = b+a
      if (showPara) {
        ctx.save();
        ctx.fillStyle = 'rgba(197,183,131,0.08)';
        ctx.strokeStyle = GOLD_DIM;
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y); ctx.lineTo(aS.x, aS.y); ctx.lineTo(rS.x, rS.y); ctx.lineTo(bS.x, bS.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // a from origin (gold), b from tip of a (cool); tip-to-tail
      drawArrow(ctx, { x: o.x, y: o.y, dx: aS.x - o.x, dy: aS.y - o.y, color: GOLD, width: 3.5, head: 12 });
      drawArrow(ctx, { x: aS.x, y: aS.y, dx: bFromA.x - aS.x, dy: bFromA.y - aS.y, color: COOL, width: 3.5, head: 12 });
      // resultant from origin (green), drawn thick on top
      drawArrow(ctx, { x: o.x, y: o.y, dx: rS.x - o.x, dy: rS.y - o.y, color: GREEN, width: 4.5, head: 14 });

      // labels placed to avoid the tip shared by b and a+b: a and b at the
      // midpoints of their shafts (nudged perpendicular), a+b beyond the tip
      const halo = (x, y, text, color, font = 'bold 15px JetBrains Mono, monospace') => {
        ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = '#0D1321'; ctx.strokeText(text, x, y);
        ctx.fillStyle = color; ctx.fillText(text, x, y);
      };
      const perpMid = (p1, p2, d) => {
        let dx = p2.x - p1.x, dy = p2.y - p1.y; const n = Math.hypot(dx, dy) || 1;
        return { x: (p1.x + p2.x) / 2 - (dy / n) * d, y: (p1.y + p2.y) / 2 + (dx / n) * d };
      };
      const aMid = perpMid(o, aS, 16);
      halo(aMid.x, aMid.y, 'a', GOLD);
      const bMid = perpMid(aS, bFromA, 16);
      halo(bMid.x, bMid.y, 'b', COOL);
      {
        let dx = rS.x - o.x, dy = rS.y - o.y; const n = Math.hypot(dx, dy) || 1;
        halo(rS.x + (dx / n) * 22, rS.y + (dy / n) * 22, 'a+b', GREEN, 'bold 16px JetBrains Mono, monospace');
      }

      // draggable tip handles for a and b (b handle at its own standalone tip)
      for (const [p, col] of [[aS, GOLD], [bS, COOL]]) {
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = col; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // invariant overlay
      ctx.font = 'bold 14px JetBrains Mono, monospace';
      ctx.fillStyle = GREEN;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`|a+b| = ${magR.toFixed(2)}  (invariant)`, 14, 12);
      ctx.fillStyle = GOLD;
      ctx.fillText(`angle(a,b) = ${between.toFixed(1)}°  (invariant)`, 14, 32);
      ctx.fillStyle = COOL;
      ctx.fillText(`frame α = ${alphaDeg.toFixed(0)}°`, 14, 52);

      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('Drag the a (gold) or b (blue) tip; rotate α. The resultant does not move.', W / 2, H - 10);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let drag = null; // 'a' | 'b'
    const onDown = (e) => {
      const wld = pointerWorld(e, canvas, geom);
      if (Math.hypot(wld.x - a.x, wld.y - a.y) < 0.6) drag = 'a';
      else if (Math.hypot(wld.x - b.x, wld.y - b.y) < 0.6) drag = 'b';
      if (drag) canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag) return;
      const wld = pointerWorld(e, canvas, geom);
      const clamp = (v) => Math.max(-UNITS, Math.min(UNITS, v));
      const next = { x: clamp(wld.x), y: clamp(wld.y) };
      if (drag === 'a') setA(next); else setB(next);
    };
    const onUp = (e) => { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ } };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [a, b, alphaDeg, showPara, showFrame, alpha, r.x, r.y, magR, between]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Frame angle (α)" value={alphaDeg} min={-180} max={180} step={1} unit="°" onChange={setAlphaDeg} />

        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showPara} onChange={(e) => setShowPara(e.target.checked)} />
            Parallelogram
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showFrame} onChange={(e) => setShowFrame(e.target.checked)} />
            Show rotating frame
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-1">basis-independent (same in every frame):</div>
          <Readout label="|a+b|" value={magR.toFixed(2)} unit="" />
          <Readout label="angle(a,b)" value={between.toFixed(1)} unit="°" />
          <div className="text-usna-muted text-xs mt-2 mb-1">inputs:</div>
          <Readout label="|a|" value={magA.toFixed(2)} unit="" />
          <Readout label="|b|" value={magB.toFixed(2)} unit="" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 460, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title="Vector addition is independent of the coordinate frame"
          description={
            "With the tail of b placed at the tip of a, the resultant a + b runs from the tail of a to the tip of b, along the diagonal of the parallelogram the two vectors span. The construction refers only to the arrows, not to any axes. Rotating the frame with α changes every component of a, b, and a + b, yet the three arrows remain in place. This independence of basis is what permits forces to be resolved in whichever frame simplifies a given problem. The length |a + b| and the angle between a and b are invariant under the rotation."
          }
          equation={String.raw`\mathbf a + \mathbf b = \mathbf b + \mathbf a,\qquad (\mathbf a+\mathbf b)_{x'} = a_{x'} + b_{x'}\ \text{in every frame},\qquad |\mathbf a+\mathbf b|\ \text{invariant}`}
        />
      </div>
    </div>
  );
}
