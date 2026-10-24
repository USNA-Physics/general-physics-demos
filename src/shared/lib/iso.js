/**
 * iso.js: a small orthographic camera for vector scenes.
 *
 * plotly-basic has no 3-D, so the demos that require a third axis (the cross
 * product directed out of the a, b plane; a gyroscope axis that tilts and
 * precesses) render on a canvas through an orthographic projection. This is the
 * shared camera those demos use.
 *
 * World frame is right-handed with z the vertical axis. The camera is specified
 * by an azimuth (rotation about the world z axis) and an elevation (angle above
 * the horizontal). The screen basis is derived from those angles:
 *   right = (−sin az, cos az, 0)
 *   up    = (−sin el cos az, −sin el sin az, cos el)
 * so world z always projects toward screen-up at the default elevation, and a
 * cross product directed along the vertical appears as a vertical arrow. The
 * default azimuth 45° and elevation 30° place +x toward the lower left, +y
 * toward the lower right, and +z upward.
 *
 * Screen convention matches the rest of the kit: +x right, +y DOWN.
 */

import { drawArrow } from './vectorArrow';

/**
 * Build an orthographic camera projector.
 * @param {object} o
 *   cx, cy      screen pixel of the world origin
 *   scale       pixels per world unit
 *   azimuth     rotation about world z, radians (default 45°)
 *   elevation   angle above the horizontal, radians (default 30°)
 * @returns {{ project, scale, cx, cy, azimuth, elevation, right, up }}
 *   project(x, y, z=0) → { sx, sy }  world → screen pixels.
 *   right, up are the world-space screen basis vectors (used to invert the
 *   projection for in-plane dragging).
 */
export function createIso({ cx, cy, scale, azimuth = Math.PI / 4, elevation = Math.PI / 6 }) {
  const sinAz = Math.sin(azimuth), cosAz = Math.cos(azimuth);
  const sinEl = Math.sin(elevation), cosEl = Math.cos(elevation);
  const right = [-sinAz, cosAz, 0];
  const up = [-sinEl * cosAz, -sinEl * sinAz, cosEl];
  const project = (x, y, z = 0) => ({
    sx: cx + scale * (x * right[0] + y * right[1] + z * right[2]),
    sy: cy - scale * (x * up[0] + y * up[1] + z * up[2]),
  });
  return { project, scale, cx, cy, azimuth, elevation, right, up };
}

/**
 * Draw a vector arrow between two world points using the shared drawArrow.
 * from/to are [x, y, z] (z defaults to 0). All other options pass through.
 */
export function drawArrow3D(ctx, iso, { from = [0, 0, 0], to, ...opts }) {
  const a = iso.project(from[0], from[1], from[2] ?? 0);
  const b = iso.project(to[0], to[1], to[2] ?? 0);
  drawArrow(ctx, { x: a.sx, y: a.sy, dx: b.sx - a.sx, dy: b.sy - a.sy, ...opts });
}

/**
 * Fill + stroke a world-space polygon (e.g. the parallelogram two vectors span).
 * points is an array of [x, y, z]. Pass fill and/or stroke as CSS colors.
 */
export function drawPolygon3D(ctx, iso, points, { fill, stroke, width = 1.5, dash } = {}) {
  if (points.length < 2) return;
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach((p, i) => {
    const s = iso.project(p[0], p[1], p[2] ?? 0);
    if (i === 0) ctx.moveTo(s.sx, s.sy);
    else ctx.lineTo(s.sx, s.sy);
  });
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  ctx.restore();
}

/**
 * Draw a world-space line segment (ground spokes, guide lines, dropped verticals).
 */
export function drawSegment3D(ctx, iso, from, to, { color = '#8B8C8E', width = 1, dash } = {}) {
  const a = iso.project(from[0], from[1], from[2] ?? 0);
  const b = iso.project(to[0], to[1], to[2] ?? 0);
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the ground plane (z = 0) as a faint grid spanning ±half in x and y,
 * plus optional labeled x/y axis arrows. Gives the 2.5-D scene a floor so tilted
 * and out-of-plane arrows read unambiguously.
 */
export function drawGroundGrid(ctx, iso, { half = 3, step = 1, color = 'rgba(139,140,142,0.22)' } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let g = -half; g <= half + 1e-9; g += step) {
    const a1 = iso.project(g, -half, 0), b1 = iso.project(g, half, 0);
    ctx.beginPath(); ctx.moveTo(a1.sx, a1.sy); ctx.lineTo(b1.sx, b1.sy); ctx.stroke();
    const a2 = iso.project(-half, g, 0), b2 = iso.project(half, g, 0);
    ctx.beginPath(); ctx.moveTo(a2.sx, a2.sy); ctx.lineTo(b2.sx, b2.sy); ctx.stroke();
  }
  ctx.restore();
}
