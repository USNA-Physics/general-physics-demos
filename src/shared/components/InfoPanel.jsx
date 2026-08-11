import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

/**
 * Info panel with title, description text, and optional KaTeX equation.
 */
export default function InfoPanel({ title, description, equation }) {
  return (
    <div className="bg-usna-card border border-usna-grid rounded-lg p-4">
      {title && <h3 className="text-usna-gold font-semibold mb-2">{title}</h3>}
      {description && <p className="text-usna-text text-sm mb-3 leading-relaxed">{description}</p>}
      {equation && (
        <div className="overflow-x-auto">
          <BlockMath math={equation} />
        </div>
      )}
    </div>
  );
}
