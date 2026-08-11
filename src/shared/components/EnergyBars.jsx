/**
 * EnergyBars — the shared "bar grammar" for energy/quantity bookkeeping.
 *
 * A row of vertical bars that trade height while (optionally) a bright marker
 * line shows their constant total. Reused by D18 (K/U/thermal), D22 (momentum
 * and KE), and D35 (SHM K/U). Pure presentation — pass in the numbers.
 *
 *   <EnergyBars
 *     items={[{ label: 'K', value: kNow, color: '#C5B783' },
 *             { label: 'U', value: uNow, color: 'rgba(197,183,131,0.45)' }]}
 *     max={totalE}
 *     total={totalE}          // optional: draws the constant-total marker
 *     height={220}
 *   />
 */
export default function EnergyBars({ items, max, total, height = 220, unit = '' }) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="flex items-end gap-4" style={{ height }}>
      {items.map((it) => {
        const frac = Math.max(0, Math.min(1, it.value / scale));
        return (
          <div key={it.label} className="flex flex-col items-center justify-end h-full">
            <span className="font-mono text-xs text-usna-gold tabular-nums mb-1">
              {it.value.toFixed(1)}{unit}
            </span>
            <div className="relative w-10 h-full bg-usna-deep border border-usna-grid rounded-sm overflow-hidden flex items-end">
              {/* constant-total marker */}
              {total != null && (
                <div
                  className="absolute left-0 right-0 border-t border-usna-text/80"
                  style={{ bottom: `${Math.min(100, (total / scale) * 100)}%` }}
                />
              )}
              <div className="w-full" style={{ height: `${frac * 100}%`, background: it.color }} />
            </div>
            <span className="text-usna-muted text-xs mt-1">{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}
