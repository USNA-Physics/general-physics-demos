/**
 * touchActivity.js — tracks whether a touch interaction is currently in flight.
 *
 * On iOS Safari a tap's synthesized `click` is dropped if the layout is repainted
 * between `pointerup` and the click (~300ms later). Plotly repaints (via react()
 * OR restyle/relayout) are heavy enough to trigger this. So animated Plotly demos
 * pause their live chart updates while a touch is active — see `restyleLive` /
 * `relayoutLive` in `./plotly` and CONTRIBUTING.md → "Animating charts (Plotly)".
 *
 * Touch input only: mouse/pen never mark activity, so desktop is unaffected.
 */
let lastTouch = -Infinity;
let installed = false;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function installTouchActivity() {
  if (installed || typeof window === 'undefined' || !window.PointerEvent) return;
  installed = true;
  const mark = (e) => { if (e.pointerType === 'touch') lastTouch = now(); };
  window.addEventListener('pointerdown', mark, true);
  window.addEventListener('pointermove', mark, true);
  window.addEventListener('pointerup', mark, true);
}

/** True while a touch happened within the last `windowMs` (covers the tap→click gap). */
export function touchBusy(windowMs = 400) {
  return now() - lastTouch < windowMs;
}
