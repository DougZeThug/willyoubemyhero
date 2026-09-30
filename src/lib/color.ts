// Colour conversion and contrast, for the two places that cannot take oklch.
//
// The second is measurement. WCAG contrast is defined on linear-light sRGB, and
// a translucent edge like `oklch(1 0 0 / 35%)` is not a colour until something
// composites it over what is behind it — so `--border`'s "is this 3:1?" cannot
// be answered in oklch either. The conversion below already computes the
// linear-light triple both jobs need; it is exported rather than duplicated.
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

/** The `/ A` tail of the same, alpha as a fraction or a percentage. */
const OKLCH_ALPHA = /^oklch\([^)]*\/\s*([\d.]+%?)\s*\)/i;

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
  const rgb = oklchToLinearRgb(css);
  if (!rgb) return css;
  return `#${hex2(gamma(rgb[0]))}${hex2(gamma(rgb[1]))}${hex2(gamma(rgb[2]))}`;
}

/** A colour as linear-light sRGB, each channel clamped into gamut. */
export type LinearRgb = readonly [number, number, number];

/**
 * `oklch(...)` to linear-light sRGB, the step before gamma encoding.
 *
 * Split out of `oklchToHex` rather than duplicated because WCAG contrast wants
 * exactly these numbers, and a second copy of the Oklab matrices is the same
 * class of bug this module was written to fix — with nothing watching it.
 * Returns null for anything that is not an `oklch()` string.
 */
export function oklchToLinearRgb(css: string): LinearRgb | null {
  const m = OKLCH.exec(css.trim());
  if (!m) return null;

  const rawL = m[1];
  const L = rawL.endsWith("%") ? parseFloat(rawL) / 100 : parseFloat(rawL);
  const C = parseFloat(m[2]);
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(h)) return null;

  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // Oklab to LMS, cubed to undo the cube root Oklab is defined with.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m2 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m2 + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m2 - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m2 + 1.707614701 * s),
  ];
}

/**
 * The alpha of an `oklch(... / A)`, or 1 where none is written.
 *
 * A sibling rather than a widening of `OKLCH`: that regex drops alpha on
 * purpose, because canvas-confetti reads the first six characters of what
 * `oklchToHex` returns and an `#rrggbbaa` would break its only caller.
 */
export function oklchAlpha(css: string): number {
  const m = OKLCH_ALPHA.exec(css.trim());
  if (!m) return 1;
  const raw = m[1];
  const a = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isFinite(a) ? clamp01(a) : 1;
}

/** sRGB channel back to linear light — the inverse of `gamma`. */
function ungamma(c: number): number {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * A translucent colour laid over an opaque one.
 *
 * The blend happens in gamma-encoded sRGB, not in linear light, because that is
 * what a browser does when it composites `oklch(1 0 0 / 35%)` over a panel.
 * Doing it in linear light is more defensible as physics and gives materially
 * different numbers — which would make a contrast assertion measure something
 * nobody ever sees.
 */
export function compositeOver(fg: LinearRgb, alpha: number, bg: LinearRgb): LinearRgb {
  const mix = (i: number) => ungamma(gamma(fg[i]) * alpha + gamma(bg[i]) * (1 - alpha));
  return [mix(0), mix(1), mix(2)];
}

/**
 * An 8-bit sRGB pixel — what a canvas readback hands back — to linear light.
 *
 * The same transfer function `compositeOver` blends through, so a measurement
 * taken off a real rendered pixel and one computed from the tokens are on the
 * same footing.
 */
export function srgb8ToLinear(r: number, g: number, b: number): LinearRgb {
  return [ungamma(r / 255), ungamma(g / 255), ungamma(b / 255)];
}

/** WCAG relative luminance. */
export function relativeLuminance([r, g, b]: LinearRgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. Order of the two colours does not matter. */
export function contrast(a: LinearRgb, b: LinearRgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
