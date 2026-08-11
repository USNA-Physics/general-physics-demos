# SP211 Demo Review Log

Collaborative, by-the-numbers review of each lesson demo, in lockstep with the lecture-notes
review (run in a separate session). For each demo: (1) I state the intended goals/behavior,
(2) we test it live, (3) note findings, (4) make changes, (5) mark it **solidified**.

**Status:** ⬜ pending · 🔄 in review · ✅ solidified
**Live:** `npm run dev` → http://localhost:5173/ (password `beatARMY15`)

## Progress (by first lesson)

| Lesson(s) | Demo | Route · mode | Status |
|---|---|---|---|
| L1, L3, L8 | D01 · 1D Motion Grapher | `ch02-motion-1d/grapher` · default/area/force | ✅ |
| L2 | D02 · Free Fall Explorer | `ch02-motion-1d/free-fall` | ✅ |
| L4 | D04 · 2D Vector Kinematics | `ch03-motion-2d/vectors` | ✅ |
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

### D04 · 2D Vector Kinematics Sandbox — L4 · ✅ solidified

**Route:** `/#/sp211/ch03-motion-2d/vectors`

**Intended goal:** velocity is tangent to the path; acceleration is the change in the velocity *vector*, so on a curve it is nonzero even at constant speed and points toward the inside of the bend. Splits into tangential (changes speed) and perpendicular/centripetal (turns). Primes the L7 result (a⊥ = v²/r) three lessons early.

**Changes this review:**
- **Calmer defaults:** opens on a symmetric ellipse, lap rate 0.35 → 0.15.
- **Text refined:** InfoPanel, banners, and captions rewritten (no em-dashes, no second person); equation reframed to lead with the derivative definitions (v = dr/dt, a = dv/dt = a∥ + a⊥) and drop the capital Frenet T̂/N̂, matching the a∥/a⊥ arrow labels.
- **Isotropic (letterboxed) plane:** normalized coords now use a single scale, so a circle renders as a real circle at any container width (previously an ellipse stretched by W/H).
- **Exact parametric presets:** circle/ellipse/figure-8 sample their true parametric curve instead of a Catmull-Rom spline, so curvature is clean (circle → flat a⊥, no ripple). Editing a handle drops to the spline.
- **Companion charts vs time:** speed and acceleration-components (a∥ green, a⊥ red) strip charts below the sandbox, cursor synced ~22 Hz, parameterized by time (s), axis-title clipping fixed.
- **Drag bug fixed:** guarded the `wpRef` sync so mid-drag re-renders no longer clobber live positions (points no longer snap back on release).

**Verdict:** ✅ Solidified.

### D01 · 1D Motion Grapher — L1 (Motion) · L3 (Area) · L8 (Force) · ✅ solidified

**Route:** `/#/sp211/ch02-motion-1d/grapher` (modes: `default`, `area`, `force`)

**Intended goals:**
- **L1 (default):** the derivative chain — v is the slope of x(t), a is the slope of v(t). "Up and back" is the key moment: v goes negative while x is still positive (negative velocity ≠ decreasing position).
- **L3 (area):** the integral chain — signed area under v(t) = Δx, signed area under a(t) = Δv. Gold (+) / red (−) shading makes net displacement obvious on "Up and back."
- **L8 (force):** a = F/m sets acceleration, not velocity. Release the force → a drops to zero but the cart keeps its velocity and coasts.

**Current behavior:** three stacked, time-synced panels x/v/a sharing one time axis with a scrub line; a cart-on-a-track strip above, draggable to scrub, carrying live v (blue) and a (green) arrows; tangent-slope triangles on x(t) and v(t); presets (constant v, constant a, up-and-back, speed-up-then-brake); play/scrub; "Pin current motion" ghost overlay for comparison.

**Changes this review:**
- **Smoother animation:** `CartTrack` now runs its own continuous rAF clock and interpolates the cart position/arrows between samples (~60 fps), instead of only moving on the ~15 fps scrub state. Plot cursor synced at ~20 fps via `onTick`.
- **Arrow labels:** taller strip (120 → 158 px); v/a labels drawn *below* their shafts (centered under the tip, clamped in-strip) so the arrowhead never overlaps the text, and the two labels stay clear of each other.
- **Drag disambiguation:** inverse-lookup now picks, among near-matching x samples, the one nearest in time to the current scrub — so dragging tracks one continuous leg of non-monotonic motion ("Up and back") instead of jumping between outbound/return.

**Verdict:** ✅ Solidified. All three modes (Motion / Area / Force) confirmed working.

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
