# Spec — The Fourier Transform (time ↔ frequency, synthesis, epicycles)

- **Status:** Built · **Requested:** 2026-11-01 · Jim · slug `fourier-transform`
- **Target:** course `math` / chapter `fourier` (new, number 3) / slug `fourier-transform`
- **Route:** `/#/math/fourier/fourier-transform`
- **Serves:** **SP211 L37 (Simple Wave Motion and Harmonic Waves)** as the "zoom out" orientation
  that opens the wave unit: position in SHM obeys a wave equation and is written with trig functions,
  but the frequency domain shows that sinusoids are an *alternate set of coordinates for every signal*,
  with SHM as the near-trivial single-frequency case. Also general enrichment for the whole wave unit
  (L37–L41) and a forward hook to SP212 (Fourier series, phasors).

## Purpose + Moment

Make "everything is a sum of sinusoids" something a student can **watch happen**. A signal in time has
a twin in frequency; rebuilding it from a handful of pure tones shows the sum converging; and the same
idea, taken to 2-D, has rotating circles-upon-circles **draw a shape**. The payoff line for L37: a wave
is not one special curve, it is a change of coordinates, and simple harmonic motion is its simplest point.

> **Moment:** a sum of plain sine waves — each just a circle turning at a steady rate — reproduces *any*
> signal, even a sharp-cornered square wave or a hand-drawn outline. Add more terms and the reconstruction
> snaps to the target (with a stubborn overshoot at the corners: Gibbs). In 2-D the same tones become
> nested spinning circles whose pen traces the shape exactly in the limit.

## Learning goals

- A periodic signal `x(t)` has an equivalent **frequency-domain** representation: a set of amplitudes (and
  phases) on discrete frequencies `n f₀`. Time picture and spectrum are two views of one object.
- **Synthesis / convergence:** the partial sum of the first `N` harmonics approaches `x(t)` as `N → ∞`;
  more terms sharpen edges; corners never fully settle (the **Gibbs overshoot**, ~9%).
- **SHM is the one-term case:** a single frequency is one spike in the spectrum and one circle in 2-D;
  this is exactly the L35–L36 oscillator, now seen as the simplest Fourier mode.
- **Epicycles:** a complex Fourier series is a chain of rotating phasors (circles on circles); their tip
  traces a closed path. Frequency content *is* the set of circle radii and rates.

## Visual design

Dark theme, USNA navy signal / gold "answer" accent, JetBrains-Mono readouts ≥18 px. Three modes, each a
left **canvas** (continuous animation) + right **control panel**; charts that are not animated may use
**Plotly (2-D only)**. KaTeX for every formula.

- **`spectrum` (Time ↔ frequency, default).** Top: `x(t)` on a time axis (navy). Bottom: its **spectrum**,
  a stem/bar plot of harmonic amplitude `|c_n|` vs frequency `n f₀` (gold). Pick a preset (sine, two-tone,
  square, sawtooth, triangle, pulse train) or **drag the spectrum bars** and watch `x(t)` rebuild live, so
  the two panels are visibly one object seen two ways. A one-tone preset parks a single bar → "this is SHM."
- **`synthesis` (Build x(t) from N tones).** The target `x(t)` drawn faint; the **partial sum** `S_N(t)`
  (gold) drawn over it; an **N slider (1…~50)** adds harmonics one at a time. Optionally overlay each
  term's sinusoid faintly so the student sees the pieces. A small readout of RMS error vs `N`, and a
  callout at the discontinuity marking the **Gibbs overshoot** that does not shrink with `N`.
- **`epicycles` (Circles in circles).** The star visual. A chain of **nested rotating circles** (each a
  Fourier mode: radius `|c_n|`, angular rate `n ω₀`, start phase `arg c_n`), the last circle's rim
  carrying a **pen** that leaves a gold trail tracing a closed 2-D path. Presets: a **letter** (e.g. "N"
  for Navy), a **star**, a simple **anchor/ship outline**, a **square** and **circle** (sanity cases). An
  **N slider** sets how many circles (terms) are used; low N gives a loose, wobbly trace, high N locks onto
  the shape. A speed control; a toggle to show/hide the circles vs. just the drawn path.

## Interactions & modes

- Shared: **preset picker**, **play/pause + speed**, **N / number-of-terms slider**, show-components toggle.
- `spectrum`: draggable spectrum bars (amplitude; optional phase handle), preset signals, toggle stem/bar.
- `synthesis`: N slider, overlay-individual-terms toggle, show-target toggle, Gibbs marker toggle.
- `epicycles`: shape preset, N circles slider, show-circles toggle, trail-persistence toggle, speed.
- Registry `modes`: `[{slug:'spectrum',label:'Time ↔ frequency'}, {slug:'synthesis',label:'Build from N tones'}, {slug:'epicycles',label:'Circles in circles'}, {slug:'continuous',label:'Continuous (aperiodic)'}]`.
- **Built additions beyond the original spec:** a 1-D inspiral **GW chirp** signal (windowed, numeric coefficients); the **USNA crest** epicycle shape (traced from the logo PNG's alpha silhouette); and the **continuous** mode (Fourier integral, uncertainty Δt·Δf ≥ 1/4π, SPA chirp power law, and a periodize overlay showing the series lines sampling the continuum). Synthesis N up to 256; epicycle bandwidth up to |n| ≤ 160.

## Animation

- One `requestAnimationFrame` loop per mode; read slider/preset state from **refs**, draw imperatively on
  canvas; publish readouts (N, RMS error, current angle) **throttled ~10 Hz**, never per-frame `setState`.
- `epicycles`: advance a single phase `θ += ω₀ dt`; each circle `k` sits at the tip of circle `k−1` at
  angle `arg c_k + (n_k) θ`; append the final tip to a capped trail buffer; redraw circles + trail each
  frame. Pause freezes θ.
- `synthesis`/`spectrum`: recompute `S_N(t)` only when N or the coefficients change (not every frame);
  the only per-frame motion is an optional sweep marker.

## Math shown (KaTeX)

- Series: `x(t) = a₀/2 + Σ_{n≥1} [a_n cos(n ω₀ t) + b_n sin(n ω₀ t)]`, `ω₀ = 2π/T`.
- Complex form (epicycles): `x(t) = Σ_{n=-N}^{N} c_n e^{i n ω₀ t}`, with `|c_n|` = circle radius,
  `arg c_n` = start angle, `n ω₀` = turn rate.
- Coefficients: `c_n = (1/T) ∫₀ᵀ x(t) e^{-i n ω₀ t} dt` (presets precomputed; drawn shapes via DFT).
- Partial sum `S_N(t) = Σ_{|n|≤N} c_n e^{i n ω₀ t}`; note `S_N → x` as `N → ∞`.
- SHM tie-in: single term `x(t) = A cos(ω₀ t + φ)` ↔ one spectral line ↔ one circle.

## Acceptance criteria

- `spectrum`: the preset signal and its stem plot agree; dragging a bar changes `x(t)` consistently; the
  one-tone preset shows a single spectral line and is labeled as the SHM case.
- `synthesis`: increasing N visibly converges `S_N` to the target; the square/sawtooth show a persistent
  ~9% overshoot at the jump that **narrows but does not shrink** as N grows (Gibbs), and this is called out.
- `epicycles`: with enough circles the pen traces the chosen shape to visual accuracy; the circle radii and
  rates are exactly the Fourier magnitudes/frequencies; low N gives a recognizable but rounded trace.
- All three readable from the back of a lecture hall; no WebGL/3-D; labels non-overlapping; 60 fps on a
  classroom laptop for N up to ~50 circles.

## Technical notes

- New chapter `fourier` (number 3) in the `math` course registry, after `calculus-1d`; component lazy-loaded
  at `src/courses/math/fourier/FourierTransform.jsx`. Follow the mode-switch pattern of
  `math/vectors/CrossProduct.jsx` and the linked-panel pattern of `math/calculus-1d/SlopeIsDerivative.jsx`.
- Preset coefficients can be closed-form (square/sawtooth/triangle/pulse); drawn-shape presets store a list
  of boundary points and run a small **DFT** (O(N·M), M = sample count) once at load — no FFT library needed
  at these sizes. Keep shapes as resampled closed paths (uniform in arc length) so the trace is smooth.
- Canvas for all animation; Plotly (2-D) acceptable for the static spectrum bars if simpler than canvas.
- Reuse `@shared/components/{Slider,ControlPanel,Readout,InfoPanel}` and `@shared/lib/{canvas,color,plotly}`.
  Gold = the reconstruction/answer (partial sum, pen trail); navy = the target/signal; gray = axes.
- SI/angle units internal in radians; display frequency as harmonic index `n` (and `n f₀` if a base is set).

## Out of scope / future

- ~~Continuous (non-periodic) Fourier transform and the uncertainty/width tradeoff~~ — now built as the `continuous` mode.
- 2-D image FFT, filtering, windowing, the FFT algorithm itself.
- Audio playback of the synthesized tone (nice future add; keep this build visual-only).
- Phasor/complex-number primer — if students need `e^{iθ}` first, that is the separate planned
  *complex numbers & phasors* widget (SP212); link to it once it exists.
