/**
 * Left-side control panel wrapper with reset button.
 */
export default function ControlPanel({ onReset, children }) {
  return (
    <div className="lg:w-72 shrink-0 bg-usna-card border border-usna-grid rounded-lg p-4">
      {children}
      <button
        onClick={onReset}
        className="mt-4 w-full py-2 rounded text-sm font-medium bg-usna-deep text-usna-muted hover:text-usna-gold border border-usna-grid transition-colors"
      >
        Reset
      </button>
    </div>
  );
}
