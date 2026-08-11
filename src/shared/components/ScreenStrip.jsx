import { useRef, useEffect, useState, useCallback } from 'react';
import { setupCanvas, renderScreenStrip } from '@shared/lib/canvas';

/**
 * Canvas component that renders a 1D intensity distribution as a brightness strip.
 * Auto-sizes to fill its container width.
 */
export default function ScreenStrip({ intensityFn, xRange, wavelengthNm, gamma = 1, height = 60 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);

  const measure = useCallback(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ctx = setupCanvas(canvas, width, height);
    renderScreenStrip(ctx, width, height, intensityFn, xRange, wavelengthNm, gamma);
  }, [intensityFn, xRange, wavelengthNm, gamma, width, height]);

  return (
    <div ref={containerRef} className="w-full">
      {width > 0 && (
        <canvas
          ref={canvasRef}
          className="rounded border border-usna-grid w-full"
          style={{ height }}
        />
      )}
    </div>
  );
}
