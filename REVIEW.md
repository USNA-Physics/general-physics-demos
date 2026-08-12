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
| L5 | D05 · Relative Motion | `ch03-motion-2d/relative` | ✅ |
| L6 | D06 · Projectile Motion | `ch03-motion-2d/projectile` (moved out of Ch2) | ✅ |
| L7 | D07 · UCM Visualizer | `ch03-motion-2d/ucm` | ✅ |
| L9, L10 | D09 · Free-Body Diagram Builder | `ch04-newton/fbd` · fbd/pairs | ✅ |
| Ch4 extra | D10 · Newton's 2nd Law (F = ma) | `ch04-newton/second-law` | ✅ |
| Ch4 extra | D08 · Atwood Machine | `ch04-newton/atwood` | ✅ |
| L11 | D11 · Friction Incline | `ch05-applications/friction` | ✅ |
| L12 | D12 · Drag & Terminal Velocity | `ch05-applications/drag` (moved out of Ch2) | ✅ |
| L13 | D13 · Banked Curve | `ch05-applications/banked` (moved out of UCM/D07) | ✅ |
| L14 | D14 · Center of Mass Playground | `ch05-applications/cm` · default/tumbling | ✅ |
| L15–L17 | D15 · Work & Power Visualizer | `ch06-work/work` · dot/area/power | ✅ |
| L18–L20 | D18 · Energy Landscape Explorer | `ch07-energy/landscape` · default/equilibria/dissipation | ✅ |
| L21–L23 | D22 · Collision Sandbox | `ch08-momentum/collisions` · 1d/impulse/2d | ✅ |
| L24 | D24 · Rotational Kinematics Grapher | `ch09-rotation/grapher` | ✅ |
| L25–L27 | D25 · Moment of Inertia Explorer | `ch09-rotation/inertia` · shapes/torque/dynamics | ✅ |
| L28 | D28 · Rolling Race | `ch09-rotation/rolling` | ✅ |
| L29, L30 | D30 · Angular Momentum Conservation | `ch10-angular-momentum/conservation` · vector/skater | ✅ |
| L31, L32 | D31 · Orbit Simulator | `ch11-gravity/orbits` · kepler/escape | ✅ |
| L33, L34 | D34 · Buoyancy Tank | `ch13-fluids/tank` · pressure/buoyancy | ✅ |
| L35, L36 | D35 · SHM Explorer | `ch14-oscillations/shm` · spring/pendulum | ⬜ |
| L37, L38 | D37 · Traveling Wave Explorer | `ch15-waves/traveling` · transverse/longitudinal | ⬜ |
| L39 | D39 · Doppler Wavefront Visualizer | `ch15-waves/doppler` | ⬜ |
| L40, L41 | D40 · Superposition Sandbox | `ch16-superposition/sandbox` · beats/standing | ⬜ |

---

## Review log

### D34 · Buoyancy Tank — L33 (pressure) · L34 (buoyancy) · ✅ solidified

**Route:** `/#/sp211/ch13-fluids/tank` (pressure / buoyancy, with a submarine sub-mode)

**Goal:** P = P₀ + ρgh acts equally in all directions and its top-vs-bottom mismatch is buoyancy; a floating body settles to submerged fraction ρ_obj/ρ_fluid with F_B = ρ_fluid V g; ballast slides a submarine's mean density through neutral.

**Changes this review (buoyancy mode):**
- **Submarine button now toggles** off on a second click (it always re-entered before); shows "(on)" when active and clears depth-compression when turned off.
- **Depth compression made visible:** the per-meter factor was too small to matter over the shallow tank (~0.4%); scaled it up so the mean density visibly climbs on descent (and the below-neutral runaway dive actually shows), plus a new "Hull volume (vs surface)" readout.
- **Neutral is now a real, reachable state:** relative-density bands give neutral / nearly neutral / floats / sinks (emerald / teal / gold / red), and a "◎ Set neutral" button snaps the object density (or submarine ballast) exactly to the fluid density, so neutral is achievable even in seawater/mercury.

**Note:** InfoPanel copy still carries some em-dashes / shouting caps (tone pass not yet done — see follow-up).

**Verdict:** ✅ Solidified (pressure + buoyancy).

### D31 · Orbit Simulator — L31 (kepler) · L32 (escape) · ✅ solidified

**Route:** `/#/sp211/ch11-gravity/orbits` (kepler / escape)

**Goal:** an orbit is a projectile that keeps missing the ground; the conic family (crash → circle → ellipse → escape) follows from launch speed; Kepler II (equal areas) and III (T² ∝ a³) emerge; escape is decided by the sign of the total energy E = K + U on the potential-well diagram.

**Changes this review:**
- **View auto-fit + framing.** Added a world→screen zoom+pan that fits and centers the predicted orbit's bounding box, so orbits fill the frame and the planet slides off-center (e.g. right when apoapsis extends left) instead of shooting off the edge. Pan is clamped so the planet always stays visible; unbound launches get their own planet-centered framing so escapes leave cleanly rather than vanishing. Click-to-launch inverts the full transform.
- **Dotted predicted ellipse** drawn from the eccentricity vector (correct for tilted click-launches), plus an on-canvas legend distinguishing the predicted orbit from the traced path.
- **Escape lab fixes:** EscapeLab now relaunches on slider change (it didn't, so the live energy was stale at +0); the banner/sign read the exact launch energy; the potential-well U-axis is focused on the launch-potential region so a small E > 0 sits visibly above U = 0; escape recolored red → green (blue = bound, gold = knife-edge, green = escape).
- **Tone pass, both modes:** InfoPanels, status stamps, notes, banner labels, and plot title de-AI'd (no em-dashes or shouting caps).

**Verdict:** ✅ Solidified (kepler + escape).

### D30 · Angular Momentum Conservation — L29 (vector) · L30 (skater) · ✅ solidified

**Route:** `/#/sp211/ch10-angular-momentum/conservation` (vector / skater)

**Goal:** straight-line motion carries L = r × p about an off-path point (L = mvb, set by the chosen axis); a torque makes dL/dt = τ. Skater: pulling mass in drops I, so ω rises to keep L = Iω fixed while KE = L²/2I rises (work done pulling in); pushed to the extreme by a Crab-pulsar collapse.

**Changes this review:**
- **Neutron-star spin-up fixed.** The core-radius slider mapped radius linearly across 20 km → 7×10⁵ km, so ω ∝ 1/r² stayed ≈ 0 for nearly the whole travel and then spiked. Now maps radius logarithmically (each step scales r and ω by a constant factor), and the star's on-screen spin runs on a compressed scale (∝ orders of magnitude of spin-up) so the collapse reads as a smooth ramp; the readout and an on-canvas note still report the true rate.
- **Tone pass, both modes:** rewrote both InfoPanels and the on-canvas/JSX notes; removed em-dashes and shouting caps (`RISES`, `NOT`, `ALONG`, `PERPENDICULAR`), the "exam trap"/"question everyone misses" framing, and stray casual phrasing.

**Verdict:** ✅ Solidified (vector + skater).

### D28 · Rolling Race — L28 · ✅ solidified

**Route:** `/#/sp211/ch09-rotation/rolling`

**Goal:** rolling without slipping splits KE into translation + rotation; a = g sinθ / (1 + c), so ordering depends only on the shape constant c (mass and radius cancel): solid sphere wins, hoop loses.

**Verdict:** ✅ Solidified. Reviewed and signed off previously (no changes this session). **Chapter 9 complete** (D24 grapher, D25 moment of inertia, D28 rolling race).

### D25 · Moment of Inertia Explorer — L25 (shapes) · L26 (torque) · L27 (dynamics) · ✅ solidified

**Route:** `/#/sp211/ch09-rotation/inertia` (shapes / torque / dynamics)

**Goal:** I = c·m·r² depends on where the mass sits, not just how much; parallel axis adds M d²; τ = r F sinθ needs the perpendicular lever arm / perpendicular force; Στ = Iα is the rotational F = ma; a massive Atwood pulley drags a below g(m₁−m₂)/(m₁+m₂).

**Changes this review:**
- **Moment-of-inertia equations in the gallery grid:** each body now shows its symbolic I (hoop `I = mr²`, disk `I = (1/2)mr²`, shell `I = (2/3)mr²`, sphere `I = (2/5)mr²`, rods `I = (1/12)mL²` and `I = (1/3)mL²`) both under the canvas body and in the selector buttons. Used inline parenthesized fractions (not tiny unicode glyphs) at the same text size; taller gallery box (360→430) and eased body radius so no cell text clips.
- **Torque arm clarified:** added a gold "twist τ" gauge arc around the bolt plus an on-canvas caption and panel note explaining that the tight bolt does not turn, the handle flexes by the applied torque, and it returns to level as the torque eases.
- **Στ = Iα playground: new ω-vs-time comparison plot.** All four spinnable bodies drawn as straight ω(t) = (τ/I)t lines (flattening at the 30 rad/s cap), the three non-selected ones light, the selected one bold and on top, with a live white cursor tracking the selected body's spin-up. Legend placed below the axis.
- InfoPanels + on-canvas/JSX text de-AI'd across all modes (no em-dashes, no shouting caps).

**Verdict:** ✅ Solidified (shapes / torque / dynamics, plus the builder and Atwood sub-tools).

### D24 · Rotational Kinematics Grapher — L24 · ✅ solidified

**Route:** `/#/sp211/ch09-rotation/grapher`

**Goal:** the angular twin of D01 — three time-synced panels θ/ω/α built by integrating α (so ω = ∫α, θ = ∫ω hold exactly); a spinning disk shows one ω giving every point its own v = r·ω; D01 ghost overlay, area/slope grammar, and a "flick the disk" recorder.

**Changes this review:**
- **Frame rate:** replaced the 15 fps `setInterval` play loop with a continuous rAF clock; the disk now samples the motion at a smoothly advancing time (60 fps) via a new interpolator, while the React scrub (Plotly cursor) updates at ~30 fps. Fixed a stale-closure bug where the rim velocity arrow read the initial radius.
- **Text de-AI'd:** InfoPanel title/description and the "One ω, two speeds" note (no em-dashes, no AI flourishes).

**Verdict:** ✅ Solidified.

### D22 · Collision Sandbox — L21 (1d) · L22 (impulse) · L23 (2d) · ✅ solidified

**Route:** `/#/sp211/ch08-momentum/collisions` (1d / impulse / 2d)

**Goal:** momentum conserved in every collision while KE is only conserved for e = 1; impulse J = ∫F dt = Δp with a fixed area trading peak force for contact time (the airbag argument); 2D momentum conserved component-by-component, closing as one vector triangle (equal-mass elastic → 90°).

**Changes this review:**
- **Tracers softened** so the mass outlines stay readable: 1D trails dropped to a slim, low-alpha central streak and the carts gained a crisp outline; 2D trail dots shrunk and faded.
- **Impulse mode synchronized:** the top animation, the g-gauge, and the F(t) fill now share one contact clock (scrub pinned to 0 through approach, 0→1 across contact, held full through recede) so all three evolve together.
- **Cushion-aware sound:** a rigid wall gives a louder, brighter rap; more cushion gives a softer, lower thud (the 1D/2D cart knock is unchanged).
- **1D momentum axis made e-independent:** it was auto-scaling from the live bars, so elastic collisions rescaled the chart and made the conserved Σp bar *appear* to move; now sized once from the pre/stuck/elastic extremes, so Σp sits on the constant-total line at every e.
- **2D momentum triangle fit:** the inset now scales to the full triangle bounding box (both axes) and centers it, so a steep outgoing arrow no longer clips off the bottom; panel height bumped.
- **Sound is opt-in:** off by default, with a per-mode "Contact/Impact sound" checkbox flipping a shared flag.
- InfoPanels + on-canvas text de-AI'd (no em-dashes, no shouting caps).

**Verdict:** ✅ Solidified (all three modes). **Chapter 8 complete.**

### D18 · Energy Landscape Explorer — L18 · L19 · L20 · ✅ solidified

**Route:** `/#/sp211/ch07-energy/landscape` (default / equilibria / dissipation)

**Goal:** ball on U(x) with F = −dU/dx; K↔U trade while total E stays flat; turning points at E = U(x); stable/unstable equilibria; friction bleeds mechanical energy into a thermal bar (K+U+thermal conserved).

**Changes this review:**
- **Equilibria:** deduped `findExtrema` (adjacent samples double-flagged a smooth min/max → doubled ○/△ labels; now merged to the true extreme).
- **Mode-switch state carryover fixed:** the component is reused across modes, so dissipation's friction (and accumulated thermal) bled into equilibria. A mode-change effect now resets friction to the mode default and re-drops the ball.

**Verdict:** ✅ Solidified. Dissipation mode praised as-is.

### D15 · Work & Power Visualizer — L15 (dot) · L16 (area) · L17 (power) · ✅ solidified

**Route:** `/#/sp211/ch06-work/work`

**Changes this review:**
- **Dot mode rewritten to real physics on rAF** (was a fixed setInterval): the rope's F∥ accelerates the crate at a = F∥/m. Rest-start when pulled forward (so mass is plainly visible), moving-entry for the zero/negative-work cases. Added a crate-mass slider, crate-speed and kinetic-energy readouts, and the W = ΔKE framing.
- **Defaults tuned:** force 80 → 10 N (range 0–50), distance 4 → 7 m; force arrows rescaled (3 → 12 px/N) with a proportional cap.
- **Force labels (F, F∥, F⊥) placed by hand** at distinct anchors (they shared a tip and collided), hidden when ~0.
- **Area mode:** energy-driven motion (v = √(2·KE/m), KE = launch + work-so-far) + a **position-vs-time panel** drawn as a dashed ghost the crate rides (matching the W(s) style).
- **Power mode:** race slowed (track 8→18 m) so the lower-force motor still wins but watchably, and its "tie" messaging corrected; curved ramp fixed (it was pinned by a flat, zero-force bottom → reshaped to a 12°→40° incline, VMAX cap, 400 W default) so v = P/F∥ visibly surges/crawls; race force labels moved off the arrowheads; "handicap" renamed to "uneven power".
- All InfoPanels de-AI'd.

**Verdict:** ✅ Solidified (all three modes).

### D14 · Center of Mass Playground — L14 · ✅ solidified

**Route:** `/#/sp211/ch05-applications/cm` (modes: default / tumbling)

**Goal:** CM = mass-weighted average (can lie outside the material); F_ext = M·a_cm; a tumbling body's CM traces a clean parabola; internal forces (explosion) can't move the CM.

**Changes this review:** replaced the phallic "wrench (lopsided)" tumbling body with an **L-shape (right-angle bracket)** with a heavier corner — same lopsided-CM lesson, unmistakably geometric. Updated label, InfoPanel, docstring, and registry moment.

**Verdict:** ✅ Solidified. **Chapter 5 complete** (D11 friction, D12 drag, D13 banked, D14 CM).

### D13 · Banked Curve — L13 · ✅ solidified

**Route:** `/#/sp211/ch05-applications/banked` (shares the UCM `Banked` component)

**Goal:** a banked turn needs a net inward force; design speed v_d = √(r g tanθ) needs no friction; friction flips up-/down-slope across v_d; grip budget (μN) sets when the car breaks loose. Earlier pass fixed the off-the-plane slide and de-AI'd the text.

**Verdict:** ✅ Solidified.

### D12 · Drag & Terminal Velocity — L12 · ✅ solidified

**Route:** `/#/sp211/ch05-applications/drag` (shares the Free Fall family)

**Goal:** drag grows with speed → terminal velocity (asymptote never crossed); heavy-vs-light honest via ballistic coefficient; air twin vs vacuum twin (land together in vacuum); linear vs quadratic drag. RK4-integrated, object presets (feather → skydiver).

**Verdict:** ✅ Solidified (reviewed as-is; no changes needed).

### D11 · Friction Incline — L11 · ✅ solidified

**Route:** `/#/sp211/ch05-applications/friction`

**Goal:** static friction adjusts to hold up to μ_s N, then breaks away at tanθ = μ_s (mass-independent); friction drops discontinuously to kinetic; hysteresis re-sticks only below tanθ = μ_k. Stacked preset carries both weights.

**Changes this review:**
- **Arrows adaptive + clamped** so they never overflow the canvas; scale sized to the labeled block (readable), oversized ghost arrows clamped.
- **20 kg comparison ("ghost") block now default off** (single mode shows one block); relabeled toggle.
- **Theme-aware plot** (legend, θ_crit annotation, critical line, zero-lines follow light/dark) — the app defaults to light mode.
- **Reset relocates the blocks** to the top of the incline.
- **New "Separate the two free-body diagrams" option** (stacked) offsetting the two FBDs with leaders + labels.
- InfoPanel text de-AI'd.

**Verdict:** ✅ Solidified.

### D08 · Atwood Machine — Ch4 (new) · ✅ solidified

**Route:** `/#/sp211/ch04-newton/atwood`

**Goal:** one inextensible string ties two masses to a shared acceleration a = (m₂−m₁)g/(m₁+m₂); tension lies between the weights.

**Behavior:** m₁/m₂ sliders; heavier side falls; per-block T/mg/a arrows; live HUD with a and T; "which side falls" state. Options (default off): **massive pulley** (a = (m₂−m₁)g/(m₁+m₂+M_p/2), split tensions T₁≠T₂ whose difference spins the pulley, chunkier gold pulley) and **energy panel** (boxed widget: PE released = translational KE + rotational KE). Pulley spins (spokes) with the string.

**Verdict:** ✅ Solidified. **Chapter 4 complete** (D09 FBD, D10 F=ma, D08 Atwood).

### D10 · Newton's Second Law (F = ma) — Ch4 (new) · ✅ solidified

**Route:** `/#/sp211/ch04-newton/second-law`

**Goal:** F_net = m·a. Constant net force → constant acceleration → straight-line v(t); double F doubles the slope, double m halves it. Friction: static holds below the limit, then net = applied − kinetic.

**Behavior:** camera-follows a block on a scrolling track; applied-force / mass / kinetic-friction sliders; on-block F/f/a/v arrows + a live `a = F_net/m` HUD; velocity-vs-time strip whose slope is the acceleration.

**Verdict:** ✅ Solidified.

### D09 · Free-Body Diagram Builder — L9 (fbd) · L10 (pairs) · ✅ solidified

**Route:** `/#/sp211/ch04-newton/fbd` and `/pairs`

**Changes this review:**
- **FBD mode:** per-scene task banner; on-canvas delete (✕ at the selected tip + Delete key + red panel button); "Snap to correct forces" button; fixed balance-point oscillation (freeze drift while dragging + aim from home centre); incline block now rests on the ramp; force polygon walks vectors in angular order instead of collapsing into pairs.
- **Pairs mode:** fit-to-frame transform (nothing spills out); geometry alignment (block sits on the table slab; horse/cart rest on a common ground line joined by a rope; horse redrawn as a clean block); force/body labels in contrasting pills placed force-aware (widest gap / perpendicular to arrowhead); a collision-resolution pass separates all label pills with dotted leaders.
- **Text:** InfoPanels, notes, badges, and hints rewritten (no em-dashes, no shouting caps).

**Verdict:** ✅ Solidified. Next: two new Ch4 demos (Newton's 2nd law sandbox, Atwood machine).

### D07 · UCM Vector Visualizer — L7 · ✅ solidified

**Route:** `/#/sp211/ch03-motion-2d/ucm` (single mode after banked was split out)

**Changes this review:**
- **No-force ghost line fixed:** the dotted tangent now runs from the ghost's fixed release point (marked) to the ghost, instead of swinging back to the still-orbiting bead.
- **Text refined** (InfoPanel + on-canvas): no em-dashes, no "ask the room", no shouting caps.
- **Radius made visible:** switched from auto-fit (constant circle size) to a fixed metres→px scale, so a larger radius draws a larger circle; added a 10 m scale bar and an `r = X m` readout.
- **Banked mode split out to Ch5** as D13 (see below).

**Verdict:** ✅ Solidified.

### D06 · Projectile Motion — L6 · ✅ solidified

**Route:** `/#/sp211/ch03-motion-2d/projectile` (shares the Free Fall family's integrator)

**Intended goal:** independence of horizontal and vertical motion; range/apex/flight-time; 45° optimum on flat ground (less with launch height); complementary angles give the same range; drag breaks the symmetry.

**Changes this review:**
- **Landing feedback:** every shot spawns an on-canvas burst at the impact point (confetti + "HIT!" on a hit, dust + "miss" otherwise).
- **Clearer score card:** hits · shots · accuracy, a result chip, and a live "landing vs target, off by ±Z m" line.
- **Game mode:** "Start game mode" → randomized reachable targets ("Next target"), a dotted aim guide tracing only the first ~60% of flight, a single fired shot (no preview), bullseye scoring by distance-from-centre (Bullseye 100 / Inner 60 / Hit 30), and a points/rounds/best scoreboard. Analysis tools hidden in game mode.

**Verdict:** ✅ Solidified.

### D05 · Relative Motion / Riverboat — L5 · ✅ solidified

**Route:** `/#/sp211/ch03-motion-2d/relative`

**Intended goal:** relative motion is vector addition, v_bg = v_bw + v_wg. Frame of reference is a viewpoint, not a second simulation: the same trajectory seen from the ground vs. from the water.

**Changes this review:**
- **Auto-fit view:** isotropic transform fits the whole crossing (launch, dock, buoy, track, sliding shoreline) into the pane with margins; scale is stable per configuration and rescales on control changes, so nothing runs off-frame.
- **Coordinate grid + labels:** each pane draws a labeled metre grid representing that observer's rest frame (x downstream, y across). Ground features slide across the water-frame lattice, which is what makes the frame switch legible.
- **Dock enlarged + labeled** (pilings, bold DOCK); added a **mid-channel buoy** as a second ground-fixed hazard.
- **Collision effects:** frame-independent bursts (detected in ground coords, rendered in all panes) — a "BONK!" splash at the buoy, a "DOCKED!" confetti fountain when the boat lands within 3 m of the dock. Fire once per crossing, re-armed on loop/param change.
- **Text professionalized** (InfoPanel, banners, badge, legend, captions): no em-dashes, no second person.
- Correctness: in the water frame the boat's trail is anchored to the fixed water point while the launch marker slides.

**Verdict:** ✅ Solidified.

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
