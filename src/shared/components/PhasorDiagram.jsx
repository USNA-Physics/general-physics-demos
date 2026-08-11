import { useRef, useEffect } from 'react';
import { setupCanvas } from '@shared/lib/canvas';
import { wavelengthToRGB } from '@shared/lib/color';

/**
 * Canvas-based phasor (vector addition) diagram.
 */
export default function PhasorDiagram({ phasors, wavelengthNm, size = 400 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, size, size);
    drawPhasors(ctx, size, phasors, wavelengthNm);
  }, [phasors, wavelengthNm, size]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded border border-usna-grid"
      style={{ width: size, height: size }}
    />
  );
}

function drawArrowhead(ctx, from, to, headLen, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < headLen * 1.5) return;
  const angle = Math.atan2(dy, dx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLen * Math.cos(angle - Math.PI / 7),
    to.y - headLen * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    to.x - headLen * Math.cos(angle + Math.PI / 7),
    to.y - headLen * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fill();
}

function drawPhasors(ctx, size, phasors, wavelengthNm) {
  const rgb = wavelengthToRGB(wavelengthNm);
  const color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;

  const points = [{ x: 0, y: 0 }];
  for (const { amplitude, phase } of phasors) {
    const last = points[points.length - 1];
    points.push({
      x: last.x + amplitude * Math.cos(phase),
      y: last.y + amplitude * Math.sin(phase),
    });
  }

  const end = points[points.length - 1];
  const mag = Math.sqrt(end.x ** 2 + end.y ** 2);
  const totalAmp = phasors.reduce((s, p) => s + p.amplitude, 0);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const range = Math.max(rangeX, rangeY, totalAmp * 0.05);

  const pad = 0.14 * size;
  const drawArea = size - 2 * pad;
  const scale = drawArea / range;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const toCanvas = (p) => ({
    x: pad + (p.x - centerX + range / 2) * scale,
    y: pad + (-p.y + centerY + range / 2) * scale,
  });

  // Background
  ctx.fillStyle = '#0D1321';
  ctx.fillRect(0, 0, size, size);

  // Phasor chain
  const showArrows = phasors.length <= 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = phasors.length > 20 ? 1.5 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < phasors.length; i++) {
    const from = toCanvas(points[i]);
    const to = toCanvas(points[i + 1]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (showArrows) {
      drawArrowhead(ctx, from, to, 8, color);
    }
  }

  // Resultant (gold)
  const originC = toCanvas(points[0]);
  const endC = toCanvas(end);

  ctx.strokeStyle = '#C5B783';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(originC.x, originC.y);
  ctx.lineTo(endC.x, endC.y);
  ctx.stroke();
  if (mag > totalAmp * 0.005) {
    drawArrowhead(ctx, originC, endC, 12, '#C5B783');
  }

  // Origin dot
  ctx.fillStyle = '#F0ECE3';
  ctx.beginPath();
  ctx.arc(originC.x, originC.y, 4, 0, 2 * Math.PI);
  ctx.fill();

  // Resultant labels
  const normMag = totalAmp > 0 ? mag / totalAmp : 0;
  ctx.fillStyle = '#C5B783';
  ctx.font = '600 16px "JetBrains Mono", "Fira Code", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`|E|/E\u2080 = ${normMag.toFixed(3)}`, 10, size - 28);
  ctx.fillText(`I/I\u2080  = ${(normMag ** 2).toFixed(4)}`, 10, size - 10);
}
