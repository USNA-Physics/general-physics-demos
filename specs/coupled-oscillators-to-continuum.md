# Spec — Coupled Oscillators → the Continuum String (where the wave equation comes from)

- **Status:** Built · **Requested:** 2026-11-16 · Jim · **slug** `coupled-oscillators` · modes `chain` (default), `modes`, `continuum`
- **Built:** 2026-11-16 · `src/courses/sp211/ch15-waves/CoupledOscillators.jsx` · route `/#/sp211/ch15-waves/coupled-oscillators`
- **Target:** course `sp211` / chapter `ch15-waves` / slug `coupled-oscillators` · **dLabel D37b**
- **Route:** `/#/sp211/ch15-waves/coupled-oscillators`
- **Serves:** **SP211 L37 (Simple Wave Motion and Harmonic Waves), Block 0** — the "a wave is just many
  coupled SHM oscillators" bridge made watchable. It closes the gap students feel between the single
  oscillator of L35–L36 (pendulum, mass–spring) and the field `y(x,t)` of the wave equation: add beads,
  couple them, take `N → ∞`, and the wave equation *emerges* with nothing new but Newton's second law.
  Forward ties: normal modes → **L41 standing waves**; the long-wavelength non-dispersive limit → the
  pulse-keeps-its-shape claim of L37 Block 1. Sibling to the traveling-wave explorer (D37, `.../traveling-wave`).

## Purpose + Moment

Make the continuum limit something a student can **turn a knob and watch happen**. Start with one bead on a
string — pure SHM, L35. Add a second: two normal modes, a slow beat as energy sloshes between them. Add more
and the "modes" start to look like sine arches; a disturbance begins to *travel* instead of just sloshing.
Push `N` toward a hundred and the lumpy chain becomes a smooth string carrying a clean pulse at one speed.
The payoff line for Block 0: **the wave equation is not a new law — it is Newton's second law on a great many
coupled oscillators, in the limit where the beads are too dense to see.**

> **Moment:** drag `N` from 1 upward. At `N=1` the bead is the L35 oscillator. At `N=2–3` you see discrete
> normal modes and beating. By `N≈20` a plucked disturbance propagates down the chain and holds its shape;
> overlay the smooth continuum curve and the beads sit right on it. The discrete dispersion curve
> `ω = 2√(F_T/ma)·|sin(ka/2)|` visibly straightens into the line `ω = vk` at long wavelength — the exact
> moment the medium becomes non-dispersive and `v = √(F_T/μ)` becomes a single speed for every wavelength.

## Learning goals

- A string is a **chain of coupled simple harmonic oscillators**: each bead (mass `m`, spacing `a`) is pulled
  back by the tension in the two segments to its neighbors, `m ÿ_n = (F_T/a)(y_{n+1} − 2y_n + y_{n−1})`.
- **One bead is SHM; many beads is a wave.** Nothing new is introduced from `N=1` to `N→∞` — only Newton's
  second law applied to more masses. The single bead's `ω = √(2F_T/ma)` is the `N=1` case.
- **Normal modes:** an `N`-bead chain has exactly `N` normal modes, shapes `sin(pπn/(N+1))`, each a collective
  SHM at its own frequency. Low modes already look like the sine arches of a continuous string.
- **The continuum limit:** as `a → 0`, `N → ∞` with `μ = m/a` and `L = Na` fixed, the second difference becomes
  a second derivative and the chain's equations become the **wave equation** `∂²y/∂t² = v²∂²y/∂x²`, `v = √(F_T/μ)`.
- **Dispersion and why pulses keep their shape:** the discrete chain has `ω = 2√(F_T/ma)|sin(ka/2)|` — speed
  depends on wavelength (dispersive, lumpy). At long wavelength `ka ≪ 1` this straightens to `ω = vk`: one speed
  for all wavelengths, so a pulse travels without spreading. Discreteness only bites when `λ` approaches `a`.

## Visual design

Dark theme, USNA navy for the medium/beads, gold for the "answer" overlay (continuum curve, linearized
dispersion, launched pulse), gray axes/baseline. JetBrains-Mono readouts ≥18 px. Each mode is a left **canvas**
(continuous animation) + right **control panel**; non-animated plots (dispersion curve, mode spectrum) may use
**Plotly (2-D only)**. KaTeX for every formula. Readable from the back of a lecture hall.

- **`chain` (Beads on a string, default).** A horizontal row of `N` navy beads on a taut string, equilibrium as
  a dashed gray baseline, tension segments drawn between beads. Controls set `N` (1…~120, log-ish slider),
  tension `F_T`, and bead mass `m`. The student **displaces/plucks** a bead or picks an initial shape
  (single-bead kick, Gaussian bump, half-sine) and watches the coupled motion evolve by direct time
  integration. A faint **gold continuum curve** interpolates the beads so the "string" appears as `N` grows.
  Readouts: `N`, `a = L/N`, `μ = m/a`, `v = √(F_T/μ)`. A **highlight one bead** toggle draws its restoring
  force from the two neighbor segments (the figure in the lesson) and traces its displacement-vs-time (its SHM).
- **`modes` (Normal modes & dispersion).** Left: the chain frozen into a chosen **normal mode** `p` (1…N),
  shape `sin(pπn/(N+1))`, optionally animated as a standing oscillation `cos(ω_p t)`. Right (Plotly): the
  **dispersion curve** — discrete points `ω_p = 2√(F_T/ma)|sin(k_p a/2)|` with `k_p = pπ/L`, overlaid on the
  straight continuum line `ω = vk` (gold). The two coincide at low `p` and peel apart near the **zone edge**
  `k = π/a`. A second small panel: the **mode-frequency ladder** (the `N` discrete `ω_p`) next to the
  continuous-string ladder `ω_p = pπv/L`, showing they agree for the low modes and the chain simply runs out of
  modes at `N`. (This is the explicit hook to L41 standing waves.)
- **`continuum` (Take N → ∞).** The star teaching move. A single **N slider** swept from small to large with the
  physics running live: at small `N` a launched pulse is lumpy and **disperses** (trailing ripples, speed
  wavelength-dependent); as `N` climbs the same pulse **locks** into a clean traveling shape at `v = √(F_T/μ)`.
  The discrete beads and the gold smooth curve are shown together so the viewer watches the beads "fill in" the
  string. An optional inset makes the limit algebraic: the **second difference** `(y_{n+1} − 2y_n + y_{n−1})/a²`
  drawn against the **second derivative** `∂²y/∂x²`, converging as `a → 0` — the Taylor step that turns the chain
  equation into the wave equation.

## Interactions & modes

- Shared: **play/pause + speed**, **N slider**, `F_T` and `m` sliders, reset, initial-condition picker
  (single-bead kick, Gaussian pulse, half-sine, two-bead for `N=2` beating).
- `chain`: pluck/displace a bead by dragging; highlight-one-bead toggle (restoring-force arrows + its `y(t)` trace);
  show/hide continuum curve; boundary toggle **fixed ends** vs **free ends** (default fixed, matching a string on posts).
- `modes`: mode-number `p` slider, animate-mode toggle, show discrete-vs-continuum dispersion overlay, zone-edge marker.
- `continuum`: N sweep (manual slider + an "auto-increase" play), launch-pulse button, show second-difference inset.
- Registry `modes`: `[{slug:'chain',label:'Beads on a string'}, {slug:'modes',label:'Normal modes & dispersion'}, {slug:'continuum',label:'Take N → ∞'}]`.

## Animation

- One `requestAnimationFrame` loop per mode. Integrate the `N` coupled ODEs
  `ÿ_n = (F_T/ma)(y_{n+1} − 2y_n + y_{n−1})` with a **symplectic (velocity-Verlet) integrator** so energy does
  not drift over long runs; substep as needed for stiffness at large `N` (dt scales like `a/v`). Fixed-end BCs
  pin `y_0 = y_{N+1} = 0`.
- Read slider/preset state from **refs**; draw beads/segments/curve imperatively on canvas; publish readouts
  (`N`, `a`, `v`, current mode) **throttled ~10 Hz**, never per-frame `setState`.
- `modes` dispersion/ladder plots recompute only when `N`, `F_T`, or `m` change (closed-form, not per frame).
- `continuum`: the pulse is just an initial condition evolved by the same integrator; the only thing the N
  sweep changes is how many beads discretize it. Pause freezes the state.

## Math shown (KaTeX)

- Chain equation of motion: `m\ddot y_n = \frac{F_T}{a}\,(y_{n+1} - 2y_n + y_{n-1})`.
- `N=1` single oscillator (fixed ends): `m\ddot y = -\frac{2F_T}{a}y`, `ω = \sqrt{2F_T/ma}` — the L35 case.
- Continuum limit: `y_{n+1}-2y_n+y_{n-1} \to a^2\,\partial_x^2 y`, giving
  `\partial_t^2 y = v^2\,\partial_x^2 y`, `v = \sqrt{F_T/\mu}`, `μ = m/a`.
- Normal modes: `y_n^{(p)} = \sin\!\frac{p\pi n}{N+1}`, `p = 1,\dots,N`.
- Dispersion relation: `ω(k) = 2\sqrt{F_T/ma}\;\big|\sin(ka/2)\big|`, with `ω ≈ vk` for `ka ≪ 1`
  and the continuum ladder `ω_p = pπv/L`.

## Acceptance criteria

- `chain`: `N=1` is visibly a single SHM oscillator at `ω = √(2F_T/ma)`; `N=2` shows two normal modes and a
  slow beat; by `N≈20` a plucked disturbance **propagates** down the string and (fixed ends) reflects. Energy
  is conserved to visual accuracy over a 60 s run (symplectic integrator — no blow-up, no decay).
- `modes`: selecting mode `p` shows the `sin(pπn/(N+1))` shape; the discrete dispersion points lie **on** the
  continuum line `ω = vk` at low `p` and **peel away** toward the zone edge; the low modes of the ladder match
  `pπv/L`.
- `continuum`: increasing `N` visibly turns a lumpy, dispersing pulse into a clean one traveling at
  `v = √(F_T/μ)`; the second-difference inset converges to `∂²y/∂x²`. The readout `v` matches `√(F_T/μ)` as
  `F_T`/`m` sliders move.
- All modes readable from the back of a hall; no WebGL/3-D; labels non-overlapping; ≥60 fps for `N` up to ~120
  on a classroom laptop (substep the integrator rather than dropping frames).

## Technical notes

- Component lazy-loaded at `src/courses/sp211/ch15-waves/CoupledOscillators.jsx`; register in the `ch15-waves`
  chapter after `traveling-wave` (D37). Follow the mode-switch pattern of `math/vectors/CrossProduct.jsx` and
  the canvas/animation pattern of the existing wave widgets in `ch15-waves`.
- Pure Verlet on `N` DOF — no ODE library. State is two `Float64Array(N+2)` (position, velocity) plus the pinned
  ends; the force is a three-point stencil, O(N) per substep. Choose `dt ≤ 0.2·a/v` and run `ceil` substeps per
  animation frame so large `N` stays stable without slowing the visible frame rate.
- Normal-mode shapes and frequencies are closed-form (above) — compute once per `(N,F_T,m)`; no eigensolver needed.
- Reuse `@shared/components/{Slider,ControlPanel,Readout,InfoPanel}` and `@shared/lib/{canvas,color,plotly}`.
  Gold = the continuum/answer overlay (smooth curve, linear `ω=vk`, launched pulse); navy = the discrete medium
  (beads, segments); gray = axes/baseline.
- SI internal; display `N`, `a`, `μ`, `v` with units; angles/phases in radians internally.

## Out of scope / future

- 2-D membranes / the 2-D wave equation (a drum). This widget is deliberately the **1-D** chain → string story.
- Damping, driving, and resonance of the chain (a driven-chain sibling could tie to AC/driven-SHM later).
- Longitudinal (sound-in-a-lattice) version — same math with displacement along the chain; a natural L38 follow-on.
- Audio playback of the mode frequencies (nice future add; keep this build visual-only).
