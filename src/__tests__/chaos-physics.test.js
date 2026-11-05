import { describe, it, expect } from 'vitest';
import {
  rk4Step, stepOnePeriod, wrapPi, classifyPeriod, deriv,
  drivePeriod, STEPS_PER_PERIOD,
} from '../courses/sp211/ch14-oscillations/chaosPhysics.js';

function approx(actual, expected, tol = 1e-5) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

// energy of the undriven, undamped pendulum (dimensionless): ½ω² − cos θ
const energy = ([th, w]) => 0.5 * w * w - Math.cos(th);

describe('wrapPi', () => {
  it('leaves angles already in (−π, π]', () => approx(wrapPi(1), 1));
  it('wraps just past π to a negative angle', () => approx(wrapPi(Math.PI + 0.1), -Math.PI + 0.1));
  it('wraps a full turn back to ~0', () => approx(wrapPi(2 * Math.PI), 0));
  it('maps −π to +π (half-open convention)', () => approx(wrapPi(-Math.PI), Math.PI));
});

describe('deriv (driven damped pendulum)', () => {
  it('θ̇ = ω', () => approx(deriv(0.3, 1.7, 0, 2, 1, 0.5)[0], 1.7));
  it('restoring + damping + drive assemble correctly', () => {
    // ω̇ = A cos(Ω t) − ω/Q − sin θ
    const [, wd] = deriv(0.5, 0.4, 1.2, 3, 0.8, 0.6);
    approx(wd, 0.8 * Math.cos(0.6 * 1.2) - 0.4 / 3 - Math.sin(0.5));
  });
});

describe('undriven, undamped limit (A=0, Q→∞): closed orbits, energy conserved', () => {
  it('conserves energy over many periods of small-angle swing', () => {
    const Q = 1e12, A = 0, Om = 0.5;
    let s = [0.3, 0];
    const E0 = energy(s);
    const dt = 0.01;
    for (let i = 0; i < 20000; i++) s = rk4Step(s, i * dt, dt, Q, A, Om);
    approx(energy(s), E0, 1e-6); // RK4 drift stays tiny
  });

  it('reproduces SHM at ω₀=1 for a small-angle start (A=0, large Q)', () => {
    // small θ → period ≈ 2π; after one 2π of time the bob returns near the start
    const Q = 1e12, A = 0, Om = 0.5;
    let s = [0.05, 0];
    const dt = 2 * Math.PI / 2000;
    for (let i = 0; i < 2000; i++) s = rk4Step(s, i * dt, dt, Q, A, Om);
    approx(s[0], 0.05, 2e-3); // returned to the release angle after one natural period
    approx(s[1], 0, 2e-3);
  });

  it('large-angle period exceeds the small-angle 2π (sin θ < θ)', () => {
    // integrate until the first return through θ=0 going the same way, measure the period
    const Q = 1e12, A = 0, Om = 0.5, dt = 0.001;
    const halfPeriod = (th0) => {
      let s = [th0, 0], t = 0, prev = th0;
      // quarter swing: from rest at th0 until θ first crosses 0
      while (s[0] > 0 && t < 100) { prev = s[0]; s = rk4Step(s, t, dt, Q, A, Om); t += dt; }
      return t; // ≈ quarter period
    };
    expect(halfPeriod(2.5)).toBeGreaterThan(halfPeriod(0.05)); // bigger swing is slower
  });
});

describe('stepOnePeriod strobes on the drive phase', () => {
  it('advances time by exactly T_D', () => {
    const Om = 2 / 3;
    const [, t] = stepOnePeriod([0.2, 0], 0, 2, 1.0, Om);
    approx(t, drivePeriod(Om), 1e-9);
    expect(STEPS_PER_PERIOD).toBeGreaterThan(50);
  });
});

describe('classifyPeriod', () => {
  it('flags a constant (period-1) strobe sequence', () => {
    expect(classifyPeriod(new Array(40).fill(1.234))).toBe(1);
  });
  it('flags an alternating period-2 sequence', () => {
    const seq = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.2 : 1.2));
    expect(classifyPeriod(seq)).toBe(2);
  });
  it('returns 0 (chaotic) for a non-repeating sequence', () => {
    // a chaotic-like strobe: irrational rotation, never repeats within tol
    const seq = Array.from({ length: 48 }, (_, i) => Math.sin(i * 1.7) * 2 + i * 0.013);
    expect(classifyPeriod(seq)).toBe(0);
  });
});
