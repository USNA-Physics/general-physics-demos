import { useRef, useEffect } from 'react';
import { setupCanvas, renderAiryDisk } from '@shared/lib/canvas';

/**
 * Canvas component that renders a 2D Airy disk pattern.
 * Debounces rendering during rapid slider changes.
 */
export default function AiryDisk2D({ intensityFn, rMax, wavelengthNm, gamma = 1, size = 400 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const timer = setTimeout(() => {
      const ctx = setupCanvas(canvas, size, size);
      renderAiryDisk(ctx, size, intensityFn, rMax, wavelengthNm, gamma);
    }, 30);
    return () => clearTimeout(timer);
  }, [intensityFn, rMax, wavelengthNm, gamma, size]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded border border-usna-grid"
      style={{ width: size, height: size }}
    />
  );
}
