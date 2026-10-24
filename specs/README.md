# Demo & Widget Specs

This directory tracks **requested specifications** for new interactive demos / widgets
(and small apps) in `general-physics-demos`, *before* they are built. Each spec is a
self-contained brief a developer or an agent can implement against.

## How to use

- **One spec per widget/app.** A course-level spec (e.g. `math-preliminaries-course.md`)
  may index a set of related widgets and describe shared structure.
- A spec is `Status: Requested` until a component exists. When built, flip it to
  `Status: Built` and record the registry `slug` + route.
- **Specs are the source of intent; `src/registry.js` is the source of what exists.**
  If they disagree, the registry wins and the spec should be updated or closed.

## Conventions every spec must respect (from `CLAUDE.md` + `CONTRIBUTING.md`)

- React 18 + Vite, **HashRouter only**, each experiment a **lazy-loaded** component in
  `src/courses/<courseId>/<chapterSlug>/<Name>.jsx`, registered in `src/registry.js`.
- **Animation off the React render cycle** — one `requestAnimationFrame` loop that reads
  inputs from refs and draws imperatively; readouts published throttled (~10 Hz), never
  per-frame `setState`. See `CONTRIBUTING.md` and `ch14-oscillations/ShmExplorer.jsx`.
- **Canvas** for continuous animation; **Plotly** (basic dist — **2D only, no WebGL/3D**)
  for charts; **KaTeX** (`react-katex`) for equations; **framer-motion** for UI motion.
- Palette: **USNA Navy `#00205B`**, **Gold `#C5B783`**, dark theme. Body text ≥16px,
  slider readouts ≥18px mono (JetBrains Mono). Readable from the back of a lecture hall.
- Reuse shared components `@shared/components/{Slider,ControlPanel,Readout,InfoPanel,EnergyBars,DemoStub,StatusBadge}`
  and shared libs `@shared/lib/{canvas,vectorArrow,color,plotly,shapes,linkedPlots}`.
  `drawArrow` in `vectorArrow.js` is the standard vector-arrow renderer — use it for every
  spec here (they are all vector/geometry heavy).
- **SI units internally**; convert for display at the call site.

## Spec file format

Front-matter block (status / date / requested-by / target course+chapter+slug+dLabel),
then: **Purpose + Moment** · **Learning goals / lessons served** · **Visual design** ·
**Interactions & Modes** · **Animation** · **Math shown (KaTeX)** · **Acceptance criteria** ·
**Technical notes** · **Out of scope / future**.

The **Moment** is the single counterintuitive prediction the widget is built around
(mirrors the `moment` field on each registry experiment).

## Index

| Spec | Target | Kind | Status | Route |
|---|---|---|---|---|
| `precession-gyroscope.md` | `sp211` / `ch10-angular-momentum` | demo | Built | `/#/sp211/ch10-angular-momentum/precession` |
| `math-preliminaries-course.md` | course `math` (General Math) | course | Built | `/#/math` |
| `math-vectors-what-they-are.md` | `math` / `vectors` | widget | Built | `/#/math/vectors/what-they-are` |
| `math-vectors-dot-product.md` | `math` / `vectors` | widget | Built | `/#/math/vectors/dot-product` |
| `math-vectors-cross-product.md` | `math` / `vectors` | widget | Built | `/#/math/vectors/cross-product` |
| `math-calculus-slope-is-derivative.md` | `math` / `calculus-1d` | widget | Built | `/#/math/calculus-1d/slope-is-derivative` |
| `math-calculus-area-is-integral.md` | `math` / `calculus-1d` | widget | Built | `/#/math/calculus-1d/area-is-integral` |

**Planned / not yet specced** (request when wanted): vector addition & change-of-basis
(may fold into *what-they-are*), the Fundamental Theorem of Calculus (ties slope ↔ area),
the determinant / triple-product form of the cross product, complex numbers & phasors
(for SP212), partial derivatives & gradient (SP212+).
