/**
 * RouteAnalytics — sends a GA4 page_view (and sets document.title) on every
 * in-app navigation. Mounted inside the Router so it sees HashRouter route
 * changes, including `?mode=` switches (which live in the hash's query string).
 *
 * The title is built from the registry so GA reports read as human-friendly
 * names ("1D Motion Grapher — Area = integral · SP211") instead of bare slugs,
 * and the browser tab updates to match.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../analytics';
import { findCourse, findChapter, findExperiment } from '../registry';

const SITE = 'USNA Physics Demos';

/** Build a readable page title from the route path + query. */
export function pageTitle(pathname, search) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) return SITE;

  // Full-screen deck lives outside the course tree.
  if (parts[0] === 'sp211' && parts[1] === 'semester-preview') {
    return `SP211 Semester Preview · ${SITE}`;
  }

  const [courseId, chapterSlug, experimentSlug] = parts;
  const course = findCourse(courseId);
  if (!course) return SITE;

  if (!chapterSlug) return `${course.title} · ${SITE}`;

  const chapter = findChapter(courseId, chapterSlug);
  if (!chapter) return `${course.title} · ${SITE}`;

  if (!experimentSlug) {
    return `Ch ${chapter.number} · ${chapter.title} — ${course.title}`;
  }

  const experiment = findExperiment(courseId, chapterSlug, experimentSlug);
  if (!experiment) return `${chapter.title} — ${course.title}`;

  // Append the active mode's label when the demo exposes multiple views.
  const modeSlug = new URLSearchParams(search).get('mode');
  const modes = experiment.modes ?? [];
  const activeMode =
    modeSlug && modeSlug !== modes[0]?.slug
      ? modes.find((m) => m.slug === modeSlug)
      : null;

  const label = activeMode ? `${experiment.title} — ${activeMode.label}` : experiment.title;
  return `${label} · ${course.title}`;
}

export default function RouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    const title = pageTitle(location.pathname, location.search);
    document.title = title;
    trackPageView(location.pathname + location.search, title);
  }, [location.pathname, location.search]);

  return null;
}
