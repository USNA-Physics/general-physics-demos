import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * The dot product, presented as a projection.
 *
 * Two vectors are drawn from the origin. The dot product is represented by the
 * projection of a onto the line of b, a signed segment of length |a|cosθ. As b
 * rotates, a·b is greatest when the vectors are aligned, is exactly zero when they
 * are perpendicular, and is negative when the angle is obtuse; the projection
 * reverses direction accordingly. The product depends on the cosine of the angle,
 * in contrast to the cross product, which depends on the sine.
 *
 * The geometric form |a||b|cosθ and the component form aₓbₓ + a_yb_y give the same
 * value, and both are displayed together in the panel. The construction and both
 * formulas extend without change to three dimensions, where a·b = aₓbₓ + a_yb_y +
 * a_zb_z; representative 3-D examples are provided in the control panel.
 *
 * Modes:
 *   projection  pure geometry, a and b dimensionless
 *   work        the factors are relabeled F (newtons) and d (meters); the
 *               projection of F along d is the component of the force that does
 *               work, and a·b is the work W = F·d in joules
 *
 * The state is polar (a magnitude and an angle per vector), so the sliders and the
 * drag handles share one representation. Drawing is imperative on a canvas and
 * repeats on each state change and on resize; there is no animation loop.
 */

const GOLD = '#C5B783';       // b / d, the direction projected onto; the result
const GOLD_HI = '#E6D9A8';    // the projection segment (brighter gold)
const BLUE = '#5B9BD5';       // a / F, the vector being projected
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const NEG = '#9A8C6B';        // muted gold for a negative dot product
const BG = '#0D1321';

const MAG_MIN = 0.5;
const MAG_MAX = 8;
const TOL = 3;                // degrees within which a special case is reported

const DEFAULTS = {
  projection: { aMag: 5, aAng: 25, bMag: 4, bAng: 70 },
  work: { aMag: 6, aAng: 30, bMag: 4, bAng: 0 }, // F = 6 N at 30°, d = 4 m horizontal
};

// Representative three-dimensional examples. Each reports the component sum, the
// magnitudes, and the angle, demonstrating that the operation is unchanged in 3-D.
const EXAMPLES_3D = [
  { label: 'Oblique', a: [1, 2, 2], b: [2, 0, 1] },
  { label: 'Perpendicular', a: [1, 0, 0], b: [0, 1, 0] },
  { label: 'Antiparallel', a: [1, 1, 0], b: [-2, -2, 0] },
  { label: 'General', a: [2, -1, 3], b: [0, 4, 1] },
];

const rad = (deg) => (deg * Math.PI) / 180;
const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm3 = (u) => Math.hypot(u[0], u[1], u[2]);

export default function DotProduct({ mode = 'projection' }) {
  const work = mode === 'work';
  const L = work
    ? { a: 'F', b: 'd', aUnit: 'N', bUnit: 'm', dotLabel: 'W = F·d', dotUnit: 'J' }
    : { a: 'a', b: 'b', aUnit: '', bUnit: '', dotLabel: 'a·b', dotUnit: '' };

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const d0 = work ? DEFAULTS.work : DEFAULTS.projection;
  const [aMag, setAMag] = useState(d0.aMag);
  const [aAng, setAAng] = useState(d0.aAng); // deg, math convention (CCW from +x)
  const [bMag, setBMag] = useState(d0.bMag);
  const [bAng, setBAng] = useState(d0.bAng);

  const [showProjection, setShowProjection] = useState(true);
  const [showAngle, setShowAngle] = useState(true);
  const [showPerp, setShowPerp] = useState(true);
  const [showStrip, setShowStrip] = useState(true);
  const [lockRotate, setLockRotate] = useState(false); // fix magnitudes, rotate b only
  const [example, setExample] = useState(null);        // selected 3-D example index

  const reset = () => {
    setAMag(d0.aMag); setAAng(d0.aAng); setBMag(d0.bMag); setBAng(d0.bAng);
    setShowProjection(true); setShowAngle(true); setShowPerp(true);
    setShowStrip(true); setLockRotate(false); setExample(null);
  };

  // place b at a fixed orientation relative to a (the special cases)
  const setRelative = (offsetDeg) => setBAng(((aAng + offsetDeg) % 360 + 360) % 360);

  // derived geometry (cheap; recomputed each render)
  const ax = aMag * Math.cos(rad(aAng));
  const ay = aMag * Math.sin(rad(aAng));
  const bx = bMag * Math.cos(rad(bAng));
  const by = bMag * Math.sin(rad(bAng));
  // signed angle from a to b in [0,360), and the unsigned angle between in [0,180]
  const signed = ((bAng - aAng) % 360 + 360) % 360;
  const between = signed > 180 ? 360 - signed : signed;
  const cosT = Math.cos(rad(between));
  const dotGeom = aMag * bMag * cosT;          // |a||b|cosθ
  const dotComp = ax * bx + ay * by;           // aₓbₓ + a_yb_y  (same number)
  const projScalar = aMag * cosT;              // signed length of a's projection on b
  const perp = Math.abs(cosT) < 0.02;          // essentially 90° or 270°

  // special-case classification. The two perpendicular orientations (90° and 270°)
  // are distinguished here only to make the point that a·b cannot tell them apart.
  let special = null;
  if (Math.abs(signed - 0) < TOL || Math.abs(signed - 360) < TOL) special = 'parallel';
  else if (Math.abs(signed - 180) < TOL) special = 'antiparallel';
  else if (Math.abs(signed - 90) < TOL) special = 'perpendicular';
  else if (Math.abs(signed - 270) < TOL) special = 'perpendicular-reversed';

  const specialText = {
    parallel: 'Parallel: cosθ = 1, a·b is maximal and positive.',
    antiparallel: 'Antiparallel: cosθ = −1, a·b is maximal in magnitude and negative.',
    perpendicular: 'Perpendicular: cosθ = 0, so a·b = 0.',
    'perpendicular-reversed': 'Perpendicular (reversed): cosθ = 0 again, so a·b = 0. The dot product does not distinguish the two perpendicular orientations.',
  };

  const ex = example != null ? EXAMPLES_3D[example] : null;
  const exDot = ex ? dot3(ex.a, ex.b) : 0;
  const exAngle = ex ? Math.acos(Math.max(-1, Math.min(1, exDot / (norm3(ex.a) * norm3(ex.b))))) * 180 / Math.PI : 0;

  // state snapshot for the imperative draw + drag handlers
  const stRef = useRef({});
  stRef.current = {
    aMag, aAng, bMag, bAng, ax, ay, bx, by, projScalar, cosT, between, signed, perp,
    showProjection, showAngle, showPerp, showStrip, work, L, special,
  };
  const drawRef = useRef(() => {});
  const draggingRef = useRef(null); // 'a' | 'b' | null

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    canvas.style.touchAction = 'none';

    let ctx, W, H, ox, oy, scale;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      ox = W * 0.46;
      oy = H * 0.56;                                   // room for arrows pointing up
      scale = (Math.min(W, H) * 0.44) / MAG_MAX;       // fixed world-to-px scale
      draw();
    };

    // world → screen (math y-up → canvas y-down)
    const sx = (x) => ox + x * scale;
    const sy = (y) => oy - y * scale;

    const draw = () => {
      if (!ctx) return;
      const s = stRef.current;
      ctx.clearRect(0, 0, W, H);

      // faint axes
      ctx.strokeStyle = 'rgba(139,140,142,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, oy); ctx.lineTo(W, oy);
      ctx.moveTo(ox, 0); ctx.lineTo(ox, H);
      ctx.stroke();

      const axp = s.ax, ayp = s.ay, bxp = s.bx, byp = s.by;
      const bLen = Math.hypot(bxp, byp) || 1;
      const ux = bxp / bLen, uy = byp / bLen;          // b̂ in world coords

      // angle wedge between a and b
      if (s.showAngle) {
        const a0 = rad(s.aAng), a1 = rad(s.bAng);
        ctx.fillStyle = s.perp ? 'rgba(197,183,131,0.10)' : 'rgba(91,155,213,0.12)';
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        // canvas arc angles are clockwise-from-+x because y is flipped: negate
        ctx.arc(ox, oy, 34, -a0, -a1, (((s.bAng - s.aAng) % 360) + 360) % 360 <= 180 ? true : false);
        ctx.closePath();
        ctx.fill();
        if (!s.perp) {
          ctx.fillStyle = MUTED;
          ctx.font = '13px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const mid = rad((s.aAng + s.bAng) / 2);
          ctx.fillText(`${s.between.toFixed(0)}°`, ox + Math.cos(mid) * 52, oy - Math.sin(mid) * 52);
        }
      }

      // projection of a onto the line of b
      if (s.showProjection) {
        const projX = ux * s.projScalar, projY = uy * s.projScalar;  // world
        // dropped perpendicular from a's tip to the projection point
        if (s.showPerp) {
          ctx.strokeStyle = 'rgba(240,236,227,0.45)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(sx(axp), sy(ayp));
          ctx.lineTo(sx(projX), sy(projY));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // the projection segment: thick, from the origin along b
        ctx.strokeStyle = GOLD_HI;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(0), sy(0));
        ctx.lineTo(sx(projX), sy(projY));
        ctx.stroke();
        ctx.lineCap = 'butt';
        // signed-length label
        ctx.fillStyle = GOLD_HI;
        ctx.font = 'bold 13px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lx = sx(projX * 0.5) - uy * 16;
        const ly = sy(projY * 0.5) - ux * 16;
        ctx.fillText(`${s.projScalar >= 0 ? '' : '−'}|${s.L.a}|cosθ = ${s.projScalar.toFixed(2)}`, lx, ly);
      }

      // the two input arrows (labels drawn separately, with clearance + halo)
      drawArrow(ctx, { x: sx(0), y: sy(0), dx: sx(bxp) - sx(0), dy: sy(byp) - sy(0), color: GOLD, width: 3.5, head: 12 });
      drawArrow(ctx, { x: sx(0), y: sy(0), dx: sx(axp) - sx(0), dy: sy(ayp) - sy(0), color: BLUE, width: 3.5, head: 12 });
      const lbl = (tx, ty, text, color, out = 22) => {
        let dx = tx - sx(0), dy = ty - sy(0);
        const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
        const lx = tx + dx * out, ly = ty + dy * out;
        ctx.font = 'bold 15px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = BG; ctx.strokeText(text, lx, ly);
        ctx.fillStyle = color; ctx.fillText(text, lx, ly);
      };
      lbl(sx(bxp), sy(byp), s.L.b, GOLD);
      lbl(sx(axp), sy(ayp), s.L.a, BLUE);

      // right-angle glyph when perpendicular (a·b = 0)
      if (s.perp) {
        const q = 16;
        const pax = Math.cos(rad(s.aAng)), pay = Math.sin(rad(s.aAng));
        const pbx = Math.cos(rad(s.bAng)), pby = Math.sin(rad(s.bAng));
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx(0) + pax * q, sy(0) - pay * q);
        ctx.lineTo(sx(0) + (pax + pbx) * q, sy(0) - (pay + pby) * q);
        ctx.lineTo(sx(0) + pbx * q, sy(0) - pby * q);
        ctx.stroke();
      }

      // crate at the tip of d (work mode only)
      if (s.work) {
        const cxp = sx(bxp), cyp = sy(byp);
        ctx.save();
        ctx.translate(cxp, cyp);
        ctx.rotate(-Math.atan2(byp, bxp));
        ctx.fillStyle = '#243352';
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-14, -11, 28, 22); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      // origin dot
      ctx.fillStyle = TEXT;
      ctx.beginPath();
      ctx.arc(sx(0), sy(0), 3.5, 0, 2 * Math.PI);
      ctx.fill();

      // special-case banner
      if (s.special) {
        ctx.font = 'bold 13px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = s.special === 'parallel' ? GOLD : (s.special === 'antiparallel' ? NEG : GOLD_HI);
        const banner = {
          parallel: 'Parallel: cosθ = 1, a·b maximal',
          antiparallel: 'Antiparallel: cosθ = −1, a·b minimal',
          perpendicular: 'Perpendicular: cosθ = 0, a·b = 0',
          'perpendicular-reversed': 'Perpendicular (reversed): cosθ = 0, a·b = 0',
        }[s.special];
        ctx.fillText(banner, 14, 12);
      }

      // which-trig-function strip: cosθ highlighted, sinθ faint, θ marked
      if (s.showStrip) drawTrigStrip(ctx, W, s.between);

      // a·b value bar (centered at 0; gold positive, muted negative)
      const barW = Math.min(260, W * 0.62);
      const barX = W - barW - 16;
      const barY = H - 34;
      const barH = 14;
      const midX = barX + barW / 2;
      const full = MAG_MAX * MAG_MAX;                  // max |a·b| ≈ |a|max·|b|max
      const half = (barW / 2) * 0.92;
      const val = s.ax * s.bx + s.ay * s.by;
      const px = Math.max(-half, Math.min(half, (val / full) * (barW / 2)));
      ctx.fillStyle = 'rgba(139,140,142,0.18)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = 'rgba(139,140,142,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(midX, barY - 2); ctx.lineTo(midX, barY + barH + 2); ctx.stroke();
      ctx.fillStyle = val >= 0 ? GOLD : NEG;
      if (px >= 0) ctx.fillRect(midX, barY + 2, px, barH - 4);
      else ctx.fillRect(midX + px, barY + 2, -px, barH - 4);
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${s.L.dotLabel} = ${val.toFixed(2)} ${s.L.dotUnit}`, midX, barY - 4);
    };

    drawRef.current = draw;

    // pointer dragging (tip handles)
    const worldFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left - ox) / scale, y: (oy - (e.clientY - rect.top)) / scale };
    };
    const tipDist = (wx, wy, mag, ang) => {
      const tx = mag * Math.cos(rad(ang)), ty = mag * Math.sin(rad(ang));
      return Math.hypot((wx - tx) * scale, (wy - ty) * scale);
    };
    const onDown = (e) => {
      const { x, y } = worldFromEvent(e);
      const s = stRef.current;
      const da = tipDist(x, y, s.aMag, s.aAng);
      const db = tipDist(x, y, s.bMag, s.bAng);
      if (Math.min(da, db) > 26) return;
      // when rotation is locked, only b is grabbable
      draggingRef.current = lockRotate ? 'b' : (da <= db ? 'a' : 'b');
      canvas.setPointerCapture?.(e.pointerId);
      onMove(e);
    };
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const { x, y } = worldFromEvent(e);
      const mag = Math.max(MAG_MIN, Math.min(MAG_MAX, Math.hypot(x, y)));
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      if (draggingRef.current === 'a' && !lockRotate) { setAMag(round1(mag)); setAAng(round1(ang)); }
      else if (draggingRef.current === 'b') {
        setBAng(round1(ang));
        if (!lockRotate) setBMag(round1(mag));
      }
    };
    const onUp = (e) => { draggingRef.current = null; canvas.releasePointerCapture?.(e.pointerId); };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // lockRotate is read inside the handlers via closure, so rebind when it changes
  }, [lockRotate]);

  // redraw whenever any geometry or toggle changes
  useEffect(() => { drawRef.current(); });

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <span className="block mb-3 text-usna-muted text-xs">
          Drag either arrow tip. {lockRotate ? 'Magnitudes fixed: dragging rotates b.' : 'The sliders set magnitude and angle directly.'}
        </span>

        <Slider label={`|${L.a}| (${work ? 'force' : 'magnitude'})`} value={aMag} min={MAG_MIN} max={MAG_MAX} step={0.1} unit={L.aUnit} onChange={setAMag} />
        <Slider label={`Angle of ${L.a}`} value={round1(aAng)} min={-180} max={180} step={1} unit="°" onChange={setAAng} />
        <Slider label={`|${L.b}| (${work ? 'distance' : 'magnitude'})`} value={bMag} min={MAG_MIN} max={MAG_MAX} step={0.1} unit={L.bUnit} onChange={setBMag} />
        <Slider label={`Angle of ${L.b}`} value={round1(bAng)} min={-180} max={180} step={1} unit="°" onChange={setBAng} />

        <div className="mt-3">
          <div className="text-usna-muted text-xs mb-1.5">Special cases (set {L.b} relative to {L.a})</div>
          <div className="grid grid-cols-2 gap-1.5">
            {[['Parallel', 0], ['Perpendicular', 90], ['Antiparallel', 180], ['Reversed ⟂', 270]].map(([lbl, off]) => (
              <button
                key={off}
                onClick={() => setRelative(off)}
                className="px-2 py-1 rounded text-xs font-medium border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors"
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Toggle checked={lockRotate} onChange={setLockRotate}>Fix magnitudes, rotate {L.b} only</Toggle>
          <Toggle checked={showProjection} onChange={setShowProjection}>Show projection</Toggle>
          <Toggle checked={showPerp} onChange={setShowPerp}>Show dropped perpendicular</Toggle>
          <Toggle checked={showAngle} onChange={setShowAngle}>Show angle θ</Toggle>
          <Toggle checked={showStrip} onChange={setShowStrip}>Show cos / sin strip</Toggle>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label={L.dotLabel} value={dotGeom.toFixed(2)} unit={L.dotUnit} />
          <Readout label="θ (between)" value={between.toFixed(1)} unit="°" />
          <Readout label={`proj = |${L.a}|cosθ`} value={projScalar.toFixed(2)} unit={L.aUnit} />
          <Readout label={`|${L.a}|, |${L.b}|`} value={`${aMag.toFixed(1)}, ${bMag.toFixed(1)}`} unit="" />
        </div>

        {special && (
          <p className="mt-2 text-xs text-usna-text leading-snug">{specialText[special]}</p>
        )}

        {/* The two formulas, shown together. */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-2">One value, two formulas (equal):</div>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded border border-usna-grid p-2">
              <div className="text-usna-muted">geometric</div>
              <div className="text-usna-text mt-1">|{L.a}||{L.b}|cosθ</div>
              <div className="text-usna-gold text-base mt-1 tabular-nums">{dotGeom.toFixed(2)}</div>
            </div>
            <div className="rounded border border-usna-grid p-2">
              <div className="text-usna-muted">components</div>
              <div className="text-usna-text mt-1">{L.a}ₓ{L.b}ₓ+{L.a}_y{L.b}_y</div>
              <div className="text-usna-gold text-base mt-1 tabular-nums">{dotComp.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Three-dimensional examples: the same operation in 3-D. */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-1.5">In three dimensions</div>
          <div className="grid grid-cols-2 gap-1.5">
            {EXAMPLES_3D.map((e, i) => (
              <button
                key={e.label}
                onClick={() => setExample(example === i ? null : i)}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                  example === i ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          {ex && (
            <div className="mt-2 font-mono text-xs text-usna-text leading-relaxed">
              <div>a = ({ex.a.join(', ')})</div>
              <div>b = ({ex.b.join(', ')})</div>
              <div className="mt-1" style={{ color: GOLD }}>
                a·b = {ex.a[0]}·{ex.b[0]} + {ex.a[1]}·{ex.b[1]} + {ex.a[2]}·{ex.b[2]} = {exDot}
              </div>
              <div className="text-usna-muted mt-1">|a| = {norm3(ex.a).toFixed(2)}, |b| = {norm3(ex.b).toFixed(2)}, θ = {exAngle.toFixed(1)}°</div>
            </div>
          )}
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
          title={work ? 'Work is the force component along the displacement' : 'The dot product is a projection'}
          description={
            work
              ? 'Only the component of the force along the displacement does work. The projection of F onto d has signed length |F|cosθ, and the work is that length times |d|, so W = F·d = |F||d|cosθ. At a right angle the projection is zero and no work is done; beyond a right angle the work is negative, as when a brake or friction removes energy. The geometric form |F||d|cosθ and the component form Fₓdₓ + F_yd_y report the same value, and both extend to three dimensions.'
              : 'The dot product measures the extent to which one vector lies along another. The projection of a onto the line of b has signed length |a|cosθ, so a·b = |a||b|cosθ depends on the cosine of the angle. It is greatest when the vectors are parallel, zero when they are perpendicular, and negative when the angle is obtuse; at the antiparallel orientation it is most negative. Because it depends on cosine rather than sine, the dot product is complementary to the cross product. The geometric form |a||b|cosθ and the component form aₓbₓ + a_yb_y agree for every configuration, and both hold without change in three dimensions.'
          }
          equation={
            work
              ? String.raw`W = \vec F\cdot\vec d = |\vec F||\vec d|\cos\theta = F_x d_x + F_y d_y`
              : String.raw`\vec a\cdot\vec b = |\vec a||\vec b|\cos\theta = a_x b_x + a_y b_y + a_z b_z,\qquad \operatorname{proj}_{\vec b}\vec a = \frac{\vec a\cdot\vec b}{|\vec b|}\,\hat b`
          }
        />
      </div>
    </div>
  );
}

const round1 = (v) => Math.round(v * 10) / 10;

/** A compact strip plotting cosθ (highlighted) and sinθ (faint) over [0,180°]. */
function drawTrigStrip(ctx, W, between) {
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
  curve((th) => Math.sin(th), 'rgba(91,155,213,0.5)', 1.5); // sine, faint (the cross product)
  curve((th) => Math.cos(th), GOLD, 2.4);                   // cosine, highlighted
  const tx = plotX + (between / 180) * plotW;
  ctx.strokeStyle = 'rgba(240,236,227,0.7)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(tx, plotY); ctx.lineTo(tx, plotY + plotH); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '10px JetBrains Mono, monospace'; ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.fillText('a·b ∝ cosθ', bx0 + 8, by0 + 4);
  ctx.fillStyle = 'rgba(91,155,213,0.8)'; ctx.textAlign = 'right'; ctx.fillText('sinθ', bx0 + bw - 8, by0 + 4);
  ctx.restore();
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
