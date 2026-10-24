# Spec — The Cross Product (area, perpendicular, right-hand rule)

- **Status:** Built (`math/vectors/cross-product`) · **Requested:** 2026-10-21 · Jim
- **Target:** course `math` / chapter `vectors` / slug `cross-product`
- **Route:** `/#/math/vectors/cross-product`
- **Serves:** **SP211 L26 (torque `τ = r×F`) and L29 (`L = r×p`, `τ = dL/dt`)** — the
  load-bearing math for the rotation unit. This is the priority widget of the course.

## Purpose + Moment

Make the cross product a **thing you can see**: a vector perpendicular to both inputs, whose
length is the **area of the parallelogram** they span, whose direction is set by the
**right-hand rule**, and which **flips when you swap the order**.

> **Moment:** `a × b` points **out of the plane** of **a** and **b** — a product of two
> flat-on-the-table arrows that stands straight up. Swap to `b × a` and it points the opposite
> way. Rotate **b** toward **a** and the result shrinks to **zero** when they line up
> (opposite behaviour to the dot product, which peaks there).

## Learning goals

- `a × b` is a **vector**: magnitude `|a||b|sinθ` = parallelogram area; direction ⟂ to both
  by the right-hand rule.
- **Anticommutative:** `a × b = −(b × a)`; **`a × a = 0`**; zero when parallel, max at 90°.
- The component / determinant form matches the geometric one.
- Physics payoff: torque `τ = r × F` and angular momentum `L = r × p` — the "lever arm"
  `|r||F|sinθ` is the perpendicular part, exactly `|r × F|`.

## Visual design

Render in **2.5-D isometric canvas** so the perpendicular result can genuinely point out of
the a–b plane (reuse the projection approach planned for `precession-gyroscope.md`; `drawArrow`):

- **a** and **b** as draggable in-plane arrows; the **parallelogram** they span, shaded, with
  its **area = |a × b|** printed inside.
- **a × b** drawn **perpendicular** to the plane (up/down), length ∝ area, in gold; a small
  **right-hand curl** animates from **a** toward **b** to justify the direction.
- A **swap button** (`a×b ↔ b×a`) flips the result through the plane — animate the flip.
- A **dot-vs-cross strip**: show `|a × b| = |a||b|sinθ` beside `a · b = |a||b|cosθ` on one
  mini-plot vs θ, so the sin/cos complementarity (cross peaks at 90°, dot peaks at 0°) is
  visible at a glance.

## Interactions & modes

- Drag **a**, **b** in-plane; rotate the angle `θ`; drag to parallel and watch it vanish.
- Toggles: show parallelogram/area, show RHR curl, show component panel, show the dot-vs-cross
  strip.
- **Modes:**
  - `area` (default) — parallelogram + perpendicular result + RHR.
  - `determinant` — the `î ĵ k̂` determinant / component form computes `a × b` live from
    components, shown equal to the geometric magnitude & direction.
  - `torque-L` — **physics bridge.** Relabel to `r` and `F`: show `τ = r × F`, the lever arm
    `r sinθ`, and the out-of-plane torque. A sub-toggle swaps **F→p** to show `L = r × p` and
    the straight-line-motion case (constant `L` = `p × perpendicular distance`) — directly
    mirroring the SP211 L29 `AngularMomentum` demo so students connect the math to the physics.

## Math shown (KaTeX)

`a × b = |a||b| sinθ n̂` (n̂ by RHR) · `a × b = −(b × a)`, `a × a = 0` ·
determinant form `a × b = (a_y b_z − a_z b_y, a_z b_x − a_x b_z, a_x b_y − a_y b_x)` ·
(`torque-L`) `τ = r × F`, `L = r × p`, `|τ| = rF sinθ`.

## Acceptance criteria

- `|a × b|` equals the shaded parallelogram area; **0 when parallel**, **max at 90°**.
- Direction obeys the right-hand rule; **swap flips it**; the animated curl matches the result.
- `determinant` mode's vector equals the geometric result (magnitude + direction) for all drags.
- `torque-L` reproduces the lever-arm value and the out-of-plane direction consistent with the
  SP211 convention; the straight-line `L` case shows **constant L** as the point slides.
- Isometric view readable from the back of the hall; arrows thick, labels non-overlapping.

## Technical notes

- Isometric canvas projection (same fixed view matrix as the precession demo — consider
  sharing a small `@shared/lib` iso helper if both land). No 3-D engine.
- The RHR curl is a short framer-motion / canvas arc animation from **a** to **b**.
- Keep **a × b** gold (the "answer"); inputs navy; area shading translucent gold.

## Out of scope / future

Triple products `a·(b×c)` (volume) and `a×(b×c)`; true orbit-controllable 3-D (Three.js,
separate follow-up).
