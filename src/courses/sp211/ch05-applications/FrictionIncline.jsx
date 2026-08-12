import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { useTheme } from '@shared/ThemeContext';
import { drawArrow } from '@shared/lib/vectorArrow';
import { setupCanvas } from '@shared/lib/canvas';

/**
 * D11 · Friction Incline (L11) — the breakaway demo.
 *
 * A block sits on a tiltable ramp. As the student raises the angle the block
 * sticks: static friction f_s grows exactly to match the down-slope pull
 * (mg sinθ) and the block does not move. It keeps matching... until f_s hits its
 * ceiling f_max = μ_s N. At that instant the block breaks away and starts to
 * slide, and — because μ_k < μ_s — the friction force drops DISCONTINUOUSLY to
 * μ_k N, so the block doesn't just barely creep, it jumps straight to a finite
 * acceleration a = g(sinθ − μ_k cosθ).
 *
 * THE MOMENTS this demo is built to expose:
 *   1. Breakaway is at tanθ = μ_s, INDEPENDENT of mass. Drag the mass dial
 *      across its whole range and the breakaway angle needle does not budge —
 *      most students predict the heavy block lets go sooner. Both mg sinθ (the
 *      pull) and μ_s N = μ_s mg cosθ (the ceiling) scale with m, so m cancels.
 *      The translucent "ghost heavy block" (20 kg) alongside the light one makes
 *      this literal: both let go on the SAME frame.
 *   2. The friction force is discontinuous at breakaway. Watch the f_s bar climb
 *      right up to the f_max line, then — the moment you cross θ_crit — collapse
 *      to the shorter kinetic value. That drop is what makes a block "let go."
 *      The friction-vs-θ SAWTOOTH plot renders exactly that discontinuity.
 *   3. HYSTERESIS. Once sliding, the block does NOT re-stick at θ_crit; it keeps
 *      going until tanθ < μ_k (the smaller kinetic angle). The gap between the
 *      breakaway angle arctan(μ_s) and the re-stick angle arctan(μ_k) is the
 *      μ_s/μ_k gap made visible.
 *
 * Everything is SI internally. The single default mode carries the whole story.
 * A preset toggle adds the L11(II) two-block stacked case, where the bottom
 * block's normal correctly carries the top block's weight, N₁=(m₁+m₂)g cosθ,
 * and the coupled "slide together vs top-slides-off" outcome is resolved from
 * the two interface critical angles.
 *
 * Self-contained: own canvas + rAF loop + ResizeObserver, live numeric readouts
 * pushed through a throttled state so React doesn't churn every frame. The
 * sawtooth plot is a Plotly figure driven by the same physics helpers.
 *
 * Hook-free default export: it dispatches to a single child so the Rules of
 * Hooks are never at risk from the mode switch.
 */

const G = 9.81;              // m/s^2
const DEG = Math.PI / 180;

// ── palette (hex for canvas; tailwind usna-* classes for chrome) ────────────
const NAVY = '#00205B';
const GOLD = '#C5B783';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const GRID = '#1A2332';
const RED = '#E06C6C';       // friction (opposes motion / impending motion)
const BLUE = '#5B9BD5';      // normal force
const GREEN = '#7FB77E';     // weight components
const WHITE = '#FFFFFF';

const PRESETS = {
  single: { label: 'Single block' },
  stacked: { label: 'Two-block stack (L11 II)' },
};

// Material μ_s/μ_k pairs (representative textbook values). "Custom" lets the
// sliders roam freely; picking a named material snaps both coefficients.
const MATERIALS = {
  custom: { label: 'Custom', muS: null, muK: null },
  rubber: { label: 'Rubber on concrete', muS: 1.0, muK: 0.8 },
  wood: { label: 'Wood on wood', muS: 0.5, muK: 0.35 },
  ice: { label: 'Ice on ice', muS: 0.1, muK: 0.03 },
  teflon: { label: 'Teflon on steel', muS: 0.04, muK: 0.04 },
};

const GHOST_MASS = 20;       // kg — the heavy ghost block for the mass-independence proof

const DEFAULTS = {
  preset: 'single',
  material: 'custom',
  angle: 15,      // deg
  muS: 0.60,
  muK: 0.40,
  mass: 4,        // kg (bottom / only block)
  // stacked extras: top block sits on bottom block
  massTop: 2,     // kg
  muSTop: 0.30,   // μ_s at the block-on-block interface
  muKTop: 0.20,
  showGhost: false, // heavy-block comparison is opt-in (off = a single clean block)
  spread: false,    // stacked: draw the two FBDs offset so their arrows don't overlap
};

// ── hook-free wrapper: keeps the default export dispatch dead simple ─────────
export default function FrictionIncline({ mode = 'default' }) {
  return <FrictionInclineSim mode={mode} />;
}

// ═════════════════════════════════════════════════════════════════════════════
// The one working component (owns every hook).
// ═════════════════════════════════════════════════════════════════════════════
function FrictionInclineSim({ mode }) {
  const { dark } = useTheme();
  const [preset, setPreset] = useState(DEFAULTS.preset);
  const [material, setMaterial] = useState(DEFAULTS.material);
  const [angle, setAngle] = useState(DEFAULTS.angle);
  const [muS, setMuS] = useState(DEFAULTS.muS);
  const [muK, setMuK] = useState(DEFAULTS.muK);
  const [mass, setMass] = useState(DEFAULTS.mass);
  const [massTop, setMassTop] = useState(DEFAULTS.massTop);
  const [muSTop, setMuSTop] = useState(DEFAULTS.muSTop);
  const [muKTop, setMuKTop] = useState(DEFAULTS.muKTop);
  const [showGhost, setShowGhost] = useState(DEFAULTS.showGhost);
  const [spread, setSpread] = useState(DEFAULTS.spread);

  const isStacked = preset === 'stacked';

  // Live readouts published from the animation loop (throttled). `sliding` and
  // `slidingTop` are the ACTUAL sliding state — hysteresis means these can be
  // true below θ_crit while the block runs down.
  const [live, setLive] = useState({
    v: 0, s: 0, sliding: false, vTop: 0, sTop: 0, slidingTop: false, vGhost: 0, slidingGhost: false,
  });

  // Slow-motion replay: when armed, the sim runs at reduced time-scale and the
  // block is dropped back to rest so the breakaway plays out from the top.
  const [replay, setReplay] = useState(false);

  // When the student changes a coefficient by hand, we're no longer on a named
  // material preset.
  const setMuSManual = (v) => { setMuS(Math.max(v, muK)); setMaterial('custom'); };
  const setMuKManual = (v) => { setMuK(Math.min(v, muS)); setMaterial('custom'); };
  const setMuSTopManual = (v) => setMuSTop(Math.max(v, muKTop));
  const setMuKTopManual = (v) => setMuKTop(Math.min(v, muSTop));

  const pickMaterial = (key) => {
    setMaterial(key);
    const mat = MATERIALS[key];
    if (mat.muS != null) { setMuS(mat.muS); setMuK(mat.muK); }
  };

  const reset = () => {
    setPreset(DEFAULTS.preset);
    setMaterial(DEFAULTS.material);
    setAngle(DEFAULTS.angle);
    setMuS(DEFAULTS.muS); setMuK(DEFAULTS.muK); setMass(DEFAULTS.mass);
    setMassTop(DEFAULTS.massTop); setMuSTop(DEFAULTS.muSTop); setMuKTop(DEFAULTS.muKTop);
    setShowGhost(DEFAULTS.showGhost);
    setSpread(DEFAULTS.spread);
    setReplay(false);
    // also relocate the blocks back to the top of the incline, at rest
    simRef.current = {
      s: 0, v: 0, sliding: false,
      sTop: 0, vTop: 0, slidingTop: false,
      sGhost: 0, vGhost: 0, slidingGhost: false,
    };
  };

  // ── physics (angle-only quantities; mass cancels out of the breakaway) ──────
  const th = angle * DEG;
  const sinT = Math.sin(th), cosT = Math.cos(th);
  const thetaCrit = Math.atan(muS) / DEG;        // breakaway angle, tanθ = μ_s
  const thetaStick = Math.atan(muK) / DEG;       // re-stick angle, tanθ = μ_k  (< θ_crit)
  const N = mass * G * cosT;                       // normal force (single block)
  const pull = mass * G * sinT;                    // down-slope component of weight
  const fMax = muS * N;                            // static friction ceiling
  const atRest = angle < thetaCrit;               // is the (bottom) block still stuck (from rest)?
  // Static friction actually mobilized while stuck = the pull (Newton's 2nd law, a=0),
  // but never above the ceiling.
  const fStatic = Math.min(pull, fMax);
  const fKinetic = muK * N;                        // once sliding
  const fNow = atRest ? fStatic : fKinetic;
  const accel = atRest ? 0 : G * (sinT - muK * cosT); // = fnet/m once sliding

  // ── stacked-preset critical angles (the FIX lives here) ─────────────────────
  // Two interfaces:
  //  • ground interface (bottom block on ramp): normal carries BOTH weights,
  //    N₁ = (m₁+m₂) g cosθ.  Ground breakaway of the coupled pair is
  //    tanθ = μ_s(ground) — mass still cancels, (m₁+m₂) drops out.
  //  • upper interface (top block on bottom block): normal is only m₂ g cosθ,
  //    top breaks away (slides on the bottom) at tanθ = μ_s(top).
  // Whichever critical angle is SMALLER happens first:
  //  • if θ_crit,top < θ_crit,ground → the top block slides off first while the
  //    bottom stays stuck.
  //  • otherwise → the pair slides together as a rigid unit.
  const thetaCritGround = thetaCrit;              // uses μ_s (the ground pair)
  const thetaCritTop = Math.atan(muSTop) / DEG;   // uses μ_s(top)
  const thetaStickTop = Math.atan(muKTop) / DEG;
  const topSlidesFirst = thetaCritTop < thetaCritGround;
  const N1_stacked = (mass + massTop) * G * cosT;  // bottom block's normal WITH top weight
  const fMaxGround = muS * N1_stacked;             // ground friction ceiling (coupled)
  const pullPair = (mass + massTop) * G * sinT;    // down-slope pull on the pair

  // ── refs so the rAF loop reads fresh values without re-subscribing ──────────
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const paramRef = useRef({});
  paramRef.current = {
    angle, muS, muK, mass, isStacked, massTop, muSTop, muKTop, replay,
    thetaCrit, thetaCritTop, thetaCritGround, thetaStick, thetaStickTop,
    topSlidesFirst, showGhost, spread, ghostMass: GHOST_MASS,
  };
  // Simulation state that survives frames. Each block tracks position, velocity,
  // and a boolean `sliding` flag so hysteresis is a real latch (not recomputed
  // from angle every frame).
  const simRef = useRef({
    s: 0, v: 0, sliding: false,
    sTop: 0, vTop: 0, slidingTop: false,
    sGhost: 0, vGhost: 0, slidingGhost: false,
  });

  // When replay is armed, snap every block back to the top, at rest, un-slid.
  useEffect(() => {
    if (replay) simRef.current = {
      s: 0, v: 0, sliding: false,
      sTop: 0, vTop: 0, slidingTop: false,
      sGhost: 0, vGhost: 0, slidingGhost: false,
    };
  }, [replay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, last = 0, pub = 0;

    const resize = () => {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
    };

    const draw = (now) => {
      const p = paramRef.current;
      const sim = simRef.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const timeScale = p.replay ? 0.28 : 1;      // slow-motion factor
      const edt = dt * timeScale;

      const thr = p.angle * DEG;
      const s = Math.sin(thr), c = Math.cos(thr);

      // Generic single-block latch integrator (shared by main + ghost).
      const advance = (obj, muK, thetaCrit, thetaStick) => {
        if (!obj.sliding) {
          // stuck: does it break away?
          if (p.angle >= thetaCrit) obj.sliding = true;
        }
        if (obj.sliding) {
          const a = G * (s - muK * c);            // may be negative in the hysteresis band
          obj.v += a * edt;
          if (obj.v <= 0) {
            // it has decelerated to (or below) rest along the slope
            obj.v = 0;
            // re-stick only if friction can now actually hold it (tanθ < μ_k)
            if (p.angle < thetaStick) { obj.sliding = false; }
          }
          obj.s += obj.v * edt;
          if (obj.s < 0) obj.s = 0;
        } else {
          obj.v = 0;
        }
      };

      // ── bottom / single block ────────────────────────────────────────────
      // In the stacked preset the bottom block only breaks away at the GROUND
      // critical angle (which uses the coupled normal — but m cancels so the
      // angle is the same arctan(μ_s)); its kinetic accel while the top still
      // rides it is the coupled-pair value g(sinθ − μ_k cosθ) (again m-free).
      const groundCrit = p.isStacked ? p.thetaCritGround : p.thetaCrit;
      advance(sim, p.muK, groundCrit, p.thetaStick);

      // ── stacked TOP block (slides on the bottom via its own μ) ────────────
      if (p.isStacked) {
        advance(
          { get sliding() { return sim.slidingTop; }, set sliding(v) { sim.slidingTop = v; },
            get v() { return sim.vTop; }, set v(v) { sim.vTop = v; },
            get s() { return sim.sTop; }, set s(v) { sim.sTop = v; } },
          p.muKTop, p.thetaCritTop, p.thetaStickTop
        );
      } else {
        sim.slidingTop = false; sim.vTop = 0; sim.sTop = 0;
      }

      // ── ghost heavy block (single-block preset only) ──────────────────────
      if (!p.isStacked && p.showGhost) {
        advance(
          { get sliding() { return sim.slidingGhost; }, set sliding(v) { sim.slidingGhost = v; },
            get v() { return sim.vGhost; }, set v(v) { sim.vGhost = v; },
            get s() { return sim.sGhost; }, set s(v) { sim.sGhost = v; } },
          p.muK, p.thetaCrit, p.thetaStick
        );
      } else {
        sim.slidingGhost = false; sim.vGhost = 0; sim.sGhost = 0;
      }

      // Recycle blocks that run off the bottom so the slide loops (only when
      // they're actually moving off the ramp).
      const RUN = 4.2; // meters of travel before recycling
      if (sim.s > RUN) { sim.s = 0; if (sim.sliding) sim.v = 0.001; }
      if (sim.sTop > RUN) { sim.sTop = 0; if (sim.slidingTop) sim.vTop = 0.001; }
      if (sim.sGhost > RUN) { sim.sGhost = 0; if (sim.slidingGhost) sim.vGhost = 0.001; }

      render(ctx, W, H, p, sim);

      // publish readouts ~12 fps
      if (now - pub > 80) {
        pub = now;
        setLive({
          v: sim.v, s: sim.s, sliding: sim.sliding,
          vTop: sim.vTop, sTop: sim.sTop, slidingTop: sim.slidingTop,
          vGhost: sim.vGhost, slidingGhost: sim.slidingGhost,
        });
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ── sawtooth friction-vs-θ curve (the highest-value artifact) ───────────────
  // f(θ) = mg sinθ (static, matched to the pull) up to θ_crit, then it DROPS to
  // μ_k mg cosθ (kinetic) and falls with cosθ thereafter. We build both branches
  // as separate traces with a visible vertical discontinuity, and a live dot at
  // the current angle riding whichever branch is active.
  const sawtooth = buildSawtooth({
    mass: isStacked ? mass + massTop : mass,
    muS, muK, thetaCrit, angle,
    sliding: live.sliding, dark,
    // in stacked preset the plotted curve is the GROUND interface (pair).
  });

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {/* preset selector */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Configuration</div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(PRESETS).map(([key, pr]) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
                  preset === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        {/* material presets → set μ_s/μ_k pairs */}
        <div className="mb-4">
          <div className="text-usna-text text-sm font-medium mb-2">Surface pair</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(MATERIALS).map(([key, mat]) => (
              <button
                key={key}
                onClick={() => pickMaterial(key)}
                className={`px-2 py-1.5 rounded text-xs text-left border transition-colors ${
                  material === key
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                {mat.label}
              </button>
            ))}
          </div>
        </div>

        {/* fine tilt — sub-degree resolution near breakaway */}
        <Slider
          label="Incline angle θ"
          value={Number(angle.toFixed(1))}
          min={0} max={60} step={0.1} unit="°"
          onChange={(v) => setAngle(v)}
        />
        <div className="-mt-2 mb-3 flex gap-2">
          <button
            onClick={() => setAngle((a) => Math.max(0, Math.round((a - 0.1) * 10) / 10))}
            className="flex-1 py-1 rounded text-xs font-mono bg-usna-deep text-usna-muted border border-usna-grid hover:text-usna-gold transition-colors"
          >−0.1°</button>
          <button
            onClick={() => setAngle(Number(thetaCrit.toFixed(1)))}
            className="flex-1 py-1 rounded text-xs bg-usna-deep text-usna-muted border border-usna-grid hover:text-usna-gold transition-colors"
          >→ θ_crit</button>
          <button
            onClick={() => setAngle((a) => Math.min(60, Math.round((a + 0.1) * 10) / 10))}
            className="flex-1 py-1 rounded text-xs font-mono bg-usna-deep text-usna-muted border border-usna-grid hover:text-usna-gold transition-colors"
          >+0.1°</button>
        </div>

        <Slider label="Static coeff. μ_s" value={muS} min={0.02} max={1.2} step={0.01} unit=""
                onChange={setMuSManual} />
        <Slider label="Kinetic coeff. μ_k" value={muK} min={0.02} max={1.2} step={0.01} unit=""
                onChange={setMuKManual} />
        <Slider label="Block mass m" value={mass} min={0.5} max={20} step={0.5} unit="kg"
                onChange={setMass} />

        {isStacked && (
          <div className="mt-1 mb-2 border-t border-usna-grid pt-3">
            <div className="text-usna-text text-sm font-medium mb-2">Top block / upper interface</div>
            <Slider label="Top mass m₂" value={massTop} min={0.5} max={20} step={0.5} unit="kg"
                    onChange={setMassTop} />
            <Slider label="Upper μ_s" value={muSTop} min={0.02} max={1.2} step={0.01} unit=""
                    onChange={setMuSTopManual} />
            <Slider label="Upper μ_k" value={muKTop} min={0.02} max={1.2} step={0.01} unit=""
                    onChange={setMuKTopManual} />
          </div>
        )}

        {/* ghost heavy block toggle (single-block only) */}
        {!isStacked && (
          <label className="mt-1 mb-1 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showGhost}
              onChange={(e) => setShowGhost(e.target.checked)}
              className="accent-usna-gold"
            />
            <span className="text-usna-text text-sm">Compare with a 20 kg block (same breakaway angle)</span>
          </label>
        )}

        {/* offset the two free-body diagrams (stacked only) */}
        {isStacked && (
          <label className="mt-1 mb-1 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={spread}
              onChange={(e) => setSpread(e.target.checked)}
              className="accent-usna-gold"
            />
            <span className="text-usna-text text-sm">Separate the two free-body diagrams</span>
          </label>
        )}

        {/* slow-motion replay */}
        <div className="mt-2 border-t border-usna-grid pt-3">
          <button
            onClick={() => setReplay((r) => !r)}
            className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
              replay
                ? 'bg-usna-gold text-usna-navy'
                : 'bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {replay ? '■ Stop replay' : '⏵ Slow-motion breakaway'}
          </button>
          <p className="text-usna-muted text-xs mt-1.5 leading-snug">
            Drops the block(s) to the top and plays the slide at ~1/4 speed.
          </p>
        </div>

        {/* live force balance */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          {isStacked ? (
            <>
              <Readout label="Bottom normal N₁ = (m₁+m₂)g cosθ" value={N1_stacked.toFixed(1)} unit="N" />
              <Readout label="Ground pull (m₁+m₂)g sinθ" value={pullPair.toFixed(1)} unit="N" />
              <Readout label="Ground ceiling μ_s N₁" value={fMaxGround.toFixed(1)} unit="N" />
            </>
          ) : (
            <>
              <Readout label="Normal N" value={N.toFixed(1)} unit="N" />
              <Readout label="Down-slope mg sinθ" value={pull.toFixed(1)} unit="N" />
              <Readout label={live.sliding ? 'Kinetic friction f_k' : 'Static friction f_s'}
                       value={fNow.toFixed(1)} unit="N" />
              <FrictionBar fStatic={fStatic} fKinetic={fKinetic} fMax={fMax} atRest={!live.sliding} />
            </>
          )}
          <div className="mt-2 pt-2 border-t border-usna-grid">
            <Readout label="Breakaway θ_crit = arctan μ_s" value={thetaCrit.toFixed(1)} unit="°" />
            <Readout label="Re-stick θ = arctan μ_k" value={thetaStick.toFixed(1)} unit="°" />
            {!isStacked && <Readout label="Acceleration a" value={accel.toFixed(2)} unit="m/s²" />}
            {live.sliding && <Readout label="Speed v" value={live.v.toFixed(2)} unit="m/s" />}
          </div>
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div
          ref={wrapRef}
          className="relative bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
          style={{ height: 420 }}
        >
          <canvas ref={canvasRef} className="block" />
          {/* status banner */}
          <div className="absolute top-2 left-3 text-xs font-mono space-y-0.5 pointer-events-none">
            <div style={{ color: GOLD }}>
              θ = {angle.toFixed(1)}°  ·  θ_crit = {thetaCrit.toFixed(1)}°  ·  re-stick {thetaStick.toFixed(1)}°
            </div>
            <div style={{ color: live.sliding ? RED : MUTED }}>
              {live.sliding
                ? (angle < thetaStick ? 'SLIDING (coasting — will re-stick)' : 'SLIDING  a = g(sinθ − μ_k cosθ)')
                : 'STUCK  (f_s < μ_s N)'}
            </div>
            {isStacked ? (
              <div style={{ color: live.slidingTop ? RED : MUTED }}>
                {topSlidesFirst
                  ? `top lets go first at ${thetaCritTop.toFixed(1)}° · `
                  : `pair slides together at ${thetaCritGround.toFixed(1)}° · `}
                top block: {live.slidingTop ? 'SLIDING' : 'stuck'}
              </div>
            ) : (showGhost && (
              <div style={{ color: live.slidingGhost ? RED : MUTED }}>
                20 kg ghost: {live.slidingGhost ? 'SLIDING' : 'stuck'} — same θ_crit (mass cancels)
              </div>
            ))}
          </div>
        </div>

        {/* the sawtooth friction-vs-θ plot */}
        <div className="bg-usna-card border border-usna-grid rounded-lg p-3 min-w-0 overflow-hidden" style={{ height: 300 }}>
          <IntensityPlot traces={sawtooth.traces} layoutOverrides={sawtooth.layout} />
        </div>

        <InfoPanel {...(INFO[mode] || INFO.default)} />
      </div>
    </div>
  );
}

// ── small stacked bar: f_s (or f_k) against the μ_s N ceiling ────────────────
function FrictionBar({ fStatic, fKinetic, fMax, atRest }) {
  const scale = Math.max(fMax, fKinetic, 1e-6);
  const fillFrac = Math.min(1, (atRest ? fStatic : fKinetic) / scale);
  const ceilFrac = Math.min(1, fMax / scale); // == 1 by construction, but explicit
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-usna-muted mb-1">
        <span>{atRest ? 'f_s' : 'f_k'} vs ceiling μ_s N</span>
        <span className="font-mono">
          {(atRest ? fStatic : fKinetic).toFixed(1)} / {fMax.toFixed(1)} N
        </span>
      </div>
      <div className="relative h-3 rounded bg-usna-deep border border-usna-grid overflow-hidden">
        {/* the fill: gold when static & near ceiling, drops to kinetic bar when sliding */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-150"
          style={{
            width: `${fillFrac * 100}%`,
            background: atRest ? GOLD : RED,
          }}
        />
        {/* the μ_s N ceiling tick */}
        <div
          className="absolute inset-y-0"
          style={{ left: `${ceilFrac * 100}%`, width: 2, background: TEXT, opacity: 0.85 }}
        />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sawtooth friction-vs-θ plot builder (pure — no hooks).
// Static branch: f = mg sinθ, θ ∈ [0, θ_crit].   (friction MATCHES the pull)
// Kinetic branch: f = μ_k mg cosθ, θ ∈ [θ_crit, 90°].  (the discontinuous drop)
// The vertical gap at θ_crit between mg sinθ_crit (= μ_s mg cosθ_crit) and
// μ_k mg cosθ_crit is the μ_s/μ_k jump — the whole point.
// ═════════════════════════════════════════════════════════════════════════════
function buildSawtooth({ mass, muS, muK, thetaCrit, angle, sliding, dark = true }) {
  // theme-aware ink so the legend, annotation, and marker lines stay legible on
  // either the dark or the light plot background
  const ink = dark ? TEXT : '#1A1A2E';
  const faint = dark ? 'rgba(240,236,227,0.35)' : 'rgba(30,30,60,0.4)';
  const zl = dark ? '#2A3442' : '#C8C4BC';
  const Nsamp = 120;
  const thetaMax = 70; // degrees plotted
  const staticX = [], staticY = [];
  const kineticX = [], kineticY = [];
  for (let i = 0; i <= Nsamp; i++) {
    const deg = (i / Nsamp) * thetaMax;
    const r = deg * DEG;
    if (deg <= thetaCrit) { staticX.push(deg); staticY.push(mass * G * Math.sin(r)); }
    if (deg >= thetaCrit) { kineticX.push(deg); kineticY.push(muK * mass * G * Math.cos(r)); }
  }

  // the discontinuity drop as a dashed vertical connector at θ_crit
  const rc = thetaCrit * DEG;
  const fStaticTop = muS * mass * G * Math.cos(rc); // == mg sinθ_crit
  const fKineticTop = muK * mass * G * Math.cos(rc);

  // live dot: rides the active branch at the current angle
  const ra = angle * DEG;
  const onKinetic = sliding || angle >= thetaCrit;
  const dotY = onKinetic ? muK * mass * G * Math.cos(ra) : mass * G * Math.sin(ra);

  const traces = [
    {
      x: staticX, y: staticY, type: 'scatter', mode: 'lines',
      line: { color: GOLD, width: 3 }, name: 'static  f = mg sinθ', hoverinfo: 'skip',
    },
    {
      x: kineticX, y: kineticY, type: 'scatter', mode: 'lines',
      line: { color: RED, width: 3 }, name: 'kinetic  f = μ_k mg cosθ', hoverinfo: 'skip',
    },
    // discontinuity connector (dashed, the "drop")
    {
      x: [thetaCrit, thetaCrit], y: [fStaticTop, fKineticTop], type: 'scatter', mode: 'lines',
      line: { color: MUTED, width: 1.5, dash: 'dot' }, hoverinfo: 'skip', showlegend: false,
    },
    // live tracking dot
    {
      x: [angle], y: [dotY], type: 'scatter', mode: 'markers',
      marker: { color: WHITE, size: 11, line: { color: onKinetic ? RED : GOLD, width: 3 } },
      hoverinfo: 'skip', showlegend: false,
    },
  ];

  const layout = {
    showlegend: true,
    legend: { orientation: 'h', y: 1.18, x: 0, font: { size: 11, color: ink } },
    margin: { l: 56, r: 14, t: 8, b: 40 },
    xaxis: {
      title: { text: 'Incline angle θ (°)' }, range: [0, thetaMax], autorange: false,
      zeroline: true, zerolinecolor: zl,
    },
    yaxis: {
      title: { text: 'Friction force f (N)' }, range: undefined, autorange: true,
      zeroline: true, zerolinecolor: zl,
    },
    shapes: [{
      type: 'line', xref: 'x', yref: 'paper', x0: thetaCrit, x1: thetaCrit, y0: 0, y1: 1,
      line: { color: faint, width: 1, dash: 'dash' },
    }],
    annotations: [{
      x: thetaCrit, y: 1, yref: 'paper', text: `θ_crit ${thetaCrit.toFixed(1)}°`,
      showarrow: false, font: { color: ink, size: 11 }, xanchor: 'left', yanchor: 'top',
      xshift: 4,
    }],
  };

  return { traces, layout };
}

// ═════════════════════════════════════════════════════════════════════════════
// Canvas render — incline, block(s) [+ ghost], and free-body force vectors.
// ═════════════════════════════════════════════════════════════════════════════
function render(ctx, W, H, p, sim) {
  const thr = p.angle * DEG;
  const s = Math.sin(thr), c = Math.cos(thr);

  ctx.clearRect(0, 0, W, H);

  // Ramp geometry: right-triangle with the hinge (pivot) at the lower-left.
  const padL = 46, padR = 24, padB = 54;
  const pivotX = padL;
  const pivotY = H - padB;
  const rampLen = Math.min((W - padL - padR), (H - padB - 30) / Math.max(s, 0.02)); // px along the slope
  const L = Math.min(rampLen, W - padL - padR, 640);
  // Unit vectors: up-slope (dirUp) and outward-normal (dirN), screen coords (+y down).
  const upx = c, upy = -s;          // pointing up the incline
  const dnx = -c, dny = s;          // down the incline (direction of sliding)
  // Outward normal (away from the wedge surface, pointing up-left): (-s, -c).
  const ncx = -s, ncy = -c;

  const topX = pivotX + upx * L;    // top corner of the ramp along the slope
  const topY = pivotY + upy * L;

  // ── draw the wedge (filled triangle) ────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);       // hinge
  ctx.lineTo(topX, topY);           // top of slope
  ctx.lineTo(topX, pivotY);         // drop straight down to the base
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,32,91,0.55)';
  ctx.fill();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ground line
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, pivotY);
  ctx.lineTo(W - 12, pivotY);
  ctx.stroke();

  // angle arc + label at the hinge
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 30, -thr, 0);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = '13px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${p.angle.toFixed(1)}°`, pivotX + 36, pivotY - 14);

  const blockSize = 40;
  const RAMP_M = 5.0;               // treat the drawn ramp as ~5 m long for motion
  const pxPerM = L / RAMP_M;

  // ── place a block a distance `travel` (m) down-slope from a start point ──
  const drawBlock = (startAlong, travelM, opts) => {
    const startPx = pivotX + upx * (L * startAlong);
    const startPy = pivotY + upy * (L * startAlong);
    const travelPx = Math.min(travelM * pxPerM, L * startAlong - 4);
    const cx0 = startPx + dnx * travelPx;
    const cy0 = startPy + dny * travelPx;
    const half = blockSize / 2;
    // block center sits one half-height off the surface along the normal (+ any lift)
    const cx = cx0 + ncx * (half + (opts.lift || 0));
    const cy = cy0 + ncy * (half + (opts.lift || 0));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-thr); // align faces with the slope
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    ctx.fillStyle = opts.color;
    ctx.strokeStyle = opts.sliding ? RED : GOLD;
    ctx.lineWidth = 2;
    const hs = opts.hscale || 1;
    ctx.fillRect(-half, -half * hs, blockSize, blockSize * hs);
    ctx.strokeRect(-half, -half * hs, blockSize, blockSize * hs);
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.labelColor || NAVY;
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.tag, 0, 0);
    ctx.restore();

    return { cx, cy, surfX: cx0, surfY: cy0 };
  };

  const geom = { dnx, dny, ncx, ncy };

  // Force scale (px per newton), sized so the LABELED block's weight arrow is a
  // readable length. The heavy ghost block is excluded here (it would shrink the
  // real block's arrows); its own arrows are clamped instead (see drawFBD).
  const primaryMass = p.isStacked ? (p.mass + p.massTop) : p.mass;
  const FS = Math.min(2.2, 96 / Math.max(1, primaryMass * G));

  if (!p.isStacked) {
    // ── single block (+ optional ghost heavy block side by side) ─────────────
    // We nudge the two blocks to slightly different along-slope start fractions
    // so their FBDs don't overlap.
    if (p.showGhost) {
      // ghost heavy block — translucent, to the "upper" start; proves same θ_crit
      const gb = drawBlock(0.82, sim.sGhost, {
        color: 'rgba(224,108,108,0.16)', tag: '20 kg', sliding: sim.slidingGhost,
        alpha: 0.9, labelColor: TEXT,
      });
      drawFBD(ctx, gb.cx, gb.cy, p, thr, sim.slidingGhost, {
        mass: p.ghostMass, muS: p.muS, muK: p.muK, ...geom, compact: true, faded: true, FS,
      });
    }
    const b = drawBlock(0.50, sim.s, {
      color: 'rgba(197,183,131,0.30)', tag: `${p.mass} kg`, sliding: sim.sliding,
    });
    drawFBD(ctx, b.cx, b.cy, p, thr, sim.sliding, {
      mass: p.mass, muS: p.muS, muK: p.muK, ...geom, FS,
    });
  } else {
    // ── two-block stack (bottom carries the top's weight) ────────────────────
    const startFrac = 0.62;
    const bottom = drawBlock(startFrac, sim.s, {
      color: 'rgba(91,155,213,0.28)', tag: 'm₁', sliding: sim.sliding,
    });
    // Top block: along-slope position = bottom's travel PLUS its own extra slide,
    // stacked one block-height further out along the normal.
    const startPx = pivotX + upx * (L * startFrac);
    const startPy = pivotY + upy * (L * startFrac);
    const travelPx = Math.min((sim.s + sim.sTop) * pxPerM, L * startFrac - 4);
    const half = blockSize / 2;
    const bcx = startPx + dnx * travelPx + ncx * half;
    const bcy = startPy + dny * travelPx + ncy * half;
    const tcx = bcx + ncx * blockSize;
    const tcy = bcy + ncy * blockSize;
    ctx.save();
    ctx.translate(tcx, tcy);
    ctx.rotate(-thr);
    ctx.fillStyle = 'rgba(197,183,131,0.30)';
    ctx.strokeStyle = sim.slidingTop ? RED : GOLD;
    ctx.lineWidth = 2;
    ctx.fillRect(-half, -half, blockSize, blockSize);
    ctx.strokeRect(-half, -half, blockSize, blockSize);
    ctx.fillStyle = NAVY;
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('m₂', 0, 0);
    ctx.restore();

    // Bottom-block FBD uses the COUPLED normal N₁ = (m₁+m₂)g cosθ and the
    // combined weight arrow; the top block gets the standard single-interface FBD.
    // When "spread" is on, the two FBDs are drawn offset along the slope (bottom
    // down-slope, top up-slope) with leader lines, so their arrows don't overlap
    // and each can carry its labels.
    const spr = p.spread ? blockSize * 1.9 : 0;
    const bFx = bottom.cx + dnx * spr, bFy = bottom.cy + dny * spr;
    const tFx = tcx - dnx * spr, tFy = tcy - dny * spr;
    if (p.spread) {
      ctx.save();
      ctx.strokeStyle = 'rgba(139,140,142,0.55)';
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bottom.cx, bottom.cy); ctx.lineTo(bFx, bFy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tcx, tcy); ctx.lineTo(tFx, tFy); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    drawFBD(ctx, bFx, bFy, p, thr, sim.sliding, {
      mass: p.mass, muS: p.muS, muK: p.muK, ...geom, compact: !p.spread, FS,
      supportedMass: p.massTop, // the extra weight pressing down through the top block
    });
    drawFBD(ctx, tFx, tFy, p, thr, sim.slidingTop, {
      mass: p.massTop, muS: p.muSTop, muK: p.muKTop, ...geom, compact: !p.spread, FS,
    });
  }
}

// ── free-body diagram at a block center ──────────────────────────────────────
// `supportedMass` (stacked bottom block): the top block's weight also presses
// into the surface, so N carries (m + supportedMass) g cosθ and the weight arrow
// shown is the TOTAL (m + supportedMass) g pushing straight down.
function drawFBD(ctx, cx, cy, p, thr, sliding, o) {
  const s = Math.sin(thr), c = Math.cos(thr);
  const supported = o.supportedMass || 0;
  const mTotalOnSurface = o.mass + supported;     // mass whose weight the surface supports
  const N = mTotalOnSurface * G * c;              // FIX: includes the top block's weight
  const pull = mTotalOnSurface * G * s;           // down-slope pull the friction must fight
  const fMax = o.muS * N;
  const f = sliding ? o.muK * N : Math.min(pull, fMax);

  const FS = o.FS ?? 2.0;                 // px per newton (scene-adaptive; see render)
  const Wmag = mTotalOnSurface * G;      // full (combined) weight magnitude shown

  // Clamp any single arrow to a maximum length so the heavy ghost block (drawn at
  // the same scale as the labeled block) cannot run off the canvas.
  const CAP = 116;
  const clamp = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    if (len <= CAP || len === 0) return [dx, dy];
    const k = CAP / len; return [dx * k, dy * k];
  };

  const alpha = o.faded ? 0.5 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  // weight straight down (combined when supporting a top block)
  const [wdx, wdy] = clamp(0, Wmag * FS);
  drawArrow(ctx, {
    x: cx, y: cy, dx: wdx, dy: wdy, color: GREEN, width: 3,
    label: o.compact ? '' : (supported ? '(m₁+m₂)g' : 'mg'), head: 9,
  });

  if (!o.compact) {
    drawDashed(ctx, cx, cy, o.dnx * pull * FS, o.dny * pull * FS, GREEN);
    drawDashed(ctx, cx, cy, -o.ncx * N * FS, -o.ncy * N * FS, GREEN);
  }

  // normal force, outward along the normal (carries both weights when stacked)
  const [ndx, ndy] = clamp(o.ncx * N * FS, o.ncy * N * FS);
  drawArrow(ctx, {
    x: cx, y: cy, dx: ndx, dy: ndy, color: BLUE, width: 3,
    label: o.compact ? '' : (supported ? 'N₁' : 'N'), head: 9,
  });

  // friction — opposes impending / actual motion, i.e. points up the slope
  const upx = -o.dnx, upy = -o.dny;
  const [fdx, fdy] = clamp(upx * f * FS, upy * f * FS);
  drawArrow(ctx, {
    x: cx, y: cy, dx: fdx, dy: fdy,
    color: sliding ? RED : GOLD, width: 3,
    label: o.compact ? '' : (sliding ? 'f_k' : 'f_s'), head: 9,
  });

  ctx.restore();
}

function drawDashed(ctx, x, y, dx, dy, color) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
  ctx.restore();
}

const INFO = {
  default: {
    title: 'Friction on an incline: the breakaway',
    description:
      'Raise the angle in small steps. While the block is stuck, static friction f_s grows to exactly cancel the down-slope pull mg sinθ, so the gold bar climbs toward the μ_s N ceiling (white tick). When tanθ reaches μ_s the bar hits the ceiling and the block lets go. Three results are worth watching. First, the breakaway angle θ_crit = arctan(μ_s) does not depend on mass: turn on the 20 kg comparison block and it lets go on the same frame as the light one, because both the pull and the ceiling scale with the mass. Second, the friction is discontinuous: the friction-vs-θ plot rises as mg sinθ, then drops to μ_k mg cosθ at θ_crit, and the white dot rides whichever branch is active. Third, there is hysteresis: once it is sliding, lowering the angle keeps it moving below θ_crit, and it re-sticks only when tanθ falls below μ_k. In the two-block stack the bottom block\'s normal carries both weights, N₁ = (m₁+m₂)g cosθ, and whichever interface has the smaller arctan(μ_s) lets go first.',
    equation: String.raw`\tan\theta_{\text{crit}} = \mu_s,\quad \tan\theta_{\text{re-stick}} = \mu_k \;\Rightarrow\; a = g(\sin\theta - \mu_k\cos\theta)`,
  },
};
