import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import IntensityPlot from '@shared/components/IntensityPlot';
import { setupCanvas } from '@shared/lib/canvas';
import { drawArrow } from '@shared/lib/vectorArrow';

/**
 * D01 · 1D Motion Grapher — L1 (default), L3 (area), L8 (force).
 *
 * Three time-synchronized panels stacked in one figure — x(t), v(t), a(t) —
 * sharing a single time axis so a scrub line spans all three. The motion is
 * built by numerically integrating a(t), so every mode/preset flows through the
 * same pipeline and the three curves are guaranteed consistent (v = ∫a, x = ∫v).
 *
 *   default : pick a preset motion; scrub/play the timeline and read x, v, a.
 *             The "Up and back" preset is the L1 moment — v goes negative while
 *             the cart is still at positive x.
 *   area    : shade the area under v(t) up to the scrub time; the running
 *             integral equals Δx. Same for a(t) vs Δv. (Hard dep: L3, Aug 21.)
 *   force   : an applied force (released partway) sets a = F/m; releasing the
 *             force zeroes a but the cart keeps its velocity — force controls
 *             acceleration, not velocity.
 *
 * A "cart on a track" strip rides above the three plots: the physical object at
 * now.x, carrying live velocity (blue) and acceleration (green) arrows. You can
 * drag the cart along the track to scrub the timeline (inverse-lookup of the
 * nearest x on x(t)), bidirectional with the time slider. A tangent-slope
 * triangle rides the marker on x(t) and v(t) — its rise/run equals the v/a
 * readout. "Pin current motion" freezes the three curves faded in the
 * background so you can compare presets on the same axes.
 *
 * The plot-linkage layout here is the machinery D24 (angular twin) reuses.
 *
 * RULES OF HOOKS: the default export is a hook-free wrapper that dispatches to a
 * single per-mode child (GrapherView) which owns every hook. No hook is ever
 * called conditionally or after an early return.
 */

const T = 10;          // total time window (s)
const N = 400;         // samples across the window
const GOLD = '#C5B783';
const BLUE = '#5B9BD5';
const GREEN = '#7FB77E';
const RED = '#D9534F';
const NAVY = '#00205B';
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';

const PRESETS = {
  'constant-v': { label: 'Constant velocity', x0: 0, v0: 4, accel: () => 0 },
  'constant-a': { label: 'Constant acceleration', x0: 0, v0: 0, accel: () => 2 },
  'up-back': { label: 'Up and back', x0: 0, v0: 10, accel: () => -2 },
  // Speed-up-then-brake: a > 0 for the first half (accelerating forward), then
  // a < 0 (braking) — the cart decelerates but never reverses, so v stays ≥ 0.
  // Distinct from "up and back", where v goes negative and the cart returns.
  'speed-brake': {
    label: 'Speed up, then brake',
    x0: 0,
    v0: 2,
    accel: (t) => (t < T / 2 ? 3 : -3),
  },
};

// Build t, x, v, a arrays by integrating a(t) (cumulative trapezoid).
function integrate(x0, v0, accelFn) {
  const dt = T / (N - 1);
  const t = new Array(N), a = new Array(N), v = new Array(N), x = new Array(N);
  for (let i = 0; i < N; i++) {
    t[i] = i * dt;
    a[i] = accelFn(t[i]);
  }
  v[0] = v0; x[0] = x0;
  for (let i = 1; i < N; i++) {
    v[i] = v[i - 1] + 0.5 * (a[i] + a[i - 1]) * dt;
    x[i] = x[i - 1] + 0.5 * (v[i] + v[i - 1]) * dt;
  }
  return { t, x, v, a };
}

// Min / max of an array (for scaling the track and the tangent triangle).
function extent(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
}

const DEFAULTS = { preset: 'up-back', force: 10, mass: 2, release: 5 };

// Hook-free wrapper: dispatch to the single per-mode child so hooks never run
// conditionally. (mode only changes which controls/traces the child renders.)
export default function Grapher({ mode = 'default' }) {
  return <GrapherView mode={mode} />;
}

function GrapherView({ mode }) {
  const isForce = mode === 'force';
  const isArea = mode === 'area';

  const [preset, setPreset] = useState(DEFAULTS.preset);
  const [force, setForce] = useState(DEFAULTS.force);
  const [mass, setMass] = useState(DEFAULTS.mass);
  const [release, setRelease] = useState(DEFAULTS.release); // s at which force is removed
  const [scrub, setScrub] = useState(T);                    // current time on the timeline
  const [playing, setPlaying] = useState(false);
  const [pinned, setPinned] = useState(null);               // frozen motion for comparison

  const reset = () => {
    setPreset(DEFAULTS.preset); setForce(DEFAULTS.force); setMass(DEFAULTS.mass);
    setRelease(DEFAULTS.release); setScrub(T); setPlaying(false); setPinned(null);
  };

  // The motion for the current mode.
  const motion = useMemo(() => {
    if (isForce) {
      const a0 = force / mass;
      return integrate(0, 0, (t) => (t < release ? a0 : 0));
    }
    const p = PRESETS[preset];
    return integrate(p.x0, p.v0, p.accel);
  }, [isForce, force, mass, release, preset]);

  // Play is driven by CartTrack's own rAF clock (onTick, below) so the cart
  // animates at the display frame rate; the plot cursor is synced at ~20 fps.

  // Sample the motion at the scrub time.
  const idx = Math.max(0, Math.min(N - 1, Math.round((scrub / T) * (N - 1))));
  const now = { t: motion.t[idx], x: motion.x[idx], v: motion.v[idx], a: motion.a[idx] };
  const dX = motion.x[idx] - motion.x[0]; // ∫v dt  (area under v)
  const dV = motion.v[idx] - motion.v[0]; // ∫a dt  (area under a)

  // Pin the current motion (deep-copy the arrays so later edits don't mutate it).
  const pin = () => setPinned({
    t: motion.t.slice(), x: motion.x.slice(), v: motion.v.slice(), a: motion.a.slice(),
    label: isForce ? `F=${force}N, m=${mass}kg` : PRESETS[preset].label,
  });

  // Position extent — covers the live motion AND any pinned ghost, so both fit
  // on the cart track without rescaling as you switch presets.
  const xRange = useMemo(() => {
    const arrs = pinned ? motion.x.concat(pinned.x) : motion.x;
    return extent(arrs);
  }, [motion, pinned]);

  // ── traces ──────────────────────────────────────────────────────────────
  const line = (t, y, yaxis, color, opacity = 1, width = 2.5) => ({
    x: t, y, type: 'scatter', mode: 'lines',
    line: { color, width }, opacity, yaxis, hoverinfo: 'skip',
  });
  const dot = (val, yaxis, color) => ({
    x: [now.t], y: [val], type: 'scatter', mode: 'markers',
    marker: { color: '#FFFFFF', size: 8, line: { color, width: 2 } }, yaxis, hoverinfo: 'skip',
  });
  // Sign-colored area: split the running integral into positive (gold) and
  // negative (red) segments so Δx reads as *net signed* area on up-and-back.
  const signedArea = (arr, yaxis) => {
    const outs = [];
    const push = (seg) => {
      if (seg.length < 2) return;
      outs.push({
        x: seg.map((p) => p.t), y: seg.map((p) => p.y),
        type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tozeroy',
        fillcolor: seg[0].sign >= 0 ? 'rgba(197,183,131,0.32)' : 'rgba(217,83,79,0.32)',
        yaxis, hoverinfo: 'skip',
      });
    };
    let seg = [];
    let curSign = null;
    for (let i = 0; i <= idx; i++) {
      const y = arr[i];
      const s = y >= 0 ? 1 : -1;
      if (curSign === null) curSign = s;
      if (s !== curSign) {
        // close the current segment on the zero crossing, then start the next
        seg.push({ t: motion.t[i], y: 0, sign: curSign });
        push(seg);
        seg = [{ t: motion.t[i], y: 0, sign: s }];
        curSign = s;
      }
      seg.push({ t: motion.t[i], y, sign: curSign });
    }
    push(seg);
    return outs;
  };

  const traces = [];

  // pinned ghost curves (faded, behind everything)
  if (pinned) {
    traces.push(
      line(pinned.t, pinned.x, 'y3', GOLD, 0.28, 2),
      line(pinned.t, pinned.v, 'y2', BLUE, 0.28, 2),
      line(pinned.t, pinned.a, 'y', GREEN, 0.28, 2),
    );
  }

  // position (top, y3), velocity (middle, y2), acceleration (bottom, y)
  if (isArea) {
    traces.push(...signedArea(motion.v, 'y2'));
    traces.push(...signedArea(motion.a, 'y'));
  }
  traces.push(
    line(motion.t, motion.x, 'y3', GOLD),
    line(motion.t, motion.v, 'y2', BLUE),
    line(motion.t, motion.a, 'y', GREEN),
  );

  // ── tangent-slope triangle on x(t) [slope = v] and v(t) [slope = a] ───────
  // A small right triangle riding the marker; its rise/run equals the readout,
  // making "slope of x is v" and "slope of v is a" literally measurable.
  const tangentTriangle = (yaxis, val, slope) => {
    // horizontal run in seconds, sized ~8% of the window but clamped to edges
    const run = Math.min(T * 0.08, scrub, T - scrub) || T * 0.05;
    const t0 = now.t, t1 = now.t + run;
    const y0 = val, y1 = val + slope * run; // rise = slope · run
    return [
      // hypotenuse (the tangent line itself)
      {
        x: [t0, t1], y: [y0, y1], type: 'scatter', mode: 'lines',
        line: { color: TEXT, width: 1.5 }, yaxis, hoverinfo: 'skip',
      },
      // run (horizontal) + rise (vertical) legs, dashed
      {
        x: [t0, t1, t1], y: [y0, y0, y1], type: 'scatter', mode: 'lines',
        line: { color: 'rgba(240,236,227,0.55)', width: 1, dash: 'dot' },
        yaxis, hoverinfo: 'skip',
      },
    ];
  };
  // slope of x(t) = v ; slope of v(t) = a
  traces.push(...tangentTriangle('y3', now.x, now.v));
  traces.push(...tangentTriangle('y2', now.v, now.a));

  // markers on top of the triangles
  traces.push(dot(now.x, 'y3', GOLD), dot(now.v, 'y2', BLUE), dot(now.a, 'y', GREEN));

  const panel = (domain, title, color) => ({
    domain, title: { text: title, font: { color } }, anchor: 'x',
    // clear the shared intensity-plot base range ([0,1.05]) so each panel autoranges
    range: undefined, autorange: true,
    zeroline: true, zerolinecolor: '#2A3442', tickfont: { size: 12 },
  });

  const layout = {
    showlegend: false,
    margin: { l: 62, r: 16, t: 10, b: 42 },
    xaxis: { title: { text: 'Time (s)' }, anchor: 'y', domain: [0, 1], range: [0, T] },
    yaxis: panel([0.0, 0.27], 'a (m/s²)', GREEN),
    yaxis2: panel([0.37, 0.63], 'v (m/s)', BLUE),
    yaxis3: panel([0.72, 1.0], 'x (m)', GOLD),
    // scrub line spanning all three panels
    shapes: [{
      type: 'line', xref: 'x', yref: 'paper', x0: now.t, x1: now.t, y0: 0, y1: 1,
      line: { color: 'rgba(240,236,227,0.5)', width: 1, dash: 'dot' },
    }],
  };

  const presetBtns = (
    <div className="mb-4">
      <div className="text-usna-text text-sm font-medium mb-2">Preset motion</div>
      <div className="flex flex-col gap-1.5">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={`px-3 py-1.5 rounded text-sm text-left border transition-colors ${
              preset === key
                ? 'bg-usna-gold text-usna-navy border-usna-gold'
                : 'bg-usna-deep text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        {isForce ? (
          <>
            <Slider label="Applied force (F)" value={force} min={0} max={20} step={1} unit="N" onChange={setForce} />
            <Slider label="Mass (m)" value={mass} min={1} max={10} step={0.5} unit="kg" onChange={setMass} />
            <Slider label="Force removed at" value={release} min={0} max={T} step={0.5} unit="s" onChange={setRelease} />
          </>
        ) : (
          presetBtns
        )}

        <div className="mt-2 border-t border-usna-grid pt-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <span className="text-usna-muted text-xs">scrub or drag the cart</span>
          </div>
          <Slider label="Time (t)" value={Number(scrub.toFixed(1))} min={0} max={T} step={0.1} unit="s"
                  onChange={(v) => { setPlaying(false); setScrub(v); }} />
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3 flex flex-col gap-2">
          <button
            onClick={pin}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-deep text-usna-text border border-usna-grid hover:border-usna-gold hover:text-usna-gold transition-colors"
          >
            📌 Pin current motion
          </button>
          {pinned && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-usna-muted text-xs truncate">ghost: {pinned.label}</span>
              <button
                onClick={() => setPinned(null)}
                className="px-2 py-1 rounded text-xs bg-usna-deep text-usna-muted border border-usna-grid hover:text-usna-text transition-colors"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <div className="mt-2 border-t border-usna-grid pt-3">
          <Readout label="Position x" value={now.x.toFixed(1)} unit="m" />
          <Readout label="Velocity v" value={now.v.toFixed(1)} unit="m/s" />
          <Readout label="Acceleration a" value={now.a.toFixed(1)} unit="m/s²" />
          {isArea && (
            <div className="mt-2 pt-2 border-t border-usna-grid">
              <Readout label="∫v dt  = Δx" value={dX.toFixed(1)} unit="m" />
              <Readout label="∫a dt  = Δv" value={dV.toFixed(1)} unit="m/s" />
            </div>
          )}
        </div>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <CartTrack
          motion={motion}
          pinned={pinned}
          scrub={scrub}
          playing={playing}
          xRange={xRange}
          onTick={(t) => setScrub(t)}
          onScrubToX={(targetX) => {
            // Inverse lookup with branch disambiguation. A single x can occur at
            // two times (e.g. "Up and back" — outbound and return), so nearest-x
            // alone jumps between legs. Instead: find the closest x, then among
            // all samples within a small band of it, pick the one nearest in
            // TIME to the current scrub. Dragging then tracks one continuous leg.
            let dmin = Infinity;
            for (let i = 0; i < N; i++) {
              const d = Math.abs(motion.x[i] - targetX);
              if (d < dmin) dmin = d;
            }
            const band = 0.04 * ((xRange[1] - xRange[0]) || 1);
            let best = 0, bestDT = Infinity;
            for (let i = 0; i < N; i++) {
              if (Math.abs(motion.x[i] - targetX) <= dmin + band) {
                const dt = Math.abs(motion.t[i] - now.t);
                if (dt < bestDT) { bestDT = dt; best = i; }
              }
            }
            setPlaying(false);
            setScrub(motion.t[best]);
          }}
        />
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4 min-w-0 overflow-hidden" style={{ height: 470 }}>
          <IntensityPlot traces={traces} layoutOverrides={layout} />
        </div>
        <InfoPanel {...INFO[mode]} />
      </div>
    </div>
  );
}

/**
 * CartTrack — the physical object on a horizontal track.
 *
 * Maps position x → screen px along the track (using the shared xRange so the
 * live cart and any pinned ghost share a scale). Draws a tick ruler, the cart
 * body at now.x, and velocity (blue) + acceleration (green) arrows on it. The
 * cart is draggable: dragging maps pointer-x back to a world x and asks the
 * parent to inverse-lookup the nearest time (bidirectional scrub).
 */
function CartTrack({ motion, pinned, scrub, playing, xRange, onTick, onScrubToX }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef({ motion, pinned, scrub, playing, xRange, onTick, onScrubToX });
  const draggingRef = useRef(false);
  const clockRef = useRef(scrub);           // smooth display time (s)
  const sizeRef = useRef({ w: 600, h: 158 });

  // keep the latest props in a ref so the rAF/pointer handlers stay stable
  stateRef.current = { motion, pinned, scrub, playing, xRange, onTick, onScrubToX };

  // Linear interpolation of a motion array at time t — the cart reads this each
  // frame off a continuous clock, so it glides between the N samples instead of
  // snapping to whichever sample the (throttled) scrub state last landed on.
  const sampleAt = (arr, t) => {
    const f = Math.max(0, Math.min(N - 1, (t / T) * (N - 1)));
    const i = Math.floor(f);
    if (i >= N - 1) return arr[N - 1];
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  };

  // world-x → screen-x px, with padding so the cart body never clips the edge
  const PAD = 46;
  const worldToPx = useCallback((worldX, w) => {
    const [lo, hi] = stateRef.current.xRange;
    const span = hi - lo || 1;
    return PAD + ((worldX - lo) / span) * (w - 2 * PAD);
  }, []);
  const pxToWorld = useCallback((px, w) => {
    const [lo, hi] = stateRef.current.xRange;
    const span = hi - lo || 1;
    const frac = (px - PAD) / (w - 2 * PAD);
    return lo + Math.max(0, Math.min(1, frac)) * span;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx = setupCanvas(canvas, sizeRef.current.w, sizeRef.current.h);
    let raf = 0;
    const SPEED = T / 6;   // window sweep time ≈ 6 s
    let lastTs = 0, syncAcc = 0;

    const draw = (ts) => {
      const st = stateRef.current;
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
      lastTs = ts;

      // Advance the smooth clock while playing (and not being dragged); otherwise
      // follow the parent scrub. Sync the plot cursor at ~20 fps via onTick.
      if (st.playing && !draggingRef.current) {
        let t = clockRef.current + dt * SPEED;
        if (t >= T) t = 0;
        clockRef.current = t;
        syncAcc += dt;
        if (syncAcc >= 0.05) { syncAcc = 0; st.onTick(t); }
      } else {
        clockRef.current = st.scrub;
      }
      const ct = clockRef.current;
      // interpolated live state at the clock time
      const n = {
        x: sampleAt(st.motion.x, ct),
        v: sampleAt(st.motion.v, ct),
        a: sampleAt(st.motion.a, ct),
      };

      const { w, h } = sizeRef.current;
      const { xRange: xr, motion: m, pinned: p } = st;
      const trackY = h * 0.66;

      ctx.clearRect(0, 0, w, h);
      // backdrop
      ctx.fillStyle = '#0E1826';
      ctx.fillRect(0, 0, w, h);

      // ── ruler / track ──
      ctx.strokeStyle = '#2A3442';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, trackY);
      ctx.lineTo(w - PAD, trackY);
      ctx.stroke();

      // ticks + labels across the position range
      const [lo, hi] = xr;
      const nTicks = 6;
      ctx.fillStyle = MUTED;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i <= nTicks; i++) {
        const wx = lo + (i / nTicks) * (hi - lo);
        const px = worldToPx(wx, w);
        ctx.strokeStyle = '#223';
        ctx.beginPath();
        ctx.moveTo(px, trackY - 5);
        ctx.lineTo(px, trackY + 5);
        ctx.stroke();
        ctx.fillText(wx.toFixed(0), px, trackY + 9);
      }

      // origin marker (x = 0) if it falls inside the range
      if (lo <= 0 && hi >= 0) {
        const px0 = worldToPx(0, w);
        ctx.strokeStyle = 'rgba(240,236,227,0.3)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px0, 6);
        ctx.lineTo(px0, trackY - 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── pinned ghost cart ──
      if (p) {
        const gx = worldToPx(sampleAt(p.x, ct), w);
        ctx.fillStyle = 'rgba(197,183,131,0.22)';
        roundRect(ctx, gx - 20, trackY - 30, 40, 24, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(240,236,227,0.35)';
        ctx.beginPath(); ctx.arc(gx - 11, trackY - 4, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 11, trackY - 4, 5, 0, Math.PI * 2); ctx.fill();
      }

      // ── live cart ──
      const cx = worldToPx(n.x, w);
      const bodyTop = trackY - 30, bodyH = 24, bodyW = 44;
      // body
      ctx.fillStyle = GOLD;
      roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 5);
      ctx.fill();
      ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
      roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 5);
      ctx.stroke();
      // wheels
      ctx.fillStyle = NAVY;
      ctx.beginPath(); ctx.arc(cx - 13, trackY - 4, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 13, trackY - 4, 6, 0, Math.PI * 2); ctx.fill();

      // ── velocity & acceleration arrows on the cart ──
      // scale arrows by the max |v|,|a| across the whole motion so they read
      // proportionally and never dominate the strip.
      let vMax = 1e-6, aMax = 1e-6;
      for (let i = 0; i < m.v.length; i++) {
        if (Math.abs(m.v[i]) > vMax) vMax = Math.abs(m.v[i]);
        if (Math.abs(m.a[i]) > aMax) aMax = Math.abs(m.a[i]);
      }
      const ARROW_MAX = 78; // px
      const vArrowY = bodyTop - 22;
      const aArrowY = bodyTop - 50;
      // Draw an arrow, then its label BELOW the shaft (so the arrowhead never
      // overlaps the text) centered under the tip and clamped inside the strip.
      const labeledArrow = (y, val, mag, color, sym) => {
        const dx = mag > 1e-9 ? (val / mag) * ARROW_MAX : 0;
        drawArrow(ctx, { x: cx, y, dx, dy: 0, color, width: 4, head: 9 });
        const tipX = cx + dx;
        const lx = Math.max(PAD + 2, Math.min(w - PAD - 2, tipX));
        ctx.font = '13px JetBrains Mono, monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${sym} = ${val.toFixed(1)}`, lx, y + 5);
      };
      // acceleration (green, top) then velocity (blue, below it)
      labeledArrow(aArrowY, n.a, aMax, GREEN, 'a');
      labeledArrow(vArrowY, n.v, vMax, BLUE, 'v');

      // "drag me" hint / grab affordance below the cart
      ctx.fillStyle = draggingRef.current ? GOLD : MUTED;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(draggingRef.current ? 'scrubbing…' : '⇔ drag cart to scrub', cx, trackY + 22);

      // axis caption
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText('position x (m)', PAD, 6);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // resize
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(280, Math.floor(e.contentRect.width));
        const h = sizeRef.current.h;
        sizeRef.current = { w, h };
        ctx = setupCanvas(canvas, w, h);
      }
    });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [worldToPx]);

  // ── pointer drag → scrub ──
  const onPointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    handleDrag(e);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    handleDrag(e);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const handleDrag = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const worldX = pxToWorld(px, sizeRef.current.w);
    stateRef.current.onScrubToX(worldX);
  };

  return (
    <div
      ref={wrapRef}
      className="bg-usna-card border border-usna-grid rounded-lg min-w-0 overflow-hidden"
      style={{ height: 158 }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'ew-resize' }}
      />
    </div>
  );
}

// Local helper: rounded-rect path (not in the shared canvas lib).
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
  default: {
    title: '1D Motion Grapher',
    description: 'Position, velocity, and acceleration share one time axis, so the derivative relationships are visible at a glance: v is the slope of x, a is the slope of v. The tangent triangle riding each marker measures that slope directly. Scrub, play, or drag the cart on the track above; the cart carries live v (blue) and a (green) arrows. On "Up and back," the velocity goes negative while the cart is still at positive x — negative velocity is not the same as decreasing position. On "Speed up, then brake," a flips sign but v never does: the cart decelerates without reversing. Pin a motion to compare presets on the same faded axes.',
    equation: String.raw`v = \frac{dx}{dt}, \qquad a = \frac{dv}{dt}`,
  },
  area: {
    title: 'Area = the integral',
    description: 'The shaded area under v(t) up to the scrub time equals the displacement Δx, and the area under a(t) equals the change in velocity Δv — the two readouts track together as you scrub. Positive area is gold, negative area is red, so on "Up and back" the gold going out is cancelled by the red coming back and Δx reads as the net signed area. Integration is just accumulated signed area.',
    equation: String.raw`\Delta x = \int_0^t v\,dt, \qquad \Delta v = \int_0^t a\,dt`,
  },
  force: {
    title: 'Force controls acceleration',
    description: 'The applied force sets the acceleration through a = F/m — not the velocity. Slide "Force removed at" earlier: the moment the force is gone the acceleration drops to zero, but the cart keeps the velocity it already had and coasts. Watch the green a-arrow on the cart vanish while the blue v-arrow stays put. Releasing the force does not stop the cart.',
    equation: String.raw`a = \frac{F}{m}`,
  },
};
