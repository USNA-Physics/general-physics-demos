import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { createIso, drawArrow3D, drawPolygon3D, drawSegment3D, drawGroundGrid } from '@shared/lib/iso';

/**
 * Cross product.
 *
 * The dot product of two vectors is a scalar; the cross product is a vector
 * perpendicular to both factors. To show that direction, the scene is rendered
 * on a canvas through the shared orthographic camera (@shared/lib/iso). The two
 * input vectors have in-plane components set by dragging and out-of-plane (z)
 * components set by sliders, so genuinely three-dimensional configurations are
 * available. The product a×b is drawn as a vector perpendicular to the plane of
 * the factors, with length proportional to the area of the parallelogram they
 * span, direction given by the right-hand rule, reversing when the factors are
 * exchanged and vanishing when the inputs are parallel. The magnitude depends on
 * the sine of the angle, in contrast to the dot product, which depends on the
 * cosine.
 *
 * The camera azimuth and elevation are adjustable by dragging the background, by
 * sliders, or by continuous auto-rotation. The default view places a (along x)
 * toward the lower left, b (along y) toward the lower right, and a×b (along z)
 * upward.
 *
 * Modes:
 *   area        the geometric account: the parallelogram, the perpendicular
 *               result, the right-hand curl, and the sin/cos strip
 *   determinant the algebraic account: each factor resolved into components along
 *               the coordinate axes, with the component (determinant) form shown
 *               equal to the geometric result and standard-basis examples
 */

const GOLD = '#C5B783';     // the result a×b
const BLUE = '#5B9BD5';     // input a
const GREEN = '#7FB77E';    // input b
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BG = '#0D1321';
const AREA_FILL = 'rgba(197,183,131,0.16)';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (v) => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export default function CrossProduct({ mode = 'area' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const det = mode === 'determinant';

  const [a, setA] = useState({ x: 2.2, y: 0 });   // along +x by default
  const [b, setB] = useState({ x: 0, y: 2.0 });   // along +y by default
  const [aZ, setAZ] = useState(0);
  const [bZ, setBZ] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [showCurl, setShowCurl] = useState(true);
  const [showStrip, setShowStrip] = useState(true);
  const [showParallelogram, setShowParallelogram] = useState(true);

  // camera (angles owned by refs; state mirrors them so the sliders track)
  const [azDeg, setAzDeg] = useState(45);
  const [elDeg, setElDeg] = useState(30);
  const [autoAz, setAutoAz] = useState(false);
  const [autoEl, setAutoEl] = useState(false);
  const azRef = useRef(45);
  const elRef = useRef(30);
  const autoAzRef = useRef(autoAz); autoAzRef.current = autoAz;
  const autoElRef = useRef(autoEl); autoElRef.current = autoEl;

  const aRef = useRef(a); aRef.current = a;
  const bRef = useRef(b); bRef.current = b;
  const aZRef = useRef(aZ); aZRef.current = aZ;
  const bZRef = useRef(bZ); bZRef.current = bZ;
  const swappedRef = useRef(swapped); swappedRef.current = swapped;
  const showCurlRef = useRef(showCurl); showCurlRef.current = showCurl;
  const showStripRef = useRef(showStrip); showStripRef.current = showStrip;
  const showParaRef = useRef(showParallelogram); showParaRef.current = showParallelogram;
  const detRef = useRef(det); detRef.current = det;

  // derived scalars (recomputed each render, cheap; drive the readouts)
  const av = [a.x, a.y, aZ];
  const bv = [b.x, b.y, bZ];
  const c = cross3(av, bv);
  const magA = norm3(av);
  const magB = norm3(bv);
  const area = norm3(c);
  const theta = magA > 1e-6 && magB > 1e-6
    ? Math.acos(Math.max(-1, Math.min(1, dot3(av, bv) / (magA * magB)))) : 0;

  // in-plane polar form of each factor, driving the length / angle sliders
  const aR = Math.hypot(a.x, a.y);
  const bR = Math.hypot(b.x, b.y);
  const aPhi = norm360(Math.atan2(a.y, a.x) * DEG);
  const bPhi = norm360(Math.atan2(b.y, b.x) * DEG);

  // special-case classification (planar only, so the two perpendicular
  // orientations can be distinguished by the sign of the result)
  let special = null;
  if (Math.abs(aZ) < 1e-6 && Math.abs(bZ) < 1e-6 && magA > 1e-6 && magB > 1e-6) {
    const signed = (((Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)) * DEG) % 360 + 360) % 360;
    if (signed < 3 || signed > 357) special = 'parallel';
    else if (Math.abs(signed - 180) < 3) special = 'antiparallel';
    else if (Math.abs(signed - 90) < 3) special = 'perpendicular';
    else if (Math.abs(signed - 270) < 3) special = 'perpendicular-reversed';
  }
  const specialText = {
    parallel: 'Parallel: sinθ = 0, so a×b = 0.',
    antiparallel: 'Antiparallel: sinθ = 0, so a×b = 0.',
    perpendicular: 'Perpendicular: sinθ = 1, so |a×b| is maximal and the result is perpendicular to the plane.',
    'perpendicular-reversed': 'Perpendicular (reversed): sinθ = 1 again, but a×b points in the opposite direction. The cross product distinguishes the two perpendicular orientations.',
  };

  const resLabel = swapped ? 'b×a' : 'a×b';

  const setSpecial = (offsetDeg) => {
    setAZ(0); setBZ(0);
    const angA = Math.atan2(a.y, a.x);
    const magBxy = Math.hypot(b.x, b.y) || 2;
    const ang = angA + offsetDeg * RAD;
    setB({ x: +(magBxy * Math.cos(ang)).toFixed(3), y: +(magBxy * Math.sin(ang)).toFixed(3) });
  };
  const setBasis = (va, vb) => {
    setA({ x: va[0], y: va[1] }); setAZ(va[2]);
    setB({ x: vb[0], y: vb[1] }); setBZ(vb[2]);
  };
  // length / angle setters: changing one holds the other, from the current in-plane vector
  const clampXY = (v) => Math.max(-3, Math.min(3, v));
  const setAlen = (r) => { const ph = Math.atan2(a.y, a.x); setA({ x: clampXY(+(r * Math.cos(ph)).toFixed(4)), y: clampXY(+(r * Math.sin(ph)).toFixed(4)) }); };
  const setAang = (deg) => { const r = Math.hypot(a.x, a.y); setA({ x: clampXY(+(r * Math.cos(deg * RAD)).toFixed(4)), y: clampXY(+(r * Math.sin(deg * RAD)).toFixed(4)) }); };
  const setBlen = (r) => { const ph = Math.atan2(b.y, b.x); setB({ x: clampXY(+(r * Math.cos(ph)).toFixed(4)), y: clampXY(+(r * Math.sin(ph)).toFixed(4)) }); };
  const setBang = (deg) => { const r = Math.hypot(b.x, b.y); setB({ x: clampXY(+(r * Math.cos(deg * RAD)).toFixed(4)), y: clampXY(+(r * Math.sin(deg * RAD)).toFixed(4)) }); };
  const setAz = (v) => { azRef.current = v; setAzDeg(v); };
  const setEl = (v) => { elRef.current = v; setElDeg(v); };

  const reset = () => {
    setA({ x: 2.2, y: 0 }); setB({ x: 0, y: 2.0 });
    setAZ(0); setBZ(0); setSwapped(false);
    setAz(45); setEl(30); setAutoAz(false); setAutoEl(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    canvas.style.touchAction = 'none';
    let ctx, W, H, raf, iso, cx, cy, scale;
    let flip = swappedRef.current ? 1 : 0;
    let curlPhase = 0;
    let last, lastPub = 0;

    const buildIso = () => createIso({ cx, cy, scale, azimuth: azRef.current * RAD, elevation: elRef.current * RAD });
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      cx = W * 0.46; cy = H * 0.56;
      scale = Math.min(W, H) * 0.12;
      iso = buildIso();
    };

    const screenToPlane = (px, py, z) => {
      const [rx, ry] = iso.right;
      const [ux, uy, uz] = iso.up;
      const Pr = (px - cx) / scale;
      const Qr = (cy - py) / scale - z * uz;
      const detm = rx * uy - ry * ux;
      if (Math.abs(detm) < 1e-6) return null;
      return { x: (Pr * uy - ry * Qr) / detm, y: (rx * Qr - Pr * ux) / detm };
    };

    let dragging = null; // 'a' | 'b' | 'camera'
    let lastPx = 0, lastPy = 0;
    const pickTip = (px, py) => {
      const ta = iso.project(aRef.current.x, aRef.current.y, aZRef.current);
      const tb = iso.project(bRef.current.x, bRef.current.y, bZRef.current);
      const da = Math.hypot(px - ta.sx, py - ta.sy);
      const db = Math.hypot(px - tb.sx, py - tb.sy);
      if (da < 26 && da <= db) return 'a';
      if (db < 26) return 'b';
      return null;
    };
    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const onDown = (e) => {
      const { px, py } = toLocal(e);
      dragging = pickTip(px, py) || 'camera';
      lastPx = px; lastPy = py;
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const { px, py } = toLocal(e);
      if (dragging === 'camera') {
        setAz(norm360(azRef.current + (px - lastPx) * 0.5));
        setEl(norm360(elRef.current - (py - lastPy) * 0.5));
        lastPx = px; lastPy = py;
        return;
      }
      const z = dragging === 'a' ? aZRef.current : bZRef.current;
      const p = screenToPlane(px, py, z);
      if (!p) return;
      const x = Math.max(-3, Math.min(3, p.x));
      const y = Math.max(-3, Math.min(3, p.y));
      if (dragging === 'a') { aRef.current = { x, y }; setA({ x, y }); }
      else { bRef.current = { x, y }; setB({ x, y }); }
    };
    const onUp = (e) => { dragging = null; canvas.releasePointerCapture?.(e.pointerId); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const drawLabel = (worldPt, text, color, outPx = 22) => {
      const o = iso.project(0, 0, 0);
      const p = iso.project(worldPt[0], worldPt[1], worldPt[2]);
      let dx = p.sx - o.sx, dy = p.sy - o.sy;
      const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      const lx = p.sx + dx * outPx, ly = p.sy + dy * outPx;
      ctx.font = '15px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = BG; ctx.strokeText(text, lx, ly);
      ctx.fillStyle = color; ctx.fillText(text, lx, ly);
    };

    // component "staircase" from the origin to a tip, stepping along x, then y,
    // then z. Makes the component decomposition explicit in the determinant view.
    const drawComponents = (v, color) => {
      const p0 = [0, 0, 0];
      const p1 = [v[0], 0, 0];
      const p2 = [v[0], v[1], 0];
      const p3 = [v[0], v[1], v[2]];
      [[p0, p1], [p1, p2], [p2, p3]].forEach(([s, t]) => {
        drawSegment3D(ctx, iso, s, t, { color, width: 1.6, dash: [4, 4] });
      });
    };

    const draw = (now) => {
      if (last === undefined) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      if (autoAzRef.current) azRef.current = norm360(azRef.current + 18 * dt);
      if (autoElRef.current) elRef.current = norm360(elRef.current + 12 * dt);
      if ((autoAzRef.current || autoElRef.current) && now - lastPub > 120) {
        lastPub = now;
        setAzDeg(Math.round(azRef.current));
        setElDeg(Math.round(elRef.current));
      }
      iso = buildIso();

      const av = [aRef.current.x, aRef.current.y, aZRef.current];
      const bv = [bRef.current.x, bRef.current.y, bZRef.current];
      const isDet = detRef.current;
      const target = swappedRef.current ? 1 : 0;
      flip += (target - flip) * Math.min(1, dt * 7);
      curlPhase = (curlPhase + dt * 0.9) % 1;

      ctx.clearRect(0, 0, W, H);

      drawGroundGrid(ctx, iso, { half: 3 });
      // axes: faint in the area view, bolder and hatted in the determinant view
      const axCol = isDet ? 'rgba(139,140,142,0.85)' : 'rgba(139,140,142,0.5)';
      const axW = isDet ? 2 : 1.5;
      drawArrow3D(ctx, iso, { from: [0, 0, 0], to: [3.1, 0, 0], color: axCol, width: axW, head: 8, label: isDet ? 'x̂' : 'x', font: '12px JetBrains Mono, monospace' });
      drawArrow3D(ctx, iso, { from: [0, 0, 0], to: [0, 3.1, 0], color: axCol, width: axW, head: 8, label: isDet ? 'ŷ' : 'y', font: '12px JetBrains Mono, monospace' });
      if (isDet) {
        drawArrow3D(ctx, iso, { from: [0, 0, 0], to: [0, 0, 3.1], color: axCol, width: axW, head: 8, label: 'ẑ', font: '12px JetBrains Mono, monospace' });
      } else {
        drawSegment3D(ctx, iso, [0, 0, -2], [0, 0, 3.1], { color: 'rgba(139,140,142,0.3)', width: 1, dash: [3, 5] });
      }

      const c = cross3(av, bv);
      const areaNow = norm3(c);

      // AREA view: the shaded parallelogram
      if (!isDet && showParaRef.current) {
        drawPolygon3D(ctx, iso, [
          [0, 0, 0], av, [av[0] + bv[0], av[1] + bv[1], av[2] + bv[2]], bv,
        ], { fill: AREA_FILL, stroke: 'rgba(197,183,131,0.55)', width: 1.5, dash: [5, 5] });
        const mid = iso.project((av[0] + bv[0]) / 2, (av[1] + bv[1]) / 2, (av[2] + bv[2]) / 2);
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(197,183,131,0.9)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3.5; ctx.strokeStyle = BG;
        ctx.strokeText(`area ${areaNow.toFixed(2)}`, mid.sx, mid.sy);
        ctx.fillText(`area ${areaNow.toFixed(2)}`, mid.sx, mid.sy);
      }

      // DETERMINANT view: component staircases for each factor
      if (isDet) {
        drawComponents(av, 'rgba(91,155,213,0.8)');
        drawComponents(bv, 'rgba(127,183,126,0.8)');
      }

      // the result a×b: perpendicular to the plane, length proportional to area
      const zScale = 0.42, maxLen = 3.0;
      const len = Math.min(maxLen, areaNow * zScale);
      const dispFactor = 1 - 2 * flip;
      let resTip = null;
      if (areaNow > 1e-3 && len > 0.02) {
        const cu = [c[0] / areaNow, c[1] / areaNow, c[2] / areaNow];
        resTip = [cu[0] * len * dispFactor, cu[1] * len * dispFactor, cu[2] * len * dispFactor];
        drawArrow3D(ctx, iso, { from: [0, 0, 0], to: resTip, color: GOLD, width: 4, head: 12 });
      } else {
        const o = iso.project(0, 0, 0);
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(o.sx, o.sy, 7, 0, 2 * Math.PI); ctx.stroke();
      }

      drawArrow3D(ctx, iso, { from: [0, 0, 0], to: av, color: BLUE, width: 3.5, head: 11 });
      drawArrow3D(ctx, iso, { from: [0, 0, 0], to: bv, color: GREEN, width: 3.5, head: 11 });

      [[av, BLUE], [bv, GREEN]].forEach(([v, col]) => {
        const s = iso.project(v[0], v[1], v[2]);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, 6, 0, 2 * Math.PI); ctx.stroke();
      });

      // AREA view: right-hand curl from a toward b in the plane of the factors
      if (!isDet && showCurlRef.current && areaNow > 1e-3) {
        const e1 = unit(av);
        const bPerp = sub(bv, scaleV(e1, dot3(bv, e1)));
        if (norm3(bPerp) > 1e-6) {
          const e2 = unit(bPerp);
          const ang = Math.acos(Math.max(-1, Math.min(1, dot3(unit(av), unit(bv)))));
          const rCurl = 0.9, nSeg = 28, upTo = curlPhase;
          ctx.strokeStyle = 'rgba(197,183,131,0.9)'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= nSeg; i++) {
            const f = (i / nSeg) * upTo * ang;
            const wx = rCurl * (Math.cos(f) * e1[0] + Math.sin(f) * e2[0]);
            const wy = rCurl * (Math.cos(f) * e1[1] + Math.sin(f) * e2[1]);
            const wz = rCurl * (Math.cos(f) * e1[2] + Math.sin(f) * e2[2]);
            const p = iso.project(wx, wy, wz);
            if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
          }
          ctx.stroke();
        }
      }

      drawLabel(av, 'a', BLUE);
      drawLabel(bv, 'b', GREEN);
      if (resTip) drawLabel(resTip, resLabel, GOLD, 20);

      // AREA view: sin/cos strip
      if (!isDet && showStripRef.current) drawCrossStrip(ctx, W, theta);

      ctx.font = 'bold 13px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (areaNow < 1e-3) { ctx.fillStyle = MUTED; ctx.fillText('Parallel: a×b = 0', 14, 12); }
      else { ctx.fillStyle = GOLD; ctx.fillText(`|${resLabel}| = ${areaNow.toFixed(2)}, perpendicular to the plane`, 14, 12); }

      raf = requestAnimationFrame(draw);
    };

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

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <p className="text-usna-muted text-xs mb-3">
          Drag the <span style={{ color: BLUE }}>a</span> and{' '}
          <span style={{ color: GREEN }}>b</span> tips within the plane, or set each vector's
          length and angle with the sliders below. The{' '}
          <span style={{ color: GOLD }}>{resLabel}</span> vector is perpendicular to it.
          Drag the background to rotate the view.
        </p>

        <button
          onClick={() => setSwapped((s) => !s)}
          className="mb-4 w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
        >
          Swap order (show {swapped ? 'a×b' : 'b×a'})
        </button>

        <div className="mb-3">
          <div className="text-usna-muted text-xs mb-1.5">Special cases (set b relative to a)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {[['Parallel', 0], ['Perpendicular', 90], ['Antiparallel', 180], ['Reversed ⟂', 270]].map(([lbl, off]) => (
              <button
                key={off}
                onClick={() => setSpecial(off)}
                className="px-2 py-1 rounded text-xs font-medium border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors"
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 border-t border-usna-grid pt-3">
          <div className="text-xs mb-1.5 font-semibold" style={{ color: BLUE }}>Vector a</div>
          <Slider label="length (in plane)" value={+aR.toFixed(2)} min={0} max={3} step={0.05} unit="" onChange={setAlen} />
          <Slider label="angle (in plane)" value={Math.round(aPhi)} min={0} max={360} step={1} unit="°" onChange={setAang} />
          <Slider label="a·ẑ (out of plane)" value={aZ} min={-2.5} max={2.5} step={0.1} unit="" onChange={setAZ} />
        </div>
        <div className="mb-1">
          <div className="text-xs mb-1.5 font-semibold" style={{ color: GREEN }}>Vector b</div>
          <Slider label="length (in plane)" value={+bR.toFixed(2)} min={0} max={3} step={0.05} unit="" onChange={setBlen} />
          <Slider label="angle (in plane)" value={Math.round(bPhi)} min={0} max={360} step={1} unit="°" onChange={setBang} />
          <Slider label="b·ẑ (out of plane)" value={bZ} min={-2.5} max={2.5} step={0.1} unit="" onChange={setBZ} />
        </div>

        {/* Camera */}
        <div className="mt-2 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-1.5">View</div>
          <Slider label="Azimuth" value={Math.round(azDeg)} min={0} max={360} step={1} unit="°" onChange={setAz} />
          <Slider label="Elevation" value={Math.round(elDeg)} min={0} max={360} step={1} unit="°" onChange={setEl} />
          <div className="flex flex-col gap-2 mt-1">
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={autoAz} onChange={(e) => setAutoAz(e.target.checked)} />
              Auto-rotate azimuth
            </label>
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={autoEl} onChange={(e) => setAutoEl(e.target.checked)} />
              Auto-rotate elevation
            </label>
          </div>
        </div>

        {/* Area-view overlays */}
        {!det && (
          <div className="flex flex-col gap-2 my-3">
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={showParallelogram} onChange={(e) => setShowParallelogram(e.target.checked)} />
              Parallelogram (area = |{resLabel}|)
            </label>
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={showCurl} onChange={(e) => setShowCurl(e.target.checked)} />
              Right-hand curl
            </label>
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={showStrip} onChange={(e) => setShowStrip(e.target.checked)} />
              sin / cos strip
            </label>
          </div>
        )}

        <div className="border-t border-usna-grid pt-3 mt-3">
          <Readout label="|a|" value={magA.toFixed(2)} unit="" />
          <Readout label="|b|" value={magB.toFixed(2)} unit="" />
          <Readout label="θ" value={(theta * DEG).toFixed(1)} unit="°" />
          <Readout label={`|${resLabel}| = |a||b|sinθ`} value={area.toFixed(2)} unit="" />
        </div>

        {special && (
          <p className="mt-2 text-xs text-usna-text leading-snug">{specialText[special]}</p>
        )}

        {det && (
          <div className="mt-3 border-t border-usna-grid pt-3 text-xs font-mono text-usna-text leading-relaxed">
            <div className="text-usna-muted mb-1">component (determinant) form:</div>
            <div style={{ color: BLUE }}>a = ({a.x.toFixed(2)}, {a.y.toFixed(2)}, {aZ.toFixed(2)})</div>
            <div style={{ color: GREEN }}>b = ({b.x.toFixed(2)}, {b.y.toFixed(2)}, {bZ.toFixed(2)})</div>
            <div className="mt-1" style={{ color: GOLD }}>
              a×b = ({c[0].toFixed(2)}, {c[1].toFixed(2)}, {c[2].toFixed(2)})
            </div>
            <div className="text-usna-muted mt-1">|a×b| = {area.toFixed(2)}, matching the geometric magnitude</div>
            <div className="text-usna-muted mt-2 mb-1">standard basis:</div>
            <div className="grid grid-cols-1 gap-1">
              {[
                ['x̂ × ŷ = ẑ', [1, 0, 0], [0, 1, 0]],
                ['ŷ × ẑ = x̂', [0, 1, 0], [0, 0, 1]],
                ['ẑ × x̂ = ŷ', [0, 0, 1], [1, 0, 0]],
              ].map(([lbl, va, vb]) => (
                <button
                  key={lbl}
                  onClick={() => setBasis(va, vb)}
                  className="text-left px-2 py-1 rounded border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors"
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
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
          title={det ? 'The component form yields the same vector' : 'A vector perpendicular to the plane of its factors'}
          description={
            det
              ? "Resolving each factor into components along the coordinate axes gives the determinant form a×b = (a_yb_z − a_zb_y, a_zb_x − a_xb_z, a_xb_y − a_yb_x). The dashed staircases trace each vector as a sum of its components along x̂, ŷ, and ẑ. The resulting vector agrees in magnitude and direction with the geometric construction for every configuration, including the standard-basis relations x̂ × ŷ = ẑ, ŷ × ẑ = x̂, and ẑ × x̂ = ŷ."
              : "The dot product of two vectors is a scalar; the cross product is a vector. The product a × b is perpendicular to both factors, hence perpendicular to the plane they span. Its length equals the area of that parallelogram, |a × b| = |a||b|sinθ, and its direction is given by the right-hand rule. Exchanging the factors reverses the vector, so the product is anticommutative. It vanishes when the factors are parallel or antiparallel and is greatest when they are perpendicular; the two perpendicular orientations give results of opposite direction. Because the magnitude depends on sine rather than cosine, the cross product is complementary to the dot product, as the sin/cos strip records. Rotate the view, or give the factors out-of-plane components, to see the result in three dimensions."
          }
          equation={
            det
              ? String.raw`\vec a\times\vec b=(a_yb_z-a_zb_y,\;a_zb_x-a_xb_z,\;a_xb_y-a_yb_x)`
              : String.raw`\vec a\times\vec b=|\vec a||\vec b|\sin\theta\,\hat n,\qquad \vec a\times\vec b=-(\vec b\times\vec a),\qquad \vec a\times\vec a=0`
          }
        />
      </div>
    </div>
  );
}

// vector helpers for the right-hand curl
const magnitude = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = magnitude(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleV = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const norm360 = (d) => ((d % 360) + 360) % 360;

/** A compact strip plotting sinθ (highlighted) and cosθ (faint) over [0,180°]. */
function drawCrossStrip(ctx, W, theta) {
  const bw = Math.min(190, W * 0.42), bh = 92;
  const bx0 = W - bw - 12, by0 = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(13,19,33,0.86)';
  ctx.strokeStyle = 'rgba(139,140,142,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(bx0, by0, bw, bh); ctx.fill(); ctx.stroke();
  const plotX = bx0 + 8, plotW = bw - 16, plotY = by0 + 20, plotH = bh - 32;
  const midY = plotY + plotH / 2;
  ctx.strokeStyle = 'rgba(139,140,142,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(plotX, midY); ctx.lineTo(plotX + plotW, midY); ctx.stroke();
  const curve = (fn, col, width) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const th = (i / 60) * Math.PI;
      const px = plotX + (i / 60) * plotW;
      const py = midY - fn(th) * (plotH / 2) * 0.92;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  curve((th) => Math.cos(th), 'rgba(91,155,213,0.5)', 1.5); // cosine, faint (the dot product)
  curve((th) => Math.sin(th), GOLD, 2.4);                   // sine, highlighted
  const tx = plotX + (theta / Math.PI) * plotW;
  ctx.strokeStyle = 'rgba(240,236,227,0.7)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(tx, plotY); ctx.lineTo(tx, plotY + plotH); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '10px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.fillText('|a×b| ∝ sinθ', bx0 + 8, by0 + 4);
  ctx.fillStyle = 'rgba(91,155,213,0.8)'; ctx.textAlign = 'right'; ctx.fillText('cosθ', bx0 + bw - 8, by0 + 4);
  ctx.restore();
}
