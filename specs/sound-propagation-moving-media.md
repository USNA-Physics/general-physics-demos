# Spec — Sound Propagation in a Moving or Structured Medium (wind, shear, ducting)

- **Status:** Built · **Requested:** 2026-11-09 · Jim · **slug** `moving-medium` · modes `uniform` (default), `wind-shear`, `thermal`, `ocean-channel`
- **Target:** course `sp211` / chapter `ch15-waves` / slug `moving-medium` · **dLabel D39b**
- **Route:** `/#/sp211/ch15-waves/moving-medium`
- **Serves:** **SP211 L39 (Doppler)** — the moving-medium enrichment made interactive — with ties back to
  L37–L38 (wave speed set by the medium, intensity). The payoff is naval: atmospheric and ocean sound
  **refraction** — shadow zones, the SOFAR channel, convergence zones, and the sonar "afternoon effect."
  A more advanced sibling to the basic Doppler wavefront visualizer (D39, `.../doppler`).

## Purpose + Moment

Make "the medium is the referee" visible when the medium itself **moves or is layered**. The student sets a
wind (uniform or height-varying) or a sound-speed profile and watches rays bend, wavefronts advect, shadow
zones open, and a channel trap sound. It turns the L39 appendix (a uniform wind as an effective sound speed,
and refraction as a separate propagation effect) into something you can steer.

> **Moment:** the same source is loud far **downwind** yet nearly silent a short distance **upwind** — and
> it is *not* the wind "carrying" the sound. A wind that grows with height **refracts** the rays: down toward
> the ground on the downwind side (so it carries for miles) and up into the sky on the upwind side (opening a
> silent shadow zone). The ocean version is even stronger: a sound-speed minimum at depth **traps** rays in a
> channel that ferries them across an entire ocean.

## Learning goals

- **Uniform flow = effective directional sound speed** $c_n = v + \vec w\cdot\hat n$. Doppler in a moving
  medium: the wind **cancels** from the pitch for co-moving source and receiver and enters only through their
  **relative** motion (the L39 enrichment, made interactive).
- **Refraction:** rays bend toward **lower** propagation speed, so a vertical gradient of wind or temperature
  curves them — producing **shadow zones** and **ducts** (Snell / the ray invariant).
- **"Hear with the wind"** = downwind **downward** refraction; an upwind **shadow**.
- **Thermal:** a daytime lapse (speed falls with height) refracts rays **up** → a surface shadow near the
  source (the sonar/"afternoon effect"); a nighttime inversion refracts them **down** → sound carries far.
- **Ocean SOFAR channel:** a sound-speed minimum at depth traps rays about the axis → long-range ducting,
  **convergence zones**, and shadow zones — the physics of submarine detection.

## Visual design

A 2-D **canvas** cross-section: horizontal **range**, vertical **height** (atmosphere) or **depth** (ocean).
A source on the left launches a **fan of rays** over a spread of take-off angles; each ray is integrated
through the medium and drawn (navy), bending per the local profile. **Shadow zones** (no rays) shaded gray;
**convergence/focusing** zones (ray caustics) highlighted gold. A **profile strip** down the left edge plots
$c(y)$ or $w(y)$. A draggable **receiver** reports which rays reach it, the travel time, and — in uniform
mode — the Doppler $f_r$.

Uniform mode additionally draws the **advected circular wavefronts**, source/receiver **velocity arrows**, and
live readouts of $c_n$, the directional $\lambda$, and $f_r$ (the L39 appendix figure, made live). Palette:
navy rays/wavefronts, gold the focus/answer and the highlighted ray, gray shadow and axes; readouts ≥18 px mono.

## Interactions & modes

- **Shared:** drag the source and the receiver; play/pause a marching pulse; toggle the ray fan, the
  wavefronts, and the profile strip; a simple profile editor (drag control points).
- **Modes** (registry `modes`):
  - `uniform` (default) — set the wind vector $\vec w$ and the source/receiver velocities; see the advected
    wavefronts, the $c_n$ anisotropy, $f_r$, and the "cancels for co-moving endpoints, shifts under relative
    motion" result. Sliders: wind speed & direction, $u_s$, $u_r$, $f_s$.
  - `wind-shear` — set a wind profile $w(y)$ (linear or log-with-height); rays bend; a toggle compares the
    downwind and upwind sides; the upwind shadow zone is shaded. Sliders: shear strength, wind direction.
  - `thermal` — set a temperature / sound-speed gradient with **day (lapse)** and **night (inversion)**
    presets; day shows the surface shadow (afternoon effect), night the long-range downward ducting.
  - `ocean-channel` — set an ocean $c(\text{depth})$ profile with an adjustable minimum (the SOFAR axis);
    rays launched near the axis stay trapped, refocusing at convergence zones; place a "sub" target and see
    **detected** vs **in-shadow**.

## Animation

- One `requestAnimationFrame` loop; **ray paths are precomputed** when the profile or sliders change
  (debounced / on release), not per frame. Per-frame motion is the wavefront expansion or a pulse marching
  along the rays; readouts (travel time, $f_r$, $c_n$) published throttled (~10 Hz), never per-frame `setState`.
- Ray integration: RK4 on the 2-D acoustic ray equations with the local effective speed
  $c_{\text{eff}}(y,\theta) = c(y) + \vec w(y)\cdot\hat t$ ($\hat t$ the ray tangent); ~50–200 rays.

## Math shown (KaTeX)

- Effective speed: $c_n = v + \vec w\cdot\hat n$; dispersion $(\omega - \vec w\cdot\vec k)^2 = v^2|\vec k|^2$.
- Refraction / ray invariant (Fermat, Snell for a layered medium): $\dfrac{\cos\theta}{c_{\text{eff}}(y)} =
  \text{const}$, so rays curve toward smaller $c_{\text{eff}}$.
- Doppler (uniform): $f_r = f_s\,\dfrac{c_n - \vec u_r\cdot\hat n}{c_n - \vec u_s\cdot\hat n}$.
- Ocean: the channel/duct condition about a sound-speed minimum $c(z)$ (turning points where
  $\cos\theta = c(z)/c_{\text{launch}}$).

## Acceptance criteria

- `uniform`: stationary source and receiver give $f_r = f_s$ for **any** wind; a moving receiver gives exactly
  $f_s\big(1 - \vec u_r\cdot\hat n/c_n\big)$; wavefronts are visibly advected downwind.
- `wind-shear`: downwind rays bend **down** and reach far along the ground; upwind rays bend **up** and leave a
  shaded shadow zone; reversing the wind swaps the two sides.
- `thermal`: the daytime/lapse preset opens a surface shadow near the source; the nighttime/inversion preset
  returns rays to the ground far downrange.
- `ocean-channel`: rays launched near the axis remain trapped and refocus at convergence zones; a sub placed in
  a shadow zone reads **not detected**, one in a convergence zone reads **detected**.
- 60 fps on a classroom laptop; readable from the back of the hall; no WebGL/3-D; labels non-overlapping.

## Technical notes

- 2-D ray tracing (eikonal), RK4; effective speed $c_{\text{eff}}(y,\theta) = c(y) + \vec w(y)\cdot\hat t$.
  Shadow zones = regions no ray enters (ray-density gaps); convergence zones = ray caustics (the envelope of
  the fan). Keep profiles editable and piecewise-linear.
- Canvas for all drawing; reuse `@shared/lib/{canvas,color}` and `@shared/components/{Slider,ControlPanel,Readout,InfoPanel}`.
- A true **diffraction/field** view (sound leaking into the shadow, which is why real shadows are not silent) is
  a stretch goal via a coarse 2-D FDTD of the convected wave equation; ray tracing + shadow shading is the
  classroom-tractable default. **Label the shadow zones as "ray shadow"** and note diffraction fills them weakly,
  so the demo doesn't over-claim perfect silence.
- SI internally; display range in km (atmosphere/ocean), speeds in m/s, depth in m.

## Out of scope / future

- Full 3-D propagation; a true FDTD diffraction field (stretch); turbulence/scattering; combining a moving
  platform *and* a refracting medium (Doppler through a duct) into one mode; nonlinear / shock propagation.
  The basic stationary-medium Doppler + Mach cone stays in the original D39 widget.
