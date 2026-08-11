/**
 * shapes.js — rigid-body shape catalog shared by D25 (Moment of Inertia) and
 * D28 (Rolling Race).
 *
 * `cInertia` is the dimensionless coefficient in I = c · m · r² (about the
 * symmetry axis / rolling axis). It is the ONLY thing that sets the rolling
 * order — mass and radius cancel out of a = g sinθ / (1 + c).
 */

export const SHAPES = [
  { key: 'hoop', label: 'Hoop / ring', cInertia: 1.0, rolls: true, note: 'All mass at the rim.' },
  { key: 'cylinder', label: 'Solid cylinder / disk', cInertia: 0.5, rolls: true, note: 'Uniform disk.' },
  { key: 'shell', label: 'Thin spherical shell', cInertia: 2 / 3, rolls: true, note: 'Hollow ball.' },
  { key: 'sphere', label: 'Solid sphere', cInertia: 0.4, rolls: true, note: 'Uniform ball — the winner.' },
  { key: 'rod-center', label: 'Rod about center', cInertia: 1 / 12, rolls: false, note: 'I = mL²/12 (uses length, not radius).' },
  { key: 'rod-end', label: 'Rod about end', cInertia: 1 / 3, rolls: false, note: 'I = mL²/3 (parallel-axis from center).' },
];

export const byKey = Object.fromEntries(SHAPES.map((s) => [s.key, s]));

/** Rolling-without-slipping acceleration down an incline: a = g sinθ / (1 + c). */
export function rollingAccel(cInertia, angleDeg, g = 9.81) {
  return (g * Math.sin((angleDeg * Math.PI) / 180)) / (1 + cInertia);
}

/** Moment of inertia about the symmetry axis, I = c·m·r². */
export function inertia(cInertia, mass, radius) {
  return cInertia * mass * radius * radius;
}

/** Parallel-axis theorem: I = I_cm + M d². */
export function parallelAxis(iCm, mass, d) {
  return iCm + mass * d * d;
}

/** Fraction of kinetic energy stored in rotation while rolling: c / (1 + c). */
export function rotationalKEFraction(cInertia) {
  return cInertia / (1 + cInertia);
}
