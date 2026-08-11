import { useState, useEffect, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { SHAPES, byKey, inertia, parallelAxis } from '@shared/lib/shapes';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * D25 · Moment of Inertia Explorer — L25 (shapes), L26 (torque), L27 (dynamics).
 *
 * Three tools that build the same intuition from different angles: WHERE the
 * mass sits (not how much) is what makes a body hard to spin.
 *
 *   shapes   : a gallery of rigid bodies rendered with mass-distribution DENSITY
 *              SHADING. Give every body the SAME "flick" (same torque impulse)
 *              and watch them spin up at different rates — the hoop, with all its
 *              mass at the rim (I = mr²), crawls; the solid sphere (I = 0.4 mr²)
 *              snaps up. A parallel-axis slider drags the rotation axis off
 *              center and shows I = I_cm + M d² updating live, with the M d² term
 *              drawn as a growing ring.
 *   torque   : a wrench on a bolt. Force magnitude, application point (lever
 *              length), and angle all feed τ = r F sinθ. The perpendicular
 *              distance (the true lever arm) is drawn explicitly — pull along
 *              the wrench (θ→0) and the lever arm, and the torque, vanish.
 *   dynamics : Στ = Iα playground. Apply the SAME torque to different shapes and
 *              read back different α. An Atwood-with-massive-pulley preset shows
 *              the pulley's inertia dragging both blocks below the massless-pulley
 *              answer a = g(m₁−m₂)/(m₁+m₂).
 *
 * The default export is a thin, hook-free wrapper (rules of hooks) that renders a
 * per-mode child; each child owns its own hooks.
 */

// ── palette (canvas needs hex) ──────────────────────────────────────────────
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const DEEP = '#0D1321';
const BLUE = '#5B9BD5';
const RED = '#E07A5F';
const GREEN = '#7FB77E';

const TAU = Math.PI * 2;
const clampDt = (now, last) => {
  let dt = (now - last) / 1000;
  if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
  return dt;
};

// ═════════════════════════════════════════════════════════════════════════════
// Wrapper — branch by mode, no hooks here.
// ═════════════════════════════════════════════════════════════════════════════
export default function MomentOfInertia({ mode = 'shapes' }) {
  if (mode === 'torque') return <TorqueMode />;
  if (mode === 'dynamics') return <DynamicsMode />;
  return <ShapesMode />;
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared canvas drawing helpers (pure functions of ctx).
// ═════════════════════════════════════════════════════════════════════════════

// #rrggbb -> rgba(...) with alpha
function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Filled arrowhead-tipped vector.
function arrow(ctx, x0, y0, x1, y1, color, width = 3, label) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = 11;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(ang - 0.42), y1 - head * Math.sin(ang - 0.42));
  ctx.lineTo(x1 - head * Math.cos(ang + 0.42), y1 - head * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = 'bold 15px JetBrains Mono, monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x1 + 14 * Math.cos(ang), y1 + 14 * Math.sin(ang));
  }
  ctx.restore();
}

// Rod drawn along x; endShift=0.5 pivots at center, 1.0 pivots at the near end.
function drawRod(ctx, R, color, endShift) {
  const L = R * 1.9;
  const thick = R * 0.16;
  const left = -L * endShift;
  const right = L * (1 - endShift);
  // shade by |x| — a rod-about-end carries far mass, which is what makes I big
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    const x = left + ((right - left) * i) / steps;
    const w = (right - left) / steps + 1;
    const d = Math.abs(x) / L;
    ctx.fillStyle = hexA(color, 0.35 + 0.6 * d);
    ctx.fillRect(x, -thick / 2, w, thick);
  }
}

/**
 * Draw a rigid body with mass-distribution DENSITY SHADING, spun to angle theta.
 * The alpha of each fill maps to "how much mass lives here" — the whole point of
 * the shapes mode. Radial spokes make the rotation visible.
 *   kind: hoop | cylinder | shell | sphere | rod-center | rod-end
 */
function drawBody(ctx, cx, cy, R, theta, kind, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(theta);

  const ringFill = (r0, r1, a) => {
    ctx.beginPath();
    ctx.arc(0, 0, r1, 0, TAU);
    if (r0 > 0) ctx.arc(0, 0, r0, 0, TAU, true);
    ctx.fillStyle = hexA(color, a);
    ctx.fill('evenodd');
  };

  if (kind === 'hoop') {
    // all mass in a thin band at the rim — bright rim, empty interior
    ringFill(0, R, 0.06);
    ringFill(R * 0.86, R, 0.95);
    ringFill(R * 0.78, R * 0.86, 0.45);
  } else if (kind === 'cylinder') {
    // uniform disk — solid, even shading
    ringFill(0, R, 0.7);
  } else if (kind === 'shell') {
    // hollow ball — dense annulus, thicker/softer than a hoop (2/3 mr²)
    ringFill(0, R, 0.06);
    ringFill(R * 0.62, R, 0.85);
    ringFill(R * 0.45, R * 0.62, 0.32);
  } else if (kind === 'sphere') {
    // solid ball — mass concentrated toward center via stacked translucent disks
    for (let i = 8; i >= 1; i--) {
      const r = (R * i) / 8;
      ringFill(0, r, 0.13);
    }
  } else if (kind === 'rod-center') {
    drawRod(ctx, R, color, 0.5); // pivots about its middle
  } else if (kind === 'rod-end') {
    drawRod(ctx, R, color, 1.0); // pivots about one end
  }

  // spokes so spin is visible (rods already read as rotating)
  if (kind !== 'rod-center' && kind !== 'rod-end') {
    ctx.strokeStyle = hexA(TEXT, 0.5);
    ctx.lineWidth = 2;
    for (let s = 0; s < 4; s++) {
      const a = (s * TAU) / 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R * Math.cos(a), R * Math.sin(a));
      ctx.stroke();
    }
  }

  // hub
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function fmtC(c) {
  if (Math.abs(c - 1 / 12) < 1e-6) return '1/12';
  if (Math.abs(c - 1 / 3) < 1e-6) return '1/3';
  if (Math.abs(c - 2 / 3) < 1e-6) return '2/3';
  return c.toString();
}

// ═════════════════════════════════════════════════════════════════════════════
// SHAPES MODE (L25)
// ═════════════════════════════════════════════════════════════════════════════
const GALLERY = SHAPES.map((s) => s.key); // hoop, cylinder, shell, sphere, rod-center, rod-end

// Shapes mode holds two sub-tools behind a tab; wrapper stays hook-light.
function ShapesMode() {
  const [tab, setTab] = useState('gallery'); // gallery | builder
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {[['gallery', 'Gallery & race'], ['builder', 'Build I = Σmr²']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
              tab === k
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'gallery' ? <ShapesGallery /> : <PointMassBuilder />}
    </div>
  );
}

function ShapesGallery() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [mass, setMass] = useState(2);       // kg (shared by all bodies)
  const [radius, setRadius] = useState(0.4); // m  (radius / half-length)
  const [flick, setFlick] = useState(1.2);   // N·m·s torque impulse per flick
  const [selected, setSelected] = useState('hoop');
  const [axisD, setAxisD] = useState(0);     // parallel-axis offset, fraction of R
  const [winner, setWinner] = useState(null); // key of first body past the finish spoke

  // The race target: bodies must rotate FINISH_TURNS full turns from their reset
  // orientation. Same impulse J, different I → different ω → different finish times.
  const FINISH_TURNS = 3;
  const finishAngle = FINISH_TURNS * TAU;

  // sim state lives in refs so the rAF loop never re-subscribes
  const omega = useRef(GALLERY.map(() => 0)); // rad/s per body
  const angle = useRef(GALLERY.map(() => 0));
  const racing = useRef(false);               // when true, drag is disabled (fair race)
  const params = useRef({ mass, radius });
  params.current = { mass, radius };
  const flickRef = useRef(flick);
  flickRef.current = flick;
  const selRef = useRef({ selected, axisD });
  selRef.current = { selected, axisD };
  // the draw loop writes the winner here (via a ref) so we can lift it to state once
  const winnerRef = useRef(null);
  const setWinnerSafe = (k) => { if (winnerRef.current !== k) { winnerRef.current = k; setWinner(k); } };
  const raceRef = useRef({ finishAngle, setWinnerSafe });
  raceRef.current = { finishAngle, setWinnerSafe };

  const reset = () => {
    setMass(2); setRadius(0.4); setFlick(1.2); setSelected('hoop'); setAxisD(0);
    omega.current = GALLERY.map(() => 0);
    angle.current = GALLERY.map(() => 0);
    racing.current = false;
    winnerRef.current = null;
    setWinner(null);
  };

  // Apply the SAME impulse J to every body: Δω = J / I. Small-I bodies leap.
  // This is also the starting gun for the race: zero every angle so the finish
  // spoke is a fair FINISH_TURNS away for all bodies, then give the same J.
  const flickAll = () => {
    const { mass: m, radius: r } = params.current;
    angle.current = GALLERY.map(() => 0);
    winnerRef.current = null;
    setWinner(null);
    racing.current = true;
    GALLERY.forEach((key, i) => {
      const I = inertia(byKey[key].cInertia, m, r);
      omega.current[i] = flickRef.current / I; // set (not +=) so the race is clean
    });
  };

  // Parallel-axis readout for the selected body.
  const sel = byKey[selected];
  const iCm = inertia(sel.cInertia, mass, radius);
  const dMeters = axisD * radius;
  const iAxis = parallelAxis(iCm, mass, dMeters);
  const mdTerm = mass * dMeters * dMeters;

  // ── gallery canvas ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last);
      last = now;

      const { finishAngle: fin, setWinnerSafe } = raceRef.current;
      const isRacing = racing.current;
      // During a race, integrate WITHOUT drag so finish order reflects I alone; the
      // fastest (smallest I) crosses the finish spoke first. Otherwise apply gentle
      // rotational drag so bodies eventually settle (visual only).
      for (let i = 0; i < GALLERY.length; i++) {
        if (!isRacing) omega.current[i] *= Math.pow(0.5, dt / 3.5);
        angle.current[i] += omega.current[i] * dt;
      }
      // winner = first body to reach the finish angle
      if (isRacing && winnerRef.current === null) {
        let bestKey = null, bestAng = fin;
        for (let i = 0; i < GALLERY.length; i++) {
          if (angle.current[i] >= fin && angle.current[i] >= bestAng) {
            bestAng = angle.current[i]; bestKey = GALLERY[i];
          }
        }
        if (bestKey !== null) { setWinnerSafe(bestKey); racing.current = false; }
      }

      ctx.clearRect(0, 0, W, H);
      const cols = 3, rows = 2;
      const cellW = W / cols, cellH = H / rows;
      const R = Math.min(cellW, cellH) * 0.28;
      const { mass: m, radius: r } = params.current;
      const selKey = selRef.current.selected;

      GALLERY.forEach((key, i) => {
        const c = i % cols;
        const rr = Math.floor(i / cols);
        const cx = cellW * (c + 0.5);
        const cy = cellH * (rr + 0.5) - 8;
        const shp = byKey[key];
        const isSel = key === selKey;

        const isWinner = winnerRef.current === key;

        if (isWinner) {
          ctx.fillStyle = hexA(GREEN, 0.12);
          ctx.fillRect(cellW * c + 3, cellH * rr + 3, cellW - 6, cellH - 6);
          ctx.strokeStyle = hexA(GREEN, 0.9);
          ctx.lineWidth = 2;
          ctx.strokeRect(cellW * c + 3, cellH * rr + 3, cellW - 6, cellH - 6);
        } else if (isSel) {
          ctx.fillStyle = hexA(GOLD, 0.07);
          ctx.fillRect(cellW * c + 3, cellH * rr + 3, cellW - 6, cellH - 6);
          ctx.strokeStyle = hexA(GOLD, 0.6);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cellW * c + 3, cellH * rr + 3, cellW - 6, cellH - 6);
        }

        // finish spoke: a fixed reference ray; a body wins when its spoke sweeps
        // FINISH_TURNS past this line. The remaining fraction of a turn is shown
        // as a bright arc so partial progress reads at a glance.
        const finFrac = Math.max(0, Math.min(1, angle.current[i] / fin));
        ctx.strokeStyle = hexA(GREEN, 0.85);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (R + 8), cy); // finish ray points +x
        ctx.stroke();
        if (isRacing || finFrac > 0) {
          ctx.strokeStyle = hexA(GREEN, 0.55);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, R + 12, -Math.PI / 2, -Math.PI / 2 + finFrac * TAU);
          ctx.stroke();
        }

        drawBody(ctx, cx, cy, R, angle.current[i], key, isWinner ? GREEN : isSel ? GOLD : BLUE);

        const I = inertia(shp.cInertia, m, r);
        ctx.fillStyle = isSel ? GOLD : TEXT;
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(shp.label, cx, cy + R + 12);
        ctx.fillStyle = MUTED;
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(
          `I=${I.toFixed(3)}  ω=${Math.abs(omega.current[i]).toFixed(1)}`,
          cx, cy + R + 28,
        );
      });

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── parallel-axis mini-canvas for the selected body ──
  const paRef = useRef(null);
  const paWrap = useRef(null);
  useEffect(() => {
    const canvas = paRef.current;
    const wrap = paWrap.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last, spin = 0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last); last = now;
      spin += 0.7 * dt;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.24;
      const bodyKey = selRef.current.selected;
      const dFrac = selRef.current.axisD;

      // offset of the body's center of mass from the rotation axis (at cx,cy)
      const off = dFrac * R * 1.9;

      // the M d² "extra inertia" ring around the rotation axis
      if (off > 1) {
        ctx.strokeStyle = hexA(RED, 0.8);
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, off, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexA(RED, 0.09);
        ctx.beginPath();
        ctx.arc(cx, cy, off, 0, TAU);
        ctx.fill();
      }

      // the body orbits the rotation axis at distance off, while also spinning
      const bx = cx + off * Math.cos(spin);
      const by = cy + off * Math.sin(spin);
      drawBody(ctx, bx, by, R, spin, bodyKey, GOLD);

      // rotation axis marker
      ctx.fillStyle = TEXT;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = TEXT;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.stroke();

      // d line from axis to CM
      if (off > 1) arrow(ctx, cx, cy, bx, by, RED, 2, 'd');

      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = TEXT;
      ctx.fillText('rotation axis', 22, 8);
      ctx.fillStyle = GOLD;
      ctx.fillText('center of mass', 22, 24);
      ctx.fillStyle = TEXT;
      ctx.beginPath(); ctx.arc(14, 13, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.fillRect(10, 25, 8, 8);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Select a body</div>
          <div className="flex flex-col gap-1.5">
            {SHAPES.map((s) => (
              <button
                key={s.key}
                onClick={() => setSelected(s.key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  selected === s.key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {s.label} <span className="opacity-70 text-xs">c={fmtC(s.cInertia)}</span>
              </button>
            ))}
          </div>
        </div>

        <Slider label="Mass (all bodies)" value={mass} min={0.5} max={5} step={0.5} unit="kg" onChange={setMass} />
        <Slider label="Radius / half-length" value={radius} min={0.2} max={0.8} step={0.05} unit="m" onChange={setRadius} />
        <Slider label="Flick impulse (J)" value={flick} min={0.2} max={3} step={0.1} unit="N·m·s" onChange={setFlick} />

        <button
          onClick={flickAll}
          className="w-full py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors mb-2"
        >
          🏁 Race! Flick all (same impulse)
        </button>
        <p className="text-usna-muted text-xs mb-4 leading-relaxed">
          Same J to each → Δω = J / I. First body to spin {FINISH_TURNS} turns past its
          finish spoke wins — the hoop (big I) starts slow and loses; the sphere leaps.
        </p>

        <div className="border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-1">Parallel axis ({sel.label})</div>
          <Slider label="Axis offset d" value={Number((axisD * radius).toFixed(2))} min={0} max={Number(radius.toFixed(2))}
                  step={0.01} unit="m" onChange={(v) => setAxisD(radius > 0 ? v / radius : 0)} />
          <Readout label="I_cm" value={iCm.toFixed(4)} unit="kg·m²" />
          <Readout label="M d²" value={mdTerm.toFixed(4)} unit="kg·m²" />
          <Readout label="I = I_cm + Md²" value={iAxis.toFixed(4)} unit="kg·m²" />
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {winner && (
          <div className="rounded-lg border px-4 py-2 text-sm font-semibold flex items-center gap-2"
               style={{ background: hexA(GREEN, 0.14), borderColor: GREEN, color: TEXT }}>
            🏆 Winner: <span style={{ color: GREEN }}>{byKey[winner].label}</span>
            <span className="font-normal text-usna-muted">
              — smallest I = {inertia(byKey[winner].cInertia, mass, radius).toFixed(3)} kg·m², so the same J spins it up fastest.
            </span>
          </div>
        )}
        <div ref={wrapRef} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 360, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div ref={paWrap} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden flex-1"
               style={{ height: 220, background: DEEP }}>
            <canvas ref={paRef} className="block" />
          </div>
          <div className="bg-usna-card border border-usna-grid rounded-lg p-4 sm:w-56 shrink-0">
            <div className="text-usna-gold text-sm font-semibold mb-1">{sel.label}</div>
            <p className="text-usna-muted text-xs leading-relaxed mb-2">{sel.note}</p>
            <p className="text-usna-text text-xs leading-relaxed">
              Drag the axis off center and the M d² term (red ring) piles inertia on top of
              I_cm — at d = R it can rival I_cm itself.
            </p>
          </div>
        </div>
        <InfoPanel {...INFO.shapes} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// POINT-MASS BUILDER (L25) — I = Σ m_i r_i², then "smear" to the continuous body.
//
// The constant c in I = c m r² is not magic: it is exactly the average of r²
// (weighted by mass) over the body, divided by R². This tool lets a student stack
// point masses at chosen radii, watch each m r² term add up, and then collapse the
// same total mass into a uniform disk to see the identical I emerge as ½ M R².
// ═════════════════════════════════════════════════════════════════════════════
function PointMassBuilder() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [rNext, setRNext] = useState(0.3);  // radius (m) for the next mass dropped
  const [mNext, setMNext] = useState(0.5);  // mass (kg) for the next mass dropped
  const [masses, setMasses] = useState([]); // [{m, r, ang}]
  const [smear, setSmear] = useState(0);    // 0 = points, 1 = fully smeared disk

  const R = 0.5; // outer radius the disk/ring fills (m); sets the drawing scale

  const drop = () => {
    setMasses((prev) => {
      if (prev.length >= 12) return prev;
      const ang = (prev.length * 2.399963); // golden-angle spread so points don't overlap
      return [...prev, { m: mNext, r: rNext, ang }];
    });
    setSmear(0);
  };
  const dropRing = () => {
    // eight equal masses at the same radius → the discrete approach to a hoop
    setMasses((prev) => {
      const each = mNext;
      const add = Array.from({ length: 8 }, (_, k) => ({ m: each, r: rNext, ang: (k * TAU) / 8 }));
      return [...prev, ...add].slice(0, 16);
    });
    setSmear(0);
  };
  const undo = () => { setMasses((prev) => prev.slice(0, -1)); setSmear(0); };
  const reset = () => { setRNext(0.3); setMNext(0.5); setMasses([]); setSmear(0); };

  // I from the discrete points: the star of the show.
  const totalM = masses.reduce((s, p) => s + p.m, 0);
  const iPoints = masses.reduce((s, p) => s + p.m * p.r * p.r, 0);
  // The continuous body we "smear" into: a uniform solid disk of the SAME total
  // mass and the SAME outer radius as the largest point → I_disk = ½ M R_out².
  const rOut = masses.length ? Math.max(...masses.map((p) => p.r)) : R;
  const iDisk = 0.5 * totalM * rOut * rOut;
  const iShown = iPoints * (1 - smear) + iDisk * smear;
  // effective c for the current point cloud (Σmr² / (M R_out²)) — this is the c!
  const cEff = totalM > 0 && rOut > 0 ? iPoints / (totalM * rOut * rOut) : 0;

  const live = useRef({ masses, smear, rOut });
  live.current = { masses, smear, rOut };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last, spin = 0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last); last = now;
      spin += 0.5 * dt;
      const { masses: pts, smear: sm, rOut: ro } = live.current;

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const px = Math.min(W, H) * 0.40 / R; // meters → pixels

      // faint reference axes / radius rings
      ctx.strokeStyle = hexA(TEXT, 0.12);
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75, 1].forEach((f) => {
        ctx.beginPath(); ctx.arc(cx, cy, f * R * px, 0, TAU); ctx.stroke();
      });

      // the "smeared" continuous disk, faded in as smear→1
      if (sm > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.fillStyle = hexA(GOLD, 0.55 * sm);
        ctx.beginPath(); ctx.arc(0, 0, ro * px, 0, TAU); ctx.fill();
        ctx.restore();
      }

      // rotation axis
      ctx.fillStyle = TEXT;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();

      // point masses — size ∝ mass, drawn on a spoke at radius r, fading as smear→1
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      pts.forEach((p, i) => {
        const bx = p.r * px * Math.cos(p.ang);
        const by = p.r * px * Math.sin(p.ang);
        // spoke r_i
        ctx.strokeStyle = hexA(BLUE, 0.35 * (1 - sm));
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bx, by); ctx.stroke();
        // mass dot
        const rad = 5 + p.m * 8;
        ctx.fillStyle = hexA(RED, 0.9 * (1 - 0.85 * sm));
        ctx.beginPath(); ctx.arc(bx, by, rad, 0, TAU); ctx.fill();
        ctx.fillStyle = hexA(TEXT, 1 - sm);
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (i < 12) ctx.fillText(`m${i + 1}`, bx, by);
      });
      ctx.restore();

      // term-by-term ledger of Σ m r²
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '11px JetBrains Mono, monospace';
      const maxRows = 6;
      const shown = pts.slice(0, maxRows);
      shown.forEach((p, i) => {
        const term = p.m * p.r * p.r;
        ctx.fillStyle = hexA(RED, 0.95);
        ctx.fillText(`m${i + 1} r${i + 1}² = ${p.m.toFixed(2)}·${p.r.toFixed(2)}² = ${term.toFixed(4)}`, 12, 12 + i * 15);
      });
      if (pts.length > maxRows) {
        const rest = pts.slice(maxRows).reduce((s, p) => s + p.m * p.r * p.r, 0);
        ctx.fillStyle = MUTED;
        ctx.fillText(`+ ${pts.length - maxRows} more = ${rest.toFixed(4)}`, 12, 12 + maxRows * 15);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Next mass (m)" value={mNext} min={0.1} max={1.5} step={0.1} unit="kg" onChange={setMNext} />
        <Slider label="Next radius (r)" value={rNext} min={0.05} max={0.5} step={0.05} unit="m" onChange={setRNext} />

        <div className="flex gap-2 mt-1">
          <button
            onClick={drop}
            className="flex-1 py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            + Drop mass
          </button>
          <button
            onClick={dropRing}
            className="flex-1 py-2 rounded text-sm font-semibold bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            + Ring ×8
          </button>
        </div>
        <button
          onClick={undo}
          disabled={masses.length === 0}
          className="w-full mt-2 py-1.5 rounded text-xs font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors disabled:opacity-40"
        >
          ↶ Undo last
        </button>

        <div className="mt-4">
          <Slider label="Smear into a solid disk" value={smear} min={0} max={1} step={0.05} unit="" onChange={setSmear} />
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="masses N" value={masses.length} unit="" />
          <Readout label="total M" value={totalM.toFixed(2)} unit="kg" />
          <Readout label="I = Σ mᵢ rᵢ²" value={iPoints.toFixed(4)} unit="kg·m²" />
          <Readout label="½ M R² (disk)" value={iDisk.toFixed(4)} unit="kg·m²" />
          <Readout label="effective c = I/(MR²)" value={cEff.toFixed(3)} unit="" />
        </div>
        <p className="text-usna-muted text-xs mt-3 leading-relaxed">
          Each mass adds its own m r² to the pile — far masses count for much more (r²).
          Stack a ring at the rim (c → 1, a hoop) or pile mass near the axis (small c).
          The "smear" slider collapses your points into a uniform disk of the same mass
          and outer radius; that is where I = ½ M R² comes from.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 420, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.builder} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TORQUE MODE (L26)
// ═════════════════════════════════════════════════════════════════════════════
function TorqueMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [force, setForce] = useState(40);        // N
  const [lever, setLever] = useState(0.3);       // m (application point along wrench)
  const [angleDeg, setAngleDeg] = useState(90);  // deg between wrench and force

  const reset = () => { setForce(40); setLever(0.3); setAngleDeg(90); };

  const theta = (angleDeg * Math.PI) / 180;
  const torque = lever * force * Math.sin(theta);  // N·m
  const leverArm = lever * Math.sin(theta);        // perpendicular distance, m
  const fPerpN = force * Math.sin(theta);          // component square to handle (does the work)
  const fParN = force * Math.cos(theta);           // component along handle (wasted)

  const live = useRef({ force, lever, theta });
  live.current = { force, lever, theta };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last, twitch = 0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last); last = now;
      const { force: F, lever: r, theta: th } = live.current;

      const tq = r * F * Math.sin(th);
      // FIX: the wrench used to accumulate spin and drift, so "pull along the
      // handle → τ=0" rotated away from its canonical +x orientation. Keep the
      // handle anchored along +x (spin fixed at 0) and express torque as a small
      // bounded "twitch" that relaxes back to rest — the geometry never drifts.
      const twTarget = Math.max(-0.18, Math.min(0.18, tq * 0.02));
      twitch += (twTarget - twitch) * Math.min(1, dt * 6);
      const spin = twitch; // small, bounded, self-centering — canonical geometry stays

      ctx.clearRect(0, 0, W, H);
      const cx = W * 0.40, cy = H * 0.55;
      const pxPerM = Math.min(W, H) * 0.9; // scale wrench length to canvas

      // --- bolt head (hex) ---
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.fillStyle = GRID;
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        const px = 22 * Math.cos(a), py = 22 * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // --- wrench handle (lies along +x from the bolt) ---
      const handleLen = r * pxPerM;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.strokeStyle = hexA(TEXT, 0.85);
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(handleLen, 0);
      ctx.stroke();
      // open jaw at the tip
      ctx.lineWidth = 5;
      ctx.strokeStyle = hexA(MUTED, 0.9);
      ctx.beginPath();
      ctx.arc(handleLen, 0, 12, -1.1, 1.1);
      ctx.stroke();
      ctx.restore();

      // application point (tip of the lever), in world coords with spin
      const ax = cx + handleLen * Math.cos(spin);
      const ay = cy + handleLen * Math.sin(spin);

      // force vector at the application point, at angle th relative to the handle
      const fLen = (F / 80) * pxPerM * 0.35;
      const fdir = spin + th;                 // force direction in world frame
      const fx = ax + fLen * Math.cos(fdir);
      const fy = ay + fLen * Math.sin(fdir);

      // --- perpendicular lever arm: drop a perpendicular from the bolt onto the
      // force's line of action; that length is r·sinθ, the TRUE lever arm ---
      const dirx = Math.cos(fdir), diry = Math.sin(fdir);
      const vx = cx - ax, vy = cy - ay;
      const t = vx * dirx + vy * diry;        // projection onto the line
      const footX = ax + t * dirx;            // foot of perpendicular
      const footY = ay + t * diry;

      // extend the line of action (dashed) so students see it's a full line
      ctx.strokeStyle = hexA(BLUE, 0.4);
      ctx.setLineDash([6, 7]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax - dirx * 600, ay - diry * 600);
      ctx.lineTo(ax + dirx * 600, ay + diry * 600);
      ctx.stroke();
      ctx.setLineDash([]);

      // the lever arm segment (bolt → foot): the perpendicular distance
      ctx.strokeStyle = GOLD;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(footX, footY);
      ctx.stroke();
      ctx.setLineDash([]);

      // r arrow (bolt → application point)
      arrow(ctx, cx, cy, ax, ay, MUTED, 2, 'r');

      // --- F resolved into components along/perpendicular to the HANDLE ---
      // handle unit vector (world) and its perpendicular; F = F∥ + F⊥, and only
      // F⊥ (square to the handle) makes torque: τ = r·F⊥. F∥ pulls uselessly
      // along the wrench and does no work about the bolt.
      const hx = Math.cos(spin), hy = Math.sin(spin);      // along handle
      const nx = -Math.sin(spin), ny = Math.cos(spin);     // perpendicular to handle
      const fVecX = fx - ax, fVecY = fy - ay;
      const fPar = fVecX * hx + fVecY * hy;                 // scalar F∥ (px)
      const fPerp = fVecX * nx + fVecY * ny;                // scalar F⊥ (px)
      // F∥ (wasted) — drawn from the application point along the handle
      if (Math.abs(fPar) > 4) {
        arrow(ctx, ax, ay, ax + fPar * hx, ay + fPar * hy, MUTED, 2.5, 'F∥');
      }
      // F⊥ (does the work) — perpendicular to the handle
      if (Math.abs(fPerp) > 4) {
        arrow(ctx, ax, ay, ax + fPerp * nx, ay + fPerp * ny, GREEN, 3, 'F⊥');
      }
      // faint dashed guides completing the parallelogram (F = F∥ + F⊥)
      ctx.strokeStyle = hexA(TEXT, 0.28);
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax + fPar * hx, ay + fPar * hy); ctx.lineTo(fx, fy);
      ctx.moveTo(ax + fPerp * nx, ay + fPerp * ny); ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.setLineDash([]);

      // force arrow (drawn last so it sits on top of its components)
      arrow(ctx, ax, ay, fx, fy, RED, 3.5, 'F');

      // lever-arm label
      const armMid = { x: (cx + footX) / 2, y: (cy + footY) / 2 };
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 13px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const armLen = Math.hypot(footX - cx, footY - cy);
      if (armLen > 6) ctx.fillText('r⊥ = r sinθ', armMid.x, armMid.y - 16);

      // live τ readout in the corner
      ctx.fillStyle = TEXT;
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(`τ = ${tq.toFixed(1)} N·m`, W - 12, 12);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Force magnitude (F)" value={force} min={5} max={80} step={5} unit="N" onChange={setForce} />
        <Slider label="Lever length (r)" value={lever} min={0.1} max={0.5} step={0.02} unit="m" onChange={setLever} />
        <Slider label="Angle (θ)" value={angleDeg} min={0} max={180} step={5} unit="°" onChange={setAngleDeg} />

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Lever arm r⊥ = r sinθ" value={leverArm.toFixed(3)} unit="m" />
          <Readout label="F⊥ = F sinθ (does work)" value={fPerpN.toFixed(1)} unit="N" />
          <Readout label="F∥ = F cosθ (wasted)" value={fParN.toFixed(1)} unit="N" />
          <Readout label="Torque τ = r F⊥" value={torque.toFixed(2)} unit="N·m" />
        </div>
        <p className="text-usna-muted text-xs mt-3 leading-relaxed">
          Slide θ to 0° (pull straight along the wrench): F is huge but it is <em>all</em> F∥
          (gray, along the handle) and F⊥ (green) is zero, so τ = 0. Two equivalent pictures:
          the perpendicular lever arm r⊥ (gold), or the perpendicular force F⊥ — both give τ = r F sinθ.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 420, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.torque} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DYNAMICS MODE (L27) — two sub-tools behind a tab; wrapper stays hook-light.
// ═════════════════════════════════════════════════════════════════════════════
function DynamicsMode() {
  const [tab, setTab] = useState('playground'); // playground | atwood
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {[['playground', 'Στ = Iα playground'], ['atwood', 'Massive-pulley Atwood']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
              tab === k
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'playground' ? <TorquePlayground /> : <AtwoodPulley />}
    </div>
  );
}

// ── Στ = Iα playground: same torque, different shapes, different α ──
const SPINNABLE = SHAPES.filter((s) => s.rolls); // hoop, cylinder, shell, sphere

function TorquePlayground() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [torque, setTorque] = useState(2);   // N·m applied
  const [mass, setMass] = useState(2);       // kg
  const [radius, setRadius] = useState(0.4); // m
  const [selected, setSelected] = useState('cylinder');
  const [running, setRunning] = useState(false);

  const sel = byKey[selected];
  const I = inertia(sel.cInertia, mass, radius);
  const alpha = torque / I;

  // FIX: without any bound, ω integrated forever and ran off the readout. Cap it.
  const OMEGA_MAX = 30; // rad/s — auto-stop ceiling so the readout stays sane
  const [capped, setCapped] = useState(false);

  const omega = useRef(0);
  const angle = useRef(0);
  const live = useRef({ alpha, running });
  live.current = { alpha, running };
  const selRef = useRef(selected);
  selRef.current = selected;
  const stopRef = useRef(() => {}); // lets the rAF loop pause + flag the cap
  stopRef.current = () => { setRunning(false); setCapped(true); };

  const reset = () => {
    setTorque(2); setMass(2); setRadius(0.4); setSelected('cylinder'); setRunning(false);
    omega.current = 0; angle.current = 0; setCapped(false);
  };

  // reset kinematics whenever the body/params change
  useEffect(() => { omega.current = 0; angle.current = 0; setCapped(false); }, [selected, mass, radius, torque]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last); last = now;
      const { alpha: a, running: run } = live.current;
      if (run) {
        omega.current += a * dt;
        angle.current += omega.current * dt;
        // auto-stop at the ceiling so ω never runs off the readout
        if (Math.abs(omega.current) >= OMEGA_MAX) {
          omega.current = Math.sign(omega.current) * OMEGA_MAX;
          stopRef.current();
        }
      }

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.30;

      drawBody(ctx, cx, cy, R, angle.current, selRef.current, GOLD);

      // applied torque shown as a curved arrow around the rim
      const Rt = R * 1.2;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, Rt, -0.35, 1.5);
      ctx.stroke();
      const hx = cx + Rt * Math.cos(1.5);
      const hy = cy + Rt * Math.sin(1.5);
      arrow(ctx, hx, hy, hx + 16, hy + 4, RED, 3, 'τ');

      // live readout
      ctx.fillStyle = TEXT;
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`ω = ${omega.current.toFixed(2)} rad/s`, 12, 12);
      ctx.fillText(`α = ${live.current.alpha.toFixed(2)} rad/s²`, 12, 30);
      if (Math.abs(omega.current) >= OMEGA_MAX - 1e-6) {
        ctx.fillStyle = RED;
        ctx.fillText(`⤒ ω capped at ${OMEGA_MAX} rad/s — reset to run again`, 12, 48);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Body</div>
          <div className="flex flex-col gap-1.5">
            {SPINNABLE.map((s) => (
              <button
                key={s.key}
                onClick={() => setSelected(s.key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  selected === s.key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {s.label} <span className="opacity-70 text-xs">c={fmtC(s.cInertia)}</span>
              </button>
            ))}
          </div>
        </div>

        <Slider label="Applied torque (τ)" value={torque} min={0.5} max={6} step={0.5} unit="N·m" onChange={setTorque} />
        <Slider label="Mass (m)" value={mass} min={0.5} max={5} step={0.5} unit="kg" onChange={setMass} />
        <Slider label="Radius (r)" value={radius} min={0.2} max={0.8} step={0.05} unit="m" onChange={setRadius} />

        <button
          onClick={() => {
            if (capped) { omega.current = 0; angle.current = 0; setCapped(false); setRunning(true); return; }
            setRunning((r) => !r);
          }}
          className="w-full py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
        >
          {capped ? '↺ Restart' : running ? '❚❚ Pause' : '▶ Apply torque'}
        </button>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="I = c·m·r²" value={I.toFixed(4)} unit="kg·m²" />
          <Readout label="α = τ / I" value={alpha.toFixed(2)} unit="rad/s²" />
        </div>
        <p className="text-usna-muted text-xs mt-3 leading-relaxed">
          Same τ, swap the body: the hoop (big I) barely accelerates; the solid
          sphere (small I) spins up fast. α is set by I, the rotational mass. The spin
          auto-stops at ω = {OMEGA_MAX} rad/s so the readout stays on screen.
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 420, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.dynamics} />
      </div>
    </div>
  );
}

// ── Massive-pulley Atwood: pulley inertia drags both blocks below g(m1-m2)/(m1+m2) ──
function AtwoodPulley() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [m1, setM1] = useState(3);  // kg (right, heavier default)
  const [m2, setM2] = useState(2);  // kg (left)
  const [mp, setMp] = useState(2);  // kg pulley (solid disk, I = ½ M r²)
  const [running, setRunning] = useState(false);

  const g = 9.81;
  const rp = 0.25; // pulley radius (m) — cancels out of a but sets the visual

  // Massive pulley (solid disk, I = ½ mp rp²) with the cord not slipping:
  //   a = g (m1 − m2) / (m1 + m2 + ½ mp)
  // The ½ mp term is the pulley's rotational mass "felt" by the cord.
  const aMassive = (g * (m1 - m2)) / (m1 + m2 + 0.5 * mp);
  const aIdeal = (g * (m1 - m2)) / (m1 + m2);
  const alpha = aMassive / rp;

  // Cord tensions (m1 heavier so it descends, a > 0):
  //   m1:  m1 g − T1 = m1 a  ⟹  T1 = m1 (g − a)   (the descending side)
  //   m2:  T2 − m2 g = m2 a  ⟹  T2 = m2 (g + a)   (the rising side)
  //   pulley:  (T1 − T2) rp = I α = ½ Mp rp² (a/rp)  ⟹  T1 − T2 = ½ Mp a
  // That torque imbalance IS how the pulley's inertia enters: a massless pulley
  // forces T1 = T2, but a real one needs ΔT = ½ Mp a to angularly accelerate.
  const T1 = m1 * (g - aMassive);
  const T2 = m2 * (g + aMassive);
  const dT = T1 - T2; // = ½ Mp a

  const live = useRef({ aMassive, running, mp, aIdeal, T1, T2, dT });
  live.current = { aMassive, running, mp, aIdeal, T1, T2, dT };
  const state = useRef({ y: 0, v: 0 }); // y = displacement of m1 (down +)
  const massesRef = useRef({ m1, m2 });
  massesRef.current = { m1, m2 };

  const reset = () => { setM1(3); setM2(2); setMp(2); setRunning(false); state.current = { y: 0, v: 0 }; };

  useEffect(() => { state.current = { y: 0, v: 0 }; }, [m1, m2, mp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W, H, raf, last;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      const dt = clampDt(now, last); last = now;
      const { aMassive: a, running: run, mp: mpv, aIdeal: aid } = live.current;
      if (run) {
        state.current.v += a * dt;
        state.current.y += state.current.v * dt;
        const lim = 1.0;
        if (state.current.y > lim) { state.current.y = lim; state.current.v = 0; }
        if (state.current.y < -lim) { state.current.y = -lim; state.current.v = 0; }
      }

      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.24;
      const Rp = Math.min(W, H) * 0.10 * (0.8 + 0.12 * mpv); // pulley grows with mass
      const pxPerM = H * 0.24;

      // support bracket
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.lineTo(cx, cy - Rp);
      ctx.stroke();

      // pulley (density-shaded solid disk); spin proportional to cord travel
      const spin = -state.current.y / rp;
      drawBody(ctx, cx, cy, Rp, spin, 'cylinder', GOLD);
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`pulley ${mpv.toFixed(1)} kg`, cx, cy - Rp - 6);

      // cord + blocks. m1 (right) descends as y increases.
      const { m1: M1, m2: M2 } = massesRef.current;
      const { T1: t1, T2: t2, dT: dt2 } = live.current;
      const y1 = cy + (0.15 + state.current.y * 0.35) * pxPerM + Rp;
      const y2 = cy + (0.15 - state.current.y * 0.35) * pxPerM + Rp;
      const xR = cx + Rp, xL = cx - Rp;

      ctx.strokeStyle = hexA(TEXT, 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xR, cy); ctx.lineTo(xR, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xL, cy); ctx.lineTo(xL, y2); ctx.stroke();

      // --- tension-difference callout: draw each cord's tension as an UP arrow on
      // the block (the cord pulls each block toward the pulley), length ∝ T. The
      // two are visibly unequal whenever the pulley has mass. ---
      const tMax = Math.max(t1, t2, 1);
      const aLen = (T) => 22 + (T / tMax) * 46; // keep both visible, scale by ratio
      // right side (T1, on m1)
      arrow(ctx, xR, y1 - 2, xR, y1 - 2 - aLen(t1), RED, 3);
      ctx.fillStyle = RED;
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`T₁=${t1.toFixed(1)} N`, xR + 8, y1 - 2 - aLen(t1) / 2);
      // left side (T2, on m2)
      arrow(ctx, xL, y2 - 2, xL, y2 - 2 - aLen(t2), GREEN, 3);
      ctx.fillStyle = GREEN;
      ctx.textAlign = 'right';
      ctx.fillText(`T₂=${t2.toFixed(1)} N`, xL - 8, y2 - 2 - aLen(t2) / 2);
      // ΔT badge by the pulley — the driving torque imbalance
      ctx.fillStyle = TEXT;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`ΔT = T₁−T₂ = ${dt2.toFixed(2)} N  = ½Mₚa`, cx + Rp + 10, cy - 8);

      const block = (x, y, m, color, label) => {
        const s = 26 + m * 5;
        ctx.fillStyle = hexA(color, 0.85);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.fillRect(x - s / 2, y, s, s);
        ctx.strokeRect(x - s / 2, y, s, s);
        ctx.fillStyle = NAVY;
        ctx.font = 'bold 13px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${m.toFixed(1)}`, x, y + s / 2);
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + s + 4);
      };
      block(xR, y1, M1, GOLD, 'm₁');
      block(xL, y2, M2, BLUE, 'm₂');

      // acceleration comparison bars (bottom): ideal vs massive
      const barX = 14;
      const barMaxW = W * 0.4;
      const aMax = Math.max(0.01, Math.abs(aid)) * 1.15;
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('block acceleration', barX, H - 66);

      // ideal (massless pulley) bar
      const wi = (Math.abs(aid) / aMax) * barMaxW;
      ctx.fillStyle = hexA(MUTED, 0.8);
      ctx.fillRect(barX, H - 58, wi, 15);
      ctx.fillStyle = TEXT;
      ctx.textBaseline = 'middle';
      ctx.fillText(`ideal ${aid.toFixed(2)} m/s²`, barX + wi + 8, H - 50);

      // massive pulley bar
      const wm = (Math.abs(a) / aMax) * barMaxW;
      ctx.fillStyle = hexA(GOLD, 0.85);
      ctx.fillRect(barX, H - 34, wm, 15);
      ctx.fillStyle = TEXT;
      ctx.fillText(`with pulley ${a.toFixed(2)} m/s²`, barX + wm + 8, H - 26);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Mass m₁ (right)" value={m1} min={0.5} max={5} step={0.5} unit="kg" onChange={setM1} />
        <Slider label="Mass m₂ (left)" value={m2} min={0.5} max={5} step={0.5} unit="kg" onChange={setM2} />
        <Slider label="Pulley mass (Mₚ)" value={mp} min={0} max={8} step={0.5} unit="kg" onChange={setMp} />

        <button
          onClick={() => setRunning((r) => !r)}
          className="w-full py-2 rounded text-sm font-semibold bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
        >
          {running ? '❚❚ Pause' : '▶ Release'}
        </button>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="a (massive pulley)" value={aMassive.toFixed(3)} unit="m/s²" />
          <Readout label="a (ideal pulley)" value={aIdeal.toFixed(3)} unit="m/s²" />
          <Readout label="pulley α = a/rₚ" value={alpha.toFixed(2)} unit="rad/s²" />
        </div>
        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="T₁ (descending side)" value={T1.toFixed(2)} unit="N" />
          <Readout label="T₂ (rising side)" value={T2.toFixed(2)} unit="N" />
          <Readout label="ΔT = T₁−T₂ = ½Mₚa" value={dT.toFixed(2)} unit="N" />
        </div>
        <p className="text-usna-muted text-xs mt-3 leading-relaxed">
          Crank the pulley mass up: the blocks visibly slow. The two cord tensions split apart
          (T₁ ≠ T₂ on the canvas) because the pulley needs a net torque ΔT·rₚ to spin up — that is
          the mechanism its inertia acts through. Set Mₚ = 0 and ΔT → 0, T₁ = T₂, and a recovers
          the textbook g(m₁−m₂)/(m₁+m₂).
        </p>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="border border-usna-grid rounded-lg min-w-0 overflow-hidden"
             style={{ height: 460, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.atwood} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
const INFO = {
  shapes: {
    title: 'It is where the mass is, not how much',
    description:
      'Two bodies with the exact same mass and radius can be wildly different to spin. Flick them with the same torque impulse and the hoop — all its mass at the rim, I = mr² — crawls, while the solid sphere (I = 0.4 mr²) leaps ahead. The density shading shows why: pushing mass outward multiplies its r², and I grows with r². The parallel-axis view adds the M d² penalty for spinning about any axis other than the center of mass.',
    equation: String.raw`I = c\,m r^2, \qquad I = I_{cm} + M d^2`,
  },
  torque: {
    title: 'Torque needs the perpendicular lever arm',
    description:
      'Two equivalent ways to see τ = r F sinθ. (1) Lever-arm picture: force times the PERPENDICULAR distance from the axis to the line of action, r⊥ = r sinθ (the gold dashed segment). (2) Component picture: resolve F into F∥ = F cosθ (gray, straight along the handle — wasted, no torque) and F⊥ = F sinθ (green, square to the handle — this is the part that does the turning), then τ = r F⊥. Pull straight along the wrench (θ = 0) and F is all F∥: zero lever arm, zero F⊥, zero torque. Maximum torque comes at θ = 90°, force square to the handle.',
    equation: String.raw`\tau = r F \sin\theta = r_\perp F = r F_\perp`,
  },
  builder: {
    title: 'Where the constant c comes from: I = Σ mᵢ rᵢ²',
    description:
      'Moment of inertia is just the mass-weighted sum of r² over the body. Drop point masses at chosen radii and each contributes its own mᵢ rᵢ² — a mass twice as far out counts four times as much. Pile mass at the rim and the effective c → 1 (a hoop); pile it near the axis and c is small. The "smear" slider then collapses your discrete cloud into a uniform solid disk of the same total mass and outer radius, and the same number reappears as I = ½ M R². The textbook constant c is nothing but ⟨r²⟩/R² for the shape.',
    equation: String.raw`I = \sum_i m_i r_i^2 \;\xrightarrow{\text{continuous}}\; \int r^2\,dm = c\,M R^2`,
  },
  dynamics: {
    title: 'Στ = Iα — the rotational F = ma',
    description:
      'The same applied torque produces different angular accelerations on different bodies, because α = τ / I. I is the rotational mass: it measures resistance to angular acceleration. A hoop and a sphere of identical mass and radius spin up at different rates under one torque — the hoop is the sluggish one.',
    equation: String.raw`\sum \tau = I \alpha \;\Rightarrow\; \alpha = \frac{\tau}{I}`,
  },
  atwood: {
    title: 'Why isn’t a = g(m₁−m₂)/(m₁+m₂) anymore?',
    description:
      'The textbook Atwood answer assumes a massless pulley. Give the pulley real inertia and the cord must supply torque to angularly accelerate it, so the two tensions differ and both blocks slow down. Newton for each block plus Στ = Iα for the pulley (solid disk, I = ½Mₚrₚ²) gives a = g(m₁−m₂)/(m₁+m₂+½Mₚ). The pulley contributes half its mass to the effective inertia; slide Mₚ to zero to recover the classic result.',
    equation: String.raw`a = \frac{g\,(m_1 - m_2)}{m_1 + m_2 + \tfrac{1}{2}M_p}`,
  },
};
