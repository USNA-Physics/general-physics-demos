# SP211 Demo — Enhancement & Fix Backlog

Synthesis of a read-only review pass over all 22 lesson demos (Aug 2026). Two buckets:
- **⚠ Fix** — correctness / "the demo contradicts its own point" issues. Recommend clearing these first.
- **✦ Enhance** — cooler / more explanatory / more interactive / more customizable ideas, tagged
  `[WOW | EXPLAIN | INTERACT | CUSTOMIZE | PHYSICS]`. Pick per taste.

Annotate freely (add ✅/❌/notes per line) during per-demo review.

---

## Cross-cutting patterns (high leverage — apply to many demos)

1. **Drag the physical object** to set/scrub state (cart on D01, launch vector on D06, boat heading D05, mass amplitude D35, bob angle D35, force tip D25/D09, ball height D18, object depth D34). Recurring gap: sliders where a direct on-canvas gesture would be more visceral.
2. **Ghost / race / side-by-side comparison** to prove an invariance (heavy-vs-light D11/D12, two amplitudes same period D35, two frames at once D05, D01-vs-D24 overlay, two collisions D22, complementary-angle twin arc D06).
3. **Force / vector decomposition arrows** drawn in place (v_x/v_y on D06, F∥/F⊥ on D15 & D25, gravity-vs-drag on D12, tip-to-tail force polygon on D09).
4. **A synced strip-chart or phase-space inset** (x-v ellipse on D18/D35, speed-vs-position on D04, L(t) flat line on D30, U(r) energy well on D31, y-vs-t on D37).
5. **Live energy/quantity audit bars** extended to more demos (K+U+work on D30 skater, KE/PE breathing on D40, P·t work bars on D15 race, energy "drain" flow on D28).
6. **Real-world number callouts** (real v_esc for planets D31, Crab-pulsar rev/s D30, injury-threshold g's D22, material μ presets D11, planet gravity D35).

---

## Unit I — Kinematics & Newton

### D01 · 1D Motion Grapher
- ⚠ Ship the spec's **"speed-up-then-brake" preset** (code has constant-v/constant-a/up-back instead).
- ✦ [WOW] Add the **cart-on-a-track strip** above the plots (the physical object is missing from a motion demo); show v & a arrows on it.
- ✦ [INTERACT] **Drag the cart to scrub** (bidirectional with the timeline slider).
- ✦ [EXPLAIN] Draw the **tangent-slope triangle** on x(t)/v(t) at the marker (slope = the v/a readout).
- ✦ [EXPLAIN] In `area` mode, **sign-color the accumulating area** (gold +, red −) so Δx reads as net signed area on up-back.

### D06 · Projectile (Free Fall mode)
- ⚠ **Projectile+drag combined mode is unbuilt** — the spec's headline cross-lesson payoff ("the 30°/60° tie repealed by drag, closing the L6 loop"). Currently projectile is drag-free.
- ✦ [WOW] **Draggable target/hoop** to hit — makes complementary angles "two ways to hit it."
- ✦ [EXPLAIN] **Auto-draw the complementary-angle twin arc** (faded) landing at the same spot.
- ✦ [EXPLAIN] Decompose launch v into **v_x / v_y arrows** at the origin.
- ✦ [CUSTOMIZE] **"Sweep & auto-fire"** button that walks 0→90° filling the R(θ) curve as an animation.

### D12 · Drag (Free Fall mode)
- ⚠ **Cross-section area A is hardcoded** (0.05 m²); only mass is adjustable, so "heavy vs light" really means "high vs low vₜ via mass" — conflates mass and ballistic coefficient.
- ⚠ Post-landing the **vacuum-twin v(t) flat-lines** and diverges meaninglessly from the still-falling air curve; clip/annotate at each land time.
- ✦ [PHYSICS] **Object presets (feather/paper/baseball/bowling/skydiver)** setting (m, A, C) together — makes heavy-vs-light honest, widens the vₜ spread.
- ✦ [WOW] **Two objects dropping side-by-side** (air vs vacuum), not just their graphs.
- ✦ [EXPLAIN] Add **a(t) trace** (a: g→0) and **gravity-vs-drag force arrows** shrinking to zero at vₜ.

### D04 · 2D Vector Kinematics Sandbox
- ⚠ "Moment" banner threshold is in px units (speed/scale-dependent); gate on **aN/aMag > cos(20°)** instead (scale-free).
- ✦ [EXPLAIN] **Speed-vs-loop-position strip chart** (flat in uniform; a_t = its slope).
- ✦ [WOW] **Color the path by curvature** (κ=1/r heatmap) — sharpest bend glows, a_⊥ peaks there.
- ✦ [CUSTOMIZE] **Snap-to-shape presets** (circle, ellipse, figure-8) — figure-8 shows a_⊥→0 & flips at the inflection.
- ✦ [INTERACT] **Freeze-frame scrub** to park the particle at a curve apex and interrogate frozen arrows.

### D05 · Relative Motion (Riverboat)
- ⚠ **Water-frame streaks don't freeze** — they keep scrolling even when you're "riding the current," contradicting the frame idea.
- ✦ [WOW] **Split-screen both frames at once** (or ghost the other) instead of toggling memory.
- ✦ [INTERACT] **Drag the boat heading on-canvas** (grab the v_bw arrow).
- ✦ [PHYSICS] **"Fastest crossing" preset** (heading 90° is quickest even though you miss) vs the crab solution.
- ✦ [CUSTOMIZE] Expose **river width** (drift scales with crossing time).

### D07 · UCM Vector Visualizer
- ✅ (fixed this session) banked friction direction.
- ⚠ Kinematic: **the "no-force ghost" (best feature) silently disappears after Reset**; velocity arrow is fixed-length regardless of v.
- ⚠ Banked: friction is drawn at full required magnitude even when it exceeds μN (should cap at f_max, dash the deficit).
- ✦ [WOW] **Δv construction inset** (v(t) & v(t+Δt) tail-to-tail → Δv points inward) — the derivation of centripetal.
- ✦ [WOW] Trace the **hodograph** (tip of v over a period = a circle of radius v).
- ✦ [INTERACT] Banked: a **"friction budget" gauge** (|f_req| vs ±f_max) + animate the car sliding when it lets go.

### D09 · Free-Body Diagram Builder
- ⚠ On the incline a **"correct" diagram shows nonzero ΣF** (palette magnitudes aren't in equilibrium) — can teach that a correct static FBD doesn't close. Derive expected magnitudes from the scene (N=W cosθ, f=W sinθ) so a correct answer visibly → ΣF≈0.
- ✦ [WOW] **Equilibrium meter**: green "⚖ balanced, a=0" badge when ΣF≈0; else bold ΣF arrow and the body drifts.
- ✦ [INTERACT] **Tip-to-tail force-polygon toggle** — closure (or gap = net force) shown geometrically.
- ✦ [EXPLAIN] After Check, a **"Show me"** button ghost-drawing the correct forces over the attempt.
- ✦ [CUSTOMIZE] **Incline-angle slider** (currently hard-coded 28°) → one scene becomes a family.

### D11 · Friction Incline
- ⚠ **Stacked preset**: bottom block's normal ignores the top block's weight (N should be (m₁+m₂)g cosθ); the coupled "move together vs top-slides-off" case is oversimplified.
- ✦ [EXPLAIN] Plot the **friction-vs-θ sawtooth** (linear rise → discontinuous drop at θ_crit) with a live dot — the single most explanatory artifact here.
- ✦ [PHYSICS] **Ghost heavy block** breaking away at the same angle — proves mass-independence visually.
- ✦ [INTERACT] **Hysteresis exploration** — once sliding, lower θ; it keeps sliding until tanθ<μ_k (re-stick angle < breakaway). Great follow-on surprise.
- ✦ [CUSTOMIZE] **Material presets** (rubber/ice/teflon/wood) setting μ_s,μ_k pairs.

---

## Unit II — Energy & Momentum

### D14 · Center of Mass Playground
- ⚠ `deleteSelected` uses a **stale index** (can highlight the wrong body after deleting a non-last mass); tumbling time-of-flight readout is a dead field.
- ✦ [WOW] **Stroboscope**: stamp faint whole-body snapshots along flight — messy copies, CM stars on a clean parabola.
- ✦ [PHYSICS] **Throw-and-explode**: split the body at apex; the CM sails on undisturbed — the money demo for internal forces.
- ✦ [INTERACT] **Drag the CM★** to inverse-solve which mass/where.
- ✦ [PHYSICS] **Spin about a non-CM pivot** toggle → path becomes a cycloid, CM no longer clean parabola (contrast).

### D15 · Work & Power Visualizer
- ⚠ **Curved-ramp power is faked** (crate moves at constant screen speed while the readout claims power tracks steepness; a mystery `+5` in Ftan). Drive it with real constant power v=P/F∥ so it visibly crawls on the steep bit.
- ⚠ **"Custom (drag points)" is a misnomer** — on-plot markers aren't draggable (it's panel sliders). Wire real drag or relabel.
- ✦ [PHYSICS] **Negative work**: let θ>90° (or a braking toggle) so W goes negative/red.
- ✦ [EXPLAIN] In area mode, twin F(x) with a **live W(x)=∫F accumulation curve** (area-under-one = height-of-other).
- ✦ [PHYSICS] **Spring round-trip** (F=kx out and back) → net work zero, sets up PE.

### D18 · Energy Landscape Explorer
- ⚠ **Wall reflection damps energy ×0.5 even at μ=0**, so a ball that reaches a wall lowers its own E-line — contradicts "never budges."
- ⚠ **μ=0 vs μ>0 K-branch discontinuity** (E-line jumps when friction first nudged off zero); edit-mode reshapes U without re-freezing E₀ (can strand the ball above its E-line).
- ✦ [PHYSICS] **Phase-space (x,v) inset** — ellipse for the bowl, figure-8 separatrix for the double well, dot pinned at the unstable point on the hump. (Instructor jaw-drop.)
- ✦ [INTERACT] **Ghost race** — two near-identical drops on the double well diverge into different wells.
- ✦ [PHYSICS] **Small-oscillation overlay** at any minimum (U≈½U″x², T=2π√(m/U″)) — ties L18 to SHM.

### D22 · Collision Sandbox
- ⚠ **2D resolver only conserves momentum cleanly at e=1** (reflects the normal component only); verify the y-bar "stays zero" for e<1 with unequal masses.
- ⚠ **Mid-collision elasticity scrub doesn't read** — impulse is applied in a single frame, so e is effectively locked at contact (add a brief contact dwell); possible tunneling at high v/low frame rate.
- ✦ [WOW] **Center-of-mass frame toggle** (1D) — total-p bar literally zero, yet KE still drops.
- ✦ [PHYSICS] **2D vector-sum inset** — p₁+p₂ tip-to-tail landing on p_in (one triangle = conservation).
- ✦ [PHYSICS/WOW] **Occupant g-gauge** with survivable-threshold band (impulse mode) — the airbag argument, quantified.
- ✦ [CUSTOMIZE] Same-area **force-profile shapes** (rigid/half-sine/triangular) overlaid — peak depends on shape.

---

## Unit III — Rotation, Gravity & Fluids

### D24 · Rotational Kinematics Grapher
- ⚠ Rim velocity arrow uses |ω| and a hard-coded CCW tangent — **points wrong if ω<0** (safe today, fragile).
- ✦ [WOW] **D01-vs-D24 ghost overlay** (Latin x/v/a dimmed behind Greek θ/ω/α) — the isomorphism in one figure (the spec's headline moment).
- ✦ [INTERACT] **Flick-the-disk** input (drag rim → ω) — the kinesthetic twin of D01's drag-the-cart.
- ✦ [PHYSICS] Shade **area under ω(t) = θ** and tangent-slope on θ(t) = ω (D01's area grammar, in Greek).
- ✦ [CUSTOMIZE] **Rim-radius slider** — v_rim scales, ω invariant.

### D25 · Moment of Inertia Explorer
- ⚠ Torque playground has **no cap on α** (ω runs off the readout if left running); bolt orientation drifts so the "pull along handle → τ=0" geometry rotates.
- ✦ [WOW] **Race-to-a-target-angle** in shapes mode (winner banner) — same-J different-I with stakes.
- ✦ [PHYSICS] **Point-mass builder for I** (drop masses at radii, watch I=Σmr² accumulate, then "smear" to the continuous body) — demystifies the constant c.
- ✦ [EXPLAIN] Atwood **tension-difference callout** (T₁≠T₂, ΔT=½M_p a) — the invisible mechanism.
- ✦ [EXPLAIN] Torque mode: also draw **F∥/F⊥ decomposition** (dual to the lever arm you already show).

### D28 · Rolling Race
- ✦ [WOW] **Energy "reservoir drain"** animation — PE draining into K_trans + K_rot, hoop visibly diverting half the stream.
- ✦ [WOW] **Photo-finish** strip with time deltas ("sphere +0.0s, hoop +0.4s").
- ✦ [INTERACT] **Class-poll tally** on the vote (the vote *is* the lesson).
- ✦ [CUSTOMIZE] **Mystery racer** with hidden c — infer solid vs hollow from finishing order.
- ✦ [PHYSICS] **Slip warning** — real rolling needs μ≥(c/(1+c))tanθ; the hoop would slip on a steep ramp.

### D30 · Angular Momentum Conservation
- ⚠ **Skater visual spin is decoupled from the ω readout** (ad-hoc 0.35/r mapping; neutron-star spin disagrees with the reported ω by orders of magnitude). Label the visual "not to scale" or reconcile.
- ✦ [PHYSICS] Vector mode: **drag the pivot O** — L unchanged moving along the line of motion, scales moving perpendicular.
- ✦ [PHYSICS] **τ=0 ⟹ dL/dt=0 toggle** — add gravity, path curves, L no longer constant, live dL/dt = r×F.
- ✦ [EXPLAIN] Skater: **stacked "KE_before + work = KE_after" bar** (energy audit, not just a ×ratio).
- ✦ [WOW] Neutron star **real-scale callout** (Sun 25-day → 20 km ≈ 1000 rev/s, calibrated to the Crab).

### D31 · Orbit Simulator
- ⚠ **Suborbital "crash" is geometrically off** — launch is always at perigee, so mult<1 launches at *apogee* and many sub-circular speeds make a smaller ellipse that never hits the surface, undercutting "keeps missing the ground." Verify the crash condition.
- ✦ [EXPLAIN] Escape mode: **U(r) potential-well diagram with the E-line** — bound (line cuts the well → turning point) vs escape (clears it). The canonical picture; explains the sign.
- ✦ [WOW] **Newton's-cannonball layering** — each faster shot leaves a faded arc (suborbital→circle→ellipse), building the Principia figure.
- ✦ [INTERACT] **Click-to-launch** (drag the velocity vector, not tangential-only) → tilted ellipses, perigee ≠ launch point.
- ✦ [PHYSICS] Live **areal-velocity dA/dt** readout (constant) beside the equal-area wedges; **turning-point marker** r_max=−GM/E racing off-screen as E→0⁻.

### D34 · Buoyancy Tank
- ⚠ Verify the **floating rest fraction is physical** (submerged-fraction geometry vs analytic ρ_obj/ρ_fl is currently coincidental to the pixel size — check a cork rests at ~24%, and that floating settles to F_B=W / net 0).
- ✦ [WOW] **"Steel floats in mercury" preset** (re-enable mercury for that case) — density-is-relative punchline.
- ✦ [PHYSICS] Pressure mode: draw the **net upward resultant** of the four arrows, labeled "= F_B for this element."
- ✦ [INTERACT] **Drag the object down and release** — watch it return to equilibrium (restoring behavior as an experiment).
- ✦ [PHYSICS] Submarine **depth-compression toggle** (deeper → hull shrinks → density rises → runaway dive) — "why subs are hard."

### D35 · SHM Explorer
- ⚠ Spring: changing k/m/A mid-flight **teleports the mass** (phase continuous but A/ω jump) — integrate phase incrementally.
- ⚠ Pendulum: **transient "lie"** — "T(real)" equals the small-angle prediction for the first ~1.5 swings even at 80° until a period is measured; `cycles` computed but never shown.
- ✦ [WOW] **Two amplitudes released together** (spring) / **10° vs 60° pendulum race** — isochronism, then its breakdown, made unmistakable.
- ✦ [CUSTOMIZE] **Gravity selector** (Earth/Moon/Jupiter) — "clocks run slow on the Moon."
- ✦ [INTERACT] **Drag the mass/bob** to set amplitude/angle (the gesture the InfoPanel describes).
- ✦ [CUSTOMIZE] **Damping slider** with an exponential envelope — period still amplitude-independent as it decays.

---

## Unit IV — Oscillations & Waves

### D37 · Traveling Wave Explorer
- ⚠ Longitudinal **pressure sign is inverted** — p ∝ −∂s/∂x, so compression should sit at the opposite zero; the 90° relation is right but the convention is flipped (matters for exam-trap claims).
- ⚠ Transverse "crest" guide line sits on a **phase zero, not a crest**.
- ✦ [WOW] **Ghost-trail toggle** — fading vertical smears at each particle's past positions (21 vertical segments, gold shape gliding through) = pattern-vs-medium in one glance.
- ✦ [PHYSICS] **Energy-transport shading** P(x,t)=−F_T(∂y/∂x)(∂y/∂t) — energy flows right though particles only bob.
- ✦ [INTERACT] **Draggable cursor** in longitudinal reading s, p, density at one x ("displacement zero, pressure max").
- ✦ [INTERACT] Intensity: **second listener** with live dB *difference* ("3 m → 6 m: −6 dB").

### D39 · Doppler Wavefront Visualizer
- ⚠ **"Observer moves" branch forces cosψ=1** — reports blue-shift even on the receding half, so the formula badge disagrees with the live arrival-count (defeats the two-way-verification that is the demo's point). Fix, then feature the asymmetry.
- ✦ [PHYSICS] After the fix, **dual readout** f′_source vs f′_observer at matched Mach — the deep asymmetry, side by side.
- ✦ [WOW] **Per-wavefront audio click** (you hear the rate) + **screen-flash "boom"** at Mach 1.
- ✦ [EXPLAIN] Annotate **λ_ahead vs λ_behind** as literal ring spacing.
- ✦ [CUSTOMIZE] **Relativistic-light toggle** (C fixed, √((1+β)/(1−β))) — kills the asymmetry; sound-vs-light contrast.

### D40 · Superposition Sandbox
- ⚠ **Pluck "freeze at flat" is only exact for a single mode** — a multi-harmonic pluck is never perfectly flat (higher harmonics ≠ 0 when the fundamental is), so the "all kinetic" arrows are approximate; caption it (a memorable subtlety).
- ⚠ Beats are **temporal only** (both components share k) — the sum breathes uniformly; no traveling beat nodes.
- ✦ [PHYSICS] **KE/PE breathing bars** in standing mode — all-KE exactly at the flat instant (continuous version of the freeze).
- ✦ [EXPLAIN] **Live harmonic-spectrum bar chart** for the pluck (toggle harmonics on/off to rebuild the triangle).
- ✦ [WOW] **Moving-beats mode** (different k too) — beat nodes travel at the group velocity; lead-in to group vs phase velocity.
- ✦ [EXPLAIN] **LIGO/laser-cavity overlay** — scale the standing wave to a two-mirror cavity (make the InfoPanel finale visual).
