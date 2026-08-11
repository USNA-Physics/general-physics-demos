import { useEffect, useRef } from 'react';

/**
 * A small modal triggered by an info icon.
 * Click the icon to open; click outside or the x to close.
 */
export function InfoIcon({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-usna-muted text-usna-muted text-xs font-bold hover:border-usna-gold hover:text-usna-gold transition-colors cursor-pointer select-none"
      aria-label="More info"
    >
      i
    </button>
  );
}

export default function InfoModal({ open, onClose, title, children }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
    >
      <div className="bg-usna-card border border-usna-grid rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-usna-muted hover:text-usna-gold text-lg leading-none"
          aria-label="Close"
        >
          &times;
        </button>
        {title && (
          <h3 className="text-usna-gold font-semibold text-base mb-3">{title}</h3>
        )}
        <div className="text-usna-text text-sm leading-relaxed space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}
