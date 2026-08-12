import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D08 · Atwood machine — Chapter 4.
 *
 * Two masses hang from a light string over a pulley. The heavier side falls and
 * the lighter rises with a SHARED acceleration, because the inextensible string
 * ties their motions together. For an ideal (massless, frictionless) pulley:
 *
 *     a = (m2 - m1) g / (m1 + m2)          (m2 = right mass, +a = right falls)
 *     T = 2 m1 m2 g / (m1 + m2)
 *
 * OPTION — massive pulley (default off). A uniform-disk pulley of mass M_p has
 * moment of inertia I = ½ M_p R², so I/R² = M_p/2 adds to the effective mass:
 *
 *     a  = (m2 - m1) g / (m1 + m2 + M_p/2)
 *     T1 = m1 (g + a),   T2 = m2 (g - a)   (now T1 ≠ T2)
 *
 * The tension difference is what spins the pulley: T2 - T1 = (M_p/2) a = I a/R².
 * The pulley visibly rotates, and the energy option shows the released potential
 * energy splitting into translational KE and the pulley's rotational KE.
 *
 * Single mode. Canvas + rAF + ResizeObserver, real SI units.
 */

const G = 9.8;
const GOLD = '#C5B783';   // tension
const BLUE = '#5B9BD5';   // weight / PE
const GREEN = '#7FB77E';  // rotational KE
const WHITE = '#F0ECE3';  // acceleration
const MUTED = '#8B8C8E';
const NAVY = '#00205B';
const GRID = '#1A2332';
const TEXT = '#F0ECE3';
const BG = '#0D1321';

const DEFAULTS = { m1: 2, m2: 3, pulleyMass: 3 };
const PX_PER_M = 40;      // vertical scale
const MAX_TRAVEL = 1.9;   // m each side can move before it "lands"
const R_PHYS = 0.22;      // pulley radius (m) — only sets the visual spin rate

// I/R² term (uniform disk = Mp/2). a and the tensions for the current state.
function solve(m1, m2, Mp) {
  const inertia = Mp / 2;
  const a = ((m2 - m1) * G) / (m1 + m2 + inertia); // +a: right (m2) descends
  const T1 = m1 * (G + a); // left string
  const T2 = m2 * (G - a); // right string
  return { a, T1, T2 };
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-usna-gold w-4 h-4" />
      <span className="text-sm text-usna-text">{label}</span>
    </label>
  );
}

export default function Atwood({ mode = 'default' }) {
  void mode;
  return <Machine />;
}

function Machine() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [m1, setM1] = useState(DEFAULTS.m1);
  const [m2, setM2] = useState(DEFAULTS.m2);
  const [playing, setPlaying] = useState(true);
  const [massive, setMassive] = useState(false);
  const [pulleyMass, setPulleyMass] = useState(DEFAULTS.pulleyMass);
  const [showEnergy, setShowEnergy] = useState(false);

  const stRef = useRef({ v: 0, p: 0, theta: 0 }); // p = right descent (m); theta = pulley angle
  const liveRef = useRef({});
  liveRef.current = { m1, m2, playing, Mp: massive ? pulleyMass : 0, showEnergy };

  const [ro, setRo] = useState({ a: 0, T1: 0, T2: 0, v: 0 });

  const restart = () => { stRef.current = { v: 0, p: 0, theta: 0 }; setRo((r) => ({ ...r, v: 0 })); };
  const reset = () => {
    setM1(DEFAULTS.m1); setM2(DEFAULTS.m2); setPlaying(true);
    setMassive(false); setPulleyMass(DEFAULTS.pulleyMass); setShowEnergy(false);
    restart();
  };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let ctx, W = 0, H = 0, raf, last;
    let pub = 0;

    const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; ctx = setupCanvas(canvas, W, H); };

    const draw = (now) => {
      if (last === undefined) last = now;
      let dt = (now - last) / 1000; last = now;
      if (!(dt > 0) || dt > 0.05) dt = 1 / 60;

      const { m1: M1, m2: M2, playing: pl, Mp, showEnergy: energy } = liveRef.current;
      const s = stRef.current;
      const { a, T1, T2 } = solve(M1, M2, Mp);

      if (pl) {
        s.v += a * dt;
        s.p += s.v * dt;
        s.theta += (s.v / R_PHYS) * dt; // pulley spin (rad)
        if (s.p > MAX_TRAVEL) { s.p = MAX_TRAVEL; s.v = 0; }
        if (s.p < -MAX_TRAVEL) { s.p = -MAX_TRAVEL; s.v = 0; }
      }

      // ── geometry ──
      const cx = W / 2;
      const pulleyY = 56;
      const R = Mp > 0 ? 30 : 24;           // a massive pulley looks chunkier
      const baseHang = 120;
      const leftX = cx - R, rightX = cx + R;
      const hangR = baseHang + s.p * PX_PER_M;
      const hangL = baseHang - s.p * PX_PER_M;

      ctx.clearRect(0, 0, W, H);

      // ceiling + mount
      ctx.strokeStyle = GRID; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 96, 14); ctx.lineTo(cx + 96, 14); ctx.stroke();
      ctx.strokeStyle = 'rgba(139,140,142,0.3)'; ctx.lineWidth = 1;
      for (let x = cx - 90; x < cx + 96; x += 14) { ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x - 8, 6); ctx.stroke(); }
      ctx.strokeStyle = MUTED; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, 14); ctx.lineTo(cx, pulleyY - R); ctx.stroke();

      // strings
      ctx.strokeStyle = 'rgba(197,183,131,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(leftX, pulleyY); ctx.lineTo(leftX, pulleyY + hangL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rightX, pulleyY); ctx.lineTo(rightX, pulleyY + hangR); ctx.stroke();

      // pulley (spins with the string; darker/heavier when massive)
      ctx.save();
      ctx.translate(cx, pulleyY);
      ctx.rotate(s.theta);
      ctx.fillStyle = Mp > 0 ? '#243352' : '#16203A';
      ctx.strokeStyle = Mp > 0 ? GOLD : MUTED;
      ctx.lineWidth = Mp > 0 ? 3 : 2;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      // spokes so the rotation is visible
      ctx.strokeStyle = Mp > 0 ? 'rgba(197,183,131,0.7)' : 'rgba(139,140,142,0.6)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * (R - 4), Math.sin(ang) * (R - 4)); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = MUTED; ctx.beginPath(); ctx.arc(cx, pulleyY, 3, 0, 2 * Math.PI); ctx.fill();
      if (Mp > 0) {
        ctx.fillStyle = GOLD; ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`pulley ${Mp.toFixed(1)} kg`, cx, pulleyY - R - 4);
      }

      // blocks + force arrows (each side gets its own tension)
      const block = (x, topY, mass, tension, side) => {
        const bw = Math.min(78, 30 + mass * 4.4), bh = Math.min(58, 24 + mass * 3);
        ctx.fillStyle = 'rgba(91,155,213,0.18)';
        ctx.strokeStyle = BLUE; ctx.lineWidth = 2;
        roundRect(ctx, x - bw / 2, topY, bw, bh, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = TEXT; ctx.font = 'bold 12px JetBrains Mono, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${mass.toFixed(1)} kg`, x, topY + bh / 2);

        const F_SCALE = 0.7, CAP = 92;
        const clamp = (val) => Math.max(-CAP, Math.min(CAP, val));
        drawArrow(ctx, { x, y: topY, dx: 0, dy: -clamp(tension * F_SCALE), color: GOLD, width: 3.5, head: 10, label: side === 'right' ? 'T₂' : 'T₁' });
        drawArrow(ctx, { x, y: topY + bh, dx: 0, dy: clamp(mass * G * F_SCALE), color: BLUE, width: 3.5, head: 10, label: 'mg' });
        const aSide = side === 'right' ? a : -a;
        if (Math.abs(aSide) > 0.02) {
          drawArrow(ctx, { x: x + (side === 'right' ? bw / 2 + 22 : -bw / 2 - 22), y: topY + bh / 2, dx: 0, dy: clamp(aSide * 8), color: WHITE, width: 3, head: 9, label: 'a' });
        }
      };
      block(leftX, pulleyY + hangL, M1, T1, 'left');
      block(rightX, pulleyY + hangR, M2, T2, 'right');

      // HUD
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      const denom = Mp > 0 ? '(m₁ + m₂ + Mₚ/2)' : '(m₁ + m₂)';
      ctx.fillText(`a = (m₂ − m₁)g / ${denom} = ${a.toFixed(2)} m/s²`, 12, 12);
      if (Mp > 0) {
        ctx.fillText(`T₁ = ${T1.toFixed(1)} N,  T₂ = ${T2.toFixed(1)} N  (differ by ${Math.abs(T2 - T1).toFixed(1)} N → spins the pulley)`, 12, 30);
      } else {
        ctx.fillText(`T = ${T1.toFixed(1)} N  (equal on both sides)`, 12, 30);
      }
      const which = Math.abs(a) < 1e-3 ? 'balanced — the system hangs still'
        : (a > 0 ? 'right side falls, left side rises' : 'left side falls, right side rises');
      ctx.fillStyle = Math.abs(a) < 1e-3 ? GOLD : TEXT;
      ctx.fillText(which, 12, 48);

      // energy panel (optional): released PE = translational KE + rotational KE.
      // Drawn as a self-contained boxed widget so nothing overlaps the scene.
      if (energy) {
        const KEt = 0.5 * (M1 + M2) * s.v * s.v;
        const KEr = 0.25 * Mp * s.v * s.v;          // ½ I ω² = ¼ Mp v²
        const PEr = (M2 - M1) * G * s.p;            // released potential energy
        const maxE = Math.max(0.5, Math.abs(M2 - M1) * G * MAX_TRAVEL);

        const pw = 152, ph = 156;
        const x0 = W - pw - 12, y0 = 12;
        ctx.fillStyle = 'rgba(13,19,33,0.85)';
        ctx.strokeStyle = 'rgba(139,140,142,0.35)';
        ctx.lineWidth = 1;
        roundRect(ctx, x0, y0, pw, ph, 8); ctx.fill(); ctx.stroke();

        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = TEXT; ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.fillText('Energy (J)', x0 + 10, y0 + 8);

        ctx.font = '10px JetBrains Mono, monospace';
        const legend = [['PE released', 'rgba(91,155,213,0.9)'], ['KE translation', 'rgba(197,183,131,0.95)'], ['KE rotation', 'rgba(127,183,126,0.95)']];
        legend.forEach(([lab, col], i) => {
          const ly = y0 + 25 + i * 13;
          ctx.fillStyle = col; ctx.fillRect(x0 + 10, ly + 1, 8, 8);
          ctx.fillStyle = MUTED; ctx.fillText(lab, x0 + 23, ly);
        });

        const barBase = y0 + 130, barMax = 56, bwid = 22;
        const scale = barMax / maxE;
        const cap = (v) => Math.max(0, Math.min(barMax, v * scale));
        const peX = x0 + 44, keX = x0 + 92;
        // PE released bar
        const hp = cap(PEr);
        ctx.fillStyle = 'rgba(91,155,213,0.9)';
        ctx.fillRect(peX, barBase - hp, bwid, hp);
        // KE bar (translational gold + rotational green, stacked)
        const ht = cap(KEt), hr = Math.min(barMax - ht, cap(KEr));
        ctx.fillStyle = 'rgba(197,183,131,0.95)'; ctx.fillRect(keX, barBase - ht, bwid, ht);
        ctx.fillStyle = 'rgba(127,183,126,0.95)'; ctx.fillRect(keX, barBase - ht - hr, bwid, hr);
        // baseline + labels
        ctx.strokeStyle = 'rgba(139,140,142,0.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0 + 12, barBase + 0.5); ctx.lineTo(x0 + pw - 12, barBase + 0.5); ctx.stroke();
        ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('PE', peX + bwid / 2, barBase + 5);
        ctx.fillText('KE', keX + bwid / 2, barBase + 5);
      }

      pub += dt;
      if (pub > 0.1) { pub = 0; setRo({ a, T1, T2, v: s.v }); }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const obs = new ResizeObserver(resize);
    obs.observe(wrap);
    return () => { cancelAnimationFrame(raf); obs.disconnect(); };
  }, []);

  const w1 = m1 * G, w2 = m2 * G;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            onClick={restart}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            ⟲ Reset positions
          </button>
        </div>

        <Slider label="Left mass (m₁)" value={m1} min={1} max={10} step={0.5} unit="kg" onChange={setM1} />
        <Slider label="Right mass (m₂)" value={m2} min={1} max={10} step={0.5} unit="kg" onChange={setM2} />

        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-text text-sm font-medium mb-1">Options</div>
          <Toggle checked={massive} onChange={setMassive} label="Massive pulley (adds rotational inertia)" />
          {massive && (
            <div className="pl-6 mt-1">
              <Slider label="Pulley mass (Mₚ)" value={pulleyMass} min={0.5} max={20} step={0.5} unit="kg" onChange={setPulleyMass} />
            </div>
          )}
          <Toggle checked={showEnergy} onChange={setShowEnergy} label="Show energy (PE → KE)" />
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Acceleration a" value={Math.abs(ro.a).toFixed(2)} unit="m/s²" />
          <Readout label="Tension left T₁" value={ro.T1.toFixed(1)} unit="N" />
          <Readout label="Tension right T₂" value={ro.T2.toFixed(1)} unit="N" />
          <div className="mt-1 pt-1 border-t border-usna-grid">
            <Readout label="Left weight m₁g" value={w1.toFixed(1)} unit="N" />
            <Readout label="Right weight m₂g" value={w2.toFixed(1)} unit="N" />
          </div>
          <div className="text-usna-muted text-[11px] mt-2 leading-snug">
            {massive
              ? 'With a massive pulley the two tensions differ; their difference supplies the torque that spins it up.'
              : 'With a light pulley the one tension lies between the weights: m₁g ≤ T ≤ m₂g.'}
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 400, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>
        <InfoPanel {...INFO} />
      </div>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const INFO = {
  title: 'Atwood machine: one string ties two masses together',
  description:
    'Because the string does not stretch, both masses share a single acceleration: as one descends, the other rises at the same rate. Adding the second-law equations for the two masses cancels the internal tension, so the acceleration is the difference of the weights divided by the total mass. The system accelerates on the imbalance between the weights, not on either weight alone, and a small difference between large masses gives a gentle acceleration. A light pulley carries one tension that lies between the two weights. Turning on the massive-pulley option gives the pulley rotational inertia: the effective mass grows by half the pulley mass, the acceleration drops, and the two tensions become unequal, with their difference supplying the torque that spins the pulley. The energy option shows the released potential energy splitting into the blocks\' translational kinetic energy and the pulley\'s rotational kinetic energy.',
  equation: String.raw`a = \frac{(m_2 - m_1)\,g}{m_1 + m_2 + \tfrac{1}{2}M_p}, \qquad T_2 - T_1 = \tfrac{1}{2}M_p\,a`,
};
