/**
 * tapFix.js — activate controls on the FIRST tap on touch devices.
 *
 * Problem (confirmed on an iPhone via on-device logging): while a demo animates,
 * Plotly/canvas updates reflow the page ~20x/sec. iOS Safari drops a synthesized
 * `click` when a reflow lands between `pointerup` and the click, so a button or
 * link needs a second tap. The dropped-click is page-wide, so even the app
 * switcher above the demo is affected. On the first tap, `pointerdown` and
 * `pointerup` DO fire — only `click` is lost.
 *
 * Fix: for touch input, trigger the control on the reliable `pointerup`, then
 * swallow the browser's trailing `click` (whether it arrives or not) so the
 * control never activates twice. Mouse and pen input are ignored, so desktop
 * behavior is byte-for-byte unchanged.
 */
const CLICKABLE = 'button, a, [role="button"]';
const MOVE_TOL = 10;    // px moved beyond this ⇒ a drag/scroll, not a tap
const SWALLOW_MS = 700; // window to suppress the browser's trailing click

export function installTapFix() {
  if (typeof window === 'undefined' || !window.PointerEvent) return;
  // Escape hatch for verifying the native fix on a migrated demo: `?noshim=1`
  // (before the #) disables this so you can confirm taps work without it.
  if (new URLSearchParams(window.location.search).get('noshim') === '1') return;

  let downId = null, downX = 0, downY = 0;
  let dispatching = false;      // true only while WE dispatch the synthetic click
  let swallow = null;           // { el, until } — a trailing native click to suppress

  const onDown = (e) => {
    if (e.pointerType !== 'touch') return;
    downId = e.pointerId; downX = e.clientX; downY = e.clientY;
  };

  const onUp = (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== downId) return;
    downId = null;
    // Ignore drags/scrolls — only a stationary tap should activate a control.
    if (Math.abs(e.clientX - downX) > MOVE_TOL || Math.abs(e.clientY - downY) > MOVE_TOL) return;
    const el = e.target.closest?.(CLICKABLE);
    if (!el || el.disabled) return;
    swallow = { el, until: e.timeStamp + SWALLOW_MS };
    dispatching = true;
    el.click();              // fires now, off the reliable pointerup
    dispatching = false;
  };

  const onClick = (e) => {
    if (dispatching) return; // our own synthetic click — allow it through to React
    if (!swallow) return;
    const sameEl = e.target === swallow.el || swallow.el.contains?.(e.target);
    if (sameEl && e.timeStamp < swallow.until) { e.preventDefault(); e.stopPropagation(); }
    swallow = null;
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('click', onClick, true);
}
