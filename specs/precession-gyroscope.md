# Spec — Precession Explorer (spinning top / gyroscope)

- **Status:** Built · `sp211` / `ch10-angular-momentum` / `precession` (dLabel `D30b`)
- **Requested:** 2026-10-21 · Jim
- **Target course / chapter:** `sp211` / `ch10-angular-momentum`
- **Proposed slug / route:** `precession` → `/#/sp211/ch10-angular-momentum/precession`
- **dLabel:** new (suggest `D30b`, companion to the existing `AngularMomentum` = D30)
- **Serves:** L29 (Angular Momentum & the vector nature of torque). Pairs with the L29
  runsheet primer (the spinning top that *stands*, *drifts sideways*, and *circles faster
  as it slows*) and the Block-2 law `τ = dL/dt`.

## Purpose + Moment

Make **precession** — and specifically *why a downward pull produces a sideways motion* —
visually obvious. The demo exists to answer the L29 primer's three puzzles with arrows:

> **Moment:** Gravity pulls the top straight *down*, yet the axis drifts *sideways* in a
> circle instead of falling. Freeze it and the reason is a vector sum: `ΔL = τ Δt` points
> sideways (perpendicular to **L**), so each instant nudges **L** sideways, never down.

The central ask from the request: **make the precession arrows abundantly clear** — **L**
along the axis, **τ** horizontal and perpendicular, and the running tip `ΔL = τΔt` that
rotates **L**. The vector-sum construction is the whole point, not a garnish.

## Learning goals

- Torque is a vector `τ = r × F`; it changes the **direction** of **L**, not (here) its length.
- A spinning body stores a large **L** along its axis; a perpendicular torque sweeps that
  axis around (precession) rather than toppling it.
- Precession rate `Ω = Mgr / (I ω)` ⇒ **faster spin → slower, statelier precession**;
  as the top slows, the sweep speeds up and widens, then it falls. (The counterintuitive
  primer part (c).)
- `τ = 0 ⇒ dL/dt = 0`: kill gravity and the axis freezes wherever it points.

## Visual design

A single **2.5-D isometric canvas** (plotly-basic has no 3D — render on `<canvas>` with an
isometric projection; reuse `@shared/lib/canvas` and `drawArrow` from `vectorArrow.js`):

- A **pivot** at the origin; the top's **symmetry axis** tilted at angle `θ` from vertical,
  spinning (show spin with a rotating hatch / a small curved spin arrow on the disk).
- **Arrows (the heart of the demo), each its own color + legend chip:**
  - **L** (gold `#C5B783`) — along the axis, length ∝ `I ω`.
  - **weight `Mg`** (gray) — straight down from the center of mass (distance `r` up the axis).
  - **τ = r × F** (navy-cyan accent) — horizontal, perpendicular to the vertical plane that
    holds the axis; magnitude `Mgr sinθ`. Draw the parallelogram / right-hand curl that
    produces it on demand.
  - **ΔL = τ Δt** (bright accent) — a short arrow added to the tip of **L**, showing the next
    instant's nudge; **L + ΔL** is visibly rotated horizontally.
- **Traces:** the axis tip sweeps a **horizontal circle** (precession); optionally show the
  full **cone** the axis sweeps. Fade-trail the tip.
- A **top-down inset** (bird's-eye) showing **L**'s horizontal projection chasing around the
  circle, with **τ** always 90° ahead — the cleanest view of "torque leads, L follows."
- **KaTeX panel:** `τ = r × F = dL/dt`, `|τ| = Mgr sinθ`, `Ω = Mgr / (Iω)`.

## Interactions & modes

**Sliders (ControlPanel + Slider):** spin rate `ω`, tilt `θ`, rotor inertia `I` (or mass `M`
and arm `r`), gravity `g` (preset planets optional), animation speed.

**Toggles:** show/hide each arrow (**L**, **τ**, **Mg**, **ΔL**); show cone; show tip trace;
show top-down inset; show the **RHR curl** that builds **τ**; **gravity on/off**.

**Signature control — "Step ΔL":** pause and advance one small `Δt` at a time. Each press
draws `ΔL = τΔt` at the tip of **L** and redraws **L ← L + ΔL**, so students watch the axis
rotate sideways one bite at a time. This is the explanatory core; make it prominent.

**Readouts (≥18px mono, ~10 Hz):** `|L|`, `|τ|`, precession rate `Ω` (rev/min and rad/s),
`θ`, spin `ω` (rev/s).

**Modes (`?mode=`):**
- `top` (default) — a spinning top on a table, tilted, precessing. Matches the primer.
- `gyroscope` — a wheel on a pivoted axle held horizontal (`θ = 90°`): it *doesn't fall*,
  it precesses in a flat circle. The most dramatic "defies gravity" view; classic lecture gyro.
- `applications` — illustrative, calibrated-for-feel presets: a thrown **football** (spin
  stabilizes heading), a **spacecraft** reaction/CMG hold, and **Earth's axis** (26,000-yr
  precession of the equinoxes). Short captions; not meant for precise numbers.

## Animation

Per `CONTRIBUTING.md`: one `requestAnimationFrame` loop reading `ω, θ, I, g, speed` from
refs; integrate the precession angle `φ += Ω · dt` and the spin phase off `clockRef`; draw
the canvas every frame; publish readouts throttled. No per-frame `setState`.

## Acceptance criteria

- With gravity on, the axis **precesses** (tip traces a horizontal circle); direction is
  correct by RHR for the chosen spin sense.
- **τ** renders horizontal and perpendicular to the axis's vertical plane; **ΔL = τΔt** is
  visibly along **τ**, and "Step ΔL" rotates **L** sideways (not down).
- Increasing `ω` **lengthens L and slows Ω** (`Ω ∝ 1/ω`); the "faster spin → slower
  precession" surprise is directly observable, with a readout confirming it.
- Lowering `ω` toward zero speeds Ω up and widens the cone until the model tips (guard the
  `ω → 0` singularity: cap `Ω`, annotate "precession rate off-scale / top falls").
- **Gravity off ⇒ axis freezes** (`τ = 0 ⇒ L constant`).
- `gyroscope` mode (`θ = 90°`) shows pure horizontal precession with no fall.
- KaTeX, palette, font sizes, and the rAF-off-render pattern all per repo conventions.

## Technical notes

- **No 3D engine.** Use an isometric `<canvas>` projection (a fixed view matrix mapping
  `(x,y,z) → screen`), which the repo already favors for vector scenes. If true
  orbit-controllable 3D is desired later, that is a **Three.js** addition (new dependency)
  and should be its own follow-up — out of scope for v1.
- Keep the **spin** visual decoupled from the **precession** visual; cap the on-screen spin
  rate and add a "spin not to scale above N rev/s" note, exactly as `AngularMomentum.jsx` does.
- Physics in SI; convert `Ω` to rev/min for the readout.
- Reuse `drawArrow` for all vectors; give each arrow a consistent color used in both the main
  view, the top-down inset, and the legend.

## Out of scope / future

- **Nutation** (the small wobble superposed on precession) — mention in an InfoPanel; a
  later toggle could add it.
- Quantitative application numbers beyond illustrative feel.
- True 3D / VR.
