# SP211 Digital Experiments — Status

_Snapshot: **all demos generated, none reviewed.** Fall 2026 build cycle._

Two automated build passes are complete: (1) scaffold + first-pass build of every demo, and
(2) an enhancement/correctness pass applying the full [`DEMO_ENHANCEMENTS.md`](DEMO_ENHANCEMENTS.md)
backlog. The production build is **green**. **Human review has not started** — every demo below is
awaiting the instructor's per-demo pass (especially the live animation / interaction / audio behavior,
which automated checks can't judge).

- **Demos:** 22 lesson demos (`D01`–`D40`) + the incumbent Free Fall Explorer.
- **Lessons served:** L1–L41 (via `?mode=` deep links; see [`PLAN_211_DEMOS.md`](PLAN_211_DEMOS.md)).
- **Build:** ✅ passing · **Reviewed:** 0 / 22.

**Legend:** ✅ done · ⬜ not started · Gen = generated (first build) · Enh = enhancement/fix pass ·
Rev = human-reviewed & signed off.

---

## Unit I — Kinematics & Newton

| Demo | Route (· mode) | Gen | Enh | Rev | Review notes |
|---|---|:--:|:--:|:--:|---|
| D01 · 1D Motion Grapher | `ch02-motion-1d/grapher` · default/area/force | ✅ | ✅ | ⬜ | |
| D02 · Free Fall Explorer | `ch02-motion-1d/free-fall` · default | ✅ | ✅ | ⬜ | incumbent |
| D06 · Projectile (Free Fall mode) | `…/free-fall?mode=projectile` | ✅ | ✅ | ⬜ | +combined-drag toggle |
| D12 · Drag (Free Fall mode) | `…/free-fall?mode=drag` | ✅ | ✅ | ⬜ | |
| D04 · 2D Vector Kinematics | `ch03-motion-2d/vectors` | ✅ | ✅ | ⬜ | |
| D05 · Relative Motion (Riverboat) | `ch03-motion-2d/relative` | ✅ | ✅ | ⬜ | |
| D07 · UCM Vector Visualizer | `ch03-motion-2d/ucm` · kinematic/banked | ✅ | ✅ | ⬜ | banked friction sign fixed |
| D09 · Free-Body Diagram Builder | `ch04-newton/fbd` · fbd/pairs | ✅ | ✅ | ⬜ | |
| D11 · Friction Incline | `ch05-applications/friction` | ✅ | ✅ | ⬜ | |

## Unit II — Energy & Momentum

| Demo | Route (· mode) | Gen | Enh | Rev | Review notes |
|---|---|:--:|:--:|:--:|---|
| D14 · Center of Mass Playground | `ch05-applications/cm` · default/tumbling | ✅ | ✅ | ⬜ | |
| D15 · Work & Power Visualizer | `ch06-work/work` · dot/area/power | ✅ | ✅ | ⬜ | |
| D18 · Energy Landscape Explorer | `ch07-energy/landscape` · default/equilibria/dissipation | ✅ | ✅ | ⬜ | |
| D22 · Collision Sandbox | `ch08-momentum/collisions` · 1d/impulse/2d | ✅ | ✅ | ⬜ | |

## Unit III — Rotation, Gravity & Fluids

| Demo | Route (· mode) | Gen | Enh | Rev | Review notes |
|---|---|:--:|:--:|:--:|---|
| D24 · Rotational Kinematics Grapher | `ch09-rotation/grapher` | ✅ | ✅ | ⬜ | |
| D25 · Moment of Inertia Explorer | `ch09-rotation/inertia` · shapes/torque/dynamics | ✅ | ✅ | ⬜ | |
| D28 · Rolling Race | `ch09-rotation/rolling` | ✅ | ✅ | ⬜ | |
| D30 · Angular Momentum Conservation | `ch10-angular-momentum/conservation` · vector/skater | ✅ | ✅ | ⬜ | |
| D31 · Orbit Simulator | `ch11-gravity/orbits` · kepler/escape | ✅ | ✅ | ⬜ | |
| D34 · Buoyancy Tank | `ch13-fluids/tank` · pressure/buoyancy | ✅ | ✅ | ⬜ | |

## Unit IV — Oscillations & Waves

| Demo | Route (· mode) | Gen | Enh | Rev | Review notes |
|---|---|:--:|:--:|:--:|---|
| D35 · SHM Explorer | `ch14-oscillations/shm` · spring/pendulum | ✅ | ✅ | ⬜ | |
| D37 · Traveling Wave Explorer | `ch15-waves/traveling` · transverse/longitudinal | ✅ | ✅ | ⬜ | |
| D39 · Doppler Wavefront Visualizer | `ch15-waves/doppler` | ✅ | ✅ | ⬜ | observer-branch freq fixed |
| D40 · Superposition Sandbox | `ch16-superposition/sandbox` · beats/standing | ✅ | ✅ | ⬜ | |

_(All routes are under `/#/sp211/`.)_

---

## What's verified vs. pending

**Verified (automated):**
- Production build passes (`npm run build`).
- Static render + correct physics numbers on a spot-check spread: D01, D06, D18, D22, D31, D35, D40 (and others earlier).
- Correctness fixes from the backlog applied across all 21 files.

**Pending (needs human / live review):**
- **Animation, drag, audio, sweeps** — headless screenshots can't run these; must be clicked through live (`npm run dev` → http://localhost:5173/). Priority: Doppler wavefronts + observer branch, D06 target/sweep, D35 draggable mass, D22 mid-collision drag, audio in D39/D40.
- **Mobile responsiveness** — needs a real narrow-viewport / phone check (Plotly `min-w-0` fix applied but unconfirmed on-device).
- **Per-demo instructor sign-off** — 0 / 22 (fill the `Rev` column and the notes as you go).

## Related docs
- [`PLAN_211_DEMOS.md`](PLAN_211_DEMOS.md) — program plan + per-demo specs + lesson→experiment map + build schedule.
- [`DEMO_ENHANCEMENTS.md`](DEMO_ENHANCEMENTS.md) — the fix + enhancement backlog applied in pass 2 (per-demo checklist).

## Deployment
- **Live:** https://usna-physics.github.io/general-physics-demos/ (GitHub Pages, public repo).
- **CI:** `.github/workflows/deploy.yml` builds + deploys on every push to `main` (Pages source = GitHub Actions).
- **Access gate:** a lightweight client-side password screen (`src/shell/PasswordGate.jsx`) — shared class password, hash-stored, remembered in localStorage. Not real security (static hosting), just keeps casual passers-by out.
- **Analytics:** GA4 plumbing wired (`src/analytics.js`, env-driven). Inactive until a `VITE_GA_ID` Actions repo variable is set — see below.

## Pending
- Set `VITE_GA_ID` (GA4 Measurement ID) as an Actions repo variable to turn on analytics, then re-run the deploy.
- Per-demo instructor review (0 / 22) — unchanged.
