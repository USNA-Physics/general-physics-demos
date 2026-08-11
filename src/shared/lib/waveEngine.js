/**
 * waveEngine.js — parameterized traveling-wave sampler shared by D37 (Traveling
 * Waves) and D40 (Superposition Sandbox, which sums two of these).
 *
 * All quantities SI. A wave is { A, k, omega, phase }, with y = A sin(kx − ωt + φ).
 * Helpers derive k, ω from the friendlier λ, f and give the string wave speed.
 */

/** Sample y(x, t) for one wave at a single position. */
export function sampleWave({ A = 1, k, omega, phase = 0 }, x, t) {
  return A * Math.sin(k * x - omega * t + phase);
}

/** Sample a wave across an array of x positions at time t → Float64Array of y. */
export function sampleAcross(wave, xs, t) {
  const y = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) y[i] = sampleWave(wave, xs[i], t);
  return y;
}

/** Superpose any number of waves across xs at time t (D40). */
export function superpose(waves, xs, t) {
  const y = new Float64Array(xs.length);
  for (const w of waves) for (let i = 0; i < xs.length; i++) y[i] += sampleWave(w, xs[i], t);
  return y;
}

/** Evenly spaced sample positions on [0, xMax]. */
export function makeXs(xMax, n) {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = (i / (n - 1)) * xMax;
  return xs;
}

export const k_of = (lambda) => (2 * Math.PI) / lambda;   // wavenumber from wavelength
export const omega_of = (f) => 2 * Math.PI * f;           // angular freq from frequency
export const waveSpeed = (fTension, mu) => Math.sqrt(fTension / mu); // v = √(F_T/μ)
export const beatFreq = (f1, f2) => Math.abs(f1 - f2);
/** Standing-wave harmonic frequency on a fixed-fixed string: f_n = n v / 2L. */
export const harmonic = (n, v, L) => (n * v) / (2 * L);
