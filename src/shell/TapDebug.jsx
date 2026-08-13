/**
 * TapDebug — opt-in, on-screen input event logger for diagnosing mobile tap
 * behavior on real devices.
 *
 * Activated ONLY when the URL query string contains `tapdebug=1` (before the #,
 * e.g. `…/general-physics-demos/?tapdebug=1#/sp211/ch02-motion-1d/free-fall`).
 * When not activated it renders nothing and attaches no listeners, so it has no
 * effect on normal users or on desktop.
 *
 * It captures pointerdown / pointerup / pointercancel / click (capture phase, so
 * it sees them regardless of stopPropagation) and long main-thread tasks. This
 * tells us, for a tap that "does nothing," whether the click was never
 * synthesized (gesture/longtask suppression) vs. dispatched to the wrong target.
 */
import { useEffect, useState } from 'react';

function isEnabled() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('tapdebug') === '1';
}

export default function TapDebug() {
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (!isEnabled()) return;

    const start = performance.now();
    const stamp = () => String(Math.round(performance.now() - start)).padStart(5, ' ');
    const push = (msg) => setLog((l) => [`${stamp()}ms  ${msg}`, ...l].slice(0, 16));

    const describe = (el) => {
      if (!el || !el.tagName) return '?';
      const tag = el.tagName.toLowerCase();
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      return txt ? `${tag}:"${txt}"` : tag;
    };

    const types = ['pointerdown', 'pointerup', 'pointercancel', 'click'];
    const listeners = types.map((type) => {
      const h = (e) => push(`${type.padEnd(13)} ${describe(e.target)}`);
      document.addEventListener(type, h, true);
      return [type, h];
    });

    let po;
    try {
      po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) push(`⏱ longtask ${Math.round(entry.duration)}ms`);
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask API not supported — ignore */ }

    push('tapdebug ready — tap Pause, then the app switcher');

    return () => {
      listeners.forEach(([type, h]) => document.removeEventListener(type, h, true));
      po?.disconnect();
    };
  }, []);

  if (!isEnabled()) return null;

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
        maxHeight: '45vh', overflow: 'hidden', pointerEvents: 'none',
        background: 'rgba(0,0,0,0.86)', color: '#57ff8f',
        font: '11px/1.35 monospace', padding: '6px 8px',
        borderTop: '1px solid #57ff8f',
      }}
    >
      {log.map((line, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.7 - i * 0.03 }}>{line}</div>)}
    </div>
  );
}
