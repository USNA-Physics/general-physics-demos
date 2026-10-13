import { useState, useMemo } from 'react';
import 'katex/dist/katex.min.css';
import { BlockMath } from 'react-katex';
import ControlPanel from '@shared/components/ControlPanel';
import { useTheme } from '@shared/ThemeContext';

// D22b — Collision Setup Framer.
// A SETUP TRAINER, not a solver. The student picks the positive direction, the system
// membership, and the collision type; the demo returns a live conservation verdict and the
// assembled symbolic equation set — then deliberately refuses to compute the numbers.
// Companion to the Thursday "Collision Setup Studio" runsheet (sp211-setup-studio-collisions).

const GOLD = '#C5B783';
const GREEN = '#7FB77E';
const RED = '#D9805B';
const MUTED = '#8B8C8E';

// Each scenario mirrors a card in the studio deck. `kind` drives the verdict logic.
//  bodies: the physical objects (before-velocity sign is +x-to-the-right convention here).
//  agentLabel: the external agent for impulse-type scenarios (bat, cable, ...).
const SCENARIOS = [
  {
    id: 'stick',
    title: 'D4/D5 · Two carts — they stick',
    prompt: 'A 2.0 kg cart overtakes a 1.0 kg cart at rest; the two couple and move off together.',
    kind: 'collision',
    bodies: [
      { id: 1, label: 'm_1', vi: +1, color: GOLD },
      { id: 2, label: 'm_2', vi: 0, color: '#5B9BD5' },
    ],
    type: 'inelastic',
  },
  {
    id: 'elastic',
    title: 'D5 · Two carts — elastic bounce',
    prompt: 'The same 2.0 kg cart strikes the 1.0 kg cart at rest, but now they bounce elastically.',
    kind: 'collision',
    bodies: [
      { id: 1, label: 'm_1', vi: +1, color: GOLD },
      { id: 2, label: 'm_2', vi: 0, color: '#5B9BD5' },
    ],
    type: 'elastic',
  },
  {
    id: 'recoil',
    title: 'D6 · Recoil — astronaut throws a wrench',
    prompt: 'A 75 kg astronaut at rest throws a 2.0 kg wrench. Find the recoil.',
    kind: 'explosion',
    bodies: [
      { id: 1, label: 'M', vi: 0, color: GOLD },
      { id: 2, label: 'm', vi: 0, color: '#5B9BD5' },
    ],
    type: 'explosion',
  },
  {
    id: 'bat',
    title: 'D1 · Struck baseball (impulse)',
    prompt: 'A ball arrives at 40 m/s and leaves at 50 m/s the other way after a 1.5 ms contact with the bat.',
    kind: 'impulse',
    bodies: [{ id: 1, label: 'm', vi: -1, color: GOLD }],
    agentLabel: 'the bat',
    type: 'impulse',
  },
  {
    id: 'pendulum',
    title: 'D8 · Ballistic pendulum (two phases)',
    prompt: 'A bullet embeds in a hanging block; the block then rises to height h.',
    kind: 'multiphase',
    bodies: [
      { id: 1, label: 'm', vi: +1, color: GOLD },
      { id: 2, label: 'M', vi: 0, color: '#5B9BD5' },
    ],
    type: 'multiphase',
  },
];

const TYPE_LABEL = {
  inelastic: 'Perfectly inelastic (stick)',
  elastic: 'Elastic (bounce)',
  explosion: 'Explosion / recoil (from rest)',
  impulse: 'Impulse (external force on one body)',
  multiphase: 'Multi-phase (collision, then a smooth phase)',
};

export default function CollisionSetupFramer() {
  const { dark } = useTheme(); // theme token classes handle the palette; referenced to stay theme-aware
  void dark;

  const [scenarioId, setScenarioId] = useState('stick');
  const [posRight, setPosRight] = useState(true); // +x points right?
  const [system, setSystem] = useState({ 1: true, 2: true, agent: false });
  const [showKey, setShowKey] = useState(false);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId);

  const reset = () => {
    setPosRight(true);
    setSystem({ 1: true, 2: true, agent: false });
    setShowKey(false);
  };

  const selectScenario = (id) => {
    setScenarioId(id);
    setPosRight(true);
    setShowKey(false);
    // default: all physical bodies in the system, external agent out
    const sys = { agent: false };
    SCENARIOS.find((s) => s.id === id).bodies.forEach((b) => { sys[b.id] = true; });
    setSystem(sys);
  };

  // ----- conservation verdict from the student's choices -----
  const verdict = useMemo(() => {
    const allBodiesIn = scenario.bodies.every((b) => system[b.id]);
    if (scenario.kind === 'impulse') {
      return {
        ok: false,
        headline: 'Momentum NOT conserved (by design)',
        body:
          'Your system is one body with an external agent (' + (scenario.agentLabel || 'the agent') +
          ') acting on it. That external impulse is exactly what you solve for: J = Δp. Reach for the impulse tool, not conservation.',
        color: RED,
      };
    }
    if (!allBodiesIn) {
      return {
        ok: false,
        headline: 'Not isolated — a colliding body is outside the system',
        body:
          'Leave an interacting body out and the force it exerts becomes external, so its impulse breaks conservation. Put every colliding body inside the system.',
        color: RED,
      };
    }
    if (scenario.kind === 'multiphase') {
      return {
        ok: true,
        headline: 'Conserved THROUGH the collision only',
        body:
          'Over the brief embedding, external impulse ≈ 0 → momentum conserved. On the smooth rise afterward, use energy, not momentum. Split the problem at the instant of contact.',
        color: GREEN,
      };
    }
    return {
      ok: true,
      headline: 'Momentum conserved along ' + (posRight ? '+x (right)' : '+x (left)'),
      body:
        'Every interacting body is inside the system and the interval is the brief contact, so the net external impulse ≈ 0. ' +
        (scenario.type === 'elastic'
          ? 'Elastic → kinetic energy is conserved too.'
          : 'Kinetic energy is NOT conserved (they stick / energy is added).'),
      color: GREEN,
    };
  }, [scenario, system, posRight]);

  // ----- assembled governing equations (symbolic, never solved) -----
  const equations = useMemo(() => {
    const two = scenario.bodies.length === 2;
    switch (scenario.type) {
      case 'inelastic':
        return [
          { note: 'Momentum (always first):', tex: 'm_1 v_{1i} + m_2 v_{2i} = (m_1 + m_2)\\,v_{f}' },
          { note: 'Extra fact — they stick:', tex: 'v_{1f} = v_{2f} = v_{f}' },
          { note: 'Count: 1 equation, 1 unknown (v_f). Solvable.', tex: null },
        ];
      case 'elastic':
        return [
          { note: 'Momentum (always first):', tex: 'm_1 v_{1i} + m_2 v_{2i} = m_1 v_{1f} + m_2 v_{2f}' },
          { note: 'Extra fact — elastic (separation = approach):', tex: 'v_{1i} - v_{2i} = v_{2f} - v_{1f}' },
          { note: 'Count: 2 equations, 2 unknowns (v_{1f}, v_{2f}). Solvable.', tex: null },
        ];
      case 'explosion':
        return [
          { note: 'Momentum, starting from rest:', tex: '0 = m_1 v_{1f} + m_2 v_{2f}' },
          { note: 'So the pieces carry equal and opposite momentum:', tex: 'm_1 v_{1f} = -\\,m_2 v_{2f}' },
          { note: 'Kinetic energy is NOT conserved (energy was added).', tex: null },
        ];
      case 'impulse':
        return [
          { note: 'Impulse–momentum theorem (the system is one body):', tex: 'J = \\int F\\,dt = F_{\\mathrm{av}}\\,\\Delta t = \\Delta p = m\\,(v_f - v_i)' },
          { note: 'Mind the sign: a reversed velocity is negative, so Δp adds in magnitude.', tex: null },
        ];
      case 'multiphase':
        return [
          { note: 'Phase A — collision (brief): momentum through, energy NOT:', tex: 'm\\,v_b = (m + M)\\,V' },
          { note: 'Phase B — smooth rise: mechanical energy conserved:', tex: '\\tfrac12 (m + M) V^2 = (m + M)\\,g\\,h' },
          { note: 'Chain them: energy gives V from h, momentum gives v_b from V.', tex: null },
        ];
      default:
        return two ? [] : [];
    }
  }, [scenario]);

  const arrowFor = (vi) => {
    // sign of the drawn arrow depends on the body's velocity AND the chosen +direction
    const signed = vi * (posRight ? 1 : -1);
    if (signed > 0) return { glyph: '→', label: '+' };
    if (signed < 0) return { glyph: '←', label: '−' };
    return { glyph: '•', label: '0 (at rest)' };
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <ControlPanel onReset={reset}>
        <div className="mb-4">
          <div className="text-usna-muted text-xs uppercase tracking-wide mb-2">Scenario</div>
          <div className="flex flex-col gap-1">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => selectScenario(s.id)}
                className={
                  'text-left text-sm px-2 py-1.5 rounded border transition-colors ' +
                  (s.id === scenarioId
                    ? 'bg-usna-deep text-usna-gold border-usna-gold'
                    : 'bg-usna-deep text-usna-text border-usna-grid hover:text-usna-gold')
                }
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-usna-muted text-xs uppercase tracking-wide mb-2">Step 2 · Positive direction</div>
          <button
            onClick={() => setPosRight((p) => !p)}
            className="w-full text-sm px-2 py-1.5 rounded border bg-usna-deep text-usna-text border-usna-grid hover:text-usna-gold transition-colors"
          >
            +x points {posRight ? 'right  →' : 'left  ←'} (click to flip)
          </button>
        </div>

        <div className="mb-4">
          <div className="text-usna-muted text-xs uppercase tracking-wide mb-2">Step 3 · System (click to include)</div>
          <div className="flex flex-col gap-1">
            {scenario.bodies.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm text-usna-text">
                <input
                  type="checkbox"
                  checked={!!system[b.id]}
                  onChange={() => setSystem((s) => ({ ...s, [b.id]: !s[b.id] }))}
                />
                <span style={{ color: b.color }}>Body {b.label}</span>
              </label>
            ))}
            {(scenario.kind === 'impulse') && (
              <label className="flex items-center gap-2 text-sm text-usna-text">
                <input
                  type="checkbox"
                  checked={!!system.agent}
                  onChange={() => setSystem((s) => ({ ...s, agent: !s.agent }))}
                />
                <span style={{ color: MUTED }}>External agent ({scenario.agentLabel})</span>
              </label>
            )}
          </div>
        </div>

        <button
          onClick={() => setShowKey((k) => !k)}
          className="w-full py-2 rounded text-sm font-medium bg-usna-deep text-usna-gold border border-usna-gold hover:bg-usna-card transition-colors"
        >
          {showKey ? 'Hide setup key' : 'Reveal setup key'}
        </button>
      </ControlPanel>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
          <h3 className="text-usna-gold font-semibold mb-1">Step 1 · Sketch before | after</h3>
          <p className="text-usna-text text-sm mb-3 leading-relaxed">{scenario.prompt}</p>
          <div className="grid grid-cols-2 gap-4">
            {['Before', 'After'].map((phase) => (
              <div key={phase} className="border border-usna-grid rounded p-3">
                <div className="text-usna-muted text-xs uppercase tracking-wide mb-2">{phase}</div>
                <div className="flex flex-col gap-2">
                  {scenario.bodies.map((b) => {
                    const a = phase === 'Before' ? arrowFor(b.vi) : { glyph: '?', label: 'unknown — solve by hand' };
                    return (
                      <div key={b.id} className="flex items-center gap-2 text-usna-text">
                        <span
                          className="inline-flex items-center justify-center rounded font-mono text-sm"
                          style={{ background: b.color, color: '#0D1321', minWidth: 34, padding: '2px 6px' }}
                        >
                          {b.label.replace('_', '')}
                        </span>
                        <span className="font-mono text-lg" style={{ color: b.color }}>{a.glyph}</span>
                        <span className="text-usna-muted text-xs">{a.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-lg p-4 border"
          style={{ borderColor: verdict.color, background: 'rgba(0,0,0,0.15)' }}
        >
          <div className="text-xs uppercase tracking-wide mb-1" style={{ color: verdict.color }}>
            Step 4 · Conservation verdict
          </div>
          <div className="font-semibold mb-1" style={{ color: verdict.color }}>{verdict.headline}</div>
          <p className="text-usna-text text-sm leading-relaxed">{verdict.body}</p>
        </div>

        <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
          <h3 className="text-usna-gold font-semibold mb-1">Step 5 · Governing equations + the one extra fact</h3>
          <p className="text-usna-muted text-xs mb-3">Type: {TYPE_LABEL[scenario.type]}</p>
          <div className="flex flex-col gap-2">
            {equations.map((e, i) => (
              <div key={i}>
                <div className="text-usna-text text-sm mb-1">{e.note}</div>
                {e.tex && (
                  <div className="overflow-x-auto">
                    <BlockMath math={e.tex} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div
            className="mt-4 rounded p-3 text-sm"
            style={{ background: 'rgba(197,183,131,0.12)', border: `1px solid ${GOLD}`, color: GOLD }}
          >
            Step 6 · Setup complete — now solve it by hand. This trainer intentionally does <strong>not</strong> compute
            the answer: the skill being drilled is the setup, not the arithmetic.
          </div>
        </div>

        {showKey && (
          <div className="bg-usna-card border rounded-lg p-4" style={{ borderColor: GREEN }}>
            <h3 className="font-semibold mb-2" style={{ color: GREEN }}>Setup key</h3>
            <ul className="text-usna-text text-sm list-disc pl-5 space-y-1">
              <li><strong>System:</strong> {scenario.kind === 'impulse'
                ? 'the single struck body (the agent is external — that is why you use impulse).'
                : 'every interacting body; keep the interval brief so external impulse ≈ 0.'}</li>
              <li><strong>Conserved:</strong> {scenario.kind === 'impulse'
                ? 'momentum is NOT conserved for the chosen system — find the external impulse J = Δp.'
                : scenario.kind === 'multiphase'
                ? 'momentum THROUGH the collision; energy on the smooth phase (split at contact).'
                : scenario.type === 'elastic'
                ? 'momentum and kinetic energy.'
                : 'momentum only (kinetic energy is lost / added).'}</li>
              <li><strong>Watch the trap:</strong> {scenario.kind === 'multiphase'
                ? 'never run energy conservation through the embedding.'
                : scenario.type === 'elastic'
                ? 'use the linear separation = approach rule, not the quadratic.'
                : scenario.kind === 'impulse'
                ? 'the reversed velocity is negative — Δp adds in magnitude.'
                : scenario.type === 'explosion'
                ? 'kinetic energy is not conserved; only momentum.'
                : 'do not conserve kinetic energy when they stick.'}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
