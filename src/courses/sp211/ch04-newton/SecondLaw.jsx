import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D10 · Newton's Second Law sandbox (F = ma) — Chapter 4.
 *
 * A block on a long horizontal track. The student sets an applied force, the
 * block's mass, and an optional kinetic-friction coefficient, then presses Play
 * and watches the net force produce an acceleration a = F_net / m. The camera
 * follows the block so it stays centred while the ground scrolls past, and a
 * velocity-vs-time strip beside it shows v ramping in a straight line whose SLOPE
 * is the acceleration.
 *
 * The teaching moments:
 *   - A constant net force gives a constant acceleration: v(t) is a straight line.
 *   - Doubling the force doubles the slope; doubling the mass halves it (a = F/m).
 *   - Turn on friction: below the static limit the block will not move at all;
 *     above it, the net force is the applied force minus friction.
 *
 * Single mode. Canvas + rAF + ResizeObserver, real SI units.
 */

const G = 9.8;
const GOLD = '#C5B783';   // applied force / block
const BLUE = '#5B9BD5';   // velocity
const WHITE = '#F0ECE3';  // acceleration
const ORANGE = '#D98C5F'; // friction
const MUTED = '#8B8C8E';
const NAVY = '#00205B';
const GRID = '#1A2332';
const TEXT = '#F0ECE3';
const BG = '#0D1321';

const DEFAULTS = { force: 6, mass: 2, mu: 0 };

// Net force / acceleration for the current state (also used, at v = 0, to report
// the static-friction situation).
function solve(v, F, m, mu) {
  const fricMax = mu * m * G;
  let fAct;
  if (Math.abs(v) > 1e-3) fAct = -Math.sign(v) * fricMax;            // kinetic
  else fAct = Math.abs(F) <= fricMax ? -F : -Math.sign(F) * fricMax; // static
  const net = F + fAct;
  return { a: net / m, fAct, net, fricMax };
}

export default function SecondLaw({ mode = 'default' }) {
  void mode; // single-mode demo
  return <Sandbox />;
}

function Sandbox() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [force, setForce] = useState(DEFAULTS.force);
  const [mass, setMass] = useState(DEFAULTS.mass);
  const [mu, setMu] = useState(DEFAULTS.mu);
  const [playing, setPlaying] = useState(true);

  const stRef = useRef({ v: 0, x: 0, t: 0 });
  const liveRef = useRef({ force, mass, mu, playing });
  liveRef.current = { force, mass, mu, playing };

  const [ro, setRo] = useState({ a: 0, v: 0, x: 0, t: 0, fAct: 0, net: 0 });
  const histRef = useRef([]);          // [{t, v}] over the last ~9 s
  const [hist, setHist] = useState([]);

  const restart = () => {
    stRef.current = { v: 0, x: 0, t: 0 };
    histRef.current = [];
    setHist([]);
    setRo({ a: 0, v: 0, x: 0, t: 0, fAct: 0, net: 0 });
  };
  const reset = () => {
    setForce(DEFAULTS.force); setMass(DEFAULTS.mass); setMu(DEFAULTS.mu); setPlaying(true);
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

      const { force: F, mass: m, mu: muK, playing: pl } = liveRef.current;
      const s = stRef.current;
      const { a, fAct, net, fricMax } = solve(s.v, F, m, muK);

      if (pl) {
        const vNew = s.v + a * dt;
        // stiction: if friction is about to push v through zero and the applied
        // force is within the static limit, the block just stops.
        if (Math.abs(s.v) > 1e-3 && Math.sign(vNew) !== Math.sign(s.v) && Math.abs(F) <= fricMax) {
          s.v = 0;
        } else {
          s.v = vNew;
        }
        s.x += s.v * dt;
        s.t += dt;
        const h = histRef.current;
        h.push({ t: s.t, v: s.v });
        while (h.length && h[0].t < s.t - 9) h.shift();
      }

      // ── geometry ──
      const pxPerM = W / 18;                 // show ~18 m across
      const groundY = H * 0.60;
      const camX = s.x;                      // keep the block centred
      const sx = (wx) => W / 2 + (wx - camX) * pxPerM;

      ctx.clearRect(0, 0, W, H);

      // ground + scrolling metre ticks
      ctx.strokeStyle = GRID; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();
      ctx.fillStyle = MUTED; ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const m0 = Math.floor(camX - 10), m1 = Math.ceil(camX + 10);
      for (let mx = m0; mx <= m1; mx++) {
        const px = sx(mx);
        if (px < -20 || px > W + 20) continue;
        const major = mx % 5 === 0;
        ctx.strokeStyle = major ? 'rgba(139,140,142,0.5)' : 'rgba(139,140,142,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, groundY); ctx.lineTo(px, groundY + (major ? 9 : 5)); ctx.stroke();
        if (major) ctx.fillText(`${mx} m`, px, groundY + 11);
      }

      // block (size grows a little with mass)
      const bw = Math.min(84, 30 + m * 4.2), bh = Math.min(60, 24 + m * 2.4);
      const bx = W / 2, byTop = groundY - bh;
      ctx.fillStyle = 'rgba(197,183,131,0.22)';
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      roundRect(ctx, bx - bw / 2, byTop, bw, bh, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = GOLD; ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${m.toFixed(1)} kg`, bx, byTop + bh / 2);

      // arrows: v (top), a (just above block), F applied + friction (on the block)
      const cyF = byTop + bh / 2;
      const F_SCALE = 6, A_SCALE = 5.5, V_SCALE = 6, CAP = W * 0.32;
      const clamp = (val) => Math.max(-CAP, Math.min(CAP, val));
      // applied force
      if (Math.abs(F) > 0.05) {
        drawArrow(ctx, { x: bx, y: cyF, dx: clamp(F * F_SCALE), dy: 0, color: GOLD, width: 4, head: 11, label: 'F' });
      }
      // friction (only when it is actually resisting)
      if (Math.abs(fAct) > 0.05) {
        drawArrow(ctx, { x: bx, y: cyF + 16, dx: clamp(fAct * F_SCALE), dy: 0, color: ORANGE, width: 3.5, head: 10, label: 'f' });
      }
      // acceleration, above the block
      if (Math.abs(a) > 0.02) {
        drawArrow(ctx, { x: bx, y: byTop - 16, dx: clamp(a * A_SCALE), dy: 0, color: WHITE, width: 4, head: 11, label: 'a' });
      }
      // velocity, higher up
      if (Math.abs(s.v) > 0.02) {
        drawArrow(ctx, { x: bx, y: byTop - 42, dx: clamp(s.v * V_SCALE), dy: 0, color: BLUE, width: 4, head: 11, label: 'v' });
      }

      // HUD: the law with live numbers
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.fillText(`a = F_net / m = ${net.toFixed(1)} / ${m.toFixed(1)} = ${a.toFixed(2)} m/s²`, 12, 12);
      if (muK > 0 && Math.abs(s.v) < 1e-3 && Math.abs(F) <= fricMax) {
        ctx.fillStyle = ORANGE;
        ctx.fillText('static friction holds the block (F below the friction limit)', 12, 30);
      }

      // publish readouts + history to React at ~12 Hz
      pub += dt;
      if (pub > 0.08) {
        pub = 0;
        setRo({ a, v: s.v, x: s.x, t: s.t, fAct, net });
        setHist(histRef.current.slice());
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const obs = new ResizeObserver(resize);
    obs.observe(wrap);
    return () => { cancelAnimationFrame(raf); obs.disconnect(); };
  }, []);

  // ── v(t) strip chart ──
  const vMax = Math.max(2, ...hist.map((p) => Math.abs(p.v)));
  const tNow = ro.t;
  const tLo = Math.max(0, tNow - 9);
  const stripTraces = [
    {
      x: hist.map((p) => p.t), y: hist.map((p) => p.v),
      type: 'scatter', mode: 'lines', line: { color: BLUE, width: 2.5 }, hoverinfo: 'skip',
    },
    {
      x: [tNow], y: [ro.v], type: 'scatter', mode: 'markers',
      marker: { color: '#FFFFFF', size: 8, line: { color: BLUE, width: 2 } }, hoverinfo: 'skip',
    },
  ];
  const stripLayout = {
    showlegend: false,
    margin: { l: 52, r: 14, t: 8, b: 40 },
    xaxis: { title: { text: 'time (s)', standoff: 8 }, range: [tLo, Math.max(9, tNow)], autorange: false, zeroline: false, tickfont: { size: 11 } },
    yaxis: { title: { text: 'v (m/s)' }, range: [-vMax * 1.15, vMax * 1.15], autorange: false, zeroline: true, zerolinecolor: '#2A3442', tickfont: { size: 11 } },
  };

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
            ⟲ Restart
          </button>
        </div>

        <Slider label="Applied force (F)" value={force} min={-20} max={20} step={0.5} unit="N" onChange={setForce} />
        <Slider label="Mass (m)" value={mass} min={1} max={12} step={0.5} unit="kg" onChange={setMass} />
        <Slider label="Kinetic friction (μ)" value={mu} min={0} max={0.6} step={0.05} unit="" onChange={setMu} />

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="Acceleration a" value={ro.a.toFixed(2)} unit="m/s²" />
          <Readout label="Net force" value={ro.net.toFixed(1)} unit="N" />
          <Readout label="Friction f" value={ro.fAct.toFixed(1)} unit="N" />
          <div className="mt-1 pt-1 border-t border-usna-grid">
            <Readout label="Velocity v" value={ro.v.toFixed(2)} unit="m/s" />
            <Readout label="Position x" value={ro.x.toFixed(1)} unit="m" />
            <Readout label="Time t" value={ro.t.toFixed(1)} unit="s" />
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 300, background: BG }}
        >
          <canvas ref={canvasRef} className="block" />
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0 overflow-hidden" style={{ height: 214 }}>
          <div className="text-usna-muted text-xs mb-1 px-1 truncate">
            Velocity vs time. A constant net force gives a straight line whose slope is the acceleration.
          </div>
          <div style={{ height: 172 }}>
            <IntensityPlot traces={stripTraces} layoutOverrides={stripLayout} />
          </div>
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
  title: "Newton's second law: force sets acceleration",
  description:
    'The net force on the block equals its mass times its acceleration. With a constant net force the acceleration is constant, so the velocity climbs along a straight line and the position curves as a parabola. Doubling the force doubles the acceleration; doubling the mass halves it. Turning on friction adds a resisting force: while the block is at rest, static friction cancels the applied force up to its limit, so a force below that limit produces no motion at all. Above the limit the block accelerates under the applied force minus friction.',
  equation: String.raw`\vec F_{net} = m\,\vec a \quad\Rightarrow\quad a = \frac{F_{net}}{m}`,
};
