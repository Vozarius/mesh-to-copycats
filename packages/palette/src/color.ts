export type LinearRgb = readonly [red: number, green: number, blue: number];
export type Oklab = readonly [lightness: number, a: number, b: number];
export type Srgb = readonly [red: number, green: number, blue: number];

function finiteUnit(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be finite and in 0..1`);
  }
  return value;
}

export function srgbComponentToLinear(value: number): number {
  const component = finiteUnit(value, 'sRGB component');
  return component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4;
}

export function linearComponentToSrgb(value: number): number {
  const component = finiteUnit(value, 'linear RGB component');
  return component <= 0.0031308
    ? component * 12.92
    : 1.055 * component ** (1 / 2.4) - 0.055;
}

export function srgbToLinear(color: Srgb): LinearRgb {
  return color.map(srgbComponentToLinear) as unknown as LinearRgb;
}

export function linearToSrgb(color: LinearRgb): Srgb {
  return color.map(linearComponentToSrgb) as unknown as Srgb;
}

export function linearSrgbToOklab(color: LinearRgb): Oklab {
  const red = finiteUnit(color[0], 'linear red');
  const green = finiteUnit(color[1], 'linear green');
  const blue = finiteUnit(color[2], 'linear blue');
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

export function srgbToOklab(color: Srgb): Oklab {
  return linearSrgbToOklab(srgbToLinear(color));
}

export function oklabDistanceSquared(left: Oklab, right: Oklab): number {
  const deltaL = left[0] - right[0];
  const deltaA = left[1] - right[1];
  const deltaB = left[2] - right[2];
  return deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
}

export function hexToSrgb(hex: string): Srgb {
  const normalized = hex.replace(/^#/u, '');
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) throw new Error(`Invalid RGB hex ${hex}`);
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}
