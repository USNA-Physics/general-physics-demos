# SP211 Demo Review Log

Collaborative, by-the-numbers review of each lesson demo, in lockstep with the lecture-notes
review (run in a separate session). For each demo: (1) I state the intended goals/behavior,
(2) we test it live, (3) note findings, (4) make changes, (5) mark it **solidified**.

**Status:** ⬜ pending · 🔄 in review · ✅ solidified
**Live:** `npm run dev` → http://localhost:5173/ (password `beatARMY15`)

## Progress (by first lesson)

| Lesson(s) | Demo | Route · mode | Status |
|---|---|---|---|
| L1, L3, L8 | D01 · 1D Motion Grapher | `ch02-motion-1d/grapher` · default/area/force | 🔄 |
| L2 | D02 · Free Fall Explorer | `ch02-motion-1d/free-fall` | ✅ |
| L4 | D04 · 2D Vector Kinematics | `ch03-motion-2d/vectors` | ⬜ |
| L5 | D05 · Relative Motion | `ch03-motion-2d/relative` | ⬜ |
| L6 | D06 · Projectile Motion | `ch03-motion-2d/projectile` (moved out of Ch2) | ⬜ |
| L7, L13 | D07 · UCM Visualizer | `ch03-motion-2d/ucm` · kinematic/banked | ⬜ |
| L9, L10 | D09 · Free-Body Diagram Builder | `ch04-newton/fbd` · fbd/pairs | ⬜ |
| L11 | D11 · Friction Incline | `ch05-applications/friction` | ⬜ |
| L12 | D12 · Drag & Terminal Velocity | `ch05-applications/drag` (moved out of Ch2) | ⬜ |
| L14 | D14 · Center of Mass Playground | `ch05-applications/cm` · default/tumbling | ⬜ |
| L15–L17 | D15 · Work & Power Visualizer | `ch06-work/work` · dot/area/power | ⬜ |
| L18–L20 | D18 · Energy Landscape Explorer | `ch07-energy/landscape` · default/equilibria/dissipation | ⬜ |
| L21–L23 | D22 · Collision Sandbox | `ch08-momentum/collisions` · 1d/impulse/2d | ⬜ |
| L24 | D24 · Rotational Kinematics Grapher | `ch09-rotation/grapher` | ⬜ |
| L25–L27 | D25 · Moment of Inertia Explorer | `ch09-rotation/inertia` · shapes/torque/dynamics | ⬜ |
| L28 | D28 · Rolling Race | `ch09-rotation/rolling` | ⬜ |
| L29, L30 | D30 · Angular Momentum Conservation | `ch10-angular-momentum/conservation` · vector/skater | ⬜ |
| L31, L32 | D31 · Orbit Simulator | `ch11-gravity/orbits` · kepler/escape | ⬜ |
| L33, L34 | D34 · Buoyancy Tank | `ch13-fluids/tank` · pressure/buoyancy | ⬜ |
| L35, L36 | D35 · SHM Explorer | `ch14-oscillations/shm` · spring/pendulum | ⬜ |
| L37, L38 | D37 · Traveling Wave Explorer | `ch15-waves/traveling` · transverse/longitudinal | ⬜ |
| L39 | D39 · Doppler Wavefront Visualizer | `ch15-waves/doppler` | ⬜ |
| L40, L41 | D40 · Superposition Sandbox | `ch16-superposition/sandbox` · beats/standing | ⬜ |

---

## Review log

### D02 · Free Fall Explorer — L2 (Constant acceleration) · ✅ solidified

**Route:** `/#/sp211/ch02-motion-1d/free-fall`

**Intended goal (from the plan):** the "predict-then-drop" moment — a student estimates the
fall time from a given height, then watches the motion confirm (or refute) their kinematic
prediction under constant g. Reinforces `y(t) = y₀ + v₀t − ½gt²` and `v(t) = v₀ − gt`.

**Current behavior:** two sliders (initial height y₀ 1–100 m, initial velocity v₀ −20…+20 m/s);
a live plot of position y(t) (gold) and velocity v(t) (blue) vs time; readouts for time-to-ground
and impact speed; InfoPanel with the two kinematic equations. Curves recompute on slider change
(no animated dropping ball in the default mode).

**Changes (in progress):**
- Split into **three stacked, time-synced panels** (y, v, a) sharing one time axis, each with its own y-axis (a is a constant −g line).
- Added an **animated drop** on a vertical track beside the plots: a falling ball with a live velocity arrow, synced to a dotted time cursor and per-curve markers.
- **Strobe snapshots**: fixed dots dropped at equal time intervals that appear as the ball passes them, so the growing gap per interval is visible (replaced the moving "spring"-like trail). Brightened for visibility.
- Play/Drop + time scrub; live t / y / v / a readouts.
- Dev-only: the password gate is skipped under `npm run dev` (still active on the deployed build).

**Verdict:** ✅ Solidified.
