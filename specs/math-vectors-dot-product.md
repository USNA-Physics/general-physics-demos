# Spec — The Dot Product (projection / "how much along")

- **Status:** Built (`math/vectors/dot-product`) · **Requested:** 2026-10-21 · Jim
- **Target:** course `math` / chapter `vectors` / slug `dot-product`
- **Route:** `/#/math/vectors/dot-product`
- **Serves:** SP211 L15–L17 (work `W = F·d`); flux/projection later (SP212).

## Purpose + Moment

Show the dot product as **projection** — "how much of **a** points along **b**" — and that
the geometric and component formulas are the same number.

> **Moment:** Sweep **b** around while holding **a** fixed: `a·b` is largest when they align,
> drops to **exactly zero at 90°**, and goes **negative** when they oppose. The projection
> (the "shadow" of **a** on **b**) tracks it the whole way.

## Learning goals

- `a·b = |a||b|cosθ` measures alignment: `+` (acute), `0` (perpendicular), `−` (obtuse).
- The projection of **a** onto **b** is `(a·b / |b|) b̂`; `a·b` is a **scalar**.
- The component formula `aₓbₓ + a_yb_y` gives the identical value — two faces of one quantity.
- Application: work `W = F·d` is "force times the distance *along* the force."

## Visual design

- Canvas with two draggable arrows **a**, **b** from the origin; the **angle θ** marked.
- The **projection of a onto b** drawn as a highlighted segment along **b** (drop a
  perpendicular from **a**'s tip to the line of **b**); label its signed length.
- A **value bar / dial** for `a·b` that fills positive (gold) or negative (muted), with a
  right-angle glyph flashing when `a·b = 0`.
- Side panel: both formulas with live numbers — `|a||b|cosθ` and `aₓbₓ+a_yb_y` — shown equal.

## Interactions & modes

- Drag **a** and **b**; optional "lock |a|,|b|, rotate b only" to isolate the `cosθ` sweep.
- Toggles: show projection, show angle, show component formula, show the perpendicular.
- **Modes:** `projection` (default); `work` (relabel **a→F**, **b→d**, readout `W = F·d` in
  joules, with a block being dragged along **d**); `perpendicular-test` (challenge: drag **b**
  until `a·b = 0`, snaps and celebrates at 90°).

## Math shown (KaTeX)

`a·b = |a||b|cosθ = aₓbₓ + a_yb_y` · `proj_b a = (a·b/|b|) b̂` · (`work`) `W = F·d = Fd cosθ`.

## Acceptance criteria

- `a·b` is **exactly 0** at 90° (within float tol) and flips sign past it; both formulas agree
  to displayed precision for all drags.
- Projection segment length = `|a|cosθ` with correct sign; reverses direction when obtuse.
- `work` mode reads correct joules for `F·d` with a dragged displacement.

## Technical notes

Canvas + `drawArrow`; redraw on pointer input (rAF optional for the auto-sweep). Keep the two
formula displays literally side by side so "same number" is unmissable.

## Out of scope / future

3-D dot product; the law of cosines derivation; cosine-similarity framing.
