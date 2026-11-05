/**
 * chaosPhysics.js — the dimensionless driven damped pendulum, shared by the
 * ChaoticPendulum component (realtime modes) and chaosWorker.js (the heavy
 * bifurcation / basin sweeps). Keeping the integrator in ONE module means the
 * live trajectory and the precomputed maps can never drift apart.
 *
 *   θ'' + (1/Q)·θ' + sin θ = A·cos(ω_D t)          (time in units of 1/ω₀)
 *
 * θ is unbounded here (the bob may go over the top); callers wrap to (−π, π]
 * for DISPLAY only, never for the integrator. Fixed-step RK4 — chaos amplifies
 * integration error, so no adaptive stepping (and a worker sweep must be
 * bit-reproducible from its parameters anyway).
 */

// Canonical Baker & Gollub parameters: with Q = 2 and ω_D = 2/3 the drive
// amplitude A walks the period-doubling route to chaos. These are the fixed
// backdrop; A is the headline knob.
export const Q_DEFAULT = 2;
export const OMEGA_D_DEFAULT = 2 / 3;

// Drive presets that step along the period-doubling cascade (Q = 2, ω_D = 2/3).
// Values are the widely-cited Baker & Gollub set; the live regime label is
// MEASURED from the Poincaré points (see classifyPeriod), never asserted from
// this table — so if a value sits slightly off its band the readout still tells
// the truth and the bifurcation diagram marks where it actually lands.
export const PRESETS = [
  { key: 'p1', label: 'Period 1', A: 0.9 },
  { key: 'p2', label: 'Period 2', A: 1.07 },
  { key: 'p4', label: 'Period 4', A: 1.15 },
  { key: 'chaos', label: 'Chaotic', A: 1.5 },
];

export const STEPS_PER_PERIOD = 200; // dt = T_D / 200 — well below T_D

export const drivePeriod = (omegaD) => (2 * Math.PI) / omegaD;

/** wrap an angle to (−π, π] — DISPLAY ONLY. */
export function wrapPi(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** state derivative [θ', ω'] for state [θ, ω] at time t. */
export function deriv(th, w, t, Q, A, Om) {
  return [w, A * Math.cos(Om * t) - w / Q - Math.sin(th)];
}

/** one fixed-step RK4 step. state = [θ, ω]; returns the new [θ, ω]. */
export function rk4Step(state, t, dt, Q, A, Om) {
  const [th, w] = state;
  const k1 = deriv(th, w, t, Q, A, Om);
  const k2 = deriv(th + 0.5 * dt * k1[0], w + 0.5 * dt * k1[1], t + 0.5 * dt, Q, A, Om);
  const k3 = deriv(th + 0.5 * dt * k2[0], w + 0.5 * dt * k2[1], t + 0.5 * dt, Q, A, Om);
  const k4 = deriv(th + dt * k3[0], w + dt * k3[1], t + dt, Q, A, Om);
  return [
    th + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    w + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  ];
}

/**
 * Advance exactly one drive period T_D, returning [newState, newT]. Stepping in
 * whole periods keeps the Poincaré strobe landing on the same drive phase every
 * time (dt divides T_D evenly), which is what makes the section clean.
 */
export function stepOnePeriod(state, t, Q, A, Om, stepsPerPeriod = STEPS_PER_PERIOD) {
  const dt = drivePeriod(Om) / stepsPerPeriod;
  let s = state;
  let tt = t;
  for (let i = 0; i < stepsPerPeriod; i++) {
    s = rk4Step(s, tt, dt, Q, A, Om);
    tt += dt;
  }
  return [s, tt];
}

/**
 * Classify the period of a settled trajectory from its strobed angular
 * velocities. Returns 1, 2, 4, 8 … for a locked period-n cycle, or 0 for
 * "chaotic / not periodic" (used for the live regime label).
 */
export function classifyPeriod(omegaSamples, tol = 0.04) {
  const n = omegaSamples.length;
  if (n < 8) return 0;
  const tail = omegaSamples.slice(-Math.min(32, n));
  for (const p of [1, 2, 4, 8]) {
    if (tail.length < 2 * p) continue;
    let ok = true;
    for (let i = 0; i + p < tail.length; i++) {
      if (Math.abs(tail[i] - tail[i + p]) > tol) { ok = false; break; }
    }
    // reject the degenerate case where a period-p pattern is really period < p
    if (ok && p > 1) {
      let spread = 0;
      for (let i = 1; i < p; i++) spread = Math.max(spread, Math.abs(tail[tail.length - 1] - tail[tail.length - 1 - i]));
      if (spread < tol) continue;
    }
    if (ok) return p;
  }
  return 0;
}
