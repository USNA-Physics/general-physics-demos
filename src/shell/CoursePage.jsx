import { useState } from 'react';
import { useParams, Link, Navigate, useSearchParams } from 'react-router-dom';
import { findCourse, findExperiment } from '../registry';

export default function CoursePage() {
  const { courseId } = useParams();
  const course = findCourse(courseId);
  const [searchParams] = useSearchParams();

  // ?group=week3 filters to a topic group
  const groupSlug = searchParams.get('group');
  const activeGroup = groupSlug && course?.groups?.find((g) => g.slug === groupSlug);

  const [expandedChapters, setExpandedChapters] = useState(new Set());
  // "By chapter" (default) vs "By lesson" (the L1–L41 index). Deep-linkable via ?view=lessons.
  const [view, setView] = useState(searchParams.get('view') === 'lessons' ? 'lessons' : 'chapters');

  if (!course) return <Navigate to="/" replace />;

  const toggleChapter = (slug) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const expandAll = () => setExpandedChapters(new Set(visibleChapters.map((ch) => ch.slug)));
  const collapseAll = () => setExpandedChapters(new Set());

  // Filter chapters if a group is active
  const visibleChapters = activeGroup
    ? course.chapters.filter((ch) => activeGroup.chapterSlugs.includes(ch.slug))
    : course.chapters;

  const hasGroups = course.groups && course.groups.length > 0;
  const hasLessons = course.lessons && course.lessons.length > 0;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-usna-gold mb-1">{course.title}</h1>
      <p className="text-usna-muted mb-6">{course.subtitle}</p>

      {/* View toggle: By chapter | By lesson */}
      {hasLessons && (
        <div className="inline-flex rounded-lg border border-usna-grid overflow-hidden mb-6">
          {[['chapters', 'By chapter'], ['lessons', 'By lesson']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                view === key ? 'bg-usna-gold text-usna-navy' : 'bg-usna-card text-usna-text hover:text-usna-gold'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'lessons' ? (
        <LessonIndex courseId={courseId} lessons={course.lessons} />
      ) : (
        <>
          {/* Topic group pills */}
          {hasGroups && (
            <div className="flex flex-wrap gap-2 mb-6">
              <Link
                to={`/${courseId}`}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  !activeGroup
                    ? 'bg-usna-gold text-usna-navy border-usna-gold'
                    : 'bg-usna-card text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                }`}
              >
                All Chapters
              </Link>
              {course.groups.map((group) => (
                <Link
                  key={group.slug}
                  to={`/${courseId}?group=${group.slug}`}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    groupSlug === group.slug
                      ? 'bg-usna-gold text-usna-navy border-usna-gold'
                      : 'bg-usna-card text-usna-text border-usna-grid hover:border-usna-gold hover:text-usna-gold'
                  }`}
                >
                  {group.label}
                </Link>
              ))}
            </div>
          )}

          {activeGroup && activeGroup.description && (
            <p className="text-usna-muted text-sm mb-6 italic">{activeGroup.description}</p>
          )}

          {visibleChapters.length === 0 ? (
            <p className="text-usna-muted italic">No demos yet — check back soon.</p>
          ) : (
            <>
              {/* Expand / collapse controls */}
              <div className="flex gap-3 mb-4 text-xs text-usna-muted">
                <button onClick={expandAll} className="hover:text-usna-gold transition-colors">
                  Expand all
                </button>
                <span>/</span>
                <button onClick={collapseAll} className="hover:text-usna-gold transition-colors">
                  Collapse all
                </button>
              </div>

              <div className="space-y-3">
                {visibleChapters.map((chapter) => {
                  const isExpanded = expandedChapters.has(chapter.slug);
                  const expCount = chapter.experiments.length;

                  return (
                    <div key={chapter.slug} className="bg-usna-card border border-usna-grid rounded-lg overflow-hidden">
                      {/* Chapter header — clickable to expand, with link to chapter page */}
                      <div className="flex items-center gap-3 p-4">
                        <button
                          onClick={() => toggleChapter(chapter.slug)}
                          className="text-usna-muted hover:text-usna-gold transition-colors shrink-0"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          >
                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                          </svg>
                        </button>

                        <div className="flex-1 min-w-0">
                          <Link
                            to={`/${courseId}/${chapter.slug}`}
                            className="text-usna-text font-semibold hover:text-usna-gold transition-colors"
                          >
                            Chapter {chapter.number}: {chapter.title}
                          </Link>
                          <span className="text-usna-muted text-xs ml-2">
                            {expCount} demo{expCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Expanded experiment list */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-0 grid gap-2 sm:grid-cols-2">
                          {chapter.experiments.map((exp) => (
                            <Link
                              key={exp.slug}
                              to={`/${courseId}/${chapter.slug}/${exp.slug}`}
                              className="group block bg-usna-deep border border-usna-grid rounded p-3 hover:border-usna-gold transition-colors"
                            >
                              <h3 className="text-xs font-medium text-usna-gold group-hover:text-usna-gold-light flex items-center gap-1.5">
                                {exp.dLabel && <span className="font-mono text-[10px] text-usna-muted">{exp.dLabel}</span>}
                                {exp.title}
                                {exp.status === 'stub' && <span className="text-[9px] uppercase tracking-wide text-usna-muted">· soon</span>}
                              </h3>
                              {exp.description && (
                                <p className="text-usna-muted text-xs mt-0.5 line-clamp-2">{exp.description}</p>
                              )}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The L1–L41 lesson index: each row deep-links its exact route + mode. */
function LessonIndex({ courseId, lessons }) {
  return (
    <>
      <p className="text-usna-muted text-sm mb-4 italic">
        One experiment per lecture. Each links the exact view (mode) planned for that day.
      </p>
      <div className="space-y-1.5">
        {lessons.map((l) => {
          const exp = findExperiment(courseId, l.chapter, l.experiment);
          const defMode = exp?.modes?.[0]?.slug ?? 'default';
          const to =
            l.mode && l.mode !== defMode
              ? `/${courseId}/${l.chapter}/${l.experiment}?mode=${l.mode}`
              : `/${courseId}/${l.chapter}/${l.experiment}`;
          // A lesson is "ready" only if its host demo is built AND this specific
          // mode isn't a pending extension (e.g. free-fall's projectile/drag modes).
          const built = exp?.status === 'built' && !l.pending;
          return (
            <Link
              key={l.n}
              to={to}
              className="group flex items-center gap-3 bg-usna-card border border-usna-grid rounded px-3 py-2 hover:border-usna-gold transition-colors"
            >
              <span className="font-mono text-xs text-usna-muted w-8 shrink-0">L{l.n}</span>
              <span className="text-sm text-usna-text group-hover:text-usna-gold flex-1 min-w-0 truncate">
                {l.topic}
              </span>
              <span className="font-mono text-[10px] text-usna-muted shrink-0">{l.dLabel}{l.mode && l.mode !== 'default' ? `·${l.mode}` : ''}</span>
              <span
                className={`text-[9px] uppercase tracking-wide shrink-0 w-10 text-right ${built ? 'text-usna-gold' : 'text-usna-muted'}`}
              >
                {built ? 'ready' : 'soon'}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
