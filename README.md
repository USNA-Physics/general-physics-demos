# General Physics Demos

Interactive simulations for the introductory physics courses at the United States
Naval Academy. Built for lecture-hall projection at 1080p and for student
self-study on laptops and phones.

## Courses

| Course | Title | Status |
|--------|-------|--------|
| SP211 | General Physics I (Mechanics) | In progress |
| SP212 | General Physics II (Electricity & Magnetism) | Diffraction chapter |

Demos are organized by course and Tipler chapter. The full manifest is in
`src/registry.js`.

## Quick start

```bash
npm install      # install dependencies
npm run dev      # dev server with hot reload
npm test         # run tests
```

Open the URL Vite prints (typically http://localhost:5173).

## Build and deploy

```bash
npm run build    # production build to dist/
npx serve dist   # preview the production build
```

The output is fully static. `HashRouter` and `base: './'` let it run from any
subdirectory or host without server configuration. Deployment is automatic: the
GitHub Actions workflow in `.github/workflows/deploy.yml` builds on every push to
`main` and publishes `dist/` to GitHub Pages.

## Adding a demo

1. Create the component in `src/courses/<courseId>/<chapterSlug>/YourDemo.jsx`.
   Import shared pieces from `@shared/components/` and `@shared/lib/`.
2. Register it in `src/registry.js` with a `lazy()` import:

   ```js
   {
     slug: 'your-demo',
     title: 'Your Demo',
     description: 'One-line summary.',
     component: lazy(() => import('./courses/sp211/ch06-work/YourDemo')),
   }
   ```
3. Routing, navigation, breadcrumbs, and code-splitting follow automatically.

## Project structure

```
src/
  main.jsx        entry point (HashRouter, fonts, CSS)
  App.jsx         top-level routes
  registry.js     course / chapter / experiment manifest
  shell/          app chrome (nav, breadcrumbs, landing pages)
  shared/         components and libraries used across demos
  courses/        one folder per course, then per chapter
```

## Architecture

Client-side only. There is no server, database, or API. Each simulation computes
its physics in JavaScript and renders in the browser. The build is entirely static
files, so any static host serves it and it runs offline after the first load.

Single-page application. `index.html` loads a React app that handles navigation in
the browser with `HashRouter`. URLs take the form
`#/sp211/ch07-energy/landscape?mode=equilibria`; the hash keeps deep links and
refreshes working on a static host without rewrite rules. A `?mode=` query
parameter selects the per-lesson view of a demo.

Registry-driven. `src/registry.js` is the single manifest of courses, chapters,
and experiments. Routes, navigation, breadcrumbs, and the by-lesson index are
generated from it.

Code-split. Each demo is a `React.lazy()` dynamic import and ships as its own
chunk, loaded on demand. Plotly and KaTeX are split into separate cached chunks.

Rendering. Simulations use an HTML5 Canvas driven by a `requestAnimationFrame`
loop. Data plots use Plotly (`react-plotly.js`), equations use KaTeX, and audio
demos use the Web Audio API.

Build. Vite bundles to static assets in `dist/`, with `base: './'` for relative
asset paths. There is no server-side rendering.

Deploy. GitHub Actions runs `npm ci` and `npm run build` on each push to `main`
and publishes `dist/` to GitHub Pages over HTTPS. Video and audio live in
`public/media/` as regular files served from the same origin.

Access and analytics. A client-side password screen (`src/shell/PasswordGate.jsx`)
compares a SHA-256 hash and stores the unlock in `localStorage`; it is a deterrent
rather than real security, since static assets remain reachable. Google Analytics
4 (`src/analytics.js`) stays disabled unless a `VITE_GA_ID` build variable is set.

## Tech stack

| Layer | Choice |
|-------|--------|
| Build | Vite 5 |
| Framework | React 18 |
| Routing | react-router-dom 6 (HashRouter) |
| Styling | Tailwind CSS 3 |
| Plots | Plotly.js (`react-plotly.js`) |
| Simulation rendering | HTML5 Canvas, Web Audio API |
| Equations | KaTeX (`react-katex`) |
| Testing | Vitest |

## Visual design

USNA navy and gold on a dark theme for projected displays.

| Token | Hex | Use |
|-------|-----|-----|
| Navy | `#00205B` | nav bar, input tracks |
| Gold | `#C5B783` | accents, slider thumbs, active elements |
| Deep navy | `#001233` | page background |
| Warm white | `#F0ECE3` | primary text |

Inter for interface text, JetBrains Mono for numeric readouts, KaTeX for equations.

## Contributing

1. Branch from `main`.
2. Add the demo following the structure above.
3. Confirm `npm run build` succeeds and `npm test` passes.
4. Open a PR with a screenshot or recording.

## License

Internal use, USNA Physics Department.
