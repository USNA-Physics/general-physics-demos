/**
 * analytics.js — optional Google Analytics 4 (gtag.js).
 *
 * The Measurement ID is read from the build-time env var VITE_GA_ID (e.g.
 * "G-XXXXXXXXXX"). If it's unset, this is a complete no-op — nothing loads and
 * no requests are made — so the app runs fine locally / before GA is configured.
 *
 * To turn it on:
 *   1. Create a GA4 property at analytics.google.com → copy its Measurement ID.
 *   2. For the deployed site: add a GitHub Actions *repository variable* named
 *      VITE_GA_ID (Settings → Secrets and variables → Actions → Variables). The
 *      deploy workflow passes it into the Vite build.
 *      For local testing: put `VITE_GA_ID=G-XXXXXXXXXX` in a `.env.local` file.
 *
 * SPA + HashRouter caveat (important):
 *   GA4 derives its "page" dimension from `page_location` and *drops the URL
 *   fragment* (everything after `#`). Because every in-app route lives in the
 *   hash (`…/#/sp211/ch02-motion-1d/grapher?mode=area`), relying on the real URL
 *   would collapse every route into a single page. So we disable gtag's automatic
 *   pageview (`send_page_view: false`) and instead call `trackPageView()` on each
 *   navigation with a synthesized `page_location` that folds the hash route into
 *   a real path. `RouteAnalytics` (mounted inside the Router) drives this.
 */
const GA_ID = import.meta.env.VITE_GA_ID;

/** True when a Measurement ID is configured (build had VITE_GA_ID set). */
export const analyticsEnabled = Boolean(GA_ID);

export function initAnalytics() {
  if (!GA_ID) return; // not configured → no-op

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  // Manual pageviews only — RouteAnalytics sends them (see caveat above).
  gtag('config', GA_ID, { send_page_view: false });
}

/**
 * Fold an in-app hash route into a real URL so GA4 treats each route as a
 * distinct page. On GitHub Pages the app is served from a subpath
 * (…/general-physics-demos/); its trailing slash is stripped before appending.
 * Pure (no globals) so it can be unit-tested.
 *
 * @param {string} origin   e.g. "https://usna-physics.github.io"
 * @param {string} pathname document location pathname, e.g. "/general-physics-demos/"
 * @param {string} path     in-app route incl. query, e.g. "/sp211/…/grapher?mode=area"
 */
export function buildPageLocation(origin, pathname, path) {
  const base = pathname.replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${base}${normalized}`;
}

/**
 * Send a GA4 page_view for an in-app route.
 *
 * @param {string} path    in-app route including query, e.g.
 *                         "/sp211/ch02-motion-1d/grapher?mode=area"
 * @param {string} [title] human-readable page title for the report.
 */
export function trackPageView(path, title) {
  if (!GA_ID || typeof window.gtag !== 'function') return;

  const page_location = buildPageLocation(
    window.location.origin,
    window.location.pathname,
    path,
  );

  window.gtag('event', 'page_view', {
    page_location,
    page_title: title || document.title,
  });
}
