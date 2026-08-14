# Contributing

See [`CLAUDE.md`](CLAUDE.md) for the architecture rules (HashRouter, lazy loading,
path aliases, SI units, `base: './'`) and [`README.md`](README.md) for how to add
a demo. This file documents cross-cutting patterns that are easy to get wrong.

## Animated demos — keep animation OFF the React render cycle

This is the single most important pattern in this repo. Getting it wrong causes a
subtle, device-specific bug (see "Why" below), so follow it for every demo that
animates continuously (a play loop, a sweeping cursor, live readouts).

**Rule: drive animation with one `requestAnimationFrame` loop that reads inputs
from refs and writes output imperatively. Do NOT push the animation clock into
React state (no `setState`/`setInterval` per frame).**

Concretely, the canonical shape (see `ch14-oscillations/ShmExplorer.jsx` for a
canvas example and `ch02-motion-1d/FreeFall.jsx` for a Plotly example):

```js
const clockRef = useRef(0);                 // the animation clock — a ref, not state
const playingRef = useRef(playing); playingRef.current = playing;
const physRef = useRef(params); physRef.current = params;   // latest inputs, by ref
const [live, setLive] = useState(initial);  // readouts ONLY, published throttled

useEffect(() => {
  let raf, last = null, lastPub = 0;
  const draw = (ts) => {
    const p = physRef.current;
    const dt = last == null ? 0 : (ts - last) / 1000; last = ts;
    if (playingRef.current) clockRef.current += dt * speed;   // advance off React
    // ...draw the canvas from clockRef (cheap, no reflow)...
    // ...move any Plotly markers/lines imperatively (see below)...
    if (ts - lastPub > 90) { lastPub = ts; setLive(current); } // ~10 Hz readouts
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}, []);                                       // set up ONCE; inputs come via refs
```

- **Canvas** is drawn every frame from `clockRef` — cheap, and a canvas repaint
  never reflows the page.
- **Readouts** are React state, but published from the loop at ~10 Hz via a
  throttle, not every frame — a handful of re-renders per second, never 60.
- **Interactions** (dragging a mass, a target) use pointer events + refs, not
  per-frame state. Set `canvas.style.touchAction = 'none'` on a draggable canvas.

## Animating charts (Plotly)

`IntensityPlot` wraps `react-plotly.js`. react-plotly does a shallow (`===`)
compare on `data`/`layout`: **if you hand it new objects, it runs a full
`Plotly.react()` relayout.** Rebuilding `traces`/`layout` every render (e.g. to
move a marker) therefore re-lays-out the whole chart at frame rate. Don't.

Instead — matching react-plotly's own guidance (use `revision`/immutable data, or
a ref to call low-level Plotly APIs):

1. **Render `<Plot>` once.** Build `traces` and `layout` with `useMemo` keyed on
   the *physics params only* — never on the animation clock. Include the moving
   marker traces and any time-line `shapes` in this static definition, positioned
   at their `t = 0` values.
2. **Grab the graph div** via `IntensityPlot`'s `onReady={(gd) => (gdRef.current = gd)}`.
3. **Move the live parts imperatively** from the rAF loop with the helpers in
   `@shared/lib/plotly`:

```js
import { restyleLive, relayoutLive } from '@shared/lib/plotly';
// markers are trace indices 3,4,5 here; the time-line is shapes[0]
restyleLive(gdRef.current, { x: [[t],[t],[t]], y: [[y],[v],[a]] }, [3, 4, 5]);
relayoutLive(gdRef.current, { 'shapes[0].x0': t, 'shapes[0].x1': t });
```

`restyle`/`relayout` touch only the named attributes and do **not** recompute the
layout, so the chart never reflows during play. When the user changes a slider,
the memoized `traces`/`layout` get new identities and react-plotly does one full
`Plotly.react()` — which is correct (that's an interaction, not a frame).

Throttle the imperative chart updates to ~30 Hz (`if (ts - lastPlot > 32)`); the
canvas can stay at 60.

### Why this matters (the bug it prevents)

Re-rendering a demo (and thus `Plotly.react()`) ~20×/sec keeps the main thread and
layout busy. On iOS Safari, if a relayout lands between a tap's `pointerup` and
its synthesized `click`, **the click is dropped** — so a button or link needs a
second tap, page-wide (even the app-switcher above the demo). Canvas-only demos
that follow the ref/rAF pattern don't re-render, so they're immune; the Plotly
demos hit it because they animated through React state. Keeping animation off the
render cycle fixes it at the source.

> Historical note: a global `src/shell/tapFix.js` shim (activate on `pointerup`
> for touch) was added as a stopgap while demos were migrated to this pattern.
> Once every animated Plotly demo uses the pattern above, that shim is removed.
> `?noshim=1` in the URL disables it for on-device verification.

## Desktop must not regress

Several fixes here are gated so desktop rendering is byte-identical:
- **Canvas DPR** is capped at 2 (`@shared/lib/canvas` `effectiveDpr`) — a no-op at
  desktop DPR 1–2, only reduces cost on high-DPR phones.
- **Mobile-only layout/nav** changes are gated behind the `md:` breakpoint or a
  coarse-pointer / touch check, so ≥768px and mouse input are untouched.
- **`hover:` styles** apply only via `@media (hover: hover)` (Tailwind
  `future.hoverOnlyWhenSupported`) so a tap doesn't leave a stuck hover state.

When adding mobile fixes, keep them behind a device/breakpoint gate for the same
reason.

## Build & verify

```bash
npm run build   # must pass
npm test        # vitest
```

Animation, drag, audio, and touch behavior can't be caught by the build or unit
tests — verify those live (`npm run dev`), and on a real phone for touch.
