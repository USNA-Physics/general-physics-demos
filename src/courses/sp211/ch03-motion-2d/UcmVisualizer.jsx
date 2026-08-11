import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D07 · UCM Vector Visualizer — L7 (kinematic), L13 (banked).
 *
 * Two independent demos that both live on the "uniform circular motion needs an
 * inward force" idea:
 *
 *   kinematic : a bead runs a circle at constant speed. Its velocity arrow is
 *               tangent (length grows with v, forever turning) and its
 *               acceleration arrow points dead at the center (a = v²/r).
 *               Pausing and asking "which way is it accelerating?" is the moment
 *               — nearly everyone says "forward," but a is always inward. A
 *               faint GHOST bead is released on Play and flies off along the
 *               tangent in a straight line: that is what no-force motion looks
 *               like; the circle only exists because something keeps pulling
 *               inward. A Δv construction inset shows WHY a points inward
 *               (Δv = v(t+Δt) − v(t) leans toward the center), and the
 *               hodograph traces the tip of v over one period into a circle.
 *
 *   banked    : side-view cutaway of a banked turn. N, mg, and friction f are
 *               drawn on the car; f FLIPS from up-slope to down-slope as the
 *               speed crosses the design speed v_d = √(r g tanθ). Below v_d the
 *               car tends to slide DOWN the bank so friction points up; above
 *               v_d it tends to slide UP/out so friction points down. At exactly
 *               v_d no friction is needed at all. When the grip budget is blown
 *               (|f_req| > μN) friction is drawn capped at f_max (solid) with the
 *               unmet deficit dashed, and the car actually slides.
 *
 * Both children are self-contained (canvas + rAF + ResizeObserver). The default
 * export is a thin, hook-free wrapper so each child owns its own hooks (Rules of
 * Hooks stay satisfied across the very different mode UIs).
 */

const G = 9.81;                 // m/s²
const GOLD = '#C5B783';         // velocity / primary
const BLUE = '#5B9BD5';         // normal force
const RED = '#E07A5F';          // weight / deficit
const GREEN = '#7FB77E';        // friction
const TEXT = '#F0ECE3';         // acceleration
const MUTED = '#8B8C8E';
const GHOST = 'rgba(197,183,131,0.55)';
const HODO = 'rgba(91,155,213,0.9)'; // hodograph
const BG = '#0D1321';

// ───────────────────────────────────────────────────────────────────────────
// Wrapper (hook-free): branch on mode.
// ───────────────────────────────────────────────────────────────────────────
export default function UcmVisualizer({ mode = 'kinematic' }) {
  if (mode === 'banked') return <Banked />;
  return <Kinematic />;
}

// ───────────────────────────────────────────────────────────────────────────
// KINEMATIC (L7)
// ───────────────────────────────────────────────────────────────────────────
const K_DEFAULTS = { r: 20, v: 15 };
const K_R_MAX = 40; // matches the radius slider max; sets a fixed metres→px scale

function Kinematic() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [r, setR] = useState(K_DEFAULTS.r);   // m
  const [v, setV] = useState(K_DEFAULTS.v);   // m/s
  const [playing, setPlaying] = useState(true);
  const [showDv, setShowDv] = useState(true);      // Δv construction inset
  const [showHodo, setShowHodo] = useState(true);  // hodograph trace

  // live refs so the rAF loop reads current values without re-subscribing
  const rRef = useRef(r); rRef.current = r;
  const vRef = useRef(v); vRef.current = v;
  const playingRef = useRef(playing); playingRef.current = playing;
  const showDvRef = useRef(showDv); showDvRef.current = showDv;
  const showHodoRef = useRef(showHodo); showHodoRef.current = showHodo;

  // physics readouts (recomputed on every React render — cheap)
  const ac = (v * v) / r;               // centripetal acceleration, m/s²
  const omega = v / r;                  // rad/s
  const period = (2 * Math.PI * r) / v; // s
  const gLoad = ac / G;

  // ── ghost state persists across renders ──────────────────────────────────
  // Value is either:
  //   'relaunch'  → spawn a fresh ghost from the bead next frame
  //   null        → no ghost (e.g. paused with no manual release)
  //   {x,y,vx,vy} → a live ghost flying in a straight line (world px)
  const ghostRef = useRef('relaunch');
  // one-shot request to release the ghost from the *frozen* position while paused
  const releaseNowRef = useRef(false);

  // when we pause, freeze; when we resume, (re)launch a fresh ghost from the
  // bead's current position along the current tangent.
  useEffect(() => {
    if (playing) ghostRef.current = 'relaunch';
    else ghostRef.current = null; // freeze; a manual "release now" can override
  }, [playing]);

  const reset = () => {
    setR(K_DEFAULTS.r); setV(K_DEFAULTS.v);
    // FIX: re-arm the ghost so it re-launches after Reset even when we were
    // already playing (a bare null used to make the best feature vanish).
    ghostRef.current = 'relaunch';
    releaseNowRef.current = false;
    // If we were already playing, the [playing] effect will not fire; if we
    // toggle to playing it will — either way 'relaunch' above covers it.
    setPlaying(true);
  };

  // fire the ghost from the exact frozen position while paused
  const releaseNow = () => { releaseNowRef.current = true; };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, cx, cy, scale;
    let theta = -Math.PI / 2;   // start at top
    let last;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      cx = W / 2;
      cy = H / 2;
      // Fixed pixels-per-metre (sized so the MAX radius just fits). The circle's
      // on-screen size therefore tracks the actual radius instead of being
      // rescaled to a constant size.
      scale = (Math.min(W, H) * 0.42) / K_R_MAX;
    };

    const draw = (now) => {
      if (last === undefined) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const rM = rRef.current;
      const vM = vRef.current;
      // fixed metres→px scale, so a bigger radius draws a visibly bigger circle
      scale = (Math.min(W, H) * 0.42) / K_R_MAX;
      const Rpx = rM * scale;
      const om = vM / rM; // angular rate

      if (playingRef.current) theta += om * dt;

      // bead position (screen: +y down)
      const bx = cx + Rpx * Math.cos(theta);
      const by = cy + Rpx * Math.sin(theta);

      // unit radial (outward) and tangential (direction of travel, CCW-in-screen)
      const rux = Math.cos(theta), ruy = Math.sin(theta);
      const tux = -Math.sin(theta), tuy = Math.cos(theta);

      // velocity arrow now scales visibly with v (fix: was fixed-length).
      // cap so a huge v on a small circle still fits the frame.
      const vLenPx = Math.min(Rpx * 0.95, 18 + vM * 4.2);

      // ── ghost bookkeeping ────────────────────────────────────────────────
      // A manual "release now" fires from the frozen bead even while paused.
      if (releaseNowRef.current) {
        ghostRef.current = {
          x: bx, y: by,
          x0: bx, y0: by,         // release point (fixed) for the tangent line
          vx: tux * vM * scale,
          vy: tuy * vM * scale,
        };
        releaseNowRef.current = false;
      }
      if (ghostRef.current === 'relaunch') {
        ghostRef.current = {
          x: bx, y: by,
          x0: bx, y0: by,         // release point (fixed) for the tangent line
          vx: tux * vM * scale,   // px/s along tangent
          vy: tuy * vM * scale,
        };
      }
      const ghostLive = ghostRef.current && typeof ghostRef.current === 'object';
      if (ghostLive) {
        // a manually-released ghost keeps flying even while the bead is paused
        ghostRef.current.x += ghostRef.current.vx * dt;
        ghostRef.current.y += ghostRef.current.vy * dt;
        const gg = ghostRef.current;
        if (gg.x < -60 || gg.x > W + 60 || gg.y < -60 || gg.y > H + 60) {
          // recycle only while playing; a paused manual ghost just ends
          ghostRef.current = playingRef.current ? 'relaunch' : null;
        }
      }

      // ── paint ────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // dashed circular path
      ctx.strokeStyle = 'rgba(197,183,131,0.32)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.arc(cx, cy, Rpx, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // hodograph: tip of the velocity arrow, drawn at the CENTER as its own
      // circle of radius = |v| (in the same px units as the velocity arrow).
      // As the bead goes once around, the velocity tip sweeps this whole circle.
      if (showHodoRef.current) {
        ctx.strokeStyle = 'rgba(91,155,213,0.30)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(cx, cy, vLenPx, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        // current velocity tip on the hodograph (points the same way as v)
        const htx = cx + tux * vLenPx;
        const hty = cy + tuy * vLenPx;
        // faint arrow from hodograph center to the moving tip
        ctx.strokeStyle = 'rgba(91,155,213,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(htx, hty);
        ctx.stroke();
        ctx.fillStyle = HODO;
        ctx.beginPath();
        ctx.arc(htx, hty, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(91,155,213,0.85)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('hodograph (tip of v)', cx + 8, cy - vLenPx - 10);
      }

      // center marker + faint radius spoke
      ctx.strokeStyle = 'rgba(139,140,142,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = MUTED;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fill();

      // ghost straight-line path + ghost bead. The dotted line is the tangent
      // from the RELEASE point (fixed) to the ghost, so it reads as the actual
      // no-force path instead of a line back to the still-orbiting bead.
      const g = ghostRef.current;
      if (g && typeof g === 'object') {
        ctx.strokeStyle = 'rgba(197,183,131,0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(g.x0, g.y0);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // mark the release point on the circle
        ctx.fillStyle = 'rgba(197,183,131,0.55)';
        ctx.beginPath();
        ctx.arc(g.x0, g.y0, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        // ghost bead
        ctx.fillStyle = GHOST;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillStyle = GHOST;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('no force', g.x, g.y - 14);
      }

      // acceleration arrow — inward, length grows with a = v²/r (visual, capped)
      const acM = (vM * vM) / rM;
      const aLenPx = Math.min(Rpx * 0.85, 26 + acM * 1.4);
      drawArrow(ctx, {
        x: bx, y: by, dx: -rux * aLenPx, dy: -ruy * aLenPx,
        color: TEXT, width: 3.5, label: 'a', head: 11,
      });

      // velocity arrow — tangent, length scales with v, forever rotating
      drawArrow(ctx, {
        x: bx, y: by, dx: tux * vLenPx, dy: tuy * vLenPx,
        color: GOLD, width: 3.5, label: 'v', head: 11,
      });

      // the bead itself
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── scale bar (fixed ruler) ───────────────────────────────────────────
      // A constant 10 m reference. Because the metres→px scale is fixed, the bar
      // stays put while the circle grows or shrinks against it as r changes.
      const barM = 10;
      const barPx = barM * scale;
      const sbx = 18, sby = H - 18;
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sbx, sby); ctx.lineTo(sbx + barPx, sby);
      ctx.moveTo(sbx, sby - 4); ctx.lineTo(sbx, sby + 4);
      ctx.moveTo(sbx + barPx, sby - 4); ctx.lineTo(sbx + barPx, sby + 4);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${barM} m`, sbx, sby - 6);
      // radius readout tied to the circle (top-left, clear of the Δv inset)
      ctx.fillStyle = 'rgba(197,183,131,0.8)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`r = ${rM.toFixed(0)} m`, 14, 12);

      // ── Δv construction inset (WOW) ──────────────────────────────────────
      // Draw v(t) and v(t+Δt) tail-to-tail in a corner box and connect their
      // tips with Δv. Because both have the same length but different direction,
      // Δv leans toward the CENTER of the circle — that's why a points inward.
      if (showDvRef.current) {
        const boxW = Math.min(150, W * 0.34);
        const boxH = boxW;
        const bxo = W - boxW - 12;      // box origin (top-left)
        const byo = 12;
        // panel background
        ctx.fillStyle = 'rgba(13,19,33,0.82)';
        ctx.strokeStyle = 'rgba(139,140,142,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(bxo, byo, boxW, boxH);
        ctx.fill();
        ctx.stroke();

        // tail-to-tail origin inside the box
        const ivx = bxo + boxW * 0.38;
        const ivy = byo + boxH * 0.62;
        const iv = boxW * 0.42; // inset arrow length (px)
        const dth = 0.6;        // a fixed, exaggerated Δθ for a legible triangle

        // v(t): tangent at the bead's current angle
        const t1x = tux, t1y = tuy;
        // v(t+Δt): tangent a little later (angle advanced by dth, CCW in screen)
        const th2 = theta + dth;
        const t2x = -Math.sin(th2), t2y = Math.cos(th2);

        const p1x = ivx + t1x * iv, p1y = ivy + t1y * iv;
        const p2x = ivx + t2x * iv, p2y = ivy + t2y * iv;

        // v(t)
        drawArrow(ctx, {
          x: ivx, y: ivy, dx: t1x * iv, dy: t1y * iv,
          color: GOLD, width: 2.4, label: 'v(t)', head: 8,
        });
        // v(t+Δt)
        drawArrow(ctx, {
          x: ivx, y: ivy, dx: t2x * iv, dy: t2y * iv,
          color: 'rgba(197,183,131,0.6)', width: 2.4, label: '', head: 8,
        });
        // Δv from tip of v(t) to tip of v(t+Δt) — points inward
        drawArrow(ctx, {
          x: p1x, y: p1y, dx: p2x - p1x, dy: p2y - p1y,
          color: TEXT, width: 2.6, label: 'Δv', head: 8,
        });

        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Δv aims inward', bxo + 8, byo + 6);
        ctx.fillText('→ a = Δv/Δt', bxo + 8, byo + boxH - 16);
      }

      // paused hint banner
      if (!playingRef.current) {
        ctx.font = 'bold 14px JetBrains Mono, monospace';
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Which way is it accelerating?', cx, 12);
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              onClick={releaseNow}
              disabled={playing}
              className="px-3 py-1.5 rounded text-sm font-medium border border-usna-gold text-usna-gold hover:bg-usna-gold/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Fire the no-force ghost from the frozen position"
            >
              ↗ Release now
            </button>
          </div>
          <span className="block mt-1 text-usna-muted text-xs">
            pause &amp; ask which way a points, then release the ghost
          </span>
        </div>

        <Slider label="Radius (r)" value={r} min={5} max={40} step={1} unit="m" onChange={setR} />
        <Slider label="Speed (v)" value={v} min={2} max={40} step={1} unit="m/s" onChange={setV} />

        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showDv} onChange={(e) => setShowDv(e.target.checked)} />
            Δv construction inset
          </label>
          <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
            <input type="checkbox" checked={showHodo} onChange={(e) => setShowHodo(e.target.checked)} />
            Hodograph (tip of v)
          </label>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="a꜀ = v²/r" value={ac.toFixed(1)} unit="m/s²" />
          <Readout label="g-load" value={gLoad.toFixed(2)} unit="g" />
          <Readout label="ω = v/r" value={omega.toFixed(2)} unit="rad/s" />
          <Readout label="Period T" value={period.toFixed(1)} unit="s" />
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
          title="Acceleration points inward, always"
          description={
            "The speed is constant, yet the bead accelerates at every instant, because the direction of its velocity keeps changing. A common first guess is that the acceleration points forward, along the motion. It does not: the gold velocity arrow is tangent to the circle, while the acceleration arrow points at the center. The Δv inset shows why. Drawing v(t) and v(t+Δt) tail to tail, the difference Δv = v(t+Δt) − v(t) leans toward the center, and a = Δv/Δt inherits that direction. The blue hodograph traces the tip of the velocity vector, which sweeps out its own circle of radius v. Releasing the bead (Play launches a faint no-force ghost, or use Release now while paused) sends it off along the tangent in a straight line. That straight line is what motion with no force looks like; the circle exists only because a force keeps pulling the bead inward."
          }
          equation={String.raw`a_c = \frac{v^2}{r} = \omega^2 r \quad(\text{directed toward the center})`}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// BANKED (L13)
// ───────────────────────────────────────────────────────────────────────────
const B_DEFAULTS = { theta: 20, v: 25, r: 80, mu: 0.4 };

// Exported so it can live as its own demo in Ch5 (Applications of Newton's Laws),
// where banked-curve dynamics belongs, rather than as a mode of the UCM kinematics
// demo. See ch05-applications/BankedCurve.jsx.
export function Banked() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [theta, setTheta] = useState(B_DEFAULTS.theta); // deg
  const [v, setV] = useState(B_DEFAULTS.v);             // m/s
  const [r, setR] = useState(B_DEFAULTS.r);             // m
  const [mu, setMu] = useState(B_DEFAULTS.mu);          // unitless

  const reset = () => {
    setTheta(B_DEFAULTS.theta); setV(B_DEFAULTS.v);
    setR(B_DEFAULTS.r); setMu(B_DEFAULTS.mu);
  };

  // ── physics (SI, +x toward the center of the turn, +y up) ────────────────
  // Design speed: the speed at which no friction is required.
  const th = (theta * Math.PI) / 180;
  const vDesign = Math.sqrt(r * G * Math.tan(th));
  const acNeeded = (v * v) / r; // centripetal accel required, m/s²

  // Solve N and friction f along the incline for a car of unit mass (m cancels
  // in the "does it hold?" question; readouts report per-kg forces = accels).
  // Axis equations with x toward center, y up, f measured +up-the-slope:
  //   N sinθ - f cosθ = m v²/r        (net inward = centripetal)   ← x-axis
  //   N cosθ + f sinθ - m g = 0       (no vertical accel)          ← y-axis
  // Solving (m = 1):
  //   N = g cosθ + (v²/r) sinθ
  //   f = g sinθ - (v²/r) cosθ
  // f > 0 → friction acts UP the slope (low speed, car tends to slide down).
  // f < 0 → friction acts DOWN the slope (high speed, car tends to slide up/out).
  const c = Math.cos(th), s = Math.sin(th);
  const N = G * c + acNeeded * s;              // per-kg normal (N/kg = m/s²)
  const fReq = G * s - acNeeded * c;           // per-kg friction, +up-slope
  const fMax = mu * N;                          // available static friction
  const holds = Math.abs(fReq) <= fMax + 1e-9;
  const frictionUp = fReq > 0;                  // sign convention above
  const atDesign = Math.abs(v - vDesign) < 0.15;
  // Signed friction actually delivered: capped at ±fMax when the budget blows.
  const fDeliv = holds ? fReq : Math.sign(fReq) * fMax;
  const fDeficit = fReq - fDeliv;               // unmet demand (0 when it holds)
  // fraction of the grip budget in use (for the gauge)
  const budgetFrac = fMax > 1e-9 ? fReq / fMax : (Math.abs(fReq) > 1e-9 ? Math.sign(fReq) * 99 : 0);

  // The two force-balance axis equations with live numbers. The term that flips
  // sign at v_d is the friction term on the x-axis (∓ f cosθ) — highlight it.
  // x-axis (inward positive):  N sinθ − f cosθ = v²/r
  // y-axis (up positive):      N cosθ + f sinθ = g
  const xTermN = N * s;
  const xTermF = fDeliv * c;   // subtracted on the x-axis
  const yTermN = N * c;
  const yTermF = fDeliv * s;   // added on the y-axis

  // live refs for the rAF loop
  const stRef = useRef({});
  stRef.current = {
    th, fReq, fDeliv, fDeficit, N, fMax, holds, frictionUp, atDesign, acNeeded,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf;
    // slide animation state: offset of the car along the slope (px, +up-slope),
    // and a small outward drift so an "up/out" slip visibly leaves the bank.
    let slide = 0;
    let last;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      if (last === undefined) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      const { th, fReq, fDeliv, fDeficit, N, fMax, holds, frictionUp, atDesign } = stRef.current;
      ctx.clearRect(0, 0, W, H);

      // ── slide animation ──────────────────────────────────────────────────
      // When the grip holds, the car returns smoothly to its home position.
      // When it doesn't, it accelerates along the deficit direction: fReq>0 but
      // unmet → slides DOWN (−slope); fReq<0 unmet → slides UP/out (+slope).
      if (!holds) {
        const slipDir = fDeficit > 0 ? -1 : 1; // deficit up-slope means it slides down
        slide += slipDir * Math.min(220, Math.abs(fDeficit) * 30) * dt;
      } else {
        slide += (0 - slide) * Math.min(1, dt * 6); // ease home
      }
      // clamp so the car doesn't wander off screen
      slide = Math.max(-140, Math.min(140, slide));

      // Geometry: a wedge (the banked track) rising to the RIGHT toward the
      // center of the turn. The incline surface makes angle th with horizontal.
      const baseY = H * 0.78;         // ground line
      const apexX = W * 0.5;          // where the car sits (mid-slope)
      const slopeRun = Math.min(W * 0.36, (baseY - H * 0.18) / Math.max(0.18, Math.tan(th)));
      // incline goes from lower-left to upper-right
      const x0 = apexX - slopeRun * 0.5;
      const x1 = apexX + slopeRun * 0.5;
      const surfAngle = th; // radians, rising to the right
      const y0 = baseY;
      const y1 = baseY - slopeRun * Math.tan(surfAngle);

      // filled wedge (track cross-section)
      ctx.fillStyle = '#16203A';
      ctx.strokeStyle = 'rgba(139,140,142,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // ground / horizontal reference
      ctx.strokeStyle = 'rgba(139,140,142,0.4)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x0 - 30, y0);
      ctx.lineTo(x1 + 30, y0);
      ctx.stroke();
      ctx.setLineDash([]);

      // bank-angle arc + label at the base corner (x1, y0)
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x1, y0, 34, Math.PI + surfAngle, Math.PI, false);
      ctx.stroke();
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('θ', x1 - 42, y0 - 10);

      // "toward center" hint at the base
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('→ toward center of turn', apexX, y0 + 8);

      // unit vectors on the incline (screen coords, +y down)
      // up-the-slope points toward upper-right: (cosθ, -sinθ)
      const upX = Math.cos(surfAngle), upY = -Math.sin(surfAngle);
      // outward normal (away from surface, up-left): perpendicular to up-slope
      const nX = -Math.sin(surfAngle), nY = -Math.cos(surfAngle);

      // car home position (mid-slope), then offset by the slide amount.
      const homeX = apexX;
      const homeY = baseY - (homeX - x0) * Math.tan(surfAngle);
      // The car stays ON the banked surface and slides ALONG it: down-slope when
      // it is too slow, up-slope (heading over the outer edge) when too fast. It
      // never lifts off the plane along the normal.
      const carX = homeX + upX * slide;
      const carY = homeY + upY * slide;

      // draw the car body as a small tilted rectangle sitting on the surface
      ctx.save();
      ctx.translate(carX, carY);
      ctx.rotate(-surfAngle);
      ctx.fillStyle = holds ? '#243352' : '#3A2530';
      ctx.strokeStyle = holds ? GOLD : RED;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(-18, -22, 36, 18);
      ctx.fill();
      ctx.stroke();
      // wheels
      ctx.fillStyle = '#0B0F1A';
      ctx.beginPath(); ctx.arc(-11, -4, 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(11, -4, 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();

      // force origin: center of the car body, lifted off the surface a touch
      const ox = carX + nX * 12;
      const oy = carY + nY * 12;

      const A = 3.4; // pixels per (m/s²) for force-vector scaling

      // Normal force N — along outward normal
      drawArrow(ctx, {
        x: ox, y: oy, dx: nX * N * A, dy: nY * N * A,
        color: BLUE, width: 3, label: 'N', head: 10,
      });

      // Weight mg — straight down (per-kg magnitude = g)
      drawArrow(ctx, {
        x: ox, y: oy, dx: 0, dy: G * A, color: RED, width: 3, label: 'mg', head: 10,
      });

      // Friction f — along the incline.
      // FIX: draw only what static friction can DELIVER (capped at f_max) as a
      // solid arrow; if more was required (|fReq|>fMax), draw the unmet DEFICIT
      // as a dashed red arrow continuing from the solid tip. Never draw the full
      // required magnitude as if it were supplied.
      const delivMag = Math.abs(fDeliv) * A;
      const delivDir = fDeliv >= 0 ? 1 : -1; // +up-slope
      if (delivMag > 1) {
        drawArrow(ctx, {
          x: ox, y: oy,
          dx: upX * delivMag * delivDir, dy: upY * delivMag * delivDir,
          color: GREEN, width: 3, label: 'f', head: 10,
        });
      } else if (holds && Math.abs(fReq) * A <= 1) {
        // essentially zero friction (at design speed): a small hollow marker
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ox, oy, 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillStyle = GREEN;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('f ≈ 0', ox + 12, oy);
      }
      // dashed deficit (the friction that WOULD be needed but can't be supplied)
      if (!holds && Math.abs(fDeficit) * A > 1) {
        // solid arrow ended at the delivered tip; continue in the SAME direction
        // as the requirement (sign of fReq) from that tip.
        const tipX = ox + upX * delivMag * delivDir;
        const tipY = oy + upY * delivMag * delivDir;
        const defMag = Math.abs(fDeficit) * A;
        const defDir = fReq >= 0 ? 1 : -1;
        ctx.save();
        ctx.setLineDash([5, 5]);
        drawArrow(ctx, {
          x: tipX, y: tipY,
          dx: upX * defMag * defDir, dy: upY * defMag * defDir,
          color: RED, width: 2.4, label: 'deficit', head: 9,
        });
        ctx.restore();
        ctx.setLineDash([]);
      }

      // status banner: friction direction / grip
      ctx.font = 'bold 14px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let msg, mcol;
      if (atDesign) { msg = 'Design speed: no friction needed'; mcol = GOLD; }
      else if (!holds) { msg = frictionUp ? 'Slipping down the bank' : 'Sliding up and out: losing grip'; mcol = RED; }
      else { msg = frictionUp ? 'f points up the slope (too slow)' : 'f points down the slope (too fast)'; mcol = GREEN; }
      ctx.fillStyle = mcol;
      ctx.fillText(msg, 14, 12);

      // ── friction budget gauge (INTERACT) ─────────────────────────────────
      // A horizontal bar centered at 0 spanning ±f_max. A gold marker sits at
      // f_req; if it clips past ±f_max the overrun is drawn red — you can see
      // which limit you're hitting and how much grip margin is left.
      const gW = Math.min(240, W * 0.6);
      const gx = W - gW - 16;
      const gy = 44;
      const gh = 16;
      const midX = gx + gW / 2;
      // scale so ±f_max spans 80% of the bar (leaving room to show overrun)
      const fmaxPx = (gW / 2) * 0.8;
      const perN = fMax > 1e-9 ? fmaxPx / fMax : 0;

      // track
      ctx.fillStyle = 'rgba(139,140,142,0.18)';
      ctx.fillRect(gx, gy, gW, gh);
      // safe zone (±f_max) in translucent green
      ctx.fillStyle = 'rgba(127,183,126,0.22)';
      ctx.fillRect(midX - fmaxPx, gy, fmaxPx * 2, gh);
      // ±f_max limit ticks
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(midX - fmaxPx, gy - 3); ctx.lineTo(midX - fmaxPx, gy + gh + 3);
      ctx.moveTo(midX + fmaxPx, gy - 3); ctx.lineTo(midX + fmaxPx, gy + gh + 3);
      ctx.stroke();
      // zero line
      ctx.strokeStyle = 'rgba(139,140,142,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(midX, gy - 1); ctx.lineTo(midX, gy + gh + 1);
      ctx.stroke();
      // required-friction bar from 0 to f_req (clamped to the drawable width)
      const reqPx = Math.max(-gW / 2, Math.min(gW / 2, fReq * perN));
      const inBudget = Math.max(-fmaxPx, Math.min(fmaxPx, reqPx));
      // in-budget portion (gold)
      ctx.fillStyle = GOLD;
      if (inBudget >= 0) ctx.fillRect(midX, gy + 3, inBudget, gh - 6);
      else ctx.fillRect(midX + inBudget, gy + 3, -inBudget, gh - 6);
      // overrun portion (red) beyond ±f_max
      if (!holds) {
        ctx.fillStyle = RED;
        if (reqPx > fmaxPx) ctx.fillRect(midX + fmaxPx, gy + 3, reqPx - fmaxPx, gh - 6);
        else if (reqPx < -fmaxPx) ctx.fillRect(midX + reqPx, gy + 3, (-fmaxPx) - reqPx, gh - 6);
      }
      // gauge labels
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('friction budget  |f_req| vs ±f_max', midX, gy - 6);
      ctx.textBaseline = 'top';
      ctx.fillStyle = GREEN;
      ctx.textAlign = 'left';
      ctx.fillText('−f_max', midX - fmaxPx, gy + gh + 4);
      ctx.textAlign = 'right';
      ctx.fillText('+f_max', midX + fmaxPx, gy + gh + 4);
      // margin readout
      ctx.textAlign = 'center';
      ctx.fillStyle = holds ? GREEN : RED;
      const margin = fMax - Math.abs(fReq);
      ctx.fillText(
        holds ? `grip margin ${margin.toFixed(1)} N/kg` : `over by ${Math.abs(fDeficit).toFixed(1)} N/kg`,
        midX, gy + gh + 16
      );

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const dirLabel = atDesign ? 'none (f ≈ 0)' : frictionUp ? 'up the slope' : 'down the slope';

  // Which x-axis friction term flipped? (highlight when past design speed)
  const fFlipHigh = fReq < 0; // above design speed → friction term subtracts differently

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <Slider label="Bank angle (θ)" value={theta} min={0} max={45} step={1} unit="°" onChange={setTheta} />
        <Slider label="Speed (v)" value={v} min={0} max={60} step={1} unit="m/s" onChange={setV} />
        <Slider label="Radius (r)" value={r} min={20} max={200} step={5} unit="m" onChange={setR} />
        <Slider label="Friction (μ)" value={mu} min={0} max={1} step={0.05} unit="" onChange={setMu} />

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Design speed vd" value={vDesign.toFixed(1)} unit="m/s" />
          <Readout label="Needed a꜀ = v²/r" value={acNeeded.toFixed(1)} unit="m/s²" />
          <Readout label="Friction points" value={dirLabel} unit="" />
          <Readout label="|f| needed / max" value={`${Math.abs(fReq).toFixed(1)} / ${fMax.toFixed(1)}`} unit="N/kg" />
          <Readout label="Grip" value={holds ? 'holds' : 'SLIPS'} unit="" />
        </div>

        {/* Live force-balance axis equations (EXPLAIN). The friction term on the
            x-axis is the one that flips sign at v_d — highlighted. */}
        <div className="mt-3 border-t border-usna-grid pt-3 text-xs font-mono text-usna-text leading-relaxed">
          <div className="text-usna-muted mb-1">force balance (per kg):</div>
          <div className="mb-1">
            x:&nbsp;
            <span style={{ color: BLUE }}>N·sinθ</span>
            {' '}−{' '}
            <span
              style={{ color: fFlipHigh ? RED : GREEN, fontWeight: fFlipHigh ? 700 : 400 }}
              title="friction term that flips sign at the design speed"
            >
              f·cosθ
            </span>
            {' '}={' '}
            <span style={{ color: TEXT }}>v²/r</span>
          </div>
          <div className="text-usna-muted mb-2">
            &nbsp;&nbsp;&nbsp;{xTermN.toFixed(1)} − ({xTermF.toFixed(1)}) = {(xTermN - xTermF).toFixed(1)}
          </div>
          <div className="mb-1">
            y:&nbsp;
            <span style={{ color: BLUE }}>N·cosθ</span>
            {' '}+{' '}
            <span style={{ color: GREEN }}>f·sinθ</span>
            {' '}={' '}
            <span style={{ color: RED }}>g</span>
          </div>
          <div className="text-usna-muted">
            &nbsp;&nbsp;&nbsp;{yTermN.toFixed(1)} + ({yTermF.toFixed(1)}) = {(yTermN + yTermF).toFixed(1)}
          </div>
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
          title="Friction flips at the design speed"
          description={
            "At one speed, the design speed vd = √(r g tanθ), the banked track needs no friction: the horizontal component of the normal force alone supplies the whole centripetal pull. Below vd the car tends to slide down the bank, so static friction points up the slope. Above vd the car tends to slide up and out, so friction reverses and points down the slope. The friction-budget gauge compares |f_req| with ±f_max: while the gold bar stays inside the green limits there is grip to spare, and once it passes a limit the overrun turns red and the car breaks loose (down the bank if too slow, up and out if too fast). Static friction can supply at most f_max, so the arrow is capped there (solid) and any unmet demand is drawn dashed. The highlighted f·cosθ term in the x-equation changes sign as the speed sweeps through vd."
          }
          equation={String.raw`v_d = \sqrt{r\,g\,\tan\theta}, \qquad N\sin\theta - f\cos\theta = \frac{m v^2}{r}, \quad |f|\le \mu N`}
        />
      </div>
    </div>
  );
}
