# Spec — Conic Sections (3-D slicing, true-shape projection, equation classification)

- **Status:** Built · **Requested:** 2026-11-04 · Jim · slug `conic-sections`
- **Target:** course `math` / chapter `conics` (new, number 4) / slug `conic-sections`
- **Route:** `/#/math/conics/conic-sections`
- **Serves:** pure-math enrichment for the whole physics sequence — orbits under an
  inverse-square force are exactly these curves (SP211 gravity L31–L32), and the
  general-quadratic classification is background for later coordinate-geometry work.

## Purpose + Moment

Show that the circle, ellipse, parabola, and hyperbola are not four unrelated curves but
the plane sections of a single double cone, and that the geometric transition between them
is *the same event* as the sign change of the discriminant `B² − 4AC` in the algebra.

> **Moment:** tilt one cutting plane and the section passes smoothly from ellipse to parabola
> to hyperbola — and the instant the plane parallels a cone generator, the section's equation
> discriminant `B² − 4AC` crosses zero.

## Learning goals

- Every plane section of a double cone is a circle, ellipse, parabola, hyperbola, or a
  degenerate point/line/crossed-pair (section through the apex).
- The type depends only on the plane tilt `β` relative to the generator angle `γ = 90° − α`:
  `β < γ` ellipse, `β = γ` parabola, `β > γ` hyperbola. Eccentricity `e = sinβ / sinγ`.
- The section in the plane's own coordinates is `u² + C v² + E v + F = 0` with
  `C = cos²β − tan²α·sin²β`; since `A = 1, B = 0`, its discriminant is `B² − 4AC = −4C`, so the
  geometric transition **is** the algebraic classification.
- The general `Ax² + Bxy + Cy² + Dx + Ey + F = 0` is always a conic; `B² − 4AC` fixes the type
  (`< 0` ellipse, `= 0` parabola, `> 0` hyperbola) and the `xy` term only rotates it (principal
  axes at `½·atan2(B, A−C)`); a factorable equation gives the degenerate cases.

## Visual design

Dark theme, USNA navy plane / gold section, JetBrains-Mono readouts ≥18 px, KaTeX for formulas.
Three modes, each a left canvas + right control panel.

- **`slice` (default).** 3-D double cone (wireframe generators + rim circles) through the shared
  orthographic camera (`@shared/lib/iso`); a translucent navy cutting plane `z = h₀ + y·tanβ`; the
  section drawn as a gold curve. Drag to rotate, auto-rotate toggle, presets for each conic and a
  through-apex (degenerate) button.
- **`projection`.** The section in true shape in the plane's `(u, v)` coordinates: gold curve,
  centre/vertex, foci (navy), directrices, hyperbola asymptotes (green), with `a, b, c, e` readouts.
- **`classification`.** The general quadratic with A…F sliders and presets; the zero contour drawn
  by marching squares; readouts for `B² − 4AC`, the classification, and the principal-axis rotation;
  a dashed green principal-axis overlay.

## Interactions & modes

- Shared between `slice` and `projection`: cone half-angle `α`, plane tilt `β`, plane height `h₀`
  (lifted to the parent so switching modes keeps the same conic).
- `slice`: presets (circle/ellipse/parabola/hyperbola/through-apex), auto-rotate, show-plane.
- `projection`: foci + directrices toggles.
- `classification`: A, B, C, D, E, F sliders; presets (incl. rotated ellipse, crossed lines);
  principal-axes toggle.
- Registry `modes`: `[{slug:'slice'…},{slug:'projection'…},{slug:'classification'…}]`.

## Animation

One `requestAnimationFrame` loop per mode reading refs; `slice` advances the camera azimuth when
auto-rotating and on pointer-drag. Readouts publish throttled (~7 Hz). No per-frame `setState`.

## Math shown (KaTeX)

- Cone and plane: `x² + y² = z²tan²α`, `z = h₀ + y·tanβ`.
- Section: `u² + C v² + E v + F = 0`, `C = cos²β − tan²α·sin²β`, `B² − 4AC = −4C`.
- Standard forms + `e = c/a`; general quadratic `Ax²+Bxy+Cy²+Dx+Ey+F=0`, `Δ = B²−4AC`.

## Acceptance criteria

- The 3-D section matches the plane/cone and changes type at `β = γ`; through-apex gives a point,
  line, or crossed pair.
- The projected eccentricity equals `sinβ/sinγ` and the focus–directrix construction is consistent.
- In classification, the drawn curve, the discriminant sign, and the named type always agree, and a
  nonzero `B` tilts the curve to the shown principal axes.

## Technical notes

- New chapter `conics` (number 4) after `fourier`; component lazy-loaded at
  `src/courses/math/conics/ConicSections.jsx`. 3-D via `@shared/lib/iso` (as in `vectors/CrossProduct`).
- The 3-D section is marched around the cone (solve each nappe height on the plane per θ, split
  polylines where a branch runs to infinity) — robust across all types; the 2-D projection reuses
  those points and adds analytic foci/directrix/asymptotes; classification draws the zero contour by
  marching squares.
- Reuse `@shared/components/{Slider,ControlPanel,Readout,InfoPanel}` and `@shared/lib/{canvas,iso}`.

## Out of scope / future

- Dandelin-sphere construction animated in 3-D (mentioned in prose; a strong future add).
- Polar `r = ℓ/(1 + e cosθ)` form and the orbit tie-in to SP211 gravity (link when wanted).
- Quadric surfaces / 3-D conics.
