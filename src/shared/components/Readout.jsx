/**
 * Numeric readout row — label on the left, value + unit on the right.
 */
export default function Readout({ label, value, unit }) {
  return (
    <div className="flex justify-between items-baseline text-sm py-1">
      <span className="text-usna-muted">{label}</span>
      <span className="font-mono text-usna-gold tabular-nums">
        {value} <span className="text-usna-muted text-xs">{unit}</span>
      </span>
    </div>
  );
}
