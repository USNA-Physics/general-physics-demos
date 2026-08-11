import { describe, it, expect } from 'vitest';
import {
  sinc,
  besselJ1,
  singleSlitIntensity,
  airyIntensity,
  doubleSlitIntensity,
  nSlitIntensity,
} from '../courses/sp212/lib/physics.js';

function approx(actual, expected, tol = 1e-5) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

describe('sinc', () => {
  it('returns 1 at x=0', () => {
    expect(sinc(0)).toBe(1.0);
  });
  it('returns 0 at x=π', () => {
    approx(sinc(Math.PI), 0);
  });
  it('returns sin(1)/1 at x=1', () => {
    approx(sinc(1), Math.sin(1));
  });
});

describe('besselJ1', () => {
  it('J₁(0) = 0', () => {
    approx(besselJ1(0), 0);
  });
  it('J₁(1.8412) ≈ 0.5819 (first maximum)', () => {
    approx(besselJ1(1.8412), 0.5819, 1e-3);
  });
  it('J₁(3.8317) ≈ 0 (first zero)', () => {
    approx(besselJ1(3.8317), 0, 1e-4);
  });
  it('J₁(7.0156) ≈ 0 (second zero)', () => {
    approx(besselJ1(7.0156), 0, 1e-4);
  });
  it('is an odd function: J₁(-x) = -J₁(x)', () => {
    const x = 2.5;
    approx(besselJ1(-x), -besselJ1(x));
  });
  it('handles values in the asymptotic regime (|x| > 8)', () => {
    approx(besselJ1(10), 0.04347, 1e-4);
  });
});

describe('singleSlitIntensity', () => {
  const a = 0.1e-3;
  const lambda = 550e-9;
  const L = 2.0;

  it('central maximum = 1.0', () => {
    expect(singleSlitIntensity(0, a, lambda, L)).toBe(1.0);
  });
  it('first minimum near y = λL/a', () => {
    const y1 = (lambda * L) / a;
    expect(singleSlitIntensity(y1, a, lambda, L)).toBeLessThan(0.001);
  });
  it('symmetric: I(y) = I(-y)', () => {
    const y = 0.005;
    approx(singleSlitIntensity(y, a, lambda, L), singleSlitIntensity(-y, a, lambda, L));
  });
});

describe('airyIntensity', () => {
  const D = 1e-3;
  const lambda = 550e-9;
  const L = 2.0;

  it('central maximum = 1.0', () => {
    expect(airyIntensity(0, D, lambda, L)).toBe(1.0);
  });
  it('first dark ring near r = 1.22 λL/D', () => {
    const r1 = (1.22 * lambda * L) / D;
    expect(airyIntensity(r1, D, lambda, L)).toBeLessThan(0.005);
  });
});

describe('doubleSlitIntensity', () => {
  const a = 0.08e-3;
  const d = 0.4e-3;
  const lambda = 550e-9;
  const L = 2.0;

  it('central maximum = 1.0', () => {
    expect(doubleSlitIntensity(0, a, d, lambda, L)).toBe(1.0);
  });
  it('first interference minimum near y = λL/(2d)', () => {
    const y = (lambda * L) / (2 * d);
    expect(doubleSlitIntensity(y, a, d, lambda, L)).toBeLessThan(0.01);
  });
});

describe('nSlitIntensity', () => {
  const a = 0.08e-3;
  const d = 0.4e-3;
  const lambda = 550e-9;
  const L = 2.0;

  it('central maximum = 1.0 for N=1..10', () => {
    for (let N = 1; N <= 10; N++) {
      approx(nSlitIntensity(0, a, d, N, lambda, L), 1.0);
    }
  });
  it('N=1 matches single slit', () => {
    const y = 0.003;
    approx(nSlitIntensity(y, a, d, 1, lambda, L), singleSlitIntensity(y, a, lambda, L), 1e-6);
  });
  it('N=2 matches double slit', () => {
    const y = 0.003;
    approx(nSlitIntensity(y, a, d, 2, lambda, L), doubleSlitIntensity(y, a, d, lambda, L), 1e-6);
  });
});
