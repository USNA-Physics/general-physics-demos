# CLAUDE.md — USNA Physics Demos

## Project Overview

A single-repo platform for interactive physics demonstrations at USNA, organized by course (SP211, SP212, …) and Tipler chapter. Each demo is a lazy-loaded React component — adding a new one is: create component, add registry entry, done.

## Build & Run

```bash
npm install
npm run dev          # Dev server with HMR
npm run build        # Production → dist/
npm test             # Vitest
```

## Key Architecture Rules

- **HashRouter only** — never BrowserRouter. Static deploy + file:// compatibility.
- **Lazy loading** — every experiment component must use `React.lazy(() => import(...))` in `src/registry.js`. Never import experiment components statically.
- **Path aliases** — use `@shared/…` and `@courses/…` (defined in vite.config.js), not relative `../../` paths.
- **SI units internally** — all physics functions take meters, seconds, kg. Convert display units (mm, nm) at the call site.
- **base: './'** in vite.config.js — never change this. Required for subdirectory deployment.

## Adding a Demo

1. Create `src/courses/<courseId>/<chapterSlug>/YourDemo.jsx`
2. Add entry in `src/registry.js` with `lazy(() => import(...))`
3. Use shared components: `@shared/components/{Slider,ControlPanel,IntensityPlot,InfoPanel,Readout}`
4. Use shared libs: `@shared/lib/{plotly,canvas,color}`

## Visual Design

USNA Navy (#00205B) and Gold (#C5B783) palette. Dark theme. See `tailwind.config.js` for the full token set.

- Body text: min 16px, readable from back of lecture hall at 1080p
- Slider readouts: 18px+ monospace (JetBrains Mono)
- Equations: KaTeX via react-katex

## File Organization

- `src/shell/` — app chrome (Layout, nav, breadcrumbs, course/chapter listing)
- `src/shared/` — reusable components and libs (used by all demos)
- `src/courses/<courseId>/<chapterSlug>/` — individual demo components
- `src/registry.js` — the manifest that drives routing and navigation
