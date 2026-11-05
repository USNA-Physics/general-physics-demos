# Spec — Chaotic Pendulum Explorer (driven damped pendulum)

- **Status:** Built — `/#/sp211/ch14-oscillations/chaos` (dLabel `D36`); modes `run` · `divergence` · `poincare` · `bifurcation` · `basins`
- **Requested:** 2026-10-26 · Jim
- **Target course / chapter:** `sp211` / `ch14-oscillations`
- **Proposed slug / route:** `chaos` → `/#/sp211/ch14-oscillations/chaos`
- **dLabel:** new (suggest `D36`, the first demo native to L36; companion to `ShmExplorer` = `D35`)
- **Serves:** L36 (Oscillating Systems: Simple and Physical Pendulums). Pairs with the L36
  derivation's closing enrichment box *"The limit of the ideal: deterministic chaos"* — the
  small-angle approximation `sin φ ≈ φ` is exactly the linearization you drop to make a pendulum
  chaotic. Also back-references L35's amplitude-independence (the predictability that chaos destroys).
  Enrichment / horizon demo, not a homework or exam target.

## Purpose + Moment

Make **deterministic chaos** concrete on the one system the students have just derived: a pendulum.
The whole of L35–L36 sells the pendulum as the *most predictable* motion in physics — but that
rests on `sin φ ≈ φ` (linear) and no damping/driving. Keep the full `sin φ`, add damping and a
periodic push, and the *same* deterministic equation becomes unpredictable. The demo exists to make
that transition visible, and to show that the unpredictability has exquisite hidden structure.

> **Moment:** Two pendulums obeying identical laws, released a hair's breadth apart, track together
> for a few swings and then diverge completely — one swinging gently, the other going over the top.
> Nothing is random; the equation is exact. Yet the map of "where does it end up" is a *fractal*,
> detailed at every zoom, so no finite-precision start can predict the far future.

Two counterintuitive payoffs, both directly observable here: **sensitive dependence** (determinism
without predictability) and **fractal structure** (the strange attractor in the Poincaré section and
the fractal basin boundary, the mechanical cousin of a Julia set).

## Learning goals / lessons served

- A pendulum is simple-harmonic **only** in the small-angle limit; the nonlinearity is the real
  `sin φ`. Chaos needs that nonlinearity — a *linear* driven damped oscillator is perfectly
  predictable (it forgets its start and settles to one steady swing). (L36 Block 1 scope note.)
- **Deterministic ≠ predictable.** Sensitive dependence on initial conditions: nearby starts diverge
  exponentially (a positive Lyapunov exponent), so finite precision loses the long-term future.
- **Route to chaos.** As the drive strength rises the steady motion **period-doubles** (period 1 → 2
  → 4 → …) and then becomes chaotic — the bifurcation cascade.
- **Order inside chaos.** The chaotic motion is not a smear: sampled once per drive period
  (**Poincaré section**) it collapses onto a **strange attractor** with fractal, self-similar
  structure. The long-term outcome map over initial conditions is a **fractal basin boundary**,
  the same phenomenon that makes a **Julia set** the boundary between basins in complex dynamics.

## Governing equation

The dimensionless driven damped pendulum (time in units of `1/ω₀`, `ω₀ = √(g/L)`):

```
θ'' + (1/Q)·θ' + sin θ = A·cos(ω_D·t)
```

- `Q` — quality factor (damping; large `Q` = light damping).
- `A` — dimensionless drive amplitude (forcing torque relative to gravity). Chaos lives near `A ≈ 1`.
- `ω_D` — drive frequency (a common choice is `ω_D = 2/3`).

`θ` is unbounded (the bob can go over the top); wrap to `(−π, π]` for display only, never for the
integrator. Representative presets that **walk the period-doubling route** (pin exact values during
implementation against a reference such as Taylor, *Classical Mechanics*, ch. 12): a period-1 drive,
a period-2 drive, a period-4 drive, and a fully chaotic drive, all at fixed `Q` and `ω_D`.

## Visual design

Dark theme, USNA navy/gold. Three coordinated panels, each reusing `@shared/lib/canvas` +
`drawArrow` (pendulum) and `@shared/lib/plotly` (2D charts — **no 3D/WebGL**):

- **Pendulum canvas (left):** the bob on its rod swinging from a pivot, full range including
  over-the-top. Draw the **drive** as a small oscillating arrow/forcing indicator at the pivot and
  the instantaneous velocity arrow on the bob. In two-pendulum mode, draw both bobs (gold `#C5B783`
  and a contrasting accent) with fade trails so the divergence is unmistakable.
- **Phase-space plot (center):** `θ` (x, wrapped to `(−π, π]`) vs angular velocity `θ'` (y). The live
  trajectory draws as a fading trail; for a periodic drive it closes into a loop, for chaos it never
  repeats and fills a band. Over-the-top motion wraps cleanly (or use an unwrapped toggle).
- **Poincaré / structure plot (right, mode-dependent):** strobe the phase point once per drive period
  `T_D = 2π/ω_D` and accumulate the dots — regular motion gives a few fixed points, chaos reveals the
  **strange attractor** (fractal filigree). The same pane hosts the bifurcation diagram and the basin
  map in their modes.
- **KaTeX panel:** the governing equation, `T_D = 2π/ω_D`, and the current `(Q, A, ω_D)`. A one-line
  caption naming the regime ("period-2", "chaotic", "Lyapunov λ ≈ …").

## Interactions & modes

**Sliders (ControlPanel + Slider):** drive amplitude `A`, damping `Q`, drive frequency `ω_D`, initial
angle `θ₀`, initial velocity `θ'₀`, animation speed. `A` is the headline knob — label it and make its
effect (period-doubling → chaos) the first thing a user explores.

**Toggles:** phase-space trail on/off and trail length; Poincaré strobe on/off; unwrap `θ`; show drive
indicator; show velocity arrow.

**Signature control — "Release the twins":** in `divergence` mode, a button that launches a second
pendulum offset from the first by a tiny `Δθ₀` (e.g. `10⁻³` rad), then plots `Δ(t) = |state₁ − state₂|`
on a **log axis**. Students watch the two overlay, then peel apart; the log plot's straight-line rise
is the positive Lyapunov exponent. This is the explanatory core of the "deterministic ≠ predictable"
point; make it prominent.

**Modes (`?mode=`):**

- `run` (default) — live pendulum + phase space, with the period-1 / 2 / 4 / chaotic **drive presets**
  as one-tap buttons. The user sees the phase loop double, then dissolve.
- `divergence` — the twin pendulums and the `log Δ(t)` plot; sensitive dependence on initial conditions.
- `poincare` — accumulate the strobed section into the **strange attractor**; a zoom control reveals
  self-similar fractal structure. Short InfoPanel: "sampled once per drive beat, chaos is not a smear."
- `bifurcation` — sweep `A` across a range and plot the Poincaré-sampled `θ` vs `A`: the **period-
  doubling cascade** to chaos, with the preset `A` values marked. (Precomputed; see technical notes.)
- `basins` — a 2D grid of initial conditions `(θ₀, θ'₀)` colored by long-term outcome (e.g. which
  rotation number / which attractor they settle to). The boundary between colors is a **fractal**;
  a zoom shows it stays detailed at every scale. Include an optional side-by-side **Julia-set** inset
  with a one-line analogy: *a Julia set is the basin boundary of `z → z² + c`; this is the basin
  boundary of a real pendulum — same mathematics of fractal basins.* (Precomputed; see technical notes.)

**Readouts (≥18px mono, ~10 Hz):** `θ` (deg), `θ'`, drive phase, elapsed drive periods, current regime
label, and in `divergence` mode the running separation `Δ` and an estimated Lyapunov `λ`.

## Animation

Per `CONTRIBUTING.md`: one `requestAnimationFrame` loop reading `A, Q, ω_D, speed` and the integrator
state from refs; **fixed-step RK4** on the dimensionless ODE (take several substeps per frame so the
step stays well below `T_D`; chaos amplifies integration error, so a small fixed `dt` matters), draw
all canvases every frame, publish readouts throttled (~10 Hz). No per-frame `setState`. The Poincaré
accumulation appends a point each time the drive phase wraps.

## Math shown (KaTeX)

- `\theta'' + \tfrac{1}{Q}\,\theta' + \sin\theta = A\cos(\omega_D t)`
- `T_D = \dfrac{2\pi}{\omega_D}` (the Poincaré strobe period)
- small-angle reminder: `\sin\theta \approx \theta \Rightarrow` linear, predictable SHM (the limit chaos leaves behind)
- `\Delta(t) \sim \Delta_0\, e^{\lambda t}` (sensitive dependence; `λ > 0` in the chaotic regime)

## Acceptance criteria

- `run` mode: stepping the drive presets shows a phase-space loop that is **period-1, then 2, then 4,
  then chaotic**; the regime label matches what the loop shows.
- `divergence` mode: twin pendulums overlay then diverge; the `log Δ(t)` plot is roughly linear while
  the separation is small (positive slope ⇒ `λ > 0`) and the two pendulums end in visibly different
  states. In a **regular** (period-1) preset the twins do **not** diverge — the contrast is the lesson.
- `poincare` mode: a regular drive yields a few fixed points; a chaotic drive yields a **strange
  attractor**, and zooming shows it remains structured (not a filled blob, not a single curve).
- `bifurcation` mode: the diagram shows the **period-doubling cascade** with the preset `A` values
  landing on period-1/2/4/chaotic bands as labeled.
- `basins` mode: the outcome map has a **fractal boundary** that stays detailed under zoom; the Julia
  inset + analogy caption render.
- Integrator is stable and energy-sane in the undriven, undamped limit (`A = 0`, `Q → ∞`: closed phase
  orbits, no spurious drift). Linear check: small `θ₀`, `A = 0`, large `Q` reproduces SHM at `ω₀`.
- KaTeX, palette, font sizes, and the rAF-off-render pattern all per repo conventions.

## Technical notes

- **Realtime vs precomputed.** `run`, `divergence`, `poincare` are **realtime** (single trajectory, or
  two — cheap). `bifurcation` and `basins` integrate **thousands** of trajectories and cannot run per
  frame: compute them in a **Web Worker** with progressive rendering (stream rows/tiles as they finish,
  show a progress bar), and/or **precompute offline** and ship the result as a static image/dataset
  loaded on demand. Favor the worker for `bifurcation` (1-D sweep, fast) and precomputed tiles for
  `basins` (2-D, expensive), with live zoom re-dispatching a worker job for the visible window.
- **Integrator.** Fixed-step RK4 on the dimensionless system; expose `dt` internally, default small
  (e.g. `T_D/200`). Do **not** use adaptive stepping for the live view (variable cost breaks the rAF
  budget). Wrap `θ` only for display.
- **Determinism for reproducibility.** No `Math.random()` in the physics; "twin" offset is a fixed
  `Δθ₀`. Basin/bifurcation results must be reproducible from `(Q, ω_D, grid, dt, settle-time)`.
- **Poincaré hygiene.** Discard a **transient** (drop the first N drive periods) before accumulating,
  so the attractor is clean. Expose N.
- **Colormap.** Use `@shared/lib/color`; keep basin colors colorblind-safe and distinct from the
  navy/gold chrome.
- Physics dimensionless internally; convert `θ` to degrees for the readout only.

## Out of scope / future

- **Full 3D / spherical pendulum**, double pendulum, or magnetic-pendulum basins (the classic
  three-magnet fractal) — tempting follow-ups, each its own spec; the single driven pendulum is the
  minimal system that shows every effect here.
- **Quantitative Lyapunov spectrum / fractal-dimension readouts** beyond an illustrative `λ` estimate.
- **Live high-resolution basin zoom** to arbitrary depth (bounded by the precompute/worker budget;
  ship a few zoom levels, not infinite).
- A deeper **complex-dynamics module** (interactive Julia/Mandelbrot) belongs in the `math` course if
  wanted; here the Julia set is only a one-panel analogy for fractal basins.
