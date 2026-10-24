# Spec — New course: Mathematical Preliminaries

- **Status:** Built · course `math`
- **Requested:** 2026-10-21 · Jim
- **Kind:** Course-level spec (indexes a set of widget specs)
- **Course id:** `math` (routes `/#/math/...`)
- **Title / subtitle:** "General Math" / "A visual review of the mathematics used in the physics courses"

## Why this course

SP211 now leans hard on a few pieces of math that students are shaky on, and L29 in
particular goes **full-bore on the cross product**. The request: a set of **visual,
interactive** lessons that build *intuition first* —

- **Vectors as objects, not lists of components.** The #1 misconception: "a vector *is*
  its components." It isn't — the components change with the frame; the arrow doesn't.
- **The dot product** (projection / "how much along") and **the cross product** (area,
  perpendicular direction, right-hand rule) — the latter is the load-bearing one for
  torque `τ = r×F` and angular momentum `L = r×p`.
- **Calculus as geometry:** slopes *are* derivatives, areas *are* integrals. A refresher
  that connects directly to SP211's `v = slope of x(t)` and `displacement = area under v(t)`.

It "starts very basic" on purpose. Higher-math chapters (complex numbers/phasors, partial
derivatives, gradient, linear algebra) get added later as **SP212+** needs them; this course
is the shared math substrate, not tied to one course's lesson numbering.

## Structure

Thematic chapters (same `chapters[]` shape as `sp211`/`sp212` in `registry.js`):

### Chapter: Vectors — slug `vectors`
| Widget | slug | Moment |
|---|---|---|
| What a vector *is* | `what-they-are` | Rotate the axes: the components change, the arrow doesn't. |
| Dot product | `dot-product` | Same number from `aₓbₓ+a_yb_y` and from the projection `|a||b|cosθ`. |
| Cross product | `cross-product` | A *vector*, ⟂ to both, length = parallelogram **area**; `a×b = −b×a`. |

*(Planned: vector addition & change-of-basis — may fold into `what-they-are`.)*

### Chapter: Univariate Calculus — slug `calculus-1d`
| Widget | slug | Moment |
|---|---|---|
| Slope *is* the derivative | `slope-is-derivative` | Shrink the secant and its slope converges to the tangent's. |
| Area *is* the integral | `area-is-integral` | Add rectangles and the Riemann sum converges to the exact area. |

*(Planned: Fundamental Theorem of Calculus — the accumulation function's slope gives back
the integrand; ties the two chapters together.)*

## Registry integration

Add a new course object to `src/registry.js`, peer to `sp211`/`sp212`:

```js
{
  id: 'math',
  title: 'Mathematical Preliminaries',
  subtitle: 'Visual math methods for physics',
  description: 'Vectors as geometric objects, the dot and cross products, and calculus as geometry.',
  // No L1–L41 `lessons` map (not lesson-indexed). `groups` optional.
  chapters: [
    { slug: 'vectors', number: 1, title: 'Vectors', experiments: [ /* what-they-are, dot-product, cross-product */ ] },
    { slug: 'calculus-1d', number: 2, title: 'Univariate Calculus', experiments: [ /* slope-is-derivative, area-is-integral */ ] },
  ],
}
```

- Components live under `src/courses/math/<chapterSlug>/<Name>.jsx`, lazy-loaded exactly like
  the physics demos. Routes: `/#/math/vectors/cross-product`, etc.
- `number` on a "chapter" here is just an ordering key (not a Tipler chapter). Fine; the shell
  renders it generically.
- Each experiment carries the usual `slug / title / description / moment / status / modes /
  component`. These widgets are reference tools, so **no `dLabel`** (that field is SP211's
  lesson-demo scheme).

## Shared design principles (all widgets in this course)

- **Visualization first, algebra second.** Every claim is a picture you can drag; the formula
  is shown (KaTeX) but is the caption, not the lesson.
- **"The number is not the object."** Wherever components appear, let the student change the
  frame/parameters and watch the geometric object stay put.
- **Drag to explore**, live readouts, a one-line "Moment" surprise per widget.
- **Cross-link to the physics that uses it** (shown in each widget's InfoPanel):

  | Math widget | Used by |
  |---|---|
  | `what-they-are`, addition | SP211 L4–L7 (2-D kinematics), every FBD |
  | `dot-product` | SP211 L15–L17 (work `W = F·d`), flux later (SP212) |
  | `cross-product` | **SP211 L26 (torque `r×F`), L29 (`L = r×p`, `τ = dL/dt`)** |
  | `slope-is-derivative` | SP211 L1–L2 (`v = dx/dt`, `a = dv/dt`); the `Grapher` demo |
  | `area-is-integral` | SP211 L3 (displacement = area under `v(t)`); `Grapher` `mode=area` |

- Reuse the shared kit (`Slider`, `ControlPanel`, `Readout`, `InfoPanel`, `drawArrow`,
  `linkedPlots`) and the rAF-off-render animation pattern. Navy/gold dark theme.

## Naming — resolved

Course **id** `math`, title **"General Math"**. "Math Methods" was declined because it names
two existing courses in the department. The subtitle and description present the course as a
review of material from the Academy mathematics sequence (calculus, differential equations,
and related methods) in support of the physics courses.

## Out of scope / future (likely SP212+)

Complex numbers & phasors · partial derivatives & the gradient · line/surface integrals &
flux · basic linear algebra / matrices · differential-equation intuition (SHM, RC/RL).
Add as new chapters when the downstream course needs them.
