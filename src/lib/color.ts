// Colour conversion, for the one place in this app that cannot take oklch.
//
// Every colour in this codebase is authored in `oklch()` — the palette, the
// rarity tiers, the secret foils — and that is right: it is what CSS renders and
// what keeps two tiers perceptually a fixed distance apart.
//
// canvas-confetti is the exception. It parses colours with
// `String(str).replace(/[^0-9a-f]/gi, '')` and reads the first six characters as
// hex, so `oklch(0.82 0.14 210)` survives as `c082014210` and comes out as
// RGB(192, 130, 1) — an olive that is nobody's tier. Worse, every tier in this
// app starts `oklch(0.8…`, so they all collapse onto roughly the *same* wrong
// colour and the confetti stops carrying any information at all.

/** `oklch(L C H)` or `oklch(L C H / A)`, with L as a fraction or a percentage. */
const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear-light channel to sRGB, the standard piecewise transfer function. */
function gamma(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const hex2 = (v: number) =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * `oklch(...)` to `#rrggbb`.
 *
 * Oklab → LMS → linear sRGB → sRGB, with the standard matrices. Out-of-gamut
 * colours are clamped per channel rather than gamut-mapped: the inputs here are
 * all a designed palette that already sits inside sRGB, and a clamp is honest
 * about the few points near the edge where it does not.
 *
 * Anything that is not an `oklch()` string is passed through untouched, so a hex
 * literal — the white in every burst — costs nothing and needs no special case at
 * the call site.
 */
export function oklchToHex(css: string): string {
  const m = OKLCH.exec(css.trim());
  if (!m) return css;

  const rawL = m[1];
  const L = rawL.endsWith("%") ? parseFloat(rawL) / 100 : parseFloat(rawL);
  const C = parseFloat(m[2]);
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(h)) return css;

  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // Oklab to LMS, cubed to undo the cube root Oklab is defined with.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m2 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m2 + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m2 - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m2 + 1.707614701 * s;

  return `#${hex2(gamma(r))}${hex2(gamma(g))}${hex2(gamma(bl))}`;
}
