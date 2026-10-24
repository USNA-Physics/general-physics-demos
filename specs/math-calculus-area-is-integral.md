# Spec — Area *is* the Integral

- **Status:** Built (`math/calculus-1d/area-is-integral`) · **Requested:** 2026-10-21 · Jim
- **Target:** course `math` / chapter `calculus-1d` / slug `area-is-integral`
- **Route:** `/#/math/calculus-1d/area-is-integral`
- **Serves:** SP211 L3 (displacement = area under `v(t)`); reinforces `ch02 Grapher`
  `mode=area`. Companion to `slope-is-derivative`.

## Purpose + Moment

Show that the definite integral **is** the (signed) area under the curve, reached as the limit
of a Riemann sum of rectangles.

> **Moment:** Start with a handful of fat rectangles that clearly over/under-shoot, then slide
> `N` up: the staircase closes onto the curve and the rectangle sum converges to one number —
> the area. Drop the curve below the axis and that area goes **negative**.

## Learning goals

- `∫_a^b f dx = lim_{N→∞} Σ f(x_i) Δx` = signed area between curve and axis.
- Left / right / midpoint sums bracket and converge to the same limit.
- The **accumulation** `A(x) = ∫_a^x f` is itself a function (seed of the FTC); drag the upper
  limit and watch area pile up.
- Physics reading: area under `v(t)` is displacement; area under `a(t)` is `Δv`; area below
  the axis subtracts.

## Visual design

- A plot of `f(x)` with **Riemann rectangles** (count `N`) shaded; positive area gold, negative
  (below axis) muted/hatched. The running **sum** and, for presets, the **exact** value shown
  side by side with the gap shrinking as `N` grows.
- A **linked accumulation panel** plotting `A(x) = ∫_a^x f` as the student drags the upper
  limit `b` — the area "filling up" on the left maps to the rising curve on the right.

## Interactions & modes

- **N slider** (rectangle count — watch convergence); drag the limits `a`, `b`.
- Rule toggle: **left / right / midpoint** (and trapezoid optionally) — show how each
  approaches the same limit from different sides.
- Preset functions incl. one that dips below the axis (to make signed area concrete).
- **Modes:** `riemann` (default — rectangles → area); `accumulation` (drag `b`, build `A(x)`);
  `motion` (relabel `t, v(t)`, read the area as displacement, tying to SP211).

## Math shown (KaTeX)

`∫_a^b f(x) dx = lim_{N→∞} Σ_{i} f(x_i) Δx`, `Δx = (b−a)/N` · signed-area note ·
(`motion`) `Δx_pos = ∫ v dt`.

## Acceptance criteria

- Riemann sum → exact value as `N` grows (gap readout → 0) for every preset; left/right bracket
  from opposite sides.
- Area below the axis contributes **negatively**; a curve with equal lobes integrates to ~0.
- `accumulation` panel's `A(x)` matches the antiderivative and its **slope** visibly returns
  `f` (quiet foreshadow of the FTC widget).
- Linked panels synced; readouts throttled; no per-frame `setState`.

## Technical notes

Plotly or canvas for the curve + rectangles; `linkedPlots.js` for the accumulation panel.
Gold for positive area, a hatched muted tone for negative. Driving `N` and the limits from
refs; publish the sum/exact/gap readouts throttled.

## Out of scope / future

Improper integrals; numerical-method accuracy comparison; the **Fundamental Theorem of
Calculus** widget (planned) that pairs this directly with `slope-is-derivative`
(`d/dx ∫_a^x f = f`).
