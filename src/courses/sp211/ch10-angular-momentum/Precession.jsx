import { useState, useRef, useEffect } from 'react';
import ControlPanel from '@shared/components/ControlPanel';
import Slider from '@shared/components/Slider';
import Readout from '@shared/components/Readout';
import InfoPanel from '@shared/components/InfoPanel';
import { setupCanvas } from '@shared/lib/canvas';
import { createIso, drawArrow3D, drawSegment3D } from '@shared/lib/iso';

/**
 * Precession (D30b). Companion to AngularMomentum (D30); serves L29.
 *
 * A spinning body carries angular momentum L along its symmetry axis. The weight
 * acts at the center of mass, a distance r from the pivot, producing a torque
 * τ = r × F that is horizontal and perpendicular to the plane containing the axis.
 * Since τ = dL/dt, the increment ΔL = τ Δt is perpendicular to L: it reorients L
 * without changing its length, so the axis sweeps out a cone rather than falling.
 * The precession rate is Ω = Mgr / (Iω), which decreases as the spin rate rises.
 *
 * Rendering uses the shared isometric projection (@shared/lib/iso): the pivot sits
 * at the world origin, the x-y plane is horizontal, and z is vertical. The vector
 * construction is the subject of the demonstration, so each arrow is drawn in a
 * fixed color with a matching legend, and a step control advances the motion one
 * interval at a time to make ΔL explicit.
 */

const GOLD = '#C5B783';     // L, along the axis
const GRAY = '#9A9CA0';     // weight Mg
const CYAN = '#5BC8D5';     // torque τ
const AMBER = '#E8A14E';    // increment ΔL
const TEXT = '#F0ECE3';
const MUTED = '#8B8C8E';
const BG = '#0D1321';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

// Illustrative presets for the applications mode. Numbers are chosen for legible
// motion, not quantitative accuracy.
const APPLICATIONS = {
  football: {
    label: 'Football',
    thetaDeg: 12, omega: 90, I: 0.02, M: 0.42, r: 0.11,
    caption: 'A thrown football spins about its long axis. The large angular momentum resists reorientation, so the nose holds its heading through the flight.',
  },
  spacecraft: {
    label: 'Spacecraft',
    thetaDeg: 20, omega: 70, I: 0.05, M: 0.3, r: 0.08,
    caption: 'A spin-stabilized spacecraft, or a control-moment gyroscope aboard one, uses stored angular momentum to hold its orientation against small disturbing torques.',
  },
  earth: {
    label: "Earth's axis",
    thetaDeg: 23.5, omega: 55, I: 0.08, M: 0.2, r: 0.06,
    caption: "Earth's rotation axis precesses once in roughly 26,000 years, the precession of the equinoxes. The rate is shown greatly exaggerated here.",
  },
};

const DEFAULTS = {
  top: { thetaDeg: 25, omega: 40, I: 0.02, M: 0.5, r: 0.12 },
  gyroscope: { thetaDeg: 90, omega: 40, I: 0.02, M: 0.5, r: 0.12 },
  applications: APPLICATIONS.football,
};

export default function Precession({ mode = 'top' }) {
  // Remounting on mode change resets the parameters and animation cleanly.
  return <PrecessionCore key={mode} mode={mode} />;
}

function PrecessionCore({ mode }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const init = mode === 'applications' ? APPLICATIONS.football : DEFAULTS[mode];
  const [thetaDeg, setThetaDeg] = useState(init.thetaDeg);
  const [omega, setOmega] = useState(init.omega);     // spin rate, rad/s
  const [I, setI] = useState(init.I);                 // rotor inertia, kg·m²
  const [M, setM] = useState(init.M);                 // mass, kg
  const [r, setR] = useState(init.r);                 // pivot-to-CM distance, m
  const [g, setG] = useState(9.81);                   // m/s²
  const [speed, setSpeed] = useState(1);              // animation speed factor
  const [gravityOn, setGravityOn] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [preset, setPreset] = useState('football');

  const [showL, setShowL] = useState(true);
  const [showTau, setShowTau] = useState(true);
  const [showWeight, setShowWeight] = useState(true);
  const [showDL, setShowDL] = useState(true);
  const [showCone, setShowCone] = useState(true);
  const [showTrace, setShowTrace] = useState(true);
  const [showInset, setShowInset] = useState(true);

  // camera (angles owned by refs; state mirrors them so the sliders track)
  const [azDeg, setAzDeg] = useState(40);
  const [elDeg, setElDeg] = useState(22);
  const [autoAz, setAutoAz] = useState(false);
  const [autoEl, setAutoEl] = useState(false);
  const azRef = useRef(40);
  const elRef = useRef(22);
  const autoAzRef = useRef(autoAz); autoAzRef.current = autoAz;
  const autoElRef = useRef(autoEl); autoElRef.current = autoEl;
  const setAz = (v) => { azRef.current = v; setAzDeg(v); };
  const setEl = (v) => { elRef.current = v; setElDeg(v); };

  // one-shot request to advance a single interval while paused
  const stepRef = useRef(0);

  // live refs for the rAF loop
  const refs = useRef({});
  refs.current = {
    theta: thetaDeg * DEG, omega, I, M, r, g, speed, gravityOn, playing,
    showL, showTau, showWeight, showDL, showCone, showTrace, showInset,
  };

  // ── derived scalars for the readouts ────────────────────────────────────
  const theta = thetaDeg * DEG;
  const Lmag = I * omega;                                  // |L| = Iω
  const tauMag = gravityOn ? M * g * r * Math.sin(theta) : 0; // |τ| = Mgr sinθ
  const OmegaRaw = Lmag > 1e-6 && gravityOn ? (M * g * r) / (I * omega) : 0; // rad/s
  const OmegaCap = 6;                                      // display guard for ω→0
  const offScale = OmegaRaw > OmegaCap;
  const Omega = Math.min(OmegaRaw, OmegaCap);
  const spinRev = omega / TWO_PI;

  const applyPreset = (key) => {
    const p = APPLICATIONS[key];
    setPreset(key);
    setThetaDeg(p.thetaDeg); setOmega(p.omega); setI(p.I); setM(p.M); setR(p.r);
  };

  const reset = () => {
    const d = mode === 'applications' ? APPLICATIONS.football : DEFAULTS[mode];
    setThetaDeg(d.thetaDeg); setOmega(d.omega); setI(d.I); setM(d.M); setR(d.r);
    setG(9.81); setSpeed(1); setGravityOn(true); setPlaying(true);
    setAz(40); setEl(22); setAutoAz(false); setAutoEl(false);
    if (mode === 'applications') setPreset('football');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let ctx, W, H, raf, iso, cx, cy, scale;
    let phi = 0;            // precession azimuth
    let spinPhase = 0;      // spin angle of the rim marker (capped for legibility)
    const trace = [];       // recent axis-tip positions (world coords)
    let last, lastPub = 0;

    canvas.style.touchAction = 'none';
    const buildIso = () => createIso({ cx, cy, scale, azimuth: azRef.current * DEG, elevation: elRef.current * DEG });
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      ctx = setupCanvas(canvas, W, H);
      cx = W * 0.44; cy = H * 0.6; scale = Math.min(W, H) * 0.165;
      iso = buildIso();
    };

    // drag the scene to rotate the camera (there are no draggable tips here)
    let rotating = false, lastPx = 0, lastPy = 0;
    const toLocal = (e) => { const r = canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
    const onDown = (e) => { rotating = true; const { px, py } = toLocal(e); lastPx = px; lastPy = py; canvas.setPointerCapture?.(e.pointerId); };
    const onMove = (e) => {
      if (!rotating) return;
      const { px, py } = toLocal(e);
      setAz(norm360(azRef.current + (px - lastPx) * 0.5));
      setEl(norm360(elRef.current - (py - lastPy) * 0.5));
      lastPx = px; lastPy = py;
    };
    const onUp = (e) => { rotating = false; canvas.releasePointerCapture?.(e.pointerId); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const SPIN_CAP = 12; // rad/s of on-screen rim motion; real spin may exceed it

    const draw = (now) => {
      if (last === undefined) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;

      // advance auto-rotation, then rebuild the camera for this frame
      if (autoAzRef.current) azRef.current = norm360(azRef.current + 16 * dt);
      if (autoElRef.current) elRef.current = norm360(elRef.current + 10 * dt);
      if ((autoAzRef.current || autoElRef.current) && now - lastPub > 120) {
        lastPub = now; setAzDeg(Math.round(azRef.current)); setElDeg(Math.round(elRef.current));
      }
      iso = buildIso();

      const s = refs.current;
      const theta = s.theta;
      const Lmag = s.I * s.omega;
      const tauMag = s.gravityOn ? s.M * s.g * s.r * Math.sin(theta) : 0;
      const OmegaRaw = Lmag > 1e-6 && s.gravityOn ? (s.M * s.g * s.r) / (s.I * s.omega) : 0;
      const Omega = Math.min(OmegaRaw, 6);

      // advance precession (continuous), or by one discrete interval on request
      let dPhi = 0;
      if (s.playing && s.gravityOn) dPhi = Omega * dt * s.speed;
      if (stepRef.current > 0) { dPhi = 0.22; stepRef.current -= 1; }
      phi += dPhi;

      // spin marker (visual only, capped)
      spinPhase += Math.min(s.omega, SPIN_CAP) * dt * (s.playing ? 1 : 0);

      // ── world geometry ────────────────────────────────────────────────────
      // axis unit vector n(θ,φ); CM at r_cm = r n (scaled to world units)
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.sin(theta) * Math.sin(phi);
      const nz = Math.cos(theta);

      const rodLen = 2.3;                       // drawn length of the top's axis
      const cmFrac = 0.55;                      // CM position along the drawn rod
      const tip = [nx * rodLen, ny * rodLen, nz * rodLen];
      const cm = [nx * rodLen * cmFrac, ny * rodLen * cmFrac, nz * rodLen * cmFrac];

      // torque direction: horizontal, 90° ahead of the axis azimuth.
      // τ = r_cm × F = Mgr sinθ (−sinφ, cosφ, 0)
      const tdir = [-Math.sin(phi), Math.cos(phi), 0];

      // display lengths (world units), scaled from SI with visual caps
      const Lpx = Math.max(0.5, Math.min(2.2, Lmag * 2.3));
      const tauPx = Math.min(1.8, tauMag * 2.4);
      const wPx = Math.min(1.5, s.M * s.g * 0.26);
      const dtVis = 0.28;                       // Δt used to size the ΔL arrow
      const dLpx = Math.min(1.1, tauMag * dtVis * 2.3);

      ctx.clearRect(0, 0, W, H);

      // ground plane disk and vertical reference through the pivot
      drawGroundDisk(ctx, iso, 2.6);
      drawSegment3D(ctx, iso, [0, 0, 0], [0, 0, 2.6], { color: 'rgba(154,156,160,0.35)', width: 1, dash: [3, 5] });

      // support post for the gyroscope mode (axle pivoted on a stand)
      if (mode === 'gyroscope') {
        drawSegment3D(ctx, iso, [0, 0, -0.9], [0, 0, 0], { color: 'rgba(154,156,160,0.8)', width: 4 });
      }

      // cone swept by the axis
      if (s.showCone && Math.sin(theta) > 1e-3) {
        const circR = rodLen * Math.sin(theta);
        const circZ = rodLen * Math.cos(theta);
        ctx.strokeStyle = 'rgba(197,183,131,0.18)';
        ctx.lineWidth = 1;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * TWO_PI;
          drawSegment3D(ctx, iso, [0, 0, 0], [circR * Math.cos(a), circR * Math.sin(a), circZ], { color: 'rgba(197,183,131,0.12)', width: 1 });
        }
        // rim circle of the cone
        strokeWorldCircle(ctx, iso, circR, circZ, 'rgba(197,183,131,0.3)');
      }

      // tip trace (fades)
      if (s.showTrace) {
        trace.push(tip);
        if (trace.length > 160) trace.shift();
        for (let i = 1; i < trace.length; i++) {
          const p0 = iso.project(...trace[i - 1]);
          const p1 = iso.project(...trace[i]);
          ctx.strokeStyle = `rgba(232,161,78,${(i / trace.length) * 0.6})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
        }
      }

      // the top's axis (rod) and a disk/rotor at the end
      drawSegment3D(ctx, iso, [0, 0, 0], tip, { color: 'rgba(240,236,227,0.9)', width: 3 });
      drawRotor(ctx, iso, tip, [nx, ny, nz], spinPhase);

      // pivot marker
      const o = iso.project(0, 0, 0);
      ctx.fillStyle = TEXT;
      ctx.beginPath(); ctx.arc(o.sx, o.sy, 4, 0, TWO_PI); ctx.fill();

      // ── the vectors ─────────────────────────────────────────────────────
      // weight at the CM, straight down
      if (s.showWeight && wPx > 0.02) {
        drawArrow3D(ctx, iso, { from: cm, to: [cm[0], cm[1], cm[2] - wPx], color: GRAY, width: 3, head: 11, label: 'Mg', font: '14px JetBrains Mono, monospace' });
      }
      // torque at the CM, horizontal
      if (s.showTau && tauPx > 0.02) {
        drawArrow3D(ctx, iso, { from: cm, to: [cm[0] + tdir[0] * tauPx, cm[1] + tdir[1] * tauPx, cm[2]], color: CYAN, width: 3, head: 11, label: 'τ', font: '15px JetBrains Mono, monospace' });
      }
      // angular momentum along the axis from the pivot
      const Ltip = [nx * Lpx, ny * Lpx, nz * Lpx];
      if (s.showL) {
        drawArrow3D(ctx, iso, { from: [0, 0, 0], to: Ltip, color: GOLD, width: 4, head: 12, label: 'L', font: '16px JetBrains Mono, monospace' });
      }
      // increment ΔL = τ Δt at the tip of L, along τ (horizontal)
      if (s.showDL && dLpx > 0.02 && s.showL) {
        drawArrow3D(ctx, iso, { from: Ltip, to: [Ltip[0] + tdir[0] * dLpx, Ltip[1] + tdir[1] * dLpx, Ltip[2]], color: AMBER, width: 3, head: 10, label: 'ΔL', font: '13px JetBrains Mono, monospace' });
      }

      // top-down inset: L's horizontal projection and τ 90° ahead of it
      if (s.showInset) drawInset(ctx, W, H, phi, theta);

      // banners
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (!s.gravityOn) {
        ctx.fillStyle = MUTED;
        ctx.fillText('Gravity off: τ = 0, so L is constant and the axis is fixed.', 14, 12);
      } else if (OmegaRaw > 6) {
        ctx.fillStyle = AMBER;
        ctx.fillText('Spin low: precession rate off scale, the top falls.', 14, 12);
      }
      if (!s.playing) {
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'center';
        ctx.fillText('Use Step to add one ΔL = τ Δt increment.', W * 0.44, 12);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [mode]);

  const appCaption = mode === 'applications' ? APPLICATIONS[preset].caption : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="px-3 py-1.5 rounded text-sm font-medium bg-usna-gold text-usna-navy hover:bg-usna-gold-light transition-colors"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => { setPlaying(false); stepRef.current += 1; }}
            className="px-3 py-1.5 rounded text-sm font-medium border border-usna-gold text-usna-gold hover:bg-usna-gold/10 transition-colors"
            title="Advance one interval and add ΔL = τ Δt"
          >
            Step ΔL
          </button>
        </div>

        {mode === 'applications' && (
          <div className="mb-4">
            <div className="text-usna-muted text-xs mb-1.5">Preset</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(APPLICATIONS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                    preset === key ? 'bg-usna-gold text-usna-navy border-usna-gold' : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Slider label="Spin rate (ω)" value={omega} min={5} max={90} step={1} unit="rad/s" onChange={setOmega} />
        {mode !== 'gyroscope' && (
          <Slider label="Tilt (θ)" value={thetaDeg} min={5} max={90} step={1} unit="°" onChange={setThetaDeg} />
        )}
        <Slider label="Rotor inertia (I)" value={I} min={0.005} max={0.1} step={0.005} unit="kg·m²" onChange={setI} />
        <Slider label="Mass (M)" value={M} min={0.1} max={1.2} step={0.05} unit="kg" onChange={setM} />
        <Slider label="Arm (r)" value={r} min={0.04} max={0.25} step={0.01} unit="m" onChange={setR} />
        <Slider label="Gravity (g)" value={g} min={0} max={25} step={0.1} unit="m/s²" onChange={setG} />
        <Slider label="Animation speed" value={speed} min={0.2} max={3} step={0.1} unit="×" onChange={setSpeed} />

        <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer mt-2">
          <input type="checkbox" checked={gravityOn} onChange={(e) => setGravityOn(e.target.checked)} />
          Gravity on
        </label>

        {/* Camera */}
        <div className="mt-3 border-t border-usna-grid pt-3">
          <div className="text-usna-muted text-xs mb-1.5">View (drag the scene to rotate)</div>
          <Slider label="Azimuth" value={Math.round(azDeg)} min={0} max={360} step={1} unit="°" onChange={setAz} />
          <Slider label="Elevation" value={Math.round(elDeg)} min={0} max={360} step={1} unit="°" onChange={setEl} />
          <div className="flex flex-col gap-2 mt-1">
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={autoAz} onChange={(e) => setAutoAz(e.target.checked)} />
              Auto-rotate azimuth
            </label>
            <label className="flex items-center gap-2 text-usna-text text-sm cursor-pointer">
              <input type="checkbox" checked={autoEl} onChange={(e) => setAutoEl(e.target.checked)} />
              Auto-rotate elevation
            </label>
          </div>
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3 grid grid-cols-2 gap-x-3">
          {[['L', showL, setShowL], ['τ', showTau, setShowTau], ['Mg', showWeight, setShowWeight], ['ΔL', showDL, setShowDL], ['Cone', showCone, setShowCone], ['Trace', showTrace, setShowTrace], ['Top view', showInset, setShowInset]].map(([lbl, val, set]) => (
            <label key={lbl} className="flex items-center gap-2 text-usna-text text-xs cursor-pointer">
              <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} />
              {lbl}
            </label>
          ))}
        </div>

        <div className="mt-3 border-t border-usna-grid pt-3">
          <Readout label="|L| = Iω" value={Lmag.toFixed(3)} unit="kg·m²/s" />
          <Readout label="|τ| = Mgr sinθ" value={tauMag.toFixed(3)} unit="N·m" />
          <Readout label="Ω = Mgr / Iω" value={offScale ? '> ' + OmegaCap.toFixed(0) : OmegaRaw.toFixed(3)} unit="rad/s" />
          <Readout label="Precession" value={offScale ? 'off scale' : (OmegaRaw / TWO_PI * 60).toFixed(1)} unit="rev/min" />
          <Readout label="Spin ω" value={spinRev.toFixed(1)} unit="rev/s" />
          <Readout label="Tilt θ" value={thetaDeg.toFixed(0)} unit="°" />
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
        {appCaption && (
          <p className="text-usna-muted text-sm italic">{appCaption}</p>
        )}
        <InfoPanel
          title="A perpendicular torque reorients the angular momentum"
          description={
            "The spinning body carries angular momentum L along its axis. The weight Mg acts at the center of mass, a distance r from the pivot, and produces a torque τ = r × F. This torque is horizontal and perpendicular to the plane containing the axis, so by τ = dL/dt the increment ΔL = τ Δt is perpendicular to L. Each interval therefore turns L sideways without changing its length, and the axis traces a cone instead of falling. The Step control adds one such increment at a time, and the top view shows the torque leading the horizontal projection of L by a quarter turn. The precession rate Ω = Mgr / (Iω) is inversely proportional to the spin: a faster spin gives a longer L and a slower, steadier precession. With gravity removed the torque vanishes and the axis holds its direction."
          }
          equation={String.raw`\vec\tau=\vec r\times\vec F=\frac{d\vec L}{dt},\qquad |\vec\tau|=Mgr\sin\theta,\qquad \Omega=\frac{Mgr}{I\omega}`}
        />
      </div>
    </div>
  );
}

// ── drawing helpers ─────────────────────────────────────────────────────────

/** A faint filled disk on the ground plane (z = 0) to anchor the scene. */
function drawGroundDisk(ctx, iso, R) {
  ctx.save();
  ctx.beginPath();
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * TWO_PI;
    const p = iso.project(R * Math.cos(a), R * Math.sin(a), 0);
    if (k === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(154,156,160,0.06)';
  ctx.strokeStyle = 'rgba(154,156,160,0.25)';
  ctx.lineWidth = 1;
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Stroke a horizontal circle of radius R at height z. */
function strokeWorldCircle(ctx, iso, R, z, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * TWO_PI;
    const p = iso.project(R * Math.cos(a), R * Math.sin(a), z);
    if (k === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The rotor disk at the end of the axis. The disk is drawn in its own plane
 * (perpendicular to the axis) as a filled face with radial spokes and a curved
 * spin arrow, so the plane of rotation and the spin sense are both visible.
 */
function drawRotor(ctx, iso, center, axis, spinPhase) {
  // orthonormal basis (u, v) spanning the disk plane, perpendicular to the axis
  const [ax, ay, az] = axis;
  let ux = -ay, uy = ax, uz = 0;               // in the x-y plane, perpendicular to axis
  const un = Math.hypot(ux, uy, uz) || 1;
  ux /= un; uy /= un; uz /= un;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
  const R = 0.5;
  const pt = (ang, rad) => iso.project(
    center[0] + ux * Math.cos(ang) * rad + vx * Math.sin(ang) * rad,
    center[1] + uy * Math.cos(ang) * rad + vy * Math.sin(ang) * rad,
    center[2] + uz * Math.cos(ang) * rad + vz * Math.sin(ang) * rad,
  );
  ctx.save();

  // filled disk face (shows the plane of the disk)
  ctx.beginPath();
  for (let k = 0; k <= 40; k++) {
    const p = pt((k / 40) * TWO_PI, R);
    if (k === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(197,183,131,0.16)';
  ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.stroke();

  // radial spokes, rotating with the spin phase
  ctx.strokeStyle = 'rgba(197,183,131,0.5)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    const ang = spinPhase + (k / 6) * TWO_PI;
    const c0 = iso.project(center[0], center[1], center[2]);
    const e = pt(ang, R);
    ctx.beginPath(); ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(e.sx, e.sy); ctx.stroke();
  }

  // curved spin arrow just inside the rim, indicating the sense of rotation
  ctx.strokeStyle = TEXT; ctx.lineWidth = 2;
  ctx.beginPath();
  const rs = R * 0.7;
  for (let k = 0; k <= 16; k++) {
    const ang = spinPhase + (k / 16) * 1.4;
    const p = pt(ang, rs);
    if (k === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
  // arrowhead at the leading end of the spin arc
  const tip = pt(spinPhase + 1.4, rs);
  const near = pt(spinPhase + 1.4 - 0.12, rs);
  let hdx = tip.sx - near.sx, hdy = tip.sy - near.sy;
  const hn = Math.hypot(hdx, hdy) || 1; hdx /= hn; hdy /= hn;
  const px = -hdy, py = hdx, h = 7;
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.moveTo(tip.sx, tip.sy);
  ctx.lineTo(tip.sx - hdx * h + px * h * 0.5, tip.sy - hdy * h + py * h * 0.5);
  ctx.lineTo(tip.sx - hdx * h - px * h * 0.5, tip.sy - hdy * h - py * h * 0.5);
  ctx.closePath(); ctx.fill();

  ctx.restore();
}

const norm360 = (d) => ((d % 360) + 360) % 360;

/** Top-down inset: horizontal projection of L with τ a quarter turn ahead. */
function drawInset(ctx, W, H, phi, theta) {
  const sz = Math.min(130, W * 0.3);
  const x0 = W - sz - 12, y0 = H - sz - 12;
  const cx = x0 + sz / 2, cy = y0 + sz / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(13,19,33,0.86)';
  ctx.strokeStyle = 'rgba(139,140,142,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(x0, y0, sz, sz); ctx.fill(); ctx.stroke();
  const R = sz * 0.32 * Math.max(0.2, Math.sin(theta));
  // circle traced by the projection
  ctx.strokeStyle = 'rgba(197,183,131,0.3)'; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TWO_PI); ctx.stroke(); ctx.setLineDash([]);
  // L projection (screen y is down, so negate the y component)
  const lx = Math.cos(phi), ly = Math.sin(phi);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
  arrowHead(ctx, cx, cy, cx + lx * R, cy - ly * R, GOLD);
  // τ projection, 90° ahead
  const tx = -Math.sin(phi), ty = Math.cos(phi);
  ctx.strokeStyle = CYAN; ctx.lineWidth = 2.5;
  arrowHead(ctx, cx, cy, cx + tx * R * 0.8, cy - ty * R * 0.8, CYAN);
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = MUTED; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('top view', x0 + 6, y0 + 5);
  ctx.restore();
}

/** Minimal screen-space arrow for the inset. */
function arrowHead(ctx, x0, y0, x1, y1, color) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const h = 8, px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * h + px * h * 0.5, y1 - uy * h + py * h * 0.5);
  ctx.lineTo(x1 - ux * h - px * h * 0.5, y1 - uy * h - py * h * 0.5);
  ctx.closePath(); ctx.fill();
}
