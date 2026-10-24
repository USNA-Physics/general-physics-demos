import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * The integral as area. Companion to SlopeIsDerivative.
 *
 * The definite integral is the signed area under the curve, obtained as the limit
 * of a Riemann sum of rectangles. Three views share one canvas-driven engine:
 *
 *   riemann (default) : f(x) with N shaded rectangles. As N increases the sum
 *                       converges to the exact area, and the gap readout tends to
 *                       zero. The left and right rules bracket the limit from
 *                       opposite sides. Where the curve lies below the axis (the
 *                       sin x and x³−3x presets) the area is negative, so a curve
 *                       with equal lobes integrates to approximately zero.
 *
 *   accumulation      : two linked panels. Dragging the upper limit b fills the
 *                       signed area on the top panel while the bottom panel draws
 *                       A(x) = ∫ₐˣ f. The tangent to A at b has slope f(b), a
 *                       preview of the Fundamental Theorem of Calculus.
 *
 *   motion            : the same two panels relabeled t, v(t), so the area is
 *                       displacement (the area under v is Δx, and area below the
 *                       axis subtracts), connecting to SP211 L3 and the ch02 Grapher.
 *
 * Animation follows the house pattern: one rAF loop reads inputs from refs and
 * draws imperatively, and the sum, exact, and gap readouts are published to React
 * at about 10 Hz rather than per frame. The limits a, b live in refs so dragging
 * stays smooth; N, rule, and preset come from React state, mirrored into refs.
 */

const GOLD = '#C5B783';     // positive area
const GOLD_SOFT = 'rgba(197,183,131,0.22)';
const MUTED = '#8B8C8E';    // negative area (hatched)
const TEXT = '#F0ECE3';
const BLUE = '#5B9BD5';     // the curve / accumulation line
const BG = '#0D1321';
const GRID = 'rgba(139,140,142,0.22)';

// Each preset carries f, its exact antiderivative F (so the "exact" value and the
// accumulation A(x) = F(x) − F(a) are analytic, not numerically estimated), a
// working domain, and sensible default limits. Two presets dip below the axis so
// signed area is concrete.
const PRESETS = {
  parabola: { label: 'x²', f: (x) => x * x, F: (x) => (x * x * x) / 3, domain: [0, 3], a0: 0, b0: 2.5 },
  line: { label: 'x', f: (x) => x, F: (x) => (x * x) / 2, domain: [0, 3], a0: 0, b0: 2.5 },
  sine: { label: 'sin x', f: (x) => Math.sin(x), F: (x) => -Math.cos(x), domain: [0, 2 * Math.PI], a0: 0, b0: 2 * Math.PI },
  cubic: { label: 'x³ − 3x', f: (x) => x * x * x - 3 * x, F: (x) => (x ** 4) / 4 - 1.5 * x * x, domain: [-2.2, 2.2], a0: -2, b0: 2 },
};
const PRESET_KEYS = Object.keys(PRESETS);

const DEFAULTS = { preset: 'parabola', N: 8, rule: 'left' };

/** Signed Riemann sum with the given sampling rule (handles a>b via signed Δx). */
function riemannSum(f, a, b, N, rule) {
  const dx = (b - a) / N;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const xl = a + i * dx;
    const xr = xl + dx;
    if (rule === 'trapezoid') { s += ((f(xl) + f(xr)) / 2) * dx; continue; }
    let xi;
    if (rule === 'left') xi = xl;
    else if (rule === 'right') xi = xr;
    else xi = (xl + xr) / 2; // midpoint
    s += f(xi) * dx;
  }
  return s;
}

const fmt = (v) => (Math.abs(v) < 0.0005 ? '0.000' : v.toFixed(3));

export default function AreaIsIntegral({ mode = 'riemann' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [presetKey, setPresetKey] = useState(DEFAULTS.preset);
  const [N, setN] = useState(DEFAULTS.N);
  const [rule, setRule] = useState(DEFAULTS.rule);

  // live readouts published from the loop (~10 Hz)
  const [ro, setRo] = useState({ a: 0, b: 2.5, sum: 0, left: 0, right: 0, exact: 0, gap: 0 });

  const twoPanel = mode === 'accumulation' || mode === 'motion';

  // limits live in refs for smooth dragging; everything else mirrored from state
  const aRef = useRef(PRESETS[DEFAULTS.preset].a0);
  const bRef = useRef(PRESETS[DEFAULTS.preset].b0);
  const presetRef = useRef(presetKey); presetRef.current = presetKey;
  const NRef = useRef(N); NRef.current = N;
  const ruleRef = useRef(rule); ruleRef.current = rule;
  const modeRef = useRef(mode); modeRef.current = mode;
  const twoPanelRef = useRef(twoPanel); twoPanelRef.current = twoPanel;

  // when the preset changes, snap the limits to that preset's defaults
  useEffect(() => {
    aRef.current = PRESETS[presetKey].a0;
    bRef.current = PRESETS[presetKey].b0;
  }, [presetKey]);

  const reset = () => {
    setPresetKey(DEFAULTS.preset);
    setN(DEFAULTS.N);
    setRule(DEFAULTS.rule);
    aRef.current = PRESETS[DEFAULTS.preset].a0;
    bRef.current = PRESETS[DEFAULTS.preset].b0;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, last;
    let lastPub = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    // drag state: which handle ('a' | 'b' | null) the pointer grabbed
    let dragging = null;
    // the most recent top-panel geometry, so pointer handlers can hit-test
    let geom = null; // { rect, xMin, xMax, X, pxPerX }

    const pickHandle = (px, py) => {
      if (!geom) return null;
      const { rect, X } = geom;
      if (py < rect.y - 20 || py > rect.y + rect.h + 20) return null;
      const da = Math.abs(px - X(aRef.current));
      const db = Math.abs(px - X(bRef.current));
      const near = Math.min(da, db);
      if (near > 26) return null;
      return da <= db ? 'a' : 'b';
    };

    const toDataX = (px) => {
      if (!geom) return 0;
      const { rect, xMin, xMax } = geom;
      const t = (px - rect.x) / rect.w;
      return xMin + t * (xMax - xMin);
    };

    const onDown = (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const h = pickHandle(px, py);
      if (h) {
        dragging = h;
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    };
    const onMove = (e) => {
      if (!dragging || !geom) return;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const { xMin, xMax } = geom;
      let x = Math.max(xMin, Math.min(xMax, toDataX(px)));
      if (dragging === 'a') aRef.current = x;
      else bRef.current = x;
      e.preventDefault();
    };
    const onUp = (e) => {
      dragging = null;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    // ── draw helpers ────────────────────────────────────────────────────────
    const makeT = (rect, xMin, xMax, yMin, yMax) => ({
      X: (x) => rect.x + ((x - xMin) / (xMax - xMin)) * rect.w,
      Y: (y) => rect.y + rect.h - ((y - yMin) / (yMax - yMin)) * rect.h,
    });

    const hatchRect = (x, y, w, h) => {
      if (h <= 0.5 || w <= 0.5) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(139,140,142,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(139,140,142,0.6)';
      ctx.lineWidth = 1;
      for (let d = -h; d < w; d += 6) {
        ctx.beginPath();
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const axes = (rect, T, xMin, xMax, yMin, yMax, xLabel, yLabel) => {
      // frame baseline (y = 0) + left edge
      const y0 = T.Y(0);
      ctx.strokeStyle = 'rgba(139,140,142,0.55)';
      ctx.lineWidth = 1.2;
      if (0 >= yMin && 0 <= yMax) {
        ctx.beginPath(); ctx.moveTo(rect.x, y0); ctx.lineTo(rect.x + rect.w, y0); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x, rect.y + rect.h); ctx.stroke();
      // labels
      ctx.fillStyle = MUTED;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(xLabel, rect.x + rect.w, (0 >= yMin && 0 <= yMax ? y0 : rect.y + rect.h) + 6);
      ctx.save();
      ctx.translate(rect.x - 30, rect.y + rect.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = BLUE;
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    };

    const curve = (T, f, xMin, xMax, color = BLUE, width = 2.6, dash = null) => {
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      const steps = 240;
      for (let i = 0; i <= steps; i++) {
        const x = xMin + (i / steps) * (xMax - xMin);
        const sx = T.X(x), sy = T.Y(f(x));
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();
    };

    // a vertical draggable limit handle
    const handle = (T, x, rect, label) => {
      const sx = T.X(x);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx, rect.y - 6); ctx.lineTo(sx, rect.y + rect.h + 6); ctx.stroke();
      ctx.setLineDash([]);
      // grab knob
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(sx, rect.y - 6, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = BG;
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, sx, rect.y - 6);
    };

    const draw = (now) => {
      if (last === undefined) last = now;
      last = now;

      const P = PRESETS[presetRef.current];
      const f = P.f, F = P.F;
      const [xMin, xMax] = P.domain;
      let a = aRef.current, b = bRef.current;
      const n = NRef.current;
      const rl = ruleRef.current;
      const md = modeRef.current;
      const two = twoPanelRef.current;

      // y-range from the curve over the domain, padded, always including 0
      let ymin = 0, ymax = 0;
      for (let i = 0; i <= 200; i++) {
        const v = f(xMin + (i / 200) * (xMax - xMin));
        if (v < ymin) ymin = v; if (v > ymax) ymax = v;
      }
      const pad = (ymax - ymin) * 0.12 || 1;
      ymin -= pad; ymax += pad;

      ctx.clearRect(0, 0, W, H);

      const padL = 46, padR = 16, padT = 16, padB = 26;
      const topH = two ? H * 0.52 - padT : H - padT - padB;
      const topRect = { x: padL, y: padT, w: W - padL - padR, h: topH };
      const T = makeT(topRect, xMin, xMax, ymin, ymax);
      geom = { rect: topRect, xMin, xMax, X: T.X };

      // faint vertical grid
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      for (let gx = Math.ceil(xMin); gx <= xMax; gx++) {
        const sx = T.X(gx);
        ctx.beginPath(); ctx.moveTo(sx, topRect.y); ctx.lineTo(sx, topRect.y + topRect.h); ctx.stroke();
      }

      const motion = md === 'motion';
      const xLabel = motion ? 't (s)' : 'x';
      const yLabel = motion ? 'v (m/s)' : 'f(x)';

      // ── the shaded area between a and b ──────────────────────────────────
      // riemann: exactly N rectangles by the chosen rule, exhibiting convergence.
      // two-panel: a fine signed fill (thin slices) so the area reads as a smooth
      //            region as b is dragged.
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const y0 = T.Y(0);
      if (!two) {
        const dx = (b - a) / n;
        for (let i = 0; i < n; i++) {
          const xl = a + i * dx, xr = xl + dx;
          let xs; // sample point for the rule
          if (rl === 'left') xs = xl;
          else if (rl === 'right') xs = xr;
          else if (rl === 'midpoint') xs = (xl + xr) / 2;
          else xs = xl; // trapezoid drawn as the slice height at left for shading
          const fv = rl === 'trapezoid' ? (f(xl) + f(xr)) / 2 : f(xs);
          const rx = T.X(Math.min(xl, xr));
          const rw = Math.abs(T.X(xr) - T.X(xl));
          const yf = T.Y(fv);
          const top = Math.min(y0, yf), ht = Math.abs(yf - y0);
          if (fv >= 0) {
            ctx.fillStyle = GOLD_SOFT; ctx.fillRect(rx, top, rw, ht);
            ctx.strokeStyle = 'rgba(197,183,131,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(rx, top, rw, ht);
          } else {
            hatchRect(rx, top, rw, ht);
          }
        }
      } else {
        const slices = 240;
        const dx = (hi - lo) / slices;
        for (let i = 0; i < slices; i++) {
          const xl = lo + i * dx;
          const fv = f(xl + dx / 2);
          const rx = T.X(xl), rw = Math.max(1, T.X(xl + dx) - T.X(xl));
          const yf = T.Y(fv);
          const top = Math.min(y0, yf), ht = Math.abs(yf - y0);
          if (fv >= 0) { ctx.fillStyle = GOLD_SOFT; ctx.fillRect(rx, top, rw + 0.5, ht); }
          else hatchRect(rx, top, rw + 0.5, ht);
        }
      }

      axes(topRect, T, xMin, xMax, ymin, ymax, xLabel, yLabel);
      curve(T, f, xMin, xMax);
      handle(T, a, topRect, 'a');
      handle(T, b, topRect, 'b');

      // ── numbers ───────────────────────────────────────────────────────────
      const exact = F(b) - F(a);
      const sumLeft = riemannSum(f, a, b, n, 'left');
      const sumRight = riemannSum(f, a, b, n, 'right');
      const sumChosen = riemannSum(f, a, b, n, rl);
      const gap = sumChosen - exact;

      // in-canvas convergence caption (riemann mode)
      if (!two) {
        ctx.font = 'bold 14px JetBrains Mono, monospace';
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`${rl} sum (N=${n}) = ${fmt(sumChosen)}`, padL + 6, padT + 4);
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillStyle = TEXT;
        ctx.fillText(`exact = ${fmt(exact)}   gap = ${fmt(gap)}`, padL + 6, padT + 22);
      }

      // ── bottom panel: accumulation A(x) = ∫ₐˣ f ─────────────────────────────
      if (two) {
        const botRect = { x: padL, y: H * 0.56, w: W - padL - padR, h: H - H * 0.56 - padB };
        // A over the full domain, for a stable axis
        const Aof = (x) => F(x) - F(a);
        let amin = 0, amax = 0;
        for (let i = 0; i <= 200; i++) {
          const v = Aof(xMin + (i / 200) * (xMax - xMin));
          if (v < amin) amin = v; if (v > amax) amax = v;
        }
        const apad = (amax - amin) * 0.14 || 1; amin -= apad; amax += apad;
        const TA = makeT(botRect, xMin, xMax, amin, amax);

        axes(botRect, TA, xMin, xMax, amin, amax, xLabel, motion ? 'x (m)' : 'A(x)');
        // full A(x) faint dashed (it's a function over the whole domain)
        curve(TA, Aof, xMin, xMax, 'rgba(91,155,213,0.35)', 1.6, [5, 5]);
        // accumulated part a→b solid
        curve(TA, Aof, a, b, BLUE, 2.8);
        // current accumulation point (b, A(b)) + value
        const px = TA.X(b), py = TA.Y(Aof(b));
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill();
        // short tangent whose slope is f(b): the FTC foreshadow
        const slope = f(b);
        const dxw = (xMax - xMin) * 0.08;
        const x1 = b - dxw, x2 = b + dxw;
        const p1 = { x: TA.X(x1), y: TA.Y(Aof(b) - slope * dxw) };
        const p2 = { x: TA.X(x2), y: TA.Y(Aof(b) + slope * dxw) };
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`slope = f(b) = ${fmt(slope)}`, px + 8, py - 6);
        ctx.fillStyle = BLUE; ctx.textBaseline = 'top';
        ctx.fillText(`${motion ? 'displacement' : 'A(b)'} = ${fmt(Aof(b))}`, padL + 6, botRect.y + 2);
      }

      // publish readouts ~10 Hz
      if (now - lastPub > 100) {
        lastPub = now;
        setRo({ a, b, sum: sumChosen, left: sumLeft, right: sumRight, exact, gap });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const resObs = new ResizeObserver(resize);
    resObs.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      resObs.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const motion = mode === 'motion';
  const areaLabel = motion ? 'Displacement (area)' : 'Area ∫ₐᵇ f';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {/* preset picker */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-1.5">
            {motion ? 'Velocity v(t)' : 'Function f(x)'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setPresetKey(k)}
                className={`px-2.5 py-1 rounded text-sm font-mono border transition-colors ${
                  presetKey === k
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-card text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {PRESETS[k].label}
              </button>
            ))}
          </div>
          <span className="block mt-1.5 text-usna-muted text-xs">
            sin x and x³−3x fall below the axis, where the area is negative
          </span>
        </div>

        {mode === 'riemann' && (
          <>
            <Slider label="Rectangles (N)" value={N} min={1} max={120} step={1} unit="" onChange={setN} />
            <div className="mb-4">
              <div className="text-usna-text text-sm font-medium mb-1.5">Sampling rule</div>
              <div className="flex flex-wrap gap-1.5">
                {['left', 'right', 'midpoint', 'trapezoid'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRule(r)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      rule === r
                        ? 'bg-usna-gold text-usna-navy border-usna-gold'
                        : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <span className="block mb-3 text-usna-muted text-xs">
          drag the <span className="text-usna-gold">a</span> and <span className="text-usna-gold">b</span> handles on the plot to move the limits
        </span>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="lower limit a" value={ro.a.toFixed(2)} unit="" />
          <Readout label="upper limit b" value={ro.b.toFixed(2)} unit="" />
          {mode === 'riemann' ? (
            <>
              <Readout label={`${rule} sum`} value={fmt(ro.sum)} unit="" />
              <Readout label="exact ∫" value={fmt(ro.exact)} unit="" />
              <Readout label="gap (sum − exact)" value={fmt(ro.gap)} unit="" />
              <div className="mt-2 pt-2 border-t border-usna-grid">
                <Readout label="left sum" value={fmt(ro.left)} unit="" />
                <Readout label="right sum" value={fmt(ro.right)} unit="" />
                <span className="block mt-1 text-usna-muted text-xs">
                  left and right bracket the exact value from opposite sides; both converge as N increases
                </span>
              </div>
            </>
          ) : (
            <>
              <Readout label={areaLabel} value={fmt(ro.exact)} unit={motion ? 'm' : ''} />
              <span className="block mt-1 text-usna-muted text-xs">
                the bottom panel is A(x) = ∫ₐˣ f ; its slope at b is f(b)
              </span>
            </>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
          style={{ height: 460, background: BG, touchAction: 'none' }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title={
            mode === 'accumulation'
              ? 'The integral is a function of its upper limit'
              : mode === 'motion'
              ? 'Area under v(t) is displacement'
              : 'The integral is the signed area'
          }
          description={
            mode === 'accumulation'
              ? 'As the upper limit b varies, the signed area on the top panel is the value of the accumulation function A(x) = ∫ₐˣ f drawn on the bottom panel. A(x) increases where f is positive, decreases where f is negative, and is stationary where f vanishes. The tangent to A at b has slope f(b), the statement that differentiation inverts integration, made precise by the Fundamental Theorem of Calculus.'
              : mode === 'motion'
              ? 'When the curve is read as a velocity v(t), the signed area is the displacement. Area above the axis advances the position and area below the axis subtracts from it. The bottom panel is the position x(t) = ∫ v dt, the displacement as area of SP211 L3 and the ch02 Grapher.'
              : 'The definite integral is the signed area between the curve and the axis, approximated by a sum of N rectangles. As N increases the sum converges to the exact value and the gap readout tends to zero; the left and right rules approach the limit from opposite sides. Where the curve lies below the axis the contribution is negative, so a curve with equal lobes above and below integrates to approximately zero.'
          }
          equation={
            motion
              ? String.raw`\Delta x=\int_{t_a}^{t_b} v\,dt \;=\; \text{(signed) area under } v(t)`
              : String.raw`\int_a^b f(x)\,dx=\lim_{N\to\infty}\sum_i f(x_i)\,\Delta x,\qquad \Delta x=\frac{b-a}{N}`
          }
        />
      </div>
    </div>
  );
}
