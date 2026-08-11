import { useState, useRef, useEffect, useId } from 'react';

/**
 * Reusable slider with label, editable value readout, and USNA styling.
 * Click the value to type an exact number.
 */
export default function Slider({ label, value, min, max, step, unit, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const sliderId = useId();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(String(value));
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(Math.round(clamped / step) * step);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1">
        <label htmlFor={sliderId} className="text-usna-text text-sm font-medium">{label}</label>
        {editing ? (
          <span className="flex items-baseline gap-1">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              aria-label={`${label} value`}
              className="w-20 bg-usna-card border border-usna-gold rounded px-1.5 py-0.5 font-mono text-lg text-usna-gold text-right outline-none focus:ring-1 focus:ring-usna-gold tabular-nums"
            />
            <span className="text-sm text-usna-muted">{unit}</span>
          </span>
        ) : (
          <span
            onClick={startEdit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') startEdit(); }}
            className="font-mono text-lg text-usna-gold tabular-nums cursor-pointer hover:underline hover:decoration-usna-gold/50"
            title="Click to type a value"
          >
            {value} <span className="text-sm text-usna-muted">{unit}</span>
          </span>
        )}
      </div>
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onInput={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
