/**
 * physics.js — Pure numerical functions for optical diffraction.
 * All functions accept SI units (meters) internally.
 */

export function sinc(x) {
  if (Math.abs(x) < 1e-10) return 1.0;
  return Math.sin(x) / x;
}

/**
 * Bessel function of the first kind, order 1.
 * Rational polynomial approximation (Abramowitz & Stegun) accurate to ~1e-7.
 */
export function besselJ1(x) {
  const ax = Math.abs(x);

  if (ax < 8.0) {
    const y = x * x;
    const ans1 =
      x *
      (72362614232.0 +
        y *
          (-7895059235.0 +
            y *
              (242396853.1 +
                y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
    const ans2 =
      144725228442.0 +
      y *
        (2300535178.0 +
          y *
            (18583304.74 +
              y * (99447.43394 + y * (376.9991397 + y * 1.0))));
    return ans1 / ans2;
  }

  const z = 8.0 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const p =
    1.0 +
    y *
      (0.183105e-2 +
        y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const q =
    0.04687499995 +
    y *
      (-0.2002690873e-3 +
        y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p - z * Math.sin(xx) * q);
  return x < 0 ? -ans : ans;
}

export function singleSlitIntensity(y, a, lambda, L) {
  const sinTheta = y / Math.sqrt(y * y + L * L);
  const beta = (Math.PI * a * sinTheta) / lambda;
  return sinc(beta) ** 2;
}

export function airyIntensity(r, D, lambda, L) {
  const sinTheta = r / Math.sqrt(r * r + L * L);
  const u = (Math.PI * D * sinTheta) / lambda;
  if (Math.abs(u) < 1e-10) return 1.0;
  return (2 * besselJ1(u) / u) ** 2;
}

export function doubleSlitIntensity(y, a, d, lambda, L) {
  const sinTheta = y / Math.sqrt(y * y + L * L);
  const beta = (Math.PI * a * sinTheta) / lambda;
  const psi = (Math.PI * d * sinTheta) / lambda;
  return sinc(beta) ** 2 * Math.cos(psi) ** 2;
}

export function nSlitIntensity(y, a, d, N, lambda, L) {
  const sinTheta = y / Math.sqrt(y * y + L * L);
  const beta = (Math.PI * a * sinTheta) / lambda;
  const psi = (Math.PI * d * sinTheta) / lambda;
  const diffraction = sinc(beta) ** 2;

  const sinNpsi = Math.sin(N * psi);
  const sinPsi = Math.sin(psi);
  const interference =
    Math.abs(sinPsi) < 1e-10 ? N * N : (sinNpsi / sinPsi) ** 2;

  return (diffraction * interference) / (N * N);
}

export function interferenceOnly(y, d, lambda, L) {
  const sinTheta = y / Math.sqrt(y * y + L * L);
  const psi = (Math.PI * d * sinTheta) / lambda;
  return Math.cos(psi) ** 2;
}

export function envelopeOnly(y, a, lambda, L) {
  return singleSlitIntensity(y, a, lambda, L);
}
