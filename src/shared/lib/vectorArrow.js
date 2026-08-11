/**
 * vectorArrow.js — shared canvas arrow primitive.
 *
 * The vector-arrow drawing used across the kinematics/forces demos
 * (D04 → D05, D07, D09). Keep it generic: magnitude and direction come in as a
 * displacement (dx, dy) in screen pixels; color and label are optional.
 *
 * Screen convention: +x right, +y DOWN (canvas). Physics callers that think in
 * +y-up should negate dy at the call site.
 */

/**
 * Draw an arrow from (x, y) along (dx, dy) with a solid triangular head.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o  { x, y, dx, dy, color?, width?, label?, head?, font? }
 */
export function drawArrow(ctx, { x, y, dx, dy, color = '#C5B783', width = 3, label, head = 10, font = '13px JetBrains Mono, monospace' }) {
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len;
  const tipX = x + dx, tipY = y + dy;
  // shaft (stops short so the head sits cleanly on the tip)
  const shaftLen = Math.max(0, len - head);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ux * shaftLen, y + uy * shaftLen);
  ctx.stroke();
  // head
  const px = -uy, py = ux; // perpendicular
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * head + px * head * 0.5, tipY - uy * head + py * head * 0.5);
  ctx.lineTo(tipX - ux * head - px * head * 0.5, tipY - uy * head - py * head * 0.5);
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tipX + ux * 12, tipY + uy * 12);
  }
  ctx.restore();
}

/** Tip-to-tail composition helper: returns the resultant of a list of {dx,dy}. */
export function resultant(vectors) {
  return vectors.reduce((acc, v) => ({ dx: acc.dx + v.dx, dy: acc.dy + v.dy }), { dx: 0, dy: 0 });
}
