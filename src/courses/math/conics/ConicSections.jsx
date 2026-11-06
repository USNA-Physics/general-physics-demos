import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { createIso, drawSegment3D, drawPolygon3D } from '@shared/lib/iso';

/**
 * Conic sections (math/conics).
 *
 * The three classical conics are the plane sections of one double cone. Tilt the
 * cutting plane and the section passes continuously from circle → ellipse →
 * parabola → hyperbola, and — this is the point — the SAME transition shows up in
 * the algebra: the section, written in the plane's own (u, v) coordinates, is
 *   u² + C v² + E v + F = 0,   C = cos²β − tan²α · sin²β,
 * so its discriminant B² − 4AC = −4C changes sign exactly when the plane crosses
 * the generator (β = 90° − α), the parabola case. Geometry and the classification
 * of quadratic equations are the same fact seen two ways.
 *
 * Modes (?mode=):
 *   slice          3-D double cone + cutting plane; the section drawn in gold.
 *   projection     the section in true shape in the plane, with centre/vertex,
 *                  foci, directrix, asymptotes, and eccentricity.
 *   classification the general Ax²+Bxy+Cy²+Dx+Ey+F=0; the discriminant B²−4AC and
 *                  the principal-axis rotation that removes the xy term.
 *
 * slice + projection share the cutting-plane parameters (α, β, h₀) so switching
 * between them keeps the same conic. One rAF loop per mode reads refs and draws
 * imperatively; readouts publish throttled. No per-frame setState.
 */

const GOLD = '#C5B783';   // the conic section (the answer)
const BLUE = '#5B9BD5';   // the cutting plane
const GREEN = '#7FB77E';  // asymptotes / construction
const CONE = 'rgba(139,140,142,0.5)';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BG = '#0D1321';
const GRID = 'rgba(139,140,142,0.22)';
const FRAME = 'rgba(139,140,142,0.4)';
const PLANE_FILL = 'rgba(91,155,213,0.14)';

const TWO_PI = Math.PI * 2;
const DEG = 180 / Math.PI, RAD = Math.PI / 180;
const ZMAX = 2.6;
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const norm360 = (d) => ((d % 360) + 360) % 360;

/* ── slice geometry: section of x²+y² = (tanα)² z² by the plane z = h₀ + y tanβ ──
 * In the plane's coordinates (u along x, v up the tilt) the section is
 *   u² + C v² + E v + F = 0,  C = cos²β − k² sin²β,  E = −2k²h₀ sinβ,  F = −k²h₀².
 * A = 1, B = 0, so B² − 4AC = −4C classifies it.                                */
function sliceConic(alphaDeg, betaDeg, h0) {
  const alpha = alphaDeg * RAD, beta = betaDeg * RAD;
  const k = Math.tan(alpha), sb = Math.sin(beta), cb = Math.cos(beta);
  const C = cb * cb - k * k * sb * sb;
  const E = -2 * k * k * h0 * sb;
  const F = -k * k * h0 * h0;
  const disc = -4 * C;                         // B² − 4AC with A = 1, B = 0
  const e = Math.sin(beta) / Math.cos(alpha);  // eccentricity = sinβ / sinγ, γ = 90°−α
  const apex = Math.abs(h0) < 0.02;
  let type;
  if (apex) type = C > 1e-3 ? 'point' : Math.abs(C) <= 1e-3 ? 'line' : 'crossed lines';
  else if (Math.abs(C) < 2e-3) type = 'parabola';
  else if (C > 0) type = betaDeg < 0.5 ? 'circle' : 'ellipse';
  else type = 'hyperbola';
  const v0 = Math.abs(C) > 1e-9 ? -E / (2 * C) : 0;
  const K = Math.abs(C) > 1e-9 ? (E * E) / (4 * C) - F : 0;
  return { k, C, E, F, disc, e, type, apex, v0, K };
}

// 3-D section, marched around the cone: for each θ solve the nappe height on the
// plane, keep valid points, split into polylines where the branch runs to infinity.
function coneCut(k, betaDeg, h0, zmax) {
  const tb = Math.tan(betaDeg * RAD), N = 540, polys = [];
  for (const sign of [1, -1]) {
    let cur = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TWO_PI, s = Math.sin(th), denom = 1 - sign * k * s * tb;
      let pt = null;
      if (Math.abs(denom) > 2e-3) {
        const z = h0 / denom;
        if ((sign > 0 ? z >= 0 : z <= 0) && Math.abs(z) <= zmax) {
          const r = k * Math.abs(z);
          pt = [r * Math.cos(th), r * s, z];
        }
      }
      if (pt) cur.push(pt);
      else { if (cur.length > 1) polys.push(cur); cur = []; }
    }
    if (cur.length > 1) polys.push(cur);
  }
  return polys;
}

/* ════════════════════════════════ SLICE MODE ═════════════════════════════════ */
function SliceMode({ alpha, setAlpha, beta, setBeta, h0, setH0 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [autoRot, setAutoRot] = useState(true);
  const [showPlane, setShowPlane] = useState(true);
  const [ro, setRo] = useState({ type: 'ellipse', e: 0 });

  const alphaRef = useRef(alpha); alphaRef.current = alpha;
  const betaRef = useRef(beta); betaRef.current = beta;
  const h0Ref = useRef(h0); h0Ref.current = h0;
  const planeRef = useRef(showPlane); planeRef.current = showPlane;
  const autoRef = useRef(autoRot); autoRef.current = autoRot;
  const azRef = useRef(35), elRef = useRef(20);

  const gamma = 90 - alpha;
  const setPreset = (kind) => {
    if (kind === 'circle') setBeta(0);
    else if (kind === 'ellipse') setBeta(Math.max(8, Math.round(gamma * 0.55)));
    else if (kind === 'parabola') setBeta(Math.round(gamma));
    else if (kind === 'hyperbola') setBeta(Math.min(82, Math.round(gamma + (90 - gamma) * 0.5)));
    if (kind !== 'apex' && Math.abs(h0) < 0.3) setH0(1.4);
    if (kind === 'apex') setH0(0);
  };
  const reset = () => { setAlpha(32); setBeta(22); setH0(1.4); setAutoRot(true); setShowPlane(true); azRef.current = 35; elRef.current = 20; };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    canvas.style.touchAction = 'none';
    let ctx, W, H, raf, cx, cy, scale, last, lastPub = 0;
    let drag = null, lpx = 0, lpy = 0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); cx = W / 2; cy = H * 0.54; scale = Math.min(W, H) * 0.15; };
    const toLocal = (e) => { const r = canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
    const onDown = (e) => { const { px, py } = toLocal(e); drag = true; lpx = px; lpy = py; canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); };
    const onMove = (e) => { if (!drag) return; const { px, py } = toLocal(e); azRef.current = norm360(azRef.current + (px - lpx) * 0.5); elRef.current = Math.max(-88, Math.min(88, elRef.current - (py - lpy) * 0.4)); lpx = px; lpy = py; };
    const onUp = (e) => { drag = null; canvas.releasePointerCapture?.(e.pointerId); };
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);

    const draw = (now) => {
      if (last === undefined) last = now; let dt = (now - last) / 1000; last = now; if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      if (autoRef.current && !drag) azRef.current = norm360(azRef.current + 10 * dt);
      const a = alphaRef.current, b = betaRef.current, h = h0Ref.current, k = Math.tan(a * RAD);
      const iso = createIso({ cx, cy, scale, azimuth: azRef.current * RAD, elevation: elRef.current * RAD });

      ctx.clearRect(0, 0, W, H);

      // axis
      drawSegment3D(ctx, iso, [0, 0, -ZMAX - 0.3], [0, 0, ZMAX + 0.3], { color: 'rgba(139,140,142,0.4)', width: 1, dash: [3, 5] });

      // cone wireframe: rim circles (both nappes) + generators
      const rim = k * ZMAX;
      for (const zc of [ZMAX, -ZMAX]) {
        ctx.strokeStyle = CONE; ctx.lineWidth = 1.3; ctx.beginPath();
        for (let i = 0; i <= 80; i++) { const th = (i / 80) * TWO_PI; const p = iso.project(rim * Math.cos(th), rim * Math.sin(th), zc); i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(139,140,142,0.38)'; ctx.lineWidth = 1;
      for (let i = 0; i < 24; i++) {
        const th = (i / 24) * TWO_PI, px = rim * Math.cos(th), py = rim * Math.sin(th);
        const a0 = iso.project(0, 0, 0), aT = iso.project(px, py, ZMAX), aB = iso.project(-px, -py, -ZMAX);
        ctx.beginPath(); ctx.moveTo(aB.sx, aB.sy); ctx.lineTo(a0.sx, a0.sy); ctx.lineTo(aT.sx, aT.sy); ctx.stroke();
      }
      // apex marker
      const ap = iso.project(0, 0, 0); ctx.fillStyle = MUTED; ctx.beginPath(); ctx.arc(ap.sx, ap.sy, 3, 0, TWO_PI); ctx.fill();

      // cutting plane z = h + y tanβ as a translucent quad
      if (planeRef.current) {
        const Wp = ZMAX * 1.25, tb = Math.tan(b * RAD);
        const corner = (u, v) => [u, v * Math.cos(b * RAD), h + v * Math.sin(b * RAD)];
        // keep the quad from shooting off for steep tilts by bounding its z span via v range
        const vMax = Math.min(Wp, (ZMAX + 0.4 - Math.abs(h)) / (Math.abs(Math.sin(b * RAD)) + 1e-3) + 0.6);
        drawPolygon3D(ctx, iso, [corner(-Wp, -vMax), corner(Wp, -vMax), corner(Wp, vMax), corner(-Wp, vMax)],
          { fill: PLANE_FILL, stroke: 'rgba(91,155,213,0.7)', width: 1.5 });
        void tb;
      }

      // the section
      const polys = coneCut(k, b, h, ZMAX);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3.4; ctx.lineJoin = 'round';
      for (const poly of polys) {
        ctx.beginPath();
        poly.forEach((p, i) => { const s = iso.project(p[0], p[1], p[2]); i === 0 ? ctx.moveTo(s.sx, s.sy) : ctx.lineTo(s.sx, s.sy); });
        ctx.stroke();
      }

      // heading
      const info = sliceConic(a, b, h);
      ctx.font = 'bold 15px JetBrains Mono, monospace'; ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(info.type.toUpperCase(), 14, 12);
      ctx.font = '12px JetBrains Mono, monospace'; ctx.fillStyle = MUTED;
      ctx.fillText(`β ${b.toFixed(0)}°  vs  generator ${(90 - a).toFixed(0)}°`, 14, 32);

      if (now - lastPub > 140) { lastPub = now; setRo({ type: info.type, e: info.e }); }
      raf = requestAnimationFrame(draw);
    };

    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); robs.disconnect();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <p className="text-usna-muted text-xs mb-3">
          Tilt the <span style={{ color: BLUE }}>plane</span> through the double cone and watch the
          <span style={{ color: GOLD }}> section</span> change type. Drag the view to rotate.
        </p>
        <div className="mb-3">
          <div className="text-usna-muted text-xs mb-1.5">Section presets</div>
          <div className="grid grid-cols-2 gap-1.5">
            {['circle', 'ellipse', 'parabola', 'hyperbola'].map((kind) => (
              <button key={kind} onClick={() => setPreset(kind)}
                className="px-2 py-1 rounded text-xs font-medium border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors capitalize">
                {kind}
              </button>
            ))}
          </div>
          <button onClick={() => setPreset('apex')}
            className="mt-1.5 w-full px-2 py-1 rounded text-xs font-medium border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors">
            Through apex (degenerate)
          </button>
        </div>
        <Slider label="Cone half-angle α" value={alpha} min={10} max={75} step={1} unit="°" onChange={setAlpha} />
        <Slider label="Plane tilt β" value={beta} min={0} max={82} step={1} unit="°" onChange={setBeta} />
        <Slider label="Plane height h₀" value={+h0.toFixed(2)} min={-2.4} max={2.4} step={0.05} unit="" onChange={setH0} />
        <div className="flex flex-col gap-2 mt-1 mb-1">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={autoRot} onChange={(e) => setAutoRot(e.target.checked)} /> Auto-rotate
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showPlane} onChange={(e) => setShowPlane(e.target.checked)} /> Show cutting plane
          </label>
        </div>
        <div className="border-t border-usna-grid pt-3 mt-2">
          <Readout label="section" value={ro.type} unit="" />
          <Readout label="generator angle γ" value={(90 - alpha).toFixed(0)} unit="°" />
          <Readout label="eccentricity e" value={fmt(ro.e)} unit="" />
        </div>
        <p className="mt-3 text-xs text-usna-text leading-snug">
          The type depends only on the tilt β against the generator angle γ = 90° − α: below it an
          ellipse, equal a parabola, beyond it a hyperbola cutting both nappes.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 480, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title="One cone, every conic"
          description="A plane through a double cone meets it in a circle, an ellipse, a parabola, or a hyperbola — nothing else. Which one depends only on how the plane is tilted relative to the cone's generators: perpendicular to the axis gives a circle; a gentle tilt an ellipse; a tilt parallel to a generator a parabola; a steeper tilt cuts both nappes and gives a hyperbola. Push the plane through the apex and the section degenerates to a point, a line, or a crossed pair. These are the same curves the planets, comets, and projectiles trace, because an inverse-square force admits exactly these orbits."
          equation={String.raw`x^2+y^2=z^2\tan^2\alpha,\qquad z=h_0+y\tan\beta`}
        />
      </div>
    </div>
  );
}

/* ═════════════════════════════ PROJECTION MODE ═══════════════════════════════ */
function ProjectionMode({ alpha, setAlpha, beta, setBeta, h0, setH0 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [showFoci, setShowFoci] = useState(true);
  const [showDir, setShowDir] = useState(true);
  const [ro, setRo] = useState({ type: 'ellipse', e: 0, a: 0, b: 0, c: 0 });

  const alphaRef = useRef(alpha); alphaRef.current = alpha;
  const betaRef = useRef(beta); betaRef.current = beta;
  const h0Ref = useRef(h0); h0Ref.current = h0;
  const fociRef = useRef(showFoci); fociRef.current = showFoci;
  const dirRef = useRef(showDir); dirRef.current = showDir;
  const reset = () => { setAlpha(32); setBeta(22); setH0(1.4); setShowFoci(true); setShowDir(true); };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, lastPub = 0;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      const a = alphaRef.current, b = betaRef.current, h = h0Ref.current, k = Math.tan(a * RAD);
      const info = sliceConic(a, b, h);
      const cb = Math.cos(b * RAD);
      const polys = coneCut(k, b, h, ZMAX).map((poly) => poly.map(([x, y]) => [x, y / cb])); // isometric plane coords

      // feature geometry in (u,v)
      const { C, E, F, v0, K, type } = info;
      let feats = { type, e: info.e, a: 0, b: 0, c: 0, center: [0, v0], foci: [], directrix: [], asymptotes: [] };
      if (type === 'ellipse' || type === 'circle') {
        const au = Math.sqrt(Math.max(0, K)), av = Math.sqrt(Math.max(0, K / C));
        const major = Math.max(au, av), minor = Math.min(au, av), c = Math.sqrt(Math.max(0, major * major - minor * minor));
        feats.a = major; feats.b = minor; feats.c = c; feats.e = major > 1e-6 ? c / major : 0;
        if (av >= au) { feats.foci = [[0, v0 - c], [0, v0 + c]]; feats.directrix = [{ axis: 'v', at: v0 - major / (feats.e || 1e9) }, { axis: 'v', at: v0 + major / (feats.e || 1e9) }]; }
        else { feats.foci = [[-c, v0], [c, v0]]; feats.directrix = [{ axis: 'u', at: -major / (feats.e || 1e9) }, { axis: 'u', at: major / (feats.e || 1e9) }]; }
      } else if (type === 'parabola') {
        const vv = -F / (E || 1e-6), p = -(E || 1e-6) / 4;   // u² = -E (v - vv), 4p = -E
        feats.center = [0, vv]; feats.a = Math.abs(p); feats.e = 1;
        feats.foci = [[0, vv + p]]; feats.directrix = [{ axis: 'v', at: vv - p }];
      } else if (type === 'hyperbola') {
        const Cc = -C;
        if (K > 0) { const aa = Math.sqrt(K), bb = Math.sqrt(K / Cc), c = Math.sqrt(aa * aa + bb * bb); feats.a = aa; feats.b = bb; feats.c = c; feats.e = c / aa; feats.foci = [[-c, v0], [c, v0]]; feats.asymptotes = [Math.sqrt(Cc), -Math.sqrt(Cc)].map((m) => ({ through: [0, v0], slope: m, along: 'u' })); feats.directrix = [{ axis: 'u', at: -aa / feats.e }, { axis: 'u', at: aa / feats.e }]; }
        else { const aa = Math.sqrt(-K / Cc), bb = Math.sqrt(-K), c = Math.sqrt(aa * aa + bb * bb); feats.a = aa; feats.b = bb; feats.c = c; feats.e = c / aa; feats.foci = [[0, v0 - c], [0, v0 + c]]; feats.asymptotes = [1 / Math.sqrt(Cc), -1 / Math.sqrt(Cc)].map((m) => ({ through: [0, v0], slope: m, along: 'v' })); feats.directrix = [{ axis: 'v', at: v0 - aa / feats.e }, { axis: 'v', at: v0 + aa / feats.e }]; }
      }

      // fit view to the curve
      let umin = -1, umax = 1, vmin = -1, vmax = 1;
      const all = polys.flat();
      if (all.length) { umin = umax = all[0][0]; vmin = vmax = all[0][1]; all.forEach(([u, v]) => { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }); }
      feats.foci.forEach(([u, v]) => { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); });
      const padU = (umax - umin) * 0.15 + 0.3, padV = (vmax - vmin) * 0.15 + 0.3;
      umin -= padU; umax += padU; vmin -= padV; vmax += padV;
      const pad = 40, pw = W - 2 * pad, ph = H - 2 * pad;
      const sc = Math.min(pw / (umax - umin), ph / (vmax - vmin));
      const ox = W / 2 - sc * (umin + umax) / 2, oy = H / 2 + sc * (vmin + vmax) / 2;
      const X = (u) => ox + sc * u, Y = (v) => oy - sc * v;

      ctx.clearRect(0, 0, W, H);
      // axes
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(umin), Y(0)); ctx.lineTo(X(umax), Y(0)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(0), Y(vmin)); ctx.lineTo(X(0), Y(vmax)); ctx.stroke();
      ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('u', X(umax) - 4, Y(0) + 4); ctx.fillText('v', X(0) + 10, Y(vmax) + 2);

      // asymptotes (hyperbola)
      if (feats.asymptotes.length) {
        ctx.strokeStyle = 'rgba(127,183,126,0.6)'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
        feats.asymptotes.forEach((as) => {
          ctx.beginPath();
          if (as.along === 'u') { const vA = vmin, vB = vmax; ctx.moveTo(X(as.through[0] + (vA - as.through[1]) / as.slope), Y(vA)); ctx.lineTo(X(as.through[0] + (vB - as.through[1]) / as.slope), Y(vB)); }
          else { const uA = umin, uB = umax; ctx.moveTo(X(uA), Y(as.through[1] + as.slope * (uA - as.through[0]))); ctx.lineTo(X(uB), Y(as.through[1] + as.slope * (uB - as.through[0]))); }
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      // directrices
      if (dirRef.current) {
        ctx.strokeStyle = 'rgba(240,236,227,0.5)'; ctx.lineWidth = 1.3; ctx.setLineDash([3, 4]);
        feats.directrix.forEach((d) => {
          ctx.beginPath();
          if (d.axis === 'v') { ctx.moveTo(X(umin), Y(d.at)); ctx.lineTo(X(umax), Y(d.at)); }
          else { ctx.moveTo(X(d.at), Y(vmin)); ctx.lineTo(X(d.at), Y(vmax)); }
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      // the conic
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      polys.forEach((poly) => { ctx.beginPath(); poly.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(X(u), Y(v)) : ctx.lineTo(X(u), Y(v)))); ctx.stroke(); });
      // centre / vertex
      ctx.fillStyle = TEXT; ctx.beginPath(); ctx.arc(X(feats.center[0]), Y(feats.center[1]), 3.5, 0, TWO_PI); ctx.fill();
      // foci
      if (fociRef.current) {
        ctx.fillStyle = BLUE;
        feats.foci.forEach((f) => { ctx.beginPath(); ctx.arc(X(f[0]), Y(f[1]), 4.5, 0, TWO_PI); ctx.fill(); });
        if (feats.foci.length) {
          ctx.font = '11px JetBrains Mono, monospace'; ctx.fillStyle = BLUE; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          feats.foci.forEach((f) => ctx.fillText('focus', X(f[0]), Y(f[1]) - 6));
        }
      }

      ctx.font = 'bold 14px JetBrains Mono, monospace'; ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${feats.type.toUpperCase()}   e = ${fmt(feats.e)}`, 14, 12);

      if (now - lastPub > 140) { lastPub = now; setRo({ type: feats.type, e: feats.e, a: feats.a, b: feats.b, c: feats.c }); }
      raf = requestAnimationFrame(draw);
    };

    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []);

  const info = sliceConic(alpha, beta, h0);
  const stdForm = info.type === 'parabola'
    ? String.raw`u^2 = 4p\,(v - v_0)`
    : info.type === 'hyperbola'
      ? String.raw`\frac{(\cdot)^2}{a^2} - \frac{(\cdot)^2}{b^2} = 1,\qquad e=\frac{c}{a}>1`
      : String.raw`\frac{u^2}{a^2} + \frac{(v-v_0)^2}{b^2} = 1,\qquad e=\frac{c}{a}<1`;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <p className="text-usna-muted text-xs mb-3">
          The same section seen in true shape, in the plane's own coordinates (u, v). Adjust the
          cut and the foci, directrices, and asymptotes follow.
        </p>
        <Slider label="Cone half-angle α" value={alpha} min={10} max={75} step={1} unit="°" onChange={setAlpha} />
        <Slider label="Plane tilt β" value={beta} min={0} max={82} step={1} unit="°" onChange={setBeta} />
        <Slider label="Plane height h₀" value={+h0.toFixed(2)} min={-2.4} max={2.4} step={0.05} unit="" onChange={setH0} />
        <div className="flex flex-col gap-2 mt-1 mb-1">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showFoci} onChange={(e) => setShowFoci(e.target.checked)} /> Foci
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showDir} onChange={(e) => setShowDir(e.target.checked)} /> Directrices
          </label>
        </div>
        <div className="border-t border-usna-grid pt-3 mt-2">
          <Readout label="type" value={ro.type} unit="" />
          <Readout label="eccentricity e" value={fmt(ro.e)} unit="" />
          <Readout label="semi-axis a" value={fmt(ro.a)} unit="" />
          {ro.type !== 'parabola' && <Readout label="semi-axis b" value={fmt(ro.b)} unit="" />}
          {ro.type !== 'parabola' && <Readout label="focal c" value={fmt(ro.c)} unit="" />}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 480, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title="The section in true shape"
          description="Projected into its own plane, the section is an ordinary conic with the classical focus–directrix structure. Every conic is the locus of points whose distance to a focus is e times the distance to a directrix: e = 0 a circle, 0 < e < 1 an ellipse, e = 1 a parabola, e > 1 a hyperbola. The eccentricity is fixed by the cut alone, e = sinβ / sinγ, and the Dandelin spheres inscribed in the cone touch the plane exactly at these foci — which is why the sliced curve and the focus–directrix curve are one and the same."
          equation={stdForm}
        />
      </div>
    </div>
  );
}

/* ══════════════════════════════ CLASSIFICATION MODE ══════════════════════════ */
const QPRESETS = {
  ellipse: { A: 1, B: 0, C: 1.8, D: 0, E: 0, F: -1, label: 'Ellipse' },
  circle: { A: 1, B: 0, C: 1, D: 0, E: 0, F: -1, label: 'Circle' },
  parabola: { A: 1, B: 0, C: 0, D: 0, E: -1, F: -0.3, label: 'Parabola' },
  hyperbola: { A: 1, B: 0, C: -1, D: 0, E: 0, F: -1, label: 'Hyperbola' },
  rotated: { A: 1, B: 1.4, C: 1, D: 0, E: 0, F: -1, label: 'Rotated ellipse' },
  degenerate: { A: 1, B: 0, C: -1, D: 0, E: 0, F: 0, label: 'Crossed lines' },
};

function ClassificationMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [q, setQ] = useState({ ...QPRESETS.rotated });
  const [showAxes, setShowAxes] = useState(true);
  const qRef = useRef(q); qRef.current = q;
  const axesRef = useRef(showAxes); axesRef.current = showAxes;

  const disc = q.B * q.B - 4 * q.A * q.C;
  const classify = () => {
    if (Math.abs(disc) < 1e-3) return 'parabola';
    return disc < 0 ? (Math.abs(q.A - q.C) < 1e-6 && Math.abs(q.B) < 1e-6 ? 'circle' : 'ellipse') : 'hyperbola';
  };
  const rot = 0.5 * Math.atan2(q.B, q.A - q.C);
  const reset = () => setQ({ ...QPRESETS.rotated });
  const upd = (key) => (v) => setQ((s) => ({ ...s, [key]: v }));

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf;
    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = () => {
      const { A, B, C, D, E, F } = qRef.current;
      const R = 3.4;                                   // world half-range
      const pad = 24, pw = W - 2 * pad, ph = H - 2 * pad;
      const sc = Math.min(pw, ph) / (2 * R), ox = W / 2, oy = H / 2;
      const X = (x) => ox + sc * x, Y = (y) => oy - sc * y;

      ctx.clearRect(0, 0, W, H);
      // grid
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      for (let g = -3; g <= 3; g++) { ctx.beginPath(); ctx.moveTo(X(g), Y(-R)); ctx.lineTo(X(g), Y(R)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X(-R), Y(g)); ctx.lineTo(X(R), Y(g)); ctx.stroke(); }
      ctx.strokeStyle = FRAME; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(-R), Y(0)); ctx.lineTo(X(R), Y(0)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X(0), Y(-R)); ctx.lineTo(X(0), Y(R)); ctx.stroke();

      // principal axes (rotation that removes the xy term)
      const phi = 0.5 * Math.atan2(B, A - C);
      if (axesRef.current && Math.abs(B) > 1e-6) {
        ctx.strokeStyle = 'rgba(127,183,126,0.7)'; ctx.lineWidth = 1.4; ctx.setLineDash([7, 5]);
        for (const ang of [phi, phi + Math.PI / 2]) { ctx.beginPath(); ctx.moveTo(X(-R * Math.cos(ang)), Y(-R * Math.sin(ang))); ctx.lineTo(X(R * Math.cos(ang)), Y(R * Math.sin(ang))); ctx.stroke(); }
        ctx.setLineDash([]);
      }

      // zero contour of Q via marching squares
      const Q = (x, y) => A * x * x + B * x * y + C * y * y + D * x + E * y + F;
      const n = 220, h = (2 * R) / n;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.6; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x0 = -R + i * h, y0 = -R + j * h, x1 = x0 + h, y1 = y0 + h;
          const q00 = Q(x0, y0), q10 = Q(x1, y0), q11 = Q(x1, y1), q01 = Q(x0, y1);
          const pts = [];
          const edge = (xa, ya, va, xb, yb, vb) => { if ((va < 0) !== (vb < 0)) { const t = va / (va - vb); pts.push([xa + t * (xb - xa), ya + t * (yb - ya)]); } };
          edge(x0, y0, q00, x1, y0, q10); edge(x1, y0, q10, x1, y1, q11);
          edge(x1, y1, q11, x0, y1, q01); edge(x0, y1, q01, x0, y0, q00);
          if (pts.length >= 2) { ctx.moveTo(X(pts[0][0]), Y(pts[0][1])); ctx.lineTo(X(pts[1][0]), Y(pts[1][1])); }
        }
      }
      ctx.stroke();

      const d = B * B - 4 * A * C;
      ctx.font = 'bold 14px JetBrains Mono, monospace'; ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const label = Math.abs(d) < 1e-3 ? 'parabola (Δ = 0)' : d < 0 ? 'ellipse (Δ < 0)' : 'hyperbola (Δ > 0)';
      ctx.fillText(label, 14, 12);
      raf = requestAnimationFrame(draw);
    };
    resize(); raf = requestAnimationFrame(draw);
    const robs = new ResizeObserver(resize); robs.observe(wrap);
    return () => { cancelAnimationFrame(raf); robs.disconnect(); };
  }, []);

  const type = classify();
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <p className="text-usna-muted text-xs mb-3">
          Every second-degree equation is a conic. The <span style={{ color: GOLD }}>discriminant</span>{' '}
          B² − 4AC alone fixes the type; the <span style={{ color: GREEN }}>xy</span> term just rotates it.
        </p>
        <div className="mb-3">
          <div className="text-usna-muted text-xs mb-1.5">Presets</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(QPRESETS).map(([id, p]) => (
              <button key={id} onClick={() => setQ({ ...p })}
                className="px-2 py-1 rounded text-xs font-medium border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold transition-colors">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <Slider label="A  (x²)" value={+q.A.toFixed(2)} min={-2} max={2} step={0.05} unit="" onChange={upd('A')} />
        <Slider label="B  (xy)" value={+q.B.toFixed(2)} min={-3} max={3} step={0.05} unit="" onChange={upd('B')} />
        <Slider label="C  (y²)" value={+q.C.toFixed(2)} min={-2} max={2} step={0.05} unit="" onChange={upd('C')} />
        <Slider label="D  (x)" value={+q.D.toFixed(2)} min={-2} max={2} step={0.05} unit="" onChange={upd('D')} />
        <Slider label="E  (y)" value={+q.E.toFixed(2)} min={-2} max={2} step={0.05} unit="" onChange={upd('E')} />
        <Slider label="F  (const)" value={+q.F.toFixed(2)} min={-2} max={2} step={0.05} unit="" onChange={upd('F')} />
        <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer mt-1">
          <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} /> Principal axes
        </label>
        <div className="border-t border-usna-grid pt-3 mt-2">
          <Readout label="B² − 4AC" value={fmt(disc, 2)} unit="" />
          <Readout label="classification" value={type} unit="" />
          <Readout label="axis rotation" value={fmt(rot * DEG, 1)} unit="°" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative" style={{ height: 480, background: BG }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel
          title="The discriminant classifies the equation"
          description="The general second-degree equation in two variables is Ax² + Bxy + Cy² + Dx + Ey + F = 0, and its graph is always a conic. A single quantity, the discriminant B² − 4AC, decides which: negative for an ellipse, zero for a parabola, positive for a hyperbola — matching the sign of −4C from the sliced-cone equation, where B was zero. The cross term Bxy only tilts the conic; rotating the axes by ½·atan2(B, A−C) removes it and reveals the same ellipse, parabola, or hyperbola aligned to its principal axes. When the equation factors, the conic degenerates to a point, a line, or a crossed pair — exactly the sections through the apex."
          equation={String.raw`Ax^2+Bxy+Cy^2+Dx+Ey+F=0,\qquad \Delta=B^2-4AC`}
        />
      </div>
    </div>
  );
}

export default function ConicSections({ mode = 'slice' }) {
  const [alpha, setAlpha] = useState(32);
  const [beta, setBeta] = useState(22);
  const [h0, setH0] = useState(1.4);
  const shared = { alpha, setAlpha, beta, setBeta, h0, setH0 };
  if (mode === 'projection') return <ProjectionMode {...shared} />;
  if (mode === 'classification') return <ClassificationMode />;
  return <SliceMode {...shared} />;
}
