# USNA Physics Demos

Interactive digital experiments for undergraduate physics courses at the
United States Naval Academy. Built for lecture-hall projection (1080p) and
self-study on student laptops.

## Courses

| Course | Title | Status |
|--------|-------|--------|
| **SP211** | General Physics I — Mechanics | In progress |
| **SP212** | General Physics II — Electricity & Magnetism | Planned (see [diffraction app](https://github.com/jwkennington/app-sp212-diffraction)) |

Demos are organized by course and Tipler chapter. See the running app or
`src/registry.js` for the full manifest.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server with hot reload
npm run dev

# Run tests
npm test
```

Open the URL printed by Vite (typically `http://localhost:5173`).

## Build & Deploy

```bash
npm run build        # Production build → dist/
npx serve dist       # Local preview of production build
```

The output is fully static — copy the contents of `dist/` to any web host.
`HashRouter` and `base: './'` ensure all routes work from any subdirectory
or as a `file://` URL with no server configuration.

## Adding a New Demo

1. **Create the component** in `src/courses/<courseId>/<chapterSlug>/YourDemo.jsx`.
   Import shared components from `@shared/components/` and shared utilities from
   `@shared/lib/`.

2. **Register it** in `src/registry.js` — add an entry with a `lazy()` import:

   ```js
   {
     slug: 'your-demo',
     title: 'Your Demo',
     description: 'One-line summary.',
     component: lazy(() => import('./courses/sp211/ch05-work-energy/YourDemo')),
   }
   ```

3. **Done.** Routing, navigation, breadcrumbs, and code-splitting are automatic.

## Project Structure

```
src/
├── main.jsx              # Entry point (HashRouter, fonts, CSS)
├── App.jsx               # Top-level route definitions
├── registry.js           # Course/chapter/experiment manifest
├── shell/                # App chrome (nav, breadcrumbs, landing pages)
│   ├── Layout.jsx
│   ├── CoursePicker.jsx
│   ├── CoursePage.jsx
│   └── ExperimentPage.jsx
├── shared/               # Reusable across all demos
│   ├── components/       # Slider, ControlPanel, IntensityPlot, InfoPanel, Readout
│   └── lib/              # plotly helpers, canvas utils, color conversion
└── courses/              # One folder per course
    ├── sp211/            # Mechanics
    │   └── ch02-motion-1d/
    │       └── FreeFall.jsx
    └── sp212/            # E&M (placeholder)
```

## Architecture Decisions

- **React.lazy + dynamic import** — each demo is a separate Vite chunk. Students
  only download the code for the demo they're viewing (~10-50 KB per demo).
  Plotly (~200 KB gzipped) loads once and is cached.
- **HashRouter** — works on GitHub Pages, Netlify, any static host, and `file://`
  URLs without server-side redirect rules.
- **Path aliases** — `@shared/…` and `@courses/…` resolve via Vite config so
  imports stay clean regardless of nesting depth.
- **No SSR, no monorepo tooling** — it's one Vite app. Keep it simple.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Build | Vite 5 |
| Framework | React 18 |
| Routing | react-router-dom v6 (HashRouter) |
| Styling | Tailwind CSS 3 |
| Charts | Plotly.js (`react-plotly.js`) |
| 2D rendering | HTML5 Canvas |
| Equations | KaTeX (`react-katex`) |
| Testing | Vitest |

## Visual Design

USNA Navy & Gold palette — dark theme optimized for projected displays:

- **Navy Blue** `#00205B` (PMS 281 C) — nav bar, input tracks
- **Gold** `#C5B783` (PMS 4525 C) — accents, slider thumbs, active elements
- **Deep Navy** `#001233` — page background
- **Warm White** `#F0ECE3` — primary text
- **Inter** for UI text, **JetBrains Mono** for numeric readouts, **KaTeX** for equations.

## Contributing

1. Create a branch from `main`.
2. Add your demo following the structure above.
3. Ensure `npm run build` succeeds and `npm test` passes.
4. Open a PR with a screenshot or screen recording of the demo in action.

## License

Internal use — USNA Physics Department.

---

## Architecture Overview

A plain-English summary of how the whole thing is put together.

### Fully client-side — no backend
There is **no server, database, or API**. Every simulation runs entirely in the
browser: the physics is computed in JavaScript on each animation frame, plots are
drawn client-side, and there is nothing to authenticate against or query. The
build produces only **static files** (HTML, JS, CSS, media), so it can be hosted
by any static file server — or opened from a local folder — with zero
configuration. Once the page has loaded, it works **offline** (all code and media
are self-contained; no external CDNs or runtime services are called).

### Yes, it's a single-page app (SPA)
One HTML document (`index.html`) boots a React app that owns all navigation
**in the browser**. Moving between the course list, a chapter, or an individual
demo never triggers a full page load or a network round-trip for a new document —
React swaps the view instantly. Routing uses **`HashRouter`** (URLs look like
`…/#/sp211/ch07-energy/landscape?mode=equilibria`); the hash keeps deep links and
refreshes working on any static host (and even `file://`) without server-side
rewrite rules. Per-lesson views are selected with a `?mode=` query parameter.

### How it renders
- **HTML5 Canvas + `requestAnimationFrame`** for the interactive simulations
  (particles, fields, waveforms) — one bounded-`dt` loop per demo.
- **Plotly** (`react-plotly.js`) for data plots (x/v/a graphs, spectra, etc.).
- **KaTeX** for typeset equations, **Web Audio API** for demos with sound.
- **Tailwind CSS** for layout/styling; USNA navy/gold dark theme.

### How it's structured
- **Registry-driven:** `src/registry.js` is the single manifest of courses →
  chapters → experiments. Routes, navigation, breadcrumbs, and the "by lesson"
  index are all generated from it.
- **Code-split:** every demo is a `React.lazy()` dynamic import, so it ships as
  its own chunk and is downloaded only when opened. Heavy shared deps (Plotly,
  KaTeX) are split into their own cached chunks.

### How it's built
**Vite 5** bundles the app to static assets in `dist/`. `base: './'` makes every
asset path relative, so the site works from any subdirectory (e.g. a GitHub Pages
project path) with no rebuild. No SSR, no server rendering — build output is 100%
static.

### How it's deployed
A **GitHub Actions** workflow (`.github/workflows/deploy.yml`) runs on every push
to `main`: it checks out the repo, `npm ci`, `npm run build`, and publishes
`dist/` to **GitHub Pages** (source = GitHub Actions). Pages serves the static
files over HTTPS from GitHub's CDN. Media (video/audio) are ordinary static files
in `public/media/`, committed as regular Git objects and served from the same
origin.

### Access & analytics
- A lightweight **client-side password gate** (`src/shell/PasswordGate.jsx`)
  keeps casual visitors out. It compares a SHA-256 hash (not the plaintext) and
  remembers the unlock in `localStorage`. This is *not* real security — on static
  hosting the assets are ultimately reachable — it just deters passers-by.
- **Google Analytics 4** is wired but **off by default** (`src/analytics.js`); it
  activates only when a `VITE_GA_ID` build variable is set, and then tracks SPA
  page views across the hash routes.

### Tech stack at a glance
React 18 · Vite 5 · Tailwind CSS 3 · React Router 6 (HashRouter) · Plotly.js ·
KaTeX · HTML5 Canvas · Web Audio API · Vitest — deployed static to GitHub Pages
via GitHub Actions.
