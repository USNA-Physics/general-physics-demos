import { useParams } from 'react-router-dom';
import { findExperiment } from '@/registry';

/**
 * DemoStub — placeholder for a scaffolded-but-unbuilt lesson demo.
 *
 * Each stub component file renders <DemoStub mode={mode} /> and nothing else;
 * the display metadata (title, D-label, modes, the counterintuitive "moment",
 * build date) is pulled from the registry entry so there is a single source of
 * truth. To build the demo, replace the stub file's body with the real
 * component and flip the registry entry's `status` to 'built'.
 */
export default function DemoStub({ mode }) {
  const { courseId, chapterSlug, experimentSlug } = useParams();
  const exp = findExperiment(courseId, chapterSlug, experimentSlug);

  if (!exp) return null;

  const modes = exp.modes ?? [];
  const activeMode = mode ?? modes[0]?.slug ?? 'default';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-usna-card border border-usna-grid rounded-lg p-6">
        <div className="flex items-center gap-2 mb-3">
          {exp.dLabel && (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-usna-deep text-usna-gold border border-usna-grid">
              {exp.dLabel}
            </span>
          )}
          <span className="font-mono text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-usna-gold/15 text-usna-gold border border-usna-gold/40">
            Scaffolded · build pending
          </span>
          {exp.due && <span className="text-usna-muted text-xs ml-auto">target {exp.due}</span>}
        </div>

        <h1 className="text-2xl font-bold text-usna-text mb-2">{exp.title}</h1>
        {exp.description && (
          <p className="text-usna-muted text-sm leading-relaxed mb-4">{exp.description}</p>
        )}

        {exp.moment && (
          <div className="rounded-md bg-usna-deep border border-usna-grid p-3 mb-4">
            <div className="font-mono text-[11px] uppercase tracking-widest text-usna-gold mb-1">
              The counterintuitive moment
            </div>
            <p className="text-usna-text text-sm leading-snug">{exp.moment}</p>
          </div>
        )}

        {modes.length > 1 && (
          <div className="mb-2">
            <div className="text-usna-muted text-xs mb-1.5">Planned modes (current: <span className="text-usna-gold font-mono">{activeMode}</span>)</div>
            <div className="flex flex-wrap gap-1.5">
              {modes.map((m) => (
                <span
                  key={m.slug}
                  className={`text-xs px-2 py-1 rounded border ${
                    m.slug === activeMode
                      ? 'bg-usna-gold text-usna-navy border-usna-gold'
                      : 'bg-usna-deep text-usna-muted border-usna-grid'
                  }`}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-usna-muted text-xs mt-5 pt-3 border-t border-usna-grid">
          This route, its modes, and its place in the lesson index are wired up. The interactive build
          lands per the schedule in <span className="font-mono">PLAN_211_DEMOS.md</span>.
        </p>
      </div>
    </div>
  );
}
