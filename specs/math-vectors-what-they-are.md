# Spec — What a Vector *Is* (components vs. the object)

- **Status:** Built (`math/vectors/what-they-are`) · **Requested:** 2026-10-21 · Jim
- **Target:** course `math` / chapter `vectors` / slug `what-they-are`
- **Route:** `/#/math/vectors/what-they-are`
- **Serves:** SP211 L4–L7 (2-D kinematics), every free-body diagram; foundation for the
  dot- and cross-product widgets.

## Purpose + Moment

Break the "a vector *is* its components" misconception.

> **Moment:** Rotate the coordinate axes and the component numbers `(aₓ, a_y)` change
> completely — but the arrow, its length, and its direction do not move at all. The vector
> is the arrow; the components are just its shadow in one chosen frame.

## Learning goals

- A vector is a geometric object (magnitude + direction); components are frame-dependent
  **descriptions** of it.
- Magnitude `|a|` and the angle between two vectors are **invariant** under rotating the frame.
- Addition is tip-to-tail / parallelogram and is **basis-free**: the resultant arrow is the
  same no matter what axes you measure in.

## Visual design

- A 2-D canvas with a draggable **arrow a** (drag its tip) from the origin.
- An overlaid **coordinate frame** (x̂, ŷ) that the student can **rotate** (a knob or drag a
  handle). Dashed **projection lines** drop from the arrow tip to each axis, and the component
  values `aₓ, a_y` render live on the axes.
- An **invariants panel** that stays fixed while you rotate the frame: `|a|` and the arrow's
  absolute direction — visibly unchanged as the components churn.
- In `addition` mode: a second arrow **b**, the tip-to-tail construction, and the resultant
  **a + b**, all of which hold still as the frame rotates.

## Interactions & modes

- Drag arrow tip(s); **rotate the frame** (slider/handle for frame angle `α`).
- Toggles: show components / projection lines, show grid, show invariants.
- **Modes:** `components` (default — rotate frame, watch numbers change, arrow fixed);
  `addition` (tip-to-tail & parallelogram, basis-free); `basis` (express the same **a** in two
  different, non-orthonormal-optional bases to show components are "coordinates in a basis").

## Math shown (KaTeX)

`a = aₓ x̂ + a_y ŷ` · under a frame rotation by `α`:
`aₓ' = aₓ cosα + a_y sinα`, `a_y' = −aₓ sinα + a_y cosα` · `|a| = √(aₓ² + a_y²)` (invariant).

## Acceptance criteria

- Rotating the frame changes `(aₓ, a_y)` continuously while the arrow and `|a|` **do not move**.
- `addition` resultant arrow is identical regardless of frame angle.
- Drag + rotate are pointer-based with `touchAction:'none'`; readouts throttled.

## Technical notes

Canvas + `drawArrow`; rAF only needed if you animate the frame rotation (otherwise redraw on
input). Navy/gold palette; invariant readouts in gold to signal "this is what's real."

## Out of scope / future

3-D vectors (later, shares the isometric-canvas approach with the cross-product widget);
unit vectors / normalization as a toggle.
