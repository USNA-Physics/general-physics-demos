# Spec — Slope *is* the Derivative

- **Status:** Built (`math/calculus-1d/slope-is-derivative`) · **Requested:** 2026-10-21 · Jim
- **Target:** course `math` / chapter `calculus-1d` / slug `slope-is-derivative`
- **Route:** `/#/math/calculus-1d/slope-is-derivative`
- **Serves:** SP211 L1–L2 (`v = dx/dt`, `a = dv/dt`); reinforces the `ch02 Grapher` demo.

## Purpose + Moment

Show that the derivative at a point **is** the slope of the tangent line, reached as the limit
of the slope of a shrinking secant.

> **Moment:** Drag the two secant points together and the secant's slope settles onto one
> number — the tangent's slope. "Instantaneous rate of change" is just that limiting slope,
> not a mystery.

## Learning goals

- `f'(x) = lim_{Δx→0} [f(x+Δx) − f(x)] / Δx` = slope of the tangent = `rise/run` in the limit.
- The derivative is itself a **function**: sweep `x` and trace `f'(x)`.
- Physics reading: slope of `x(t)` is velocity; slope of `v(t)` is acceleration; a flat spot
  (`f' = 0`) is a turning point.

## Visual design

- A plot of `f(x)` (Plotly or canvas) with a point at `x` and a second point at `x + Δx`.
- The **secant** through the two points, its slope read out; as `Δx → 0` the secant rotates
  onto the **tangent** (gold). Show `rise` and `run` as labeled legs of a triangle.
- A **linked second panel** (via `@shared/lib/linkedPlots`) that **builds `f'(x)`** as the
  student drags `x` across the domain — the derivative curve drawn point by point.

## Interactions & modes

- **Δx slider** (shrink toward 0 — watch the secant slope converge, with the limiting value
  called out). Drag `x` along the curve.
- Preset functions: `x²`, `x³`, `sin x`, a draggable cubic (control points). 
- Toggles: show secant, show tangent, show rise/run triangle, trace `f'(x)`.
- **Modes:** `tangent` (default — secant→tangent limit); `derivative-function` (sweep `x`,
  accumulate the `f'(x)` curve in the linked panel); `motion` (relabel axes `t, x(t)` and read
  the slope as velocity, tying to SP211).

## Math shown (KaTeX)

`f'(x) = lim_{Δx→0} (f(x+Δx) − f(x))/Δx` · secant slope `= Δf/Δx` · (`motion`) `v = dx/dt`.

## Acceptance criteria

- As `Δx → 0`, the secant-slope readout converges to the known `f'(x)` for every preset.
- The traced `f'(x)` matches the analytic derivative (e.g. `x² → 2x`, `sin → cos`).
- `f' = 0` is visibly flagged at turning points.
- Linked panels stay in sync; readouts throttled; no per-frame `setState`.

## Technical notes

Plotly for the curves (2-D, fine) or canvas; `linkedPlots.js` to keep `f` and `f'` panels
synced. Keep the tangent gold, secant navy. Animate the `Δx → 0` collapse smoothly (framer or
a short rAF tween), but drive readouts off refs.

## Out of scope / future

Higher derivatives; numerical-vs-analytic error; the Fundamental Theorem link (its own
planned widget) that connects this to `area-is-integral`.
