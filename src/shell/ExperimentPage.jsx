import { useParams, Navigate, NavLink, useSearchParams } from 'react-router-dom';
import { findChapter, findExperiment } from '../registry';

export default function ExperimentPage() {
  const { courseId, chapterSlug, experimentSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const chapter = findChapter(courseId, chapterSlug);
  const experiment = findExperiment(courseId, chapterSlug, experimentSlug);

  if (!experiment) return <Navigate to="/" replace />;

  const Component = experiment.component;
  const siblings = chapter?.experiments || [];

  // Mode-as-URL-parameter convention: ?mode= selects the view; the first
  // declared mode is the default. The chosen mode is passed to the component.
  const modes = experiment.modes ?? [];
  const defaultMode = modes[0]?.slug ?? 'default';
  const mode = searchParams.get('mode') || defaultMode;

  const selectMode = (slug) => {
    const next = new URLSearchParams(searchParams);
    if (slug === defaultMode) next.delete('mode');
    else next.set('mode', slug);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      {siblings.length > 1 && (
        <div className="flex gap-1 overflow-x-auto mb-4 pb-1">
          {siblings.map((exp) => (
            <NavLink
              key={exp.slug}
              to={`/${courseId}/${chapterSlug}/${exp.slug}`}
              end
              className={`px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors ${
                exp.slug === experimentSlug
                  ? 'bg-usna-gold text-usna-navy'
                  : 'bg-usna-card border border-usna-grid text-usna-text hover:text-usna-gold hover:border-usna-gold'
              }`}
            >
              {exp.title}
            </NavLink>
          ))}
        </div>
      )}

      {/* Mode switcher — only when the demo exposes more than one view */}
      {modes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {modes.map((m) => (
            <button
              key={m.slug}
              onClick={() => selectMode(m.slug)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                m.slug === mode
                  ? 'bg-usna-gold text-usna-navy border-usna-gold'
                  : 'bg-usna-card text-usna-muted border-usna-grid hover:text-usna-gold hover:border-usna-gold'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <Component mode={mode} />
    </>
  );
}
