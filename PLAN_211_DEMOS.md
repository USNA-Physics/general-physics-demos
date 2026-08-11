# SP211 Digital Experiments — Program Plan & Demo Specifications

*Fall 2026 · Updated Aug 4, 2026 · Repo: `github.com/USNA-Physics/general-physics-demos`*
*Companion to sp211-syllabus-update-final.md (schedule authority) and the Todoist Demo builds sections (task-level tracking).*

---

## Part 1 — Program plan

### Design principles

1. **One experiment per lecture, available not required.** Every lesson L1–L41 has a designated experiment reachable at its own route. Lessons where the whiteboard wins on the day lose nothing; the experiment still exists for students before quizzes and tests, and for Demo Days.
2. **Components over apps.** The 41 lesson-slots are served by **23 distinct components** (1 existing + 22 builds), because consecutive lessons share physics. A component exposes **modes** — the L13 banked-curve view is the L7 UCM visualizer with `?mode=banked`. Modes are URL parameters so each lesson's plan links its *specific* view.
3. **D-labeling.** D## = the first lesson the component serves (D07 serves L7 and L13). Matches the Todoist task labels.
4. **The counterintuitive moment is the product.** Each demo is built around one prediction students get wrong — the complementary-angle tie, the rolling-race upset, the skater's KE increase. Sliders exist to let the surprise happen in front of them.
5. **Registry `groups` = lesson index.** Encode the Part-1 table into `registry.js` `groups` so the site renders a "By lesson" view: L12 → drag experiment, one tap, no chapter navigation.
6. **Branding/stack.** React + Vite + Tailwind + Plotly where plots are needed; canvas/SVG for animations. USNA Navy `#00205B`, Gold `#C5B783`; Inter for UI, JetBrains Mono for numeric readouts. Registry-driven routing with per-demo code splitting (established pattern in the repo).
7. **Phone-first.** Midshipmen will open these on phones. Single-column layouts, thumb-reachable sliders, no hover-dependent interactions.

### Lesson → experiment map (complete)

| Lesson | Topic (short) | Experiment | Mode |
|---|---|---|---|
| L1 | 1D displacement, velocity | D01 | default |
| L2 | Constant acceleration | Free Fall Explorer | default |
| L3 | Integration, kinematics | D01 | `area` |
| L4 | 2D kinematics | D04 | default |
| L5 | Relative motion | D05 | default |
| L6 | Projectile motion | D06 (Free Fall ext.) | `projectile` |
| L7 | Circular motion | D07 | `kinematic` |
| L8 | Newton's 1st/2nd | D01 | `force` |
| L9 | Contact forces, FBDs | D09 | `fbd` |
| L10 | Newton's 3rd | D09 | `pairs` |
| L11 (I, II) | Friction | D11 | default |
| L12 | Drag | D12 (Free Fall ext.) | `drag` |
| L13 | Curved paths, UCM dynamics | D07 | `banked` |
| L14 | Center of mass | D14 | default |
| L15 | Work, constant forces | D15 | `dot` |
| L16 | Work, variable forces | D15 | `area` |
| L17 | Power, curved paths | D15 | `power` |
| L18 | Potential energy | D18 | default |
| L19 | Mech. energy, equilibrium | D18 | `equilibria` |
| L20 | Conservation of total energy | D18 | `dissipation` |
| L21 | Linear momentum | D22 | `1d` |
| L22 | Impulse, 1D collisions | D22 | `impulse` |
| L23 | 2D collisions | D22 | `2d` |
| L24 | Rotational kinematics | D24 | default |
| L25 | Rotational KE, moment of inertia | D25 | `shapes` |
| L26 | Torque, N2 rotation (I) | D25 | `torque` |
| L27 | N2 rotation (II), power | D25 | `dynamics` |
| L28 | Rolling | D28 | default |
| L29 | Angular momentum | D30 | `vector` |
| L30 | Conservation of ang. momentum | D30 | `skater` |
| L31 | Kepler's laws | D31 | `kepler` |
| L32 | Grav. PE, orbits, escape | D31 | `escape` |
| L33 | Fluids, pressure | D34 | `pressure` |
| L34 | Buoyancy | D34 | `buoyancy` |
| L35 | SHM | D35 | `spring` |
| L36 | Oscillating systems | D35 | `pendulum` |
| L37 | Traveling waves | D37 | `transverse` |
| L38 | Sound, intensity | D37 | `longitudinal` |
| L39 | Doppler | D39 | default |
| L40 | Superposition, beats | D40 | `beats` |
| L41 | Standing waves | D40 | `standing` |

### Component families (build-order logic)

- **Free Fall family:** Free Fall Explorer (exists) → D06 projectile mode → D12 drag mode. One codebase, three lessons plus the M1 trailer.
- **Grapher family:** D01 (linear x–v–a) → D24 (angular θ–ω–α twin, reuses plot components).
- **Vector family:** D04 primitives → D05 (relative motion reuses vector arrows/composition).
- **Ch 9 family:** D25 (three modes) + D28 (rolling race shares shape gallery/inertia data with D25).
- **Wave family:** D37 → D40 (superposition sums two D37 wave engines); D39 standalone (wavefront geometry, not waveform).

### Build schedule & status

| Demo | Due | First classroom use | Margin |
|---|---|---|---|
| D01 | Aug 17 | L1, Aug 18 (soft); L3, Aug 21 (hard) | 1–4 days |
| D04 | Aug 18 | L4, Aug 24 | 6 days |
| D05 | Aug 19 | L5, Aug 26 | 7 days |
| D06 | Aug 20 | L6, Aug 28 | 8 days |
| D07 | Aug 21 | L7, Aug 31 | 10 days |
| D11 | Aug 27 | L11, Sep 11 | 2 wks |
| D12 | Aug 28 | L12, Sep 16 | 2.5 wks |
| D14 | Aug 31 | L14, Sep 21 | 3 wks |
| D09 | Sep 1 | L9, Sep 4 | 3 days |
| D15 | Sep 9 | L15, Sep 23 | 2 wks |
| D18 | Sep 18 | L18, Oct 2 | 2 wks |
| D22 | Sep 21 | L21, Oct 9 | 2.5 wks |
| D24 | Oct 7 | L24, Oct 16 | 9 days |
| D25 | Oct 8 | L25, Oct 19 | 11 days |
| D28 | Oct 9 | L28, Oct 26 | 2.5 wks |
| D30 | Oct 12 | L29, Oct 28 | 2 wks |
| D31 | Oct 13 | L31, Nov 4 | 3 wks |
| D34 | Oct 14 | L33, Nov 9 | 3.5 wks |
| D35 | Oct 26 | L35, Nov 13 | 2.5 wks |
| D37 | Oct 27 | L37, Nov 18 | 3 wks |
| D39 | Oct 28 | L39, Nov 23 | 3.5 wks |
| D40 | Oct 29 | L40, Nov 24 | 3.5 wks |

Notes: first-use dates reflect the Witt schedule; D09's 3-day margin is acceptable because L9's demo is available-not-required. Demo Days (9/25, 10/30, 12/4) are curation events, not builds — Demo Day #1 can showcase D01–D14, #2 the rotation family, #3 the wave family (D39 as the showpiece), pending confirmation that content is instructor's choice.

---

## Part 2 — Demo specifications

### Free Fall Explorer *(existing)* — L2, M1 trailer
Route: `/sp211/ch02-motion-1d/free-fall`
The incumbent and the seed of the family. A ball drops from adjustable height; position/velocity plots draw in real time against the constant-acceleration predictions.
**Classroom moment (L2):** predict-then-drop — students guess the fall time from height, then watch x(t) trace the parabola their equation predicted.
**M1 trailer use:** one drop, no explanation: "by Friday you'll predict this entire curve with three equations."
**Upgrade path:** hosts D06 (projectile) and D12 (drag) as modes; keep the codebase mode-ready during those builds rather than forking.

### D01 · 1D Motion Grapher — L1, L3, L8
Route: `/sp211/ch02-motion-1d/grapher` · Modes: default, `area`, `force`
Three vertically stacked, time-synchronized plots: x(t), v(t), a(t). The student drives the motion; the graphs respond live.
**Controls:** drag a cart along a horizontal track (touch/mouse) OR select preset motions (constant v, constant a, speed-up-then-brake); play/pause/scrub timeline; reset.
**Default (L1):** the derivative relationship made kinesthetic — move the cart fast, v(t) jumps; move it backward, v goes negative while x still increases from earlier motion. The classic confusion (negative velocity vs. decreasing position) is the target.
**`area` mode (L3):** shades the area under v(t) up to the scrub point and displays the running integral next to Δx — they're the same number, updating together. Second panel shades area under a(t) against Δv. This mode is the hard classroom dependency (Aug 21).
**`force` mode (L8):** adds an applied-force slider and a mass dial; a(t) responds instantly and proportionally, v(t) and x(t) build up. The point: force controls *acceleration*, not velocity — releasing the force doesn't stop the cart.
**Implementation:** Plotly for the linked plots; the plot-linkage machinery is reused wholesale by D24.

### D04 · 2D Vector Kinematics Sandbox — L4
Route: `/sp211/ch03-motion-2d/vectors`
A 2D plane where students place and drag waypoints to define r(t); the demo animates a particle along the path showing the velocity vector (tangent) and acceleration vector (pointing toward the inside of curves).
**Controls:** add/drag/delete waypoints; speed profile toggle (uniform speed vs. speeding up); vector visibility toggles; trail on/off.
**Classroom moment:** on a curved path at constant speed, the acceleration vector is visibly nonzero and points sideways — priming L7's centripetal result three lessons early.
**Implementation:** canvas/SVG animation; exports the arrow-rendering and vector-composition primitives that D05 consumes. Keep the vector-arrow component generic (magnitude, angle, color, label).

### D05 · Relative Motion (Riverboat/Crosswind) — L5
Route: `/sp211/ch03-motion-2d/relative`
A boat crosses a river with a current; the student sets the boat's heading and speed and the current's velocity, and sees heading (boat-frame velocity), the current vector, and the resultant ground-track composed tip-to-tail live.
**Controls:** boat speed/heading dials, current speed/direction, "aim straight across" and "hit the dock" presets; frame toggle (water frame vs. ground frame — the river banks move in the water frame).
**Classroom moments:** (1) aiming straight across but landing downstream; (2) the frame toggle, where the same motion looks completely different — the deepest idea in the lesson made visible. Naval hooks are free here: ship-relative wind, UNREP approach geometry.
**Implementation:** reuses D04's vector primitives; the frame toggle is a coordinate-transform of the same state, not a second simulation.

### D06 · Projectile Mode (Free Fall extension) — L6
Route: `/sp211/ch02-motion-1d/free-fall?mode=projectile`
Adds launch angle and initial height to Free Fall Explorer, with a trajectory overlay canvas and a range-vs-angle subplot.
**Controls:** angle slider (0–90°), launch speed, initial height; "hold trajectory" pins the current arc so multiple angles overlay; the range-vs-angle subplot plots a dot per fired shot, tracing out the sin 2θ curve empirically.
**Classroom moment (the L6 primer):** fire 30° and 60° at the same speed — same landing point. The range-vs-angle subplot then shows the whole symmetric curve with its 45° peak, and the empirical dots the class fired sit exactly on it.
**Height twist:** with nonzero launch height, the optimal angle visibly drops below 45° — the flare-gun problem's punchline, discoverable by slider.
**Implementation:** same integrator as free fall, per-component; the "hold trajectory" overlay pattern is reused by D12's vacuum-vs-drag comparison.

### D07 · UCM Vector Visualizer — L7, L13
Route: `/sp211/ch03-motion-2d/ucm` · Modes: `kinematic`, `banked`
A particle moves on a circle with its velocity vector (tangent) and acceleration vector (radially inward) rendered and rotating with it.
**`kinematic` (L7):** radius and speed sliders; a_c = v²/r readout in Mono; a "ghost" linear-motion particle alongside showing what no-force motion would do — the circle requires the inward pull.
**`banked` (L13):** side-view cutaway of a banked track; sliders for bank angle, speed, radius, and μ; force vectors (N, mg, friction) decompose live, and the friction vector flips direction as speed crosses the no-friction design speed v = sqrt(rg tan θ) — the moment that separates memorizers from understanders.
**Classroom moment (L7):** pause the animation and ask which way the acceleration points; most say "forward." Unpause; the arrow says inward, always.
**Implementation:** canvas; the force-decomposition panel in `banked` mode shares rendering with D09's FBD vectors — coordinate on a common force-vector component.

### D09 · Free-Body Diagram Builder — L9, L10
Route: `/sp211/ch04-newton/fbd` · Modes: `fbd`, `pairs`
A scene (block on table, block on incline, tug-of-war, stacked blocks) where students drag force vectors onto bodies from a palette (weight, normal, tension, friction, applied).
**`fbd` (L9):** build the diagram; a live net-force readout and a "check" that flags missing/extra/misdirected forces. Wrong answers get physics feedback ("your normal force is vertical, but the surface isn't"), not just red X's.
**`pairs` (L10):** selecting any force highlights its Newton's-third-law partner *on the other body* — the table pushing up on the block lights up the block pushing down on the table. The stacked-blocks preset is the discriminator: which forces act ON block A vs. BY block A.
**Classroom moment (L10):** the horse-and-cart paradox preset — if action equals reaction, how does anything accelerate? The pairs highlighting shows the two forces act on *different* bodies and never cancel.
**Implementation:** the most UI-heavy Unit 1 build (drag-and-drop, validation logic); 3-day margin to L9 is acceptable because it's available-not-required — the whiteboard fallback was the original plan anyway.

### D11 · Friction Incline — L11 (I and II)
Route: `/sp211/ch05-applications/friction`
A block on a tiltable incline. Students raise the angle slowly; the block sticks... sticks... and breaks away.
**Controls:** tilt slider (fine-grained near breakaway), μ_s and μ_k dials, mass dial; force-balance readout showing f_s climbing toward its μ_sN ceiling; slow-motion replay of the breakaway.
**Classroom moments:** (1) the breakaway happens at tan θ = μ_s independent of mass — change the mass, breakaway angle doesn't move (most predict heavier slides sooner); (2) at the instant of breakaway the block *jumps* to accelerating because μ_k < μ_s — the readout shows the friction force drop discontinuously.
**L11(II) reuse:** two-block preset (stacked, different μ at each interface) for the harder problems day.
**Implementation:** simple physics, precision UI — the tilt slider needs sub-degree resolution near breakaway or the moment is lost.

### D12 · Drag Mode (Free Fall extension) — L12
Route: `/sp211/ch02-motion-1d/free-fall?mode=drag`
Free fall with linear or quadratic drag, side-by-side with the vacuum twin.
**Controls:** drag model toggle (bv / ½CρAv²), drag coefficient slider, mass, initial height; vacuum-comparison ghost always available; v(t) plot with the terminal-velocity asymptote drawn as a dashed line the curve approaches but never crosses.
**Classroom moments:** (1) v(t) flattening onto v_t — acceleration dying as speed rises; (2) heavy-vs-light objects separating in air but not in vacuum (drop both toggles); (3) in projectile+drag combined mode, the complementary-angle symmetry from L6 visibly breaks — the 30°/60° tie is repealed, closing a loop opened three weeks earlier.
**Implementation:** numerical integration (RK4 or fine-step Euler — drag has no closed form for the quadratic case); the vacuum ghost reuses D06's hold-trajectory overlay.

### D14 · Center of Mass Playground — L14
Route: `/sp211/ch05-applications/cm` · Modes: default, `tumbling`
**Default:** place point masses on a plane; the CM marker moves live as masses are dragged or their values changed. Presets: dumbbell, L-shape, "donut" (CM outside the body — the fosbury-flop fact).
**`tumbling`:** launch an extended object (wrench/dumbbell) as a projectile; the body tumbles chaotically while the CM marker traces a clean parabola. Toggle the CM trail on and the chaos resolves into L6's trajectory.
**Classroom moment:** the tumbling toggle IS the lesson — F_ext = Ma_cm means the messy object is secretly a point particle plus rotation. This is also Lab 7's conceptual setup (the lab now explicitly includes CM).
**Implementation:** default mode is trivial; tumbling mode needs rigid-body rotation (constant ω is fine — no torque in flight) layered on the D06 trajectory integrator.

### D15 · Work & Power Visualizer — L15, L16, L17
Route: `/sp211/ch06-work/work` · Modes: `dot`, `area`, `power`
**`dot` (L15):** a crate dragged across a floor by a rope; angle slider rotates the rope, W = Fd cos θ readout updates, and the force vector visually decomposes into the working component and the useless perpendicular one. At 90°, work goes to zero while the force is still large — effort without work.
**`area` (L16):** F(x) curve (student-selectable: constant, linear spring, custom drag-drawn); the crate moves and work accumulates as shaded area, echoing D01's `area` mode deliberately (same visual grammar: accumulated area = the integral).
**`power` (L17):** the crate on a motorized winch; P = F·v live meter; a race between "big force, slow" and "small force, fast" delivering equal power — and a curved-path variant where only the tangential component powers the motion.
**Classroom moment (L15):** carrying a heavy box horizontally at constant speed does zero work on it — the demo shows why and the room argues about it, which is the point.
**Implementation:** modest build; the area machinery ports from D01.

### D18 · Energy Landscape Explorer — L18, L19, L20
Route: `/sp211/ch07-energy/landscape` · Modes: default, `equilibria`, `dissipation`
A ball rolls on a student-shaped U(x) landscape; K and U bars exchange in real time; total-E line drawn across the landscape.
**Default (L18):** preset landscapes (ramp, spring bowl, double well); drag the ball to a height, release, watch K/U trade while the total-E bar stays frozen.
**`equilibria` (L19):** overlays F = −dU/dx as a tangent-slope arrow at the ball's position; marks minima (stable) and maxima (unstable) with distinct icons; turning points appear where the total-E line intersects U(x) — the ball visibly cannot cross them.
**`dissipation` (L20):** friction slider; the K+U total now bleeds into a growing "thermal" bar; total-including-thermal stays constant. Conservation didn't fail — the ledger got a new column.
**Classroom moment (L19):** place the ball exactly on the double-well hump — it sits (unstable equilibrium) until the slightest nudge, then which well it falls into depends on the nudge direction. Sensitivity to initial conditions, for free.
**Implementation:** the highest-leverage build in the course (serves 3+ lessons and both energy reviews if they return); invest in making landscape drag-editing smooth.

### D22 · Collision Sandbox — L21, L22, L23
Route: `/sp211/ch08-momentum/collisions` · Modes: `1d`, `impulse`, `2d`
**`1d` (L21):** two carts on a track; mass and velocity sliders; momentum bar chart (per-cart + total) alongside a KE bar chart. Elasticity slider from perfectly elastic to perfectly inelastic. Total momentum bar never moves; the KE bar does — the asymmetry between the two conservation laws, visible.
**`impulse` (L22):** slow-motion collision with F(t) plotted during contact; area under F(t) = Δp readout; a "cushion" slider (stiff vs. soft bumper) showing same Δp, different peak force — the airbag argument, quantified.
**`2d` (L23):** overhead view, glancing collisions with adjustable impact parameter; momentum vectors decompose into x/y components, each conserved independently. Preset: equal masses elastic → 90° opening angle (the billiards fact).
**Classroom moment (L21):** the elastic slider mid-drag — students watch KE loss grow while momentum conservation doesn't flinch.
**Implementation:** Lab 6 (Momentum and 1D Collisions) runs *before* L21 under the Witt schedule, so students arrive having measured this — the demo's job shifts to organizing what the lab showed them. Note in the L21 plan.

### D24 · Rotational Kinematics Grapher — L24
Route: `/sp211/ch09-rotation/grapher`
D01's angular twin: θ(t), ω(t), α(t) stacked and linked, driven by a spinning disk the student flicks or a motor-torque preset. A dot painted on the rim connects the angular story to the linear one: its speed readout is v = rω, and a second dot at half the radius moves at half the speed — same ω, different v.
**Classroom moment:** "everything you learned in week 1 is about to happen again with Greek letters" — run D01 and D24 side by side (both loaded, tab-switch) and let the isomorphism land visually.
**Implementation:** deliberately a thin skin over D01's plot-linkage machinery; budget half the build time of D01.

### D25 · Moment of Inertia Explorer — L25, L26, L27
Route: `/sp211/ch09-rotation/inertia` · Modes: `shapes`, `torque`, `dynamics`
**`shapes` (L25):** gallery of bodies (hoop, disk, rod-about-center, rod-about-end, sphere) with their mass distribution rendered as density shading; spin each with the same flick and compare responses; parallel-axis slider drags the rotation axis off-center and I = I_cm + Md² updates live with the geometric term visualized.
**`torque` (L26):** a wrench on a bolt; force magnitude, application point, and angle sliders; τ = rF sin θ with the lever arm drawn explicitly — the perpendicular distance, not the distance to the force.
**`dynamics` (L27):** Στ = Iα playground — same torque applied to different shapes from the gallery, different α; Atwood-with-massive-pulley preset where the pulley's inertia visibly slows both blocks (the classic "why isn't a = g(m1−m2)/(m1+m2) anymore" moment).
**Classroom moment (L25):** hoop vs. disk, same mass, same radius, same flick — the hoop responds sluggishly. Where the mass *sits* matters, and the density shading shows it.
**Implementation:** shares the shape gallery and inertia data table with D28 — build the shape definitions as a common module.

### D28 · Rolling Race — L28
Route: `/sp211/ch09-rotation/rolling`
Hoop, disk, and sphere released simultaneously down an incline. Students vote before release.
**Controls:** incline angle, shape selection (race any subset), mass/radius dials that — punchline — don't change the finishing order; per-racer energy-partition bars splitting KE into translational and rotational shares live during the descent.
**Classroom moment:** the vote is the lesson. Most pick the heaviest or largest; the sphere wins regardless of mass and radius because the order depends only on I/mr² — and the energy bars show why: the hoop banks the most KE in rotation, starving its translation.
**Follow-up:** a "frictionless ice" toggle where nothing rolls and everything slides down tied — isolating friction's role as the torque provider.
**Implementation:** reuses D25's shape module; the race itself is closed-form (constant acceleration per shape), so this is mostly presentation-layer work.

### D30 · Angular Momentum Conservation — L29, L30
Route: `/sp211/ch10-angular-momentum/conservation` · Modes: `vector`, `skater`
**`vector` (L29):** L = r × p made visible — a particle passes a pivot point in a straight line and its angular momentum about that pivot is nonzero and constant; the r and p vectors and the cross-product arrow update along the path. Straight-line motion having angular momentum is the conceptual hurdle; this mode exists to clear it.
**`skater` (L30):** a spinning figure with an arm-extension slider; I drops, ω rises, the L readout doesn't move — and the KE readout *rises*. A "where did the energy come from?" callout button reveals the answer (the skater's muscles do work pulling mass inward). Merry-go-round preset: a student walks toward the center of a rotating platform and the platform speeds up.
**Classroom moment (L30):** the KE increase. L conserved but KE not is the exam question everyone misses; here it's a readout they watched change.
**Implementation:** straightforward; the neutron-star preset (collapse a star's radius, watch ω hit hundreds of rev/s) doubles as M1 Act III payoff and Demo Day #2 material.

### D31 · Orbit Simulator — L31, L32
Route: `/sp211/ch11-gravity/orbits` · Modes: `kepler`, `escape`
A satellite launched tangentially from a given altitude; launch-speed slider sweeps the trajectory through suborbital arc → circular orbit → ellipse → parabola → hyperbolic escape.
**`kepler` (L31):** elliptical orbits with equal-area sectors shading in equal times (Kepler II animated); a period readout and a T² vs a³ mini-plot that accumulates a point per orbit flown, tracing Kepler III empirically — same empirical-plot pattern as D06's range curve.
**`escape` (L32):** total-energy readout E = K + U with the sign highlighted; E < 0 bound, E = 0 the parabolic knife-edge, E > 0 gone. The v_esc moment: creep the slider until the sign flips.
**Classroom moment (L31):** "an orbit is just L6's projectile that keeps missing the ground" — start suborbital and increase speed until the arc closes into an orbit. Newton's cannonball, interactive.
**Implementation:** needs a stable orbit integrator (leapfrog/velocity-Verlet — energy drift ruins the E = 0 boundary); this is the one demo where integrator choice is load-bearing.

### D34 · Buoyancy Tank — L33, L34
Route: `/sp211/ch13-fluids/tank` · Modes: `pressure`, `buoyancy`
**`pressure` (L33):** a tank cross-section with a depth probe the student drags; P = P₀ + ρgh readout; pressure arrows on a submerged test surface from all directions (pressure is not down-ward); fluid-density selector (fresh, seawater, mercury) rescaling the gradient.
**`buoyancy` (L34):** an object with a density slider lowered into the fluid: sinks, floats at the surface with the correct submerged fraction, or hovers neutrally when densities match. Displaced-volume ghost rendered beside the tank with F_B = ρ_f V g computed from it — Archimedes as bookkeeping. Submarine preset: ballast-tank fill slider moves the boat's mean density through neutral; trim by flooding fore/aft tanks.
**Classroom moment (L34):** the floating-fraction readout on an iceberg preset (ρ_ice/ρ_seawater ≈ 0.90 submerged), then the submarine preset — for this room, buoyancy is a career topic, not a chapter.
**Implementation:** static equilibria mostly; the sink/float animation needs simple drag so things settle rather than oscillate forever.

### D35 · SHM Explorer — L35, L36
Route: `/sp211/ch14-oscillations/shm` · Modes: `spring`, `pendulum`
**`spring` (L35):** mass-on-spring with x(t) tracing live; k and m dials changing ω = sqrt(k/m) audibly (period readout) but — amplitude slider — *not* the period; K/U exchange bars (reusing D18's bar grammar); optional phase-space view (x vs v ellipse) as a stretch toggle; a rotating-disk shadow projection linking SHM to L7's circular motion (the callback written into the L35 plan).
**`pendulum` (L36):** simple pendulum with amplitude slider and a "small-angle" overlay: the T = 2π sqrt(L/g) prediction vs. actual period, agreeing at 5° and visibly diverging by 45° — the approximation's validity range measured, not asserted. Physical-pendulum preset (rod, hoop) with I-based period.
**Classroom moment (L35):** amplitude doesn't change the period (isochronism) — most predict bigger swings take longer; the readout says no (until `pendulum` mode shows where that finally fails, which is its own moment).
**Implementation:** `pendulum` mode integrates the full sin θ equation — that's the point; don't small-angle the simulation itself.

### D37 · Traveling Wave Explorer — L37, L38
Route: `/sp211/ch15-waves/traveling` · Modes: `transverse`, `longitudinal`
**`transverse` (L37):** y(x,t) = A sin(kx − ωt) animated on a string; A, k (or λ), ω (or f) sliders with v = fλ readout; marked medium-particles that bob vertically while the waveform sails by horizontally — the medium-doesn't-travel point, which is the single most persistent wave misconception; tension/density sliders changing v = sqrt(F_T/μ).
**`longitudinal` (L38):** a column of air particles with compressions/rarefactions traveling; dual-representation view showing the same wave as displacement curve AND pressure curve (offset by 90° — a classic exam trap made visible); intensity mode with a source and 1/r² falloff rings, dB readout at a draggable listener. Sonar framing in the lesson plan, not the demo.
**Classroom moment (L37):** click any particle and watch it move only up-down while the wave moves left-right. Ask "what actually travels?" Answer: the pattern — energy and phase, not stuff.
**Implementation:** the wave engine (parameterized traveling wave, particle markers) is written once and consumed twice more by D40.

### D39 · Doppler Wavefront Visualizer — L39
Route: `/sp211/ch15-waves/doppler`
A moving source emits circular wavefronts at fixed frequency; the wavefronts crowd ahead and stretch behind. A draggable observer shows received frequency live.
**Controls:** source speed slider (0 → v → beyond); observer position (draggable, ahead/behind/abeam); source-vs-observer-motion toggle (the asymmetry between the two cases — same relative speed, different f' — is the subtle payoff); frequency readout in Mono, with an optional audio tone that shifts as the geometry changes.
**Classroom moments:** (1) the crowded-ahead/stretched-behind picture explains the formula before any algebra; (2) slide source speed up to v and the wavefronts pile into a wall — the sound barrier; past v, the Mach cone opens. The bow-shock is the finale.
**Standalone showpiece:** self-contained, visually spectacular, zero dependencies — the designated Demo Day #3 headliner and the strongest candidate if any build gets pulled early for M1's Act IV.
**Implementation:** pure geometry (expanding circles from a moving emission point); the cheapest spectacular in the catalog.

### D40 · Superposition Sandbox — L40, L41
Route: `/sp211/ch16-superposition/sandbox` · Modes: `beats`, `standing`
**`beats` (L40):** two D37 wave engines summed; independent frequency sliders; the component waves drawn faint, the sum bold. Set f₁ = f₂ and slowly detune — the envelope emerges and f_beat = |f₁ − f₂| is measurable off the screen; audio output makes the beats audible (the wah-wah-wah matching the envelope is the moment).
**`standing` (L41):** counter-propagating equal waves; nodes and antinodes appear and *stay put* — motion everywhere, travel nowhere; fixed-end string presets with harmonic buttons (n = 1, 2, 3...) snapping to f_n = nv/2L; a "pluck anywhere" stretch feature decomposing into harmonics.
**Classroom moment (L41):** freeze-frame the standing wave at the instant the string is completely flat — where did the energy go? (All kinetic, that instant.) The question that reveals who's thinking.
**Course finale:** the interferometry bridge — standing waves in a laser cavity is Michelson's instrument, which is LIGO's instrument, which closes the loop opened in M1 Act IV. Written into the L41 plan and Demo Day #3.
**Implementation:** sum of two D37 engines plus audio (Web Audio API); the harmonic presets are lookup, not simulation.

---

## Part 3 — Site infrastructure tasks (small, do during first build session)

1. **`groups` lesson index:** encode the Part-1 table in `registry.js`; render a "By lesson" navigation view (L1–L41 → route+mode links).
2. **Mode-as-URL-parameter convention:** every multi-mode component reads `?mode=` so lesson plans link exact views.
3. **Shared modules:** vector-arrow component (D04→D05, D07, D09), plot-linkage (D01→D24), shape/inertia module (D25→D28), wave engine (D37→D40), overlay/ghost pattern (D06→D12), bar-chart grammar (D18→D22, D35).
4. **Demo Day playlists:** a curated-sequence page type (ordered list of demo+mode links with presenter notes) — one per Demo Day, pending Witt's confirmation of format.
