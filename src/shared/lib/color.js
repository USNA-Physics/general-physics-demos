/**
 * color.js — Wavelength-to-RGB conversion (Dan Bruton's algorithm).
 */

/**
 * Convert a visible-light wavelength to an {r, g, b} object (0-255).
 * Returns neutral gray for wavelengths outside 380-780 nm.
 */
export function wavelengthToRGB(lambdaNm) {
  let r, g, b;

  if (lambdaNm < 380 || lambdaNm > 780) {
    return { r: 180, g: 180, b: 180 };
  }

  if (lambdaNm < 440) {
    r = -(lambdaNm - 440) / (440 - 380); g = 0.0; b = 1.0;
  } else if (lambdaNm < 490) {
    r = 0.0; g = (lambdaNm - 440) / (490 - 440); b = 1.0;
  } else if (lambdaNm < 510) {
    r = 0.0; g = 1.0; b = -(lambdaNm - 510) / (510 - 490);
  } else if (lambdaNm < 580) {
    r = (lambdaNm - 510) / (580 - 510); g = 1.0; b = 0.0;
  } else if (lambdaNm < 645) {
    r = 1.0; g = -(lambdaNm - 645) / (645 - 580); b = 0.0;
  } else {
    r = 1.0; g = 0.0; b = 0.0;
  }

  let factor;
  if (lambdaNm < 420) {
    factor = 0.3 + (0.7 * (lambdaNm - 380)) / (420 - 380);
  } else if (lambdaNm > 700) {
    factor = 0.3 + (0.7 * (780 - lambdaNm)) / (780 - 700);
  } else {
    factor = 1.0;
  }

  const gamma = 0.8;
  return {
    r: Math.round(255 * (r * factor) ** gamma),
    g: Math.round(255 * (g * factor) ** gamma),
    b: Math.round(255 * (b * factor) ** gamma),
  };
}

export function wavelengthToCSS(lambdaNm) {
  const { r, g, b } = wavelengthToRGB(lambdaNm);
  return `rgb(${r},${g},${b})`;
}

export function wavelengthToRGBA(lambdaNm, alpha = 1) {
  const { r, g, b } = wavelengthToRGB(lambdaNm);
  return `rgba(${r},${g},${b},${alpha})`;
}
