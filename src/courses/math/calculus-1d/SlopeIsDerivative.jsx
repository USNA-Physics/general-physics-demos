import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * The derivative as slope (math/calculus-1d).
 *
 * The derivative at a point is the slope of the tangent line, obtained as the
 * limit of secant slopes. Two linked canvas panels share one x-domain.
 *
 *   top    f(x) with a point at x and a second at x + Δx. The secant through
 *          them (blue) approaches the tangent (gold) as Δx decreases to zero; a
 *          rise/run triangle labels Δf and Δx. Turning points (f′ = 0) are
 *          marked on the curve.
 *
 *   bottom f′(x). The analytic derivative is drawn faintly as a reference, and
 *          as x moves across the domain the derivative is traced point by point
 *          (gold), exhibiting the derivative as a function. A gold dot marks
 *          (x, f′(x)) and a dotted cursor line links the two panels.
 *
 * As Δx decreases to zero the secant-slope readout converges to the tangent
 * slope and the |secant − tangent| gap approaches zero.
 *
 * Modes (?mode=): tangent (default), derivative-function (trace enabled by
 * default), motion (axes relabeled t, x(t), so the slope is the velocity
 * v = dx/dt, connecting to SP211).
 *
 * One rAF loop reads inputs from refs and draws imperatively; readouts publish
 * throttled (~10 Hz). No per-frame setState.
 */

const GOLD = '#C5B783';   // tangent (primary)
const BLUE = '#5B9BD5';   // secant / the x+Δx point
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BG = '#0D1321';
const GRID = 'rgba(139,140,142,0.22)';

const NSAMP = 260; // fixed derivative-trace grid (independent of canvas size)

// Solve the 4×4 Vandermonde system for the cubic a0 + a1 x + a2 x² + a3 x³ that
// passes exactly through the four (xn, yn) control points. Gaussian elimination
// with partial pivoting. Returns [a0, a1, a2, a3] so f AND f′ stay analytic.
function fitCubic(xn, yn) {
  const M = xn.map((x, i) => [1, x, x * x, x * x * x, yn[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-9;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

// Control-point nodes for the draggable cubic, and a pleasant default S-curve.
const CUBIC_XN = [-2, -2 / 3, 2 / 3, 2];
const CUBIC_YN0 = [-2, 1.6, -1.6, 2];

const PRESETS = {
  quad: { label: 'x²', f: (x) => x * x, df: (x) => 2 * x, domain: [-3, 3], yR: [-1, 9.2], dyR: [-6.5, 6.5], x0: 1, dx0: 1 },
  cube: { label: 'x³', f: (x) => x * x * x, df: (x) => 3 * x * x, domain: [-2.2, 2.2], yR: [-11, 11], dyR: [-1.5, 15], x0: 1, dx0: 0.8 },
  sin: { label: 'sin x', f: Math.sin, df: Math.cos, domain: [-Math.PI * 1.05, Math.PI * 1.05], yR: [-1.35, 1.35], dyR: [-1.35, 1.35], x0: 0.6, dx0: 0.8 },
  cubic: { label: 'drag cubic', domain: [-2.45, 2.45], yR: [-4.2, 4.2], dyR: [-10, 10], x0: 0, dx0: 0.7 },
};

export default function SlopeIsDerivative({ mode = 'tangent' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [preset, setPreset] = useState('quad');
  const [dx, setDx] = useState(PRESETS.quad.dx0);
  const [showSecant, setShowSecant] = useState(true);
  const [showTangent, setShowTangent] = useState(true);
  const [showTri, setShowTri] = useState(true);
  const [traceDeriv, setTraceDeriv] = useState(mode === 'derivative-function');

  // Throttled readout mirror (published ~10 Hz from the rAF loop).
  const [ro, setRo] = useState({ x: PRESETS.quad.x0, secant: 2, tangent: 2, gap: 0, turning: false });

  // Motion mode just relabels the axes/readouts; the math is identical.
  const L = mode === 'motion'
    ? { xAxis: 't', fName: 'x(t)', dName: 'v = dx/dt', slope: 'v', dUnit: ' m/s' }
    : { xAxis: 'x', fName: 'f (x)', dName: "f ′(x)", slope: "f ′", dUnit: '' };

  // ── live refs (read by the rAF loop; never trigger re-subscribe) ───────────
  const presetRef = useRef(preset); presetRef.current = preset;
  const dxRef = useRef(dx); dxRef.current = dx;
  const xRef = useRef(PRESETS.quad.x0);                 // current x (dragged)
  const ynRef = useRef([...CUBIC_YN0]);                 // cubic control y-values
  const coefRef = useRef(fitCubic(CUBIC_XN, CUBIC_YN0));
  const tracedRef = useRef(new Array(NSAMP).fill(false));
  const toggleRef = useRef({ showSecant, showTangent, showTri, traceDeriv });
  toggleRef.current = { showSecant, showTangent, showTri, traceDeriv };

  // One-shot "Shrink Δx → 0" animation state.
  const shrinkRef = useRef(false);
  // Pointer-drag bookkeeping + the current view transform (CSS px) for hit-testing.
  const dragRef = useRef(null);
  const viewRef = useRef(null);

  // Reset / preset changes: drop x into the new domain, clear the trace, restore
  // the cubic's default control points.
  const applyPreset = (id) => {
    const p = PRESETS[id];
    xRef.current = p.x0;
    dxRef.current = p.dx0;
    setDx(p.dx0);
    tracedRef.current = new Array(NSAMP).fill(false);
    if (id === 'cubic') {
      ynRef.current = [...CUBIC_YN0];
      coefRef.current = fitCubic(CUBIC_XN, CUBIC_YN0);
    }
    shrinkRef.current = false;
  };

  useEffect(() => { applyPreset(preset); /* eslint-disable-next-line */ }, [preset]);

  const reset = () => {
    setShowSecant(true); setShowTangent(true); setShowTri(true);
    setTraceDeriv(mode === 'derivative-function');
    applyPreset(preset);
  };

  // Helpers bound to the current preset's f / f′.
  const makeFns = (id) => {
    if (id === 'cubic') {
      const c = coefRef.current;
      return {
        f: (x) => c[0] + c[1] * x + c[2] * x * x + c[3] * x * x * x,
        df: (x) => c[1] + 2 * c[2] * x + 3 * c[3] * x * x,
      };
    }
    return { f: PRESETS[id].f, df: PRESETS[id].df };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;
    let lastPub = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      const id = presetRef.current;
      const p = PRESETS[id];
      const { f, df } = makeFns(id);
      const [xmin, xmax] = p.domain;
      const [y0R, y1R] = p.yR;
      const [dy0R, dy1R] = p.dyR;

      // "Shrink Δx → 0": ease toward the slider floor, then sync React state.
      if (shrinkRef.current) {
        dxRef.current += (0.02 - dxRef.current) * Math.min(1, 0.12);
        if (dxRef.current < 0.05) { dxRef.current = 0.02; shrinkRef.current = false; setDx(0.02); }
      }

      // ── layout: two stacked panels sharing the x-axis ──────────────────────
      const left = 48, right = 16, top = 12, botPad = 24;
      const usableH = H - top - botPad;
      const topH = usableH * 0.58;
      const gap = 28;
      const topRect = { x: left, y: top, w: W - left - right, h: topH - gap * 0.5 };
      const botRect = { x: left, y: top + topH + gap * 0.5, w: W - left - right, h: usableH - topH - gap * 0.5 };

      const xPix = (x) => topRect.x + ((x - xmin) / (xmax - xmin)) * topRect.w;
      const yTop = (y) => topRect.y + ((y1R - y) / (y1R - y0R)) * topRect.h;
      const yBot = (y) => botRect.y + ((dy1R - y) / (dy1R - dy0R)) * botRect.h;

      viewRef.current = { left, right, W, xmin, xmax, topRect, botRect, y0R, y1R };

      ctx.clearRect(0, 0, W, H);

      // ── panel frames + zero axes ───────────────────────────────────────────
      const frame = (r) => {
        ctx.strokeStyle = 'rgba(139,140,142,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      };
      frame(topRect); frame(botRect);

      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      // y = 0 lines
      if (y0R < 0 && y1R > 0) { const y = yTop(0); ctx.beginPath(); ctx.moveTo(topRect.x, y); ctx.lineTo(topRect.x + topRect.w, y); ctx.stroke(); }
      if (dy0R < 0 && dy1R > 0) { const y = yBot(0); ctx.beginPath(); ctx.moveTo(botRect.x, y); ctx.lineTo(botRect.x + botRect.w, y); ctx.stroke(); }
      // x = 0 line (shared)
      if (xmin < 0 && xmax > 0) {
        const x = xPix(0);
        ctx.beginPath(); ctx.moveTo(x, topRect.y); ctx.lineTo(x, topRect.y + topRect.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, botRect.y); ctx.lineTo(x, botRect.y + botRect.h); ctx.stroke();
      }

      // panel titles
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(L.fName, topRect.x + 6, topRect.y + 5);
      ctx.fillText(L.dName, botRect.x + 6, botRect.y + 5);
      // x-axis labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${L.xAxis} = ${xmin.toFixed(1)}`, xPix(xmin) + 22, botRect.y + botRect.h + 5);
      ctx.fillText(`${xmax.toFixed(1)}`, xPix(xmax) - 12, botRect.y + botRect.h + 5);

      // ── top: the curve f(x) ────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(240,236,227,0.82)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= 300; i++) {
        const x = xmin + (i / 300) * (xmax - xmin);
        const py = yTop(f(x));
        if (i === 0) ctx.moveTo(xPix(x), py); else ctx.lineTo(xPix(x), py);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(topRect.x, topRect.y, topRect.w, topRect.h); ctx.clip();
      ctx.stroke();
      ctx.restore();

      // ── turning points (f′ = 0): scan for sign changes of f′ ───────────────
      const turns = [];
      let prev = df(xmin);
      for (let i = 1; i <= NSAMP; i++) {
        const x = xmin + (i / NSAMP) * (xmax - xmin);
        const cur = df(x);
        if (prev === 0 || (prev < 0) !== (cur < 0)) {
          const xr = x - (xmax - xmin) / NSAMP * (cur / (cur - prev || 1e-9));
          turns.push(xr);
        }
        prev = cur;
      }
      turns.forEach((xt) => {
        if (xt < xmin || xt > xmax) return;
        const sx = xPix(xt), sy = yTop(f(xt));
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(197,183,131,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, topRect.y); ctx.lineTo(sx, topRect.y + topRect.h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(197,183,131,0.9)';
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 2 * Math.PI); ctx.fill();
      });
      if (turns.length) {
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(197,183,131,0.75)';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('f ′ = 0 (flat)', topRect.x + topRect.w - 6, topRect.y + 5);
      }

      // ── the two points, secant, tangent, rise/run triangle ─────────────────
      const x0 = Math.min(xmax, Math.max(xmin, xRef.current));
      const dxv = dxRef.current;
      const x1 = Math.min(xmax, Math.max(xmin, x0 + dxv));
      const f0 = f(x0), f1 = f(x1);
      const run = x1 - x0;
      const secSlope = Math.abs(run) > 1e-6 ? (f1 - f0) / run : df(x0);
      const tanSlope = df(x0);
      const tog = toggleRef.current;

      ctx.save();
      ctx.beginPath(); ctx.rect(topRect.x, topRect.y, topRect.w, topRect.h); ctx.clip();

      // tangent (gold): slope df(x0) through P0, spanning the panel
      if (tog.showTangent) {
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(xPix(xmin), yTop(f0 + tanSlope * (xmin - x0)));
        ctx.lineTo(xPix(xmax), yTop(f0 + tanSlope * (xmax - x0)));
        ctx.stroke();
      }
      // secant (blue): through P0 and P1
      if (tog.showSecant && Math.abs(run) > 1e-6) {
        ctx.strokeStyle = BLUE; ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(xPix(xmin), yTop(f0 + secSlope * (xmin - x0)));
        ctx.lineTo(xPix(xmax), yTop(f0 + secSlope * (xmax - x0)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // rise/run triangle
      if (tog.showTri && Math.abs(run) > 1e-6) {
        ctx.strokeStyle = 'rgba(91,155,213,0.8)'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(xPix(x0), yTop(f0));
        ctx.lineTo(xPix(x1), yTop(f0));   // run leg
        ctx.lineTo(xPix(x1), yTop(f1));   // rise leg
        ctx.stroke();
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = BLUE; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('Δx', (xPix(x0) + xPix(x1)) / 2, yTop(f0) + 4);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('Δf', xPix(x1) + 5, (yTop(f0) + yTop(f1)) / 2);
      }
      ctx.restore();

      // point markers (P0 gold, P1 blue)
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(xPix(x0), yTop(f0), 6, 0, 2 * Math.PI); ctx.fill();
      if (Math.abs(run) > 1e-6) {
        ctx.fillStyle = BLUE;
        ctx.beginPath(); ctx.arc(xPix(x1), yTop(f1), 5, 0, 2 * Math.PI); ctx.fill();
      }

      // cubic control points (draggable)
      if (id === 'cubic') {
        const yn = ynRef.current;
        CUBIC_XN.forEach((xn, i) => {
          const sx = xPix(xn), sy = yTop(yn[i]);
          ctx.fillStyle = 'rgba(13,19,33,0.9)';
          ctx.strokeStyle = TEXT; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        });
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = MUTED; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('drag the hollow nodes', topRect.x + 6, topRect.y + topRect.h - 6);
      }

      // ── bottom: f′(x), faint analytic reference, traced points, live point ──
      ctx.save();
      ctx.beginPath(); ctx.rect(botRect.x, botRect.y, botRect.w, botRect.h); ctx.clip();
      // analytic reference (faint dashed)
      ctx.strokeStyle = 'rgba(197,183,131,0.28)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (let i = 0; i <= 300; i++) {
        const x = xmin + (i / 300) * (xmax - xmin);
        const py = yBot(df(x));
        if (i === 0) ctx.moveTo(xPix(x), py); else ctx.lineTo(xPix(x), py);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // traced points (gold): the derivative built point by point as x moves
      if (tog.traceDeriv) {
        const traced = tracedRef.current;
        ctx.fillStyle = GOLD;
        for (let i = 0; i < NSAMP; i++) {
          if (!traced[i]) continue;
          const x = xmin + (i / (NSAMP - 1)) * (xmax - xmin);
          ctx.beginPath(); ctx.arc(xPix(x), yBot(df(x)), 1.8, 0, 2 * Math.PI); ctx.fill();
        }
      }
      ctx.restore();

      // mark the current x as traced, then draw the live derivative point
      const ti = Math.round(((x0 - xmin) / (xmax - xmin)) * (NSAMP - 1));
      if (ti >= 0 && ti < NSAMP) tracedRef.current[ti] = true;
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(xPix(x0), yBot(tanSlope), 6, 0, 2 * Math.PI); ctx.fill();

      // dotted cursor line tying both panels at the current x
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(197,183,131,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xPix(x0), topRect.y); ctx.lineTo(xPix(x0), botRect.y + botRect.h); ctx.stroke();
      ctx.setLineDash([]);

      // ── publish readouts (~10 Hz) ──────────────────────────────────────────
      if (now - lastPub > 100) {
        lastPub = now;
        const nearTurn = turns.some((xt) => Math.abs(xt - x0) < (xmax - xmin) * 0.012);
        setRo({ x: x0, secant: secSlope, tangent: tanSlope, gap: Math.abs(secSlope - tanSlope), turning: nearTurn });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize);
    robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []); // eslint-disable-line

  // ── pointer: drag x along the curve, or drag a cubic control node ──────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const worldX = (cssX) => {
      const v = viewRef.current; if (!v) return 0;
      const plotW = v.W - v.left - v.right;
      return v.xmin + ((cssX - v.left) / plotW) * (v.xmax - v.xmin);
    };
    const worldYTop = (cssY) => {
      const v = viewRef.current; if (!v) return 0;
      const { topRect, y0R, y1R } = v;
      return y1R - ((cssY - topRect.y) / topRect.h) * (y1R - y0R);
    };

    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      const cssX = e.clientX - r.left, cssY = e.clientY - r.top;
      const v = viewRef.current;
      // cubic: grab a control node if the press is near one
      if (presetRef.current === 'cubic' && v) {
        const plotW = v.W - v.left - v.right;
        const yn = ynRef.current;
        for (let i = 0; i < CUBIC_XN.length; i++) {
          const sx = v.left + ((CUBIC_XN[i] - v.xmin) / (v.xmax - v.xmin)) * plotW;
          const sy = v.topRect.y + ((v.y1R - yn[i]) / (v.y1R - v.y0R)) * v.topRect.h;
          if (Math.hypot(cssX - sx, cssY - sy) < 14) { dragRef.current = { type: 'cp', idx: i }; return; }
        }
      }
      dragRef.current = { type: 'x' };
      applyDrag(cssX, cssY);
    };

    const applyDrag = (cssX, cssY) => {
      const d = dragRef.current; if (!d) return;
      const v = viewRef.current; if (!v) return;
      if (d.type === 'cp') {
        const yn = ynRef.current;
        yn[d.idx] = Math.max(v.y0R + 0.15, Math.min(v.y1R - 0.15, worldYTop(cssY)));
        coefRef.current = fitCubic(CUBIC_XN, yn);
        tracedRef.current = new Array(NSAMP).fill(false); // derivative changed
      } else {
        xRef.current = Math.max(v.xmin, Math.min(v.xmax, worldX(cssX)));
        shrinkRef.current = false;
      }
    };

    const onDown = (e) => { e.preventDefault(); canvas.setPointerCapture?.(e.pointerId); pick(e); };
    const onMove = (e) => {
      if (!dragRef.current) return;
      const r = canvas.getBoundingClientRect();
      applyDrag(e.clientX - r.left, e.clientY - r.top);
    };
    const onUp = () => { dragRef.current = null; };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(3) : '--');

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <label className="text-usna-text text-sm font-medium block mb-1.5">Function</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([id, p]) => (
              <button
                key={id}
                onClick={() => setPreset(id)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                  preset === id
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Slider label="Separation (Δx)" value={dx} min={0.02} max={2.5} step={0.02} unit="" onChange={(v) => { setDx(v); dxRef.current = v; shrinkRef.current = false; }} />
        <button
          onClick={() => { shrinkRef.current = true; }}
          className="mb-3 w-full px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
        >
          Shrink Δx → 0
        </button>
        <span className="block -mt-2 mb-3 text-usna-muted text-xs">
          Drag the curve to move {L.xAxis}; the secant approaches the tangent.
        </span>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showSecant} onChange={(e) => setShowSecant(e.target.checked)} /> Secant (blue)
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showTangent} onChange={(e) => setShowTangent(e.target.checked)} /> Tangent (gold)
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showTri} onChange={(e) => setShowTri(e.target.checked)} /> Rise / run triangle
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={traceDeriv} onChange={(e) => setTraceDeriv(e.target.checked)} /> Trace {L.dName}
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label={L.xAxis} value={fmt(ro.x)} unit="" />
          <Readout label="secant Δf/Δx" value={fmt(ro.secant)} unit={L.dUnit} />
          <Readout label={`tangent ${L.slope}`} value={fmt(ro.tangent)} unit={L.dUnit} />
          <Readout label="|secant − tangent|" value={fmt(ro.gap)} unit="" />
          {ro.turning && <Readout label="at a turning point" value={`${L.slope} = 0`} unit="" />}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 460, background: BG }}
        >
          <canvas ref={canvasRef} className="block" style={{ touchAction: 'none' }} />
        </div>
        <InfoPanel
          title={mode === 'motion' ? 'The slope of x(t) is the velocity' : 'The derivative as the slope of the tangent'}
          description={
            mode === 'motion'
              ? "With the upper curve read as position x(t), the secant slope Δx/Δt is the average velocity over an interval and the tangent slope is the instantaneous velocity v = dx/dt. As Δt decreases to zero, the average velocity converges to the instantaneous value and the |secant − tangent| gap approaches zero. The lower panel traces v(t) as x(t) is sampled across the domain, and a horizontal tangent marks an instant where v = 0. These are the relations v = dx/dt and a = dv/dt of the first SP211 lessons."
              : "The derivative at a point is the slope of the tangent line. For two points x and x + Δx the secant has slope Δf/Δx, the average rate of change; as Δx decreases to zero the secant slope converges to the tangent slope f′(x) and the |secant − tangent| gap approaches zero. Since each x determines one such value, the derivative is itself a function, traced point by point in the lower panel and agreeing with the analytic result (x² gives 2x, sin gives cos). Where the tangent is horizontal, f′(x) = 0, locating a turning point."
          }
          equation={mode === 'motion'
            ? String.raw`v = \frac{dx}{dt} = \lim_{\Delta t \to 0} \frac{x(t+\Delta t) - x(t)}{\Delta t}`
            : String.raw`f'(x) = \lim_{\Delta x \to 0} \frac{f(x+\Delta x) - f(x)}{\Delta x}`}
        />
      </div>
    </div>
  );
}
