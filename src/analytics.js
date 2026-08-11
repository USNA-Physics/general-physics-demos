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
 * Because the app uses HashRouter (SPA), gtag's automatic pageview only fires on
 * first load, so we also send a page_view on every hash-route change.
 */
const GA_ID = import.meta.env.VITE_GA_ID;

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
  // send_page_view fires the initial hit; SPA route changes are handled below.
  gtag('config', GA_ID, { send_page_view: true });

  const sendPageView = () => {
    gtag('event', 'page_view', {
      page_path: window.location.hash.slice(1) || '/',
      page_location: window.location.href,
      page_title: document.title,
    });
  };
  window.addEventListener('hashchange', sendPageView);
}
