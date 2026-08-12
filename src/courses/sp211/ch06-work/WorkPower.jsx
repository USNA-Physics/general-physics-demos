import { useState, useMemo, useEffect, useRef } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D15 · Work & Power Visualizer — L15 (dot), L16 (area), L17 (power).
 *
 * Three separate lessons on the same physical quantity, so each mode is its own
 * self-contained child with its own hooks; the default export is a thin,
 * hook-free dispatcher (RULES OF HOOKS — no conditional hooks in the parent).
 *
 *   dot   : a crate dragged by a rope at angle θ. The applied force decomposes
 *           into a working component F·cosθ and a perpendicular component
 *           F·sinθ. W = F d cosθ. At θ = 90° the force is still large but does
 *           ZERO work — effort without work. Push θ PAST 90° (or flip on the
 *           brake) and F∥ points backward: the work goes NEGATIVE and red, the
 *           force drains energy instead of adding it. (The lecture moment:
 *           carrying a box horizontally does no work; braking does negative work.)
 *   area  : a chosen F(x) curve (constant, linear spring, spring round-trip, or a
 *           custom curve shaped by control-point sliders). The crate walks across
 *           and work accumulates as the signed shaded area under F(x). A TWIN
 *           panel plots the running integral W(x) = ∫F dx directly beneath, so the
 *           area under the top curve equals the height of the bottom one — the
 *           exact area↔integral grammar of D01. The spring round-trip out-and-back
 *           returns net work to zero (positive area out, negative area back).
 *   power : a motorized winch. Two motors race at (tunable) power; each motor's
 *           FORCE is a slider and v = P/F is derived, so students who crank one
 *           motor's force just make it slower — equal power always ties. A
 *           handicap toggle lets the powers differ so one genuinely wins. The
 *           curved-ramp variant drives the crate with GENUINE constant power:
 *           v(s) = P / F∥(s), so it visibly crawls where the ramp is steep and
 *           surges where it is shallow — power, not speed, is what is held fixed.
 */

const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const RED = '#D9805B';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const DEEP = '#0D1321';

// ── hook-free dispatcher ─────────────────────────────────────────────────────
export default function WorkPower({ mode = 'dot' }) {
  if (mode === 'area') return <AreaMode />;
  if (mode === 'power') return <PowerMode />;
  return <DotMode />;
}

// ═════════════════════════════════════════════════════════════════════════════
// DOT MODE — W = F d cosθ, with the vector decomposition made visual.
// Now θ can exceed 90° (and a brake toggle forces θ→180°), so F∥ can point
// backward and the work goes negative.
// ═════════════════════════════════════════════════════════════════════════════
function DotMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [force, setForce] = useState(10);        // N, rope tension magnitude
  const [angle, setAngle] = useState(30);        // deg, rope above horizontal (0..180)
  const [distance, setDistance] = useState(7);   // m, drag distance
  const [mass, setMass] = useState(20);          // kg, crate mass
  const [playing, setPlaying] = useState(true);
  const [brake, setBrake] = useState(false);     // brake: force opposes motion (θ=180°)

  // published from the physics loop (drives readouts + the position slider)
  const [progress, setProgress] = useState(0);   // 0..1 fraction of the drag
  const [speed, setSpeed] = useState(0);         // m/s current crate speed

  // effective angle: braking overrides the slider and points the force straight
  // back along the motion (θ = 180°), the cleanest possible negative-work case.
  const effAngle = brake ? 180 : angle;

  // integrated state (owned by the loop) + live controls in a ref
  const simRef = useRef({ x: 0, v: 0 });
  const st = useRef({});
  st.current = { force, angle: effAngle, distance, mass, playing };

  const reset = () => {
    setForce(10); setAngle(30); setDistance(7); setMass(20); setBrake(false); setPlaying(true);
    simRef.current = { x: 0, v: 0 };
  };

  const theta = (effAngle * Math.PI) / 180;
  const fPar = force * Math.cos(theta);   // working component (can be negative)
  const fPerp = force * Math.sin(theta);  // perpendicular component
  const workTotal = fPar * distance;
  const workNow = fPar * progress * distance;
  const ke = 0.5 * mass * speed * speed;         // current kinetic energy

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow, pub = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const draw = (now) => {
      let dt = lastNow === undefined ? 1 / 60 : (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const { force: F, angle: aDeg, distance: d, mass: m, playing: pl } = st.current;
      const th = (aDeg * Math.PI) / 180;

      // ── physics: the rope's working component accelerates the crate (a = F∥/m) ──
      // When the rope pulls the crate FORWARD (F∥ > 0) it starts from REST, so the
      // acceleration a = F∥/m, and hence the mass, is plainly visible (a heavy
      // crate speeds up slowly). When the rope does zero work (θ = 90°) or negative
      // work (θ > 90°/brake) the crate instead enters already moving, so we can
      // watch the force coast it or slow it to a stop.
      const fPar = F * Math.cos(th);
      const ENTER_V = 2.5;                       // m/s entry speed for the non-forward cases
      const sim = simRef.current;
      if (pl && d > 0.01) {
        if (sim.x <= 0 && sim.v <= 0.001 && fPar <= 0.05) sim.v = ENTER_V;
        sim.v += (fPar / m) * dt;
        sim.x += sim.v * dt;
        if (sim.x >= d || (sim.v <= 0.01 && fPar <= 0)) {
          sim.x = 0;
          sim.v = fPar > 0.05 ? 0 : ENTER_V;     // rest if pulled forward, else re-enter moving
        }
        if (sim.x < 0) sim.x = 0;
      }
      const prog = d > 0.01 ? Math.max(0, Math.min(1, sim.x / d)) : 0;

      ctx.clearRect(0, 0, W, H);

      const floorY = Math.round(H * 0.72);
      const crateW = 84, crateH = 60;
      const marginL = 90;
      const travel = W - marginL - crateW - 110;             // px available to move
      const x0 = marginL;
      const crateX = x0 + travel * prog;                     // left edge of crate
      const cx = crateX + crateW / 2;
      const topY = floorY - crateH;

      // ── floor ──
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();
      // hatch under the floor
      ctx.strokeStyle = 'rgba(139,140,142,0.35)';
      ctx.lineWidth = 1;
      for (let hx = 0; hx < W + 20; hx += 16) {
        ctx.beginPath();
        ctx.moveTo(hx, floorY);
        ctx.lineTo(hx - 12, floorY + 12);
        ctx.stroke();
      }

      // start & end distance markers
      ctx.strokeStyle = 'rgba(240,236,227,0.25)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(x0 + crateW / 2, topY - 40);
      ctx.lineTo(x0 + crateW / 2, floorY + 6);
      ctx.moveTo(x0 + crateW / 2 + travel, topY - 40);
      ctx.lineTo(x0 + crateW / 2 + travel, floorY + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      // displacement span (motion is always +x to the right)
      const arrowY = floorY + 34;
      drawArrow(ctx, { x: x0 + crateW / 2, y: arrowY, dx: travel * prog, dy: 0, color: MUTED, width: 2, label: `d = ${(d * prog).toFixed(1)} m` });

      // ── crate ──
      const anchorX = cx;                 // rope attaches at top-center of crate
      const anchorY = topY;
      roundRect(crateX, topY, crateW, crateH, 8);
      ctx.fillStyle = 'rgba(197,183,131,0.16)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // crate "planks"
      ctx.strokeStyle = 'rgba(197,183,131,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crateX + 8, topY + crateH * 0.5);
      ctx.lineTo(crateX + crateW - 8, topY + crateH * 0.5);
      ctx.stroke();
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('crate', cx, topY + crateH / 2);

      // ── force vectors from the rope anchor ──
      // Big enough to read at the low default force, with a proportional cap so a
      // large force can't shoot off the frame (the whole triangle shrinks together,
      // so the F∥ : F⊥ ratio stays correct).
      const ARROW_CAP = 175;
      const scale = F * 12 > ARROW_CAP ? ARROW_CAP / Math.max(F, 0.1) : 12;
      const dxF = F * Math.cos(th) * scale;
      const dyF = -F * Math.sin(th) * scale;          // screen y is down
      // rope line (thin, from anchor outward, drawn under the arrow)
      ctx.strokeStyle = 'rgba(240,236,227,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(anchorX + dxF * 1.05, anchorY + dyF * 1.05);
      ctx.stroke();

      // component guides (dashed) forming the right triangle
      ctx.strokeStyle = 'rgba(240,236,227,0.2)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      // horizontal leg
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(anchorX + dxF, anchorY);
      // vertical leg up to the tip
      ctx.lineTo(anchorX + dxF, anchorY + dyF);
      ctx.stroke();
      ctx.setLineDash([]);

      const fParVal = F * Math.cos(th);               // signed working component
      const fPerpVal = F * Math.sin(th);              // perpendicular component
      const backward = fParVal < -0.5;                // F∥ opposes the motion
      // arrows first, WITHOUT labels (the F⊥ and total-F arrows share a tip, so
      // their built-in labels would collide there — we place all three by hand).
      drawArrow(ctx, { x: anchorX, y: anchorY, dx: dxF, dy: 0, color: backward ? RED : GREEN, width: 4 });
      drawArrow(ctx, { x: anchorX + dxF, y: anchorY, dx: 0, dy: dyF, color: 'rgba(217,128,91,0.85)', width: 3 });
      drawArrow(ctx, { x: anchorX, y: anchorY, dx: dxF, dy: dyF, color: GOLD, width: 3 });

      // labels at distinct spots; a component's label is hidden when it is ~0
      ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.textBaseline = 'middle';
      if (Math.abs(fParVal) > 0.5) {                  // F∥ beyond the horizontal tip
        ctx.fillStyle = backward ? RED : GREEN;
        ctx.textAlign = dxF >= 0 ? 'left' : 'right';
        ctx.fillText(`F∥ = ${fParVal.toFixed(0)} N`, anchorX + dxF + (dxF >= 0 ? 8 : -8), anchorY);
      }
      if (Math.abs(fPerpVal) > 0.5) {                 // F⊥ beside the vertical leg's middle
        ctx.fillStyle = 'rgba(217,128,91,0.95)';
        ctx.textAlign = 'left';
        ctx.fillText(`F⊥ = ${fPerpVal.toFixed(0)} N`, anchorX + dxF + 8, anchorY + dyF / 2);
      }
      // total F: above the resultant tip (lifted clear of the F∥ row)
      const rlen = Math.hypot(dxF, dyF) || 1;
      const ux = dxF / rlen, uy = dyF / rlen;
      ctx.fillStyle = GOLD;
      ctx.textAlign = ux >= 0 ? 'left' : 'right';
      ctx.fillText(`F = ${F.toFixed(0)} N`, anchorX + dxF + ux * 10, anchorY + dyF + uy * 12 - 14);

      // angle arc (sweeps from +x to the rope direction)
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, 26, 0, -th, true);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${aDeg.toFixed(0)}°`, anchorX + 30, anchorY - 8);

      // ── signed work bar (bottom-left): fills right & gold for +W, left & red for −W ──
      const wSigned = fParVal * (d * prog);   // W = F∥ · d  (signed)
      const wMax = 50 * 8;                             // Fmax·dmax reference (|cos|=1)
      const barH = 12;
      const barY = H - 26;
      const cx0 = 24 + Math.min(W - 200, 240) / 2;     // zero-line (center) of the bar
      const barHalf = Math.min(W - 200, 240) / 2;
      ctx.textAlign = 'left';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.fillText('work done  W = F d cosθ   (right = +, left = −)', 24, barY - 6);
      // track
      ctx.fillStyle = GRID;
      ctx.fillRect(cx0 - barHalf, barY, barHalf * 2, barH);
      // zero line
      ctx.strokeStyle = 'rgba(240,236,227,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx0, barY - 2); ctx.lineTo(cx0, barY + barH + 2); ctx.stroke();
      // signed fill
      const fr = Math.max(-1, Math.min(1, wSigned / wMax));
      ctx.fillStyle = wSigned < 0 ? RED : GOLD;
      if (fr >= 0) ctx.fillRect(cx0, barY, barHalf * fr, barH);
      else ctx.fillRect(cx0 + barHalf * fr, barY, -barHalf * fr, barH);
      ctx.fillStyle = wSigned < 0 ? RED : TEXT;
      ctx.textAlign = 'left';
      ctx.fillText(`${wSigned.toFixed(0)} J`, cx0 + barHalf + 10, barY + barH - 1);

      // publish position + speed to React (throttled) for the readouts / slider
      pub += dt;
      if (pub > 0.08) { pub = 0; setProgress(prog); setSpeed(sim.v); }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const near90 = Math.abs(effAngle - 90) < 3;
  const negative = fPar < -0.5;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Rope tension (F)" value={force} min={0} max={50} step={1} unit="N" onChange={setForce} />
        <Slider label="Rope angle (θ)" value={angle} min={0} max={180} step={1} unit="°"
                onChange={(v) => { setBrake(false); setAngle(v); }} />
        <Slider label="Drag distance (d)" value={distance} min={0} max={8} step={0.5} unit="m" onChange={setDistance} />
        <Slider label="Crate mass (m)" value={mass} min={5} max={50} step={1} unit="kg" onChange={setMass} />

        <div className="mt-1 border-t border-usna-grid pt-3">
          <button
            onClick={() => setBrake((b) => !b)}
            className={`w-full px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
              brake
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'}`}
          >
            {brake ? '● Braking (θ = 180°)' : 'Apply brake (force backward)'}
          </button>
          <div className="mt-1 text-usna-muted text-xs leading-snug">
            Braking points the force straight back along the motion, so F∥ flips and the work goes negative.
          </div>
        </div>

        <div className="mt-1 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
            >
              {playing ? '❚❚ Pause' : '▶ Drag'}
            </button>
            <span className="text-usna-muted text-xs">or scrub below</span>
          </div>
          <Slider label="Position" value={Number(progress.toFixed(2))} min={0} max={1} step={0.01} unit=""
                  onChange={(v) => { setPlaying(false); simRef.current.x = v * distance; simRef.current.v = 0; setProgress(v); }} />
        </div>

        <div className="mt-1 border-t border-usna-grid pt-3">
          <Readout label="F∥ (working)" value={fPar.toFixed(1)} unit="N" />
          <Readout label="F⊥ (no work)" value={fPerp.toFixed(1)} unit="N" />
          <Readout label="Crate speed" value={speed.toFixed(2)} unit="m/s" />
          <div className="mt-1 pt-1 border-t border-usna-grid">
            <Readout label="Work so far" value={workNow.toFixed(1)} unit="J" />
            <Readout label="Total work (over d)" value={workTotal.toFixed(1)} unit="J" />
            <Readout label="Kinetic energy" value={ke.toFixed(1)} unit="J" />
            <div className="text-usna-muted text-[11px] mt-1 leading-snug">
              The work W = F d cosθ depends only on the force, distance, and angle, not on the mass. The mass instead sets the speed: the same work gives a heavier crate less speed (½mv² = W), so it also takes longer to cross.
            </div>
          </div>
          {near90 && (
            <div className="mt-2 text-xs text-usna-gold/90 leading-snug">
              θ ≈ 90°: the force is still {force} N, but it does zero work, so the crate coasts at a steady speed.
            </div>
          )}
          {negative && !near90 && (
            <div className="mt-2 text-xs text-[#D9805B] leading-snug">
              θ &gt; 90°: F∥ points backward, so the force does negative work and the moving crate slows down.
            </div>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
             style={{ height: 440, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.dot} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AREA MODE — W = ∫ F(x) dx as accumulated SIGNED shaded area, twinned with a
// live W(x) integral curve underneath (area-of-top = height-of-bottom).
// ═════════════════════════════════════════════════════════════════════════════
const AX_MAX = 6;          // m, x-axis extent for the one-way curves
const AN = 160;            // samples across the curve
const CUSTOM_PTS = 7;      // control points for the custom curve
const A_MASS = 10;         // kg, crate mass (sets the timing of the sweep)
const A_KE0 = 20;          // J, launch kinetic energy (so the crate is moving at x=0)
const A_TS = 0.35;         // time-scale for the animation

function AreaMode() {
  const [curve, setCurve] = useState('spring');   // 'constant' | 'spring' | 'roundtrip' | 'custom'
  const [Fconst, setFconst] = useState(40);       // N, constant force
  const [k, setK] = useState(15);                 // N/m, spring constant
  const [xPos, setXPos] = useState(0);            // path-position of the crate (integration limit)
  const [playing, setPlaying] = useState(false);
  // custom curve control-point heights (N), evenly spaced in x
  const [custom, setCustom] = useState(() =>
    Array.from({ length: CUSTOM_PTS }, (_, i) => 30 + 25 * Math.sin((i / (CUSTOM_PTS - 1)) * Math.PI)));

  // The spring round-trip runs the crate OUT to xTurn and back to 0, so its path
  // length is 2·AX_MAX; every other curve is one-way over [0, AX_MAX].
  const isRoundTrip = curve === 'roundtrip';
  const pathMax = isRoundTrip ? 2 * AX_MAX : AX_MAX;

  // live refs for the sweep loop
  const xRef = useRef(xPos); xRef.current = xPos;
  const dataRef = useRef({ Wc: [], pathMax });

  const reset = () => {
    setCurve('spring'); setFconst(40); setK(15); setXPos(0); setPlaying(false);
    setCustom(Array.from({ length: CUSTOM_PTS }, (_, i) => 30 + 25 * Math.sin((i / (CUSTOM_PTS - 1)) * Math.PI)));
  };

  // Clamp the crate position whenever the path length changes (switching modes).
  useEffect(() => { setXPos((x) => Math.min(x, pathMax)); }, [pathMax]);

  // play sweep: the crate moves at the speed its energy allows. Its kinetic energy
  // is the launch energy plus the work done so far (from the W(s) curve), so
  // v = √(2·KE/m); it speeds up where the force does more work. The x(t) plot is
  // the precomputed trajectory the crate rides (below).
  useEffect(() => {
    if (!playing) return;
    const dt = 0.025;
    const id = setInterval(() => {
      const { Wc, pathMax: pm } = dataRef.current;
      const x = xRef.current;
      const i = Math.max(0, Math.min(AN - 1, Math.round((x / pm) * (AN - 1))));
      const v = Math.sqrt((2 * Math.max(5, A_KE0 + (Wc[i] || 0))) / A_MASS);
      let nx = x + v * dt * A_TS;
      if (nx >= pm) nx = 0;
      xRef.current = nx;
      setXPos(nx);
    }, 25);
    return () => clearInterval(id);
  }, [playing]);

  // Force-at-x for the chosen curve (one-way curves only). Custom is linearly
  // interpolated between control points. The spring round-trip is handled below
  // as a signed force along a doubled path, so it is NOT part of Fof.
  const Fof = useMemo(() => {
    if (curve === 'constant') return () => Fconst;
    if (curve === 'spring') return (x) => k * x;
    if (curve === 'custom') return (x) => {
      const seg = (x / AX_MAX) * (CUSTOM_PTS - 1);
      const i = Math.max(0, Math.min(CUSTOM_PTS - 2, Math.floor(seg)));
      const f = seg - i;
      return custom[i] * (1 - f) + custom[i + 1] * f;
    };
    return () => 0;
  }, [curve, Fconst, k, custom]);

  // Sampled F over the PATH + cumulative signed integral W(s) = ∫F ds.
  //  - one-way curves: path s = x ∈ [0, AX_MAX], F ≥ 0.
  //  - round-trip spring: the crate is displaced by xTurn − |s − xTurn| going out
  //    then back; the *applied* force is F = −k·(displacement) if we pull it back
  //    against the spring... To keep the "you do work on the crate" reading, we
  //    model the APPLIED force needed to move it quasi-statically: F_app = k·disp
  //    on the way out (+, you push against nothing/stretch) and F_app = −k·disp on
  //    the way back (spring returns the energy, you do negative work). Net = 0.
  const { ss, Fs, Wc, sTurn } = useMemo(() => {
    const S = new Array(AN), F = new Array(AN), W = new Array(AN);
    if (isRoundTrip) {
      const ds = pathMax / (AN - 1);
      const turn = AX_MAX;                     // arc-length of the turnaround
      for (let i = 0; i < AN; i++) {
        const s = i * ds;
        S[i] = s;
        // displacement of the crate from origin along its path
        const disp = s <= turn ? s : (2 * turn - s);
        const goingOut = s <= turn;
        // applied force to move quasi-statically: +k·disp outbound, −k·disp inbound
        F[i] = (goingOut ? 1 : -1) * k * disp;
      }
      W[0] = 0;
      for (let i = 1; i < AN; i++) W[i] = W[i - 1] + 0.5 * (F[i] + F[i - 1]) * ds;
      return { ss: S, Fs: F, Wc: W, sTurn: turn };
    }
    const ds = AX_MAX / (AN - 1);
    for (let i = 0; i < AN; i++) { S[i] = i * ds; F[i] = Math.max(0, Fof(S[i])); }
    W[0] = 0;
    for (let i = 1; i < AN; i++) W[i] = W[i - 1] + 0.5 * (F[i] + F[i - 1]) * ds;
    return { ss: S, Fs: F, Wc: W, sTurn: null };
  }, [Fof, isRoundTrip, k, pathMax]);

  dataRef.current = { Wc, pathMax };  // the sweep loop reads the current work curve

  // Precompute the full x(t) trajectory the crate rides: at each position its
  // speed is v = √(2·KE/m) with KE = launch + work-so-far, and t accumulates
  // dt = ds / v. This is deterministic, so the whole curve can be drawn as a
  // dashed ghost with the crate travelling along it (like the W(s) panel).
  const traj = useMemo(() => {
    const tArr = new Array(AN), sArr = new Array(AN);
    const ds = pathMax / (AN - 1);
    tArr[0] = 0; sArr[0] = 0;
    for (let i = 1; i < AN; i++) {
      sArr[i] = i * ds;
      const vPrev = Math.sqrt((2 * Math.max(5, A_KE0 + (Wc[i - 1] || 0))) / A_MASS);
      const vCur = Math.sqrt((2 * Math.max(5, A_KE0 + (Wc[i] || 0))) / A_MASS);
      tArr[i] = tArr[i - 1] + ds / (0.5 * (vPrev + vCur));
    }
    return { tArr, sArr };
  }, [Wc, pathMax]);

  const idx = Math.max(0, Math.min(AN - 1, Math.round((xPos / pathMax) * (AN - 1))));
  const workNow = Wc[idx];
  const workTotal = Wc[AN - 1];
  const Fhere = Fs[idx];

  // ── plotly traces (two stacked panels: F(s) on top, W(s) below) ──
  const curveTrace = {
    x: ss, y: Fs, type: 'scatter', mode: 'lines',
    line: { color: GOLD, width: 3 }, hoverinfo: 'skip', name: 'F', yaxis: 'y2',
  };

  // positive vs negative area shaded differently: split the swept region at F=0.
  const sweptX = ss.slice(0, idx + 1);
  const sweptY = Fs.slice(0, idx + 1);
  const posY = sweptY.map((v) => (v >= 0 ? v : 0));
  const negY = sweptY.map((v) => (v < 0 ? v : 0));
  const areaPos = {
    x: sweptX, y: posY, type: 'scatter', mode: 'lines', line: { width: 0 },
    fill: 'tozeroy', fillcolor: 'rgba(197,183,131,0.32)', hoverinfo: 'skip', yaxis: 'y2',
  };
  const areaNeg = {
    x: sweptX, y: negY, type: 'scatter', mode: 'lines', line: { width: 0 },
    fill: 'tozeroy', fillcolor: 'rgba(217,128,91,0.32)', hoverinfo: 'skip', yaxis: 'y2',
  };
  const markerTrace = {
    x: [ss[idx]], y: [Fhere], type: 'scatter', mode: 'markers',
    marker: { color: '#FFFFFF', size: 9, line: { color: GOLD, width: 2 } }, hoverinfo: 'skip', yaxis: 'y2',
  };

  // twin W(s) accumulation curve (bottom panel) — grows to match the area above.
  const wLine = {
    x: ss.slice(0, idx + 1), y: Wc.slice(0, idx + 1), type: 'scatter', mode: 'lines',
    line: { color: GREEN, width: 3 }, hoverinfo: 'skip', name: 'W', yaxis: 'y',
  };
  const wGhost = {
    x: ss, y: Wc, type: 'scatter', mode: 'lines',
    line: { color: 'rgba(127,183,126,0.25)', width: 2, dash: 'dot' }, hoverinfo: 'skip', yaxis: 'y',
  };
  const wDot = {
    x: [ss[idx]], y: [workNow], type: 'scatter', mode: 'markers',
    marker: { color: '#FFFFFF', size: 9, line: { color: GREEN, width: 2 } }, hoverinfo: 'skip', yaxis: 'y',
  };

  const traces = [areaPos, areaNeg, curveTrace, markerTrace, wGhost, wLine, wDot];

  // custom-curve control points shown ON the plot (edited via the sliders below)
  if (curve === 'custom') {
    traces.push({
      x: custom.map((_, i) => (i / (CUSTOM_PTS - 1)) * AX_MAX),
      y: custom,
      type: 'scatter', mode: 'markers',
      marker: { color: BLUE, size: 12, line: { color: TEXT, width: 1.5 }, symbol: 'circle' },
      hoverinfo: 'skip', name: 'control points', yaxis: 'y2',
    });
  }

  const layout = {
    showlegend: false,
    margin: { l: 62, r: 16, t: 12, b: 46 },
    dragmode: false,
    xaxis: {
      title: { text: isRoundTrip ? 'Path length s (m)  —  out then back' : 'Position x (m)' },
      range: [0, pathMax], zeroline: true, zerolinecolor: GRID, anchor: 'y',
    },
    // bottom panel: W(s) accumulation
    yaxis: {
      title: { text: 'W(s) = ∫F ds  (J)' }, domain: [0.0, 0.42],
      range: undefined, autorange: true, zeroline: true, zerolinecolor: '#2A3442',
      anchor: 'x',
    },
    // top panel: F(s)
    yaxis2: {
      title: { text: 'Force F (N)' }, domain: [0.55, 1.0],
      range: undefined, autorange: true, zeroline: true, zerolinecolor: '#2A3442',
      anchor: 'x',
    },
    shapes: [
      // scrub line spanning both panels
      {
        type: 'line', xref: 'x', yref: 'paper', x0: ss[idx], x1: ss[idx], y0: 0, y1: 1,
        line: { color: 'rgba(240,236,227,0.5)', width: 1, dash: 'dot' },
      },
      // turnaround marker for the round trip
      ...(isRoundTrip ? [{
        type: 'line', xref: 'x', yref: 'paper', x0: sTurn, x1: sTurn, y0: 0, y1: 1,
        line: { color: 'rgba(91,155,213,0.55)', width: 1, dash: 'dash' },
      }] : []),
    ],
    annotations: [
      ...(Math.abs(workNow) > 1 && ss[idx] > 0.4 ? [{
        x: ss[idx] * 0.5, y: (Fhere >= 0 ? 1 : -1) * Math.abs(Fhere) * 0.35, xref: 'x', yref: 'y2',
        text: `area = ${workNow.toFixed(0)} J`, showarrow: false,
        font: { color: TEXT, size: 12, family: 'JetBrains Mono, monospace' },
      }] : []),
      ...(isRoundTrip ? [{
        x: sTurn, y: 1.0, xref: 'x', yref: 'paper', yanchor: 'bottom',
        text: 'turn around', showarrow: false,
        font: { color: BLUE, size: 11, family: 'JetBrains Mono, monospace' },
      }] : []),
    ],
  };

  // ── position-vs-time plot: full trajectory as a dashed ghost, the crate
  //    travelling the solid portion with a marker (matches the W(s) panel style) ──
  const { tArr, sArr } = traj;
  const xtTraces = [
    { x: tArr, y: sArr, type: 'scatter', mode: 'lines', line: { color: 'rgba(91,155,213,0.28)', width: 2, dash: 'dot' }, hoverinfo: 'skip' },
    { x: tArr.slice(0, idx + 1), y: sArr.slice(0, idx + 1), type: 'scatter', mode: 'lines', line: { color: BLUE, width: 2.5 }, hoverinfo: 'skip' },
    { x: [tArr[idx]], y: [sArr[idx]], type: 'scatter', mode: 'markers', marker: { color: '#FFFFFF', size: 8, line: { color: BLUE, width: 2 } }, hoverinfo: 'skip' },
  ];
  const xtLayout = {
    showlegend: false,
    margin: { l: 54, r: 14, t: 8, b: 38 },
    xaxis: { title: { text: 'time (s)', standoff: 6 }, range: [0, tArr[AN - 1] * 1.02 || 1], autorange: false, zeroline: false, tickfont: { size: 11 } },
    yaxis: { title: { text: isRoundTrip ? 'path s (m)' : 'position x (m)' }, range: [0, pathMax], autorange: false, zeroline: true, zerolinecolor: '#2A3442', tickfont: { size: 11 } },
  };

  // control-point editor: each slider sets one control-point height (N)
  const setPoint = (i, val) => {
    setCurve('custom');
    setCustom((c) => { const n = c.slice(); n[i] = Math.max(0, Math.min(80, val)); return n; });
  };

  const posLabel = isRoundTrip ? 'Crate path-position (s)' : 'Crate position (x)';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Force curve F(x)</div>
          <div className="flex flex-col gap-1.5">
            {[
              ['constant', 'Constant force'],
              ['spring', 'Spring  F = kx'],
              ['roundtrip', 'Spring round-trip (out & back)'],
              ['custom', 'Custom (shape sliders)'],
            ].map(([key, lbl]) => (
              <button key={key} onClick={() => setCurve(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  curve === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {curve === 'constant' && (
          <Slider label="Force (F)" value={Fconst} min={0} max={80} step={5} unit="N" onChange={setFconst} />
        )}
        {(curve === 'spring' || curve === 'roundtrip') && (
          <Slider label="Spring constant (k)" value={k} min={0} max={30} step={1} unit="N/m" onChange={setK} />
        )}
        {curve === 'custom' && (
          <div className="mb-4">
            <div className="text-usna-muted text-xs mb-2">
              Shape the curve — each vertical slider is a control-point height (N); the blue dots on the plot follow:
            </div>
            <div className="flex items-end gap-1 h-28">
              {custom.map((v, i) => (
                <input key={i} type="range" min={0} max={80} step={1} value={v}
                  aria-label={`Control point ${i + 1}`}
                  onInput={(e) => setPoint(i, parseFloat(e.target.value))}
                  className="flex-1"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '100%' }} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
              {playing ? '❚❚ Pause' : '▶ Move crate'}
            </button>
          </div>
          <Slider label={posLabel} value={Number(xPos.toFixed(2))} min={0} max={pathMax} step={0.05} unit="m"
                  onChange={(v) => { setPlaying(false); setXPos(v); }} />
        </div>

        <div className="mt-1 border-t border-usna-grid pt-3">
          <Readout label="F at crate" value={Fhere.toFixed(1)} unit="N" />
          <Readout label="Work so far  ∫F ds" value={workNow.toFixed(1)} unit="J" />
          <Readout label="Total work" value={workTotal.toFixed(1)} unit="J" />
          {isRoundTrip && (
            <div className="mt-2 text-xs text-usna-gold/90 leading-snug">
              Push out (gold, +W), let it return (red, −W): the spring gives back
              exactly what you put in, so the round-trip net work is zero.
            </div>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 420 }}>
          <IntensityPlot traces={traces} layoutOverrides={layout} />
        </div>
        <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0 overflow-hidden" style={{ height: 206 }}>
          <div className="text-usna-muted text-xs mb-1 px-1 truncate">
            Position vs time. The dashed curve is the whole trip; the crate rides it, steepening (moving faster) where the force does more work.
          </div>
          <div style={{ height: 160 }}>
            <IntensityPlot traces={xtTraces} layoutOverrides={xtLayout} />
          </div>
        </div>
        <InfoPanel {...INFO.area} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// POWER MODE — P = F·v.
//   race : two motors, force is a slider and v = P/F is derived; equal power
//          always ties. A handicap toggle lets the powers differ so one wins.
//   curve: GENUINE constant-power climb, v(s) = P / F∥(s) — crawls on the steep
//          part, surges where shallow. No hardcoded speed, no mystery +5.
// ═════════════════════════════════════════════════════════════════════════════
const RAMP_MASS = 40;      // kg, crate mass on the ramp (physical)
const RAMP_LEN = 8;        // m, physical arc length of the ramp
const RAMP_VMAX = 7;       // m/s safety cap (rarely hit now that the ramp is never flat)
const RAMP_TH_BOT = (12 * Math.PI) / 180;  // shallow slope at the bottom
const RAMP_TH_TOP = (40 * Math.PI) / 180;  // steep slope at the top
const G = 9.8;

function PowerMode() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [variant, setVariant] = useState('race');   // 'race' | 'curve'
  const [power, setPower] = useState(600);           // W, base power
  const [handicap, setHandicap] = useState(false);   // let the two powers differ
  const [forceA, setForceA] = useState(300);         // N, motor A pull
  const [forceB, setForceB] = useState(100);         // N, motor B pull
  const [rampPower, setRampPower] = useState(400);   // W, constant winch power for the climb
  const [running, setRunning] = useState(true);

  // live control snapshot for the loop
  const st = useRef({ variant, power, handicap, forceA, forceB, rampPower });
  st.current = { variant, power, handicap, forceA, forceB, rampPower };

  // live readouts published from the loop (throttled)
  const [live, setLive] = useState({
    vA: 0, vB: 0, pA: 0, pB: 0, done: false, t: 0, winner: null,
    vTan: 0, pInst: 0, Ftan: 0, slopeDeg: 0,
  });

  const reset = () => {
    setVariant('race'); setPower(600); setHandicap(false);
    setForceA(300); setForceB(100); setRampPower(400); setRunning(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, lastNow;
    // race state (meters travelled)
    let posA, posB, done, winner, elapsed, holdUntil;
    // curve state (arc length travelled, meters)
    let sMeters;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const resetSim = () => {
      posA = 0; posB = 0; done = false; winner = null; elapsed = 0; sMeters = 0;
      holdUntil = 0; lastNow = undefined;
    };

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    // Powers for the two motors: equal (=power) unless handicapped, in which case
    // A gets 1.5× and B gets 0.6× the base — genuinely unequal.
    const powers = () => {
      const { power: P, handicap: hc } = st.current;
      return hc ? { PA: P * 1.5, PB: P * 0.6 } : { PA: P, PB: P };
    };

    // ── curved ramp geometry ──
    // A quarter-cosine hill; arc-length is approximated by a fine table so the
    // crate moves at a true metres/second set by v = P/F∥.
    // incline angle grows linearly from a shallow bottom to a steep top, so it is
    // never flat (F∥ = mg·sinθ stays well above zero and v = P/F∥ stays finite,
    // varying smoothly across the whole climb).
    const slopeAt = (u) => RAMP_TH_BOT + (RAMP_TH_TOP - RAMP_TH_BOT) * u;
    const ramp = { x0: 60, span: 0, y0: 0, table: null, totalArcPx: 1 };
    const buildRamp = () => {
      ramp.span = Math.min(W - 150, H * 1.15);   // cap so the integrated rise fits the frame
      ramp.x0 = 60;
      ramp.y0 = H * 0.84;
      const NP = 200;
      const du = 1 / NP, dx = ramp.span * du;
      const pts = new Array(NP + 1);
      let acc = 0, y = ramp.y0, prevX = ramp.x0, prevY = ramp.y0;
      pts[0] = { u: 0, x: ramp.x0, y: ramp.y0, arcPx: 0 };
      for (let i = 1; i <= NP; i++) {
        const u = i / NP;
        const x = ramp.x0 + ramp.span * u;
        y -= dx * Math.tan(slopeAt(u - du / 2));   // climb (screen y decreases)
        acc += Math.hypot(x - prevX, y - prevY);
        pts[i] = { u, x, y, arcPx: acc };
        prevX = x; prevY = y;
      }
      ramp.table = pts;
      ramp.totalArcPx = acc;
    };
    // map physical arc length (m) → screen point + local param u
    const pointAtMeters = (m) => {
      const frac = Math.max(0, Math.min(1, m / RAMP_LEN));
      const targetPx = frac * ramp.totalArcPx;
      const t = ramp.table;
      let lo = 0, hi = t.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid].arcPx < targetPx) lo = mid + 1; else hi = mid; }
      const i = Math.max(1, lo);
      const a = t[i - 1], b = t[i];
      const span = (b.arcPx - a.arcPx) || 1;
      const f = (targetPx - a.arcPx) / span;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, u: a.u + (b.u - a.u) * f };
    };

    const draw = (now) => {
      if (posA === undefined) resetSim();
      let dt = lastNow === undefined ? 1 / 60 : (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const { variant: vnt } = st.current;
      ctx.clearRect(0, 0, W, H);

      if (vnt === 'race') {
        // ── power race: force is chosen, v = P/F is derived ──
        const marginL = 60;
        const finishX = W - 90;
        const trackLen = finishX - marginL;
        const distMeters = 18;   // longer track → the faster motor still wins, but at a watchable pace
        const pxPerM = trackLen / distMeters;
        const { PA, PB } = powers();
        const FA = Math.max(1, st.current.forceA);
        const FB = Math.max(1, st.current.forceB);
        const vA = PA / FA;
        const vB = PB / FB;
        const trackAy = Math.round(H * 0.34);
        const trackBy = Math.round(H * 0.64);

        if (running && !done) {
          posA += vA * dt;
          posB += vB * dt;
          elapsed += dt;
          if (posA >= distMeters || posB >= distMeters) {
            posA = Math.min(distMeters, posA); posB = Math.min(distMeters, posB);
            done = true;
            winner = Math.abs(posA - posB) < 0.02 ? 'tie' : (posA > posB ? 'A' : 'B');
          }
        }

        const drawLane = (y, pos, F, v, P, color, label) => {
          ctx.strokeStyle = GRID; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(marginL, y + 26); ctx.lineTo(finishX, y + 26); ctx.stroke();
          ctx.strokeStyle = 'rgba(240,236,227,0.4)'; ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(finishX, y - 24); ctx.lineTo(finishX, y + 26); ctx.stroke();
          ctx.setLineDash([]);
          const cx = marginL + pos * pxPerM;
          roundRect(cx - 22, y - 10, 44, 36, 6);
          ctx.fillStyle = 'rgba(197,183,131,0.15)'; ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
          // force arrow (no inline label — it would overlap the arrowhead; the value
          // is in the lane readout line above instead)
          drawArrow(ctx, { x: cx + 22, y: y + 8, dx: Math.min(110, 8 + F * 0.22), dy: 0, color, width: 3, head: 9 });
          ctx.font = '12px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = color;
          ctx.fillText(`${label}   F = ${F.toFixed(0)} N   v = ${v.toFixed(2)} m/s   P = ${P.toFixed(0)} W`, marginL, y - 26);
        };

        drawLane(trackAy, posA, FA, vA, PA, GOLD, 'Motor A');
        drawLane(trackBy, posB, FB, vB, PB, BLUE, 'Motor B');

        ctx.textAlign = 'center'; ctx.font = '15px JetBrains Mono, monospace';
        if (done) {
          ctx.fillStyle = winner === 'tie' ? GREEN : GOLD;
          const why = st.current.handicap ? 'more power' : 'less force, so more speed at the same power';
          ctx.fillText(winner === 'tie'
            ? `Dead heat: equal power and equal force give the same finish (${elapsed.toFixed(2)} s)`
            : `Motor ${winner} wins (${why})`, W / 2, H - 22);
        } else {
          ctx.fillStyle = MUTED;
          ctx.fillText(st.current.handicap
            ? 'Uneven power: the higher-power motor pulls ahead'
            : 'Same power: the smaller force gives more speed (v = P/F), so it pulls ahead', W / 2, H - 22);
        }

        if (done && running) {
          if (!holdUntil) holdUntil = now + 1400;
          if (now > holdUntil) { holdUntil = 0; resetSim(); }
        } else {
          holdUntil = 0;
        }

        setLiveThrottled({
          vA, vB, pA: PA, pB: PB, done, t: elapsed, winner,
          vTan: 0, pInst: 0, Ftan: 0, slopeDeg: 0,
        });
      } else {
        // ── genuine constant-power climb: v(s) = P / F∥(s) ──
        buildRamp();
        // draw ramp
        ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < ramp.table.length; i++) {
          const p = ramp.table[i];
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.strokeStyle = GRID; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, ramp.y0); ctx.lineTo(ramp.x0, ramp.y0); ctx.stroke();

        const P = Math.max(1, st.current.rampPower);
        // tangential force the winch must supply to move quasi-statically up the
        // slope against gravity: F∥ = m·g·sin(slope). Constant power ⇒ the speed
        // is whatever satisfies P = F∥·v, i.e. v = P / F∥. Where the slope is
        // steep, F∥ is large so v is small (it crawls); where shallow, v surges.
        const pNow = pointAtMeters(sMeters);
        const slope = slopeAt(pNow.u);
        const Ftan = Math.max(1e-3, RAMP_MASS * G * Math.sin(slope));
        const v = Math.min(RAMP_VMAX, P / Ftan);     // m/s (capped where the ramp is near-flat)

        if (running && !done) {
          sMeters += v * dt;
          if (sMeters >= RAMP_LEN) { sMeters = 0; }  // loop back to the bottom
        }

        const p = pointAtMeters(sMeters);
        const localSlope = slopeAt(p.u);
        // crate, rotated to sit on the ramp
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-localSlope);
        roundRect(-22, -40, 44, 36, 6);
        ctx.fillStyle = 'rgba(197,183,131,0.15)'; ctx.fill();
        ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore();

        // force decomposition above the crate
        const tx = Math.cos(localSlope), ty = -Math.sin(localSlope);   // up-slope unit (screen)
        const cxc = p.x, cyc = p.y - 46;
        const Fg = 64;                                                 // px for full weight
        drawArrow(ctx, { x: cxc, y: cyc, dx: 0, dy: Fg, color: MUTED, width: 2, label: 'mg' });
        const gTanMag = Fg * Math.sin(localSlope);
        drawArrow(ctx, { x: cxc, y: cyc, dx: -tx * gTanMag, dy: -ty * gTanMag, color: RED, width: 3, label: 'mg∥' });
        // motor's tangential pull (equal & opposite to mg∥ for quasi-static climb)
        drawArrow(ctx, { x: cxc, y: cyc, dx: tx * gTanMag, dy: ty * gTanMag, color: GREEN, width: 3, label: 'F∥' });
        // velocity along the tangent — length scales with the ACTUAL speed
        const vLen = Math.max(14, Math.min(80, v * 16));
        drawArrow(ctx, { x: p.x, y: p.y - 18, dx: tx * vLen, dy: ty * vLen, color: BLUE, width: 3, label: 'v' });

        const FtanNow = RAMP_MASS * G * Math.sin(localSlope);
        ctx.font = '13px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = TEXT;
        ctx.fillText('constant power, so speed adjusts:  v = P / F∥', 20, 28);
        ctx.fillStyle = GREEN;
        ctx.fillText(`P = ${P.toFixed(0)} W   F∥ = ${FtanNow.toFixed(0)} N   v = ${v.toFixed(2)} m/s   slope = ${(localSlope * 180 / Math.PI).toFixed(0)}°`, 20, 50);
        ctx.fillStyle = MUTED;
        ctx.fillText('watch it crawl on the steep top and surge where the ramp is shallow', 20, H - 20);

        setLiveThrottled({
          vA: 0, vB: 0, pA: 0, pB: 0, done: false, t: 0, winner: null,
          vTan: v, pInst: P, Ftan: FtanNow, slopeDeg: localSlope * 180 / Math.PI,
        });
      }

      raf = requestAnimationFrame(draw);
    };

    let lastPub = 0;
    function setLiveThrottled(v) {
      const t = performance.now();
      if (t - lastPub > 100) { lastPub = t; setLive(v); }
    }

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Scenario</div>
          <div className="flex flex-col gap-1.5">
            {[
              ['race', 'Power race'],
              ['curve', 'Curved ramp (constant power)'],
            ].map(([key, lbl]) => (
              <button key={key} onClick={() => setVariant(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  variant === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {variant === 'race' && (
          <>
            <Slider label={handicap ? 'Base power' : 'Motor power (both)'}
                    value={power} min={100} max={1500} step={50} unit="W" onChange={setPower} />
            <div className="mt-1 mb-2">
              <button
                onClick={() => setHandicap((h) => !h)}
                className={`w-full px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  handicap
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'}`}>
                {handicap ? '● Uneven power ON (A stronger)' : 'Give motor A more power'}
              </button>
            </div>
            <Slider label="Motor A force" value={forceA} min={50} max={800} step={10} unit="N" onChange={setForceA} />
            <Slider label="Motor B force" value={forceB} min={50} max={800} step={10} unit="N" onChange={setForceB} />
            <div className="mt-1 text-usna-muted text-xs leading-snug">
              You set the force; v = P/F follows. Cranking a force only makes that motor slower. At the same power a smaller force wins the distance race; equal force and equal power tie.
            </div>
          </>
        )}

        {variant === 'curve' && (
          <Slider label="Winch power" value={rampPower} min={150} max={1200} step={50} unit="W" onChange={setRampPower} />
        )}

        <div className="mt-1 border-t border-usna-grid pt-3">
          <button onClick={() => setRunning((r) => !r)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors">
            {running ? '❚❚ Pause' : '▶ Run'}
          </button>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          {variant === 'race' ? (
            <>
              <Readout label="Motor A speed" value={live.vA.toFixed(2)} unit="m/s" />
              <Readout label="Motor A power" value={live.pA.toFixed(0)} unit="W" />
              <Readout label="Motor B speed" value={live.vB.toFixed(2)} unit="m/s" />
              <Readout label="Motor B power" value={live.pB.toFixed(0)} unit="W" />
              <div className="mt-2 text-xs text-usna-muted leading-snug">
                {handicap
                  ? 'Powers differ, so the higher-power motor wins.'
                  : 'Same power: a smaller force means a higher speed (v = P/F). Equal force would tie.'}
              </div>
            </>
          ) : (
            <>
              <Readout label="Speed along ramp" value={live.vTan.toFixed(2)} unit="m/s" />
              <Readout label="Tangential force F∥" value={live.Ftan.toFixed(0)} unit="N" />
              <Readout label="Local slope" value={live.slopeDeg.toFixed(0)} unit="°" />
              <Readout label="Winch power (fixed)" value={live.pInst.toFixed(0)} unit="W" />
              <div className="mt-2 text-xs text-usna-muted leading-snug">
                Power is held constant, so v = P/F∥ falls where F∥ (and the slope)
                is large — the crate crawls up the steep part and speeds up below.
              </div>
            </>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div ref={wrapRef} className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden relative"
             style={{ height: 440, background: DEEP }}>
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO.power} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
const INFO = {
  dot: {
    title: 'Work needs a force along the motion',
    description:
      'Only the component of force in the direction of motion does work: W = F d cosθ. As the rope angle moves toward 90°, the tension is unchanged and the arrow is just as long, but the working component F∥ (green) shrinks to nothing and the work falls to zero, so the crate simply coasts. Past 90° (or with the brake on) F∥ points backward: the work goes negative and turns red, and the crate slows as the force drains its kinetic energy. This is why carrying a box horizontally does no work (force up, motion across, θ = 90°), while a brake pad does negative work on a wheel (force opposite the motion). Because the floor is frictionless, the rope is the only working force, so the work it does equals the change in the crate\'s kinetic energy.',
    equation: String.raw`W = \vec{F}\cdot\vec{d} = F\,d\cos\theta = \Delta KE`,
  },
  area: {
    title: 'Work is the signed area under F(x)',
    description:
      'When the force varies with position, the work is the integral of F(x), and an integral is just accumulated area. The top panel shows F(x); the bottom panel grows the running total W(x) = ∫F dx, so the area under the top curve equals the height of the bottom curve at every position (the same area-to-integral relationship as the motion grapher). A constant force gives a rectangle (W = F d); a spring F = kx gives a triangle (W = ½kx²). On the spring round-trip, pushing out shades gold for positive work and letting the spring push back shades red for negative work, so the two areas cancel and the net work returns to zero, which is the setup for stored potential energy.',
    equation: String.raw`W = \int F(x)\,dx \;=\; \text{(signed area under the curve)}`,
  },
  power: {
    title: 'Power is the rate of doing work',
    description:
      'Power is work per unit time, P = F·v. In the race you set each motor\'s force and the speed follows as v = P/F, so increasing a force only makes that motor slower, and at equal power the two always cross the line together. Turn on the handicap to give one motor more power and it genuinely wins: more power, not more force, is what gets there sooner. On the curved ramp the winch holds its power constant, so the speed obeys v = P/F∥: where the ramp is steep the tangential force is large and the crate crawls, and where it is shallow F∥ is small and the crate surges ahead.',
    equation: String.raw`P = \frac{dW}{dt} = \vec{F}\cdot\vec{v} \;\Rightarrow\; v = \frac{P}{F_\parallel}`,
  },
};
