/**
 * Pure colour-math for the custom colour picker. Three jobs:
 *
 *   1. Round-trip between the representations the rest of the app speaks:
 *      OKLCH (what's stored on the mark and in `user_settings`), hex (the
 *      input format the picker shows the user), and HSV (what
 *      react-colorful's `HsvColorPicker` drives off internally).
 *   2. WCAG luminance + contrast ratio for an arbitrary sRGB pair — the
 *      basis for the picker's contrast-mask paint and for the schema's
 *      light/dark colour-pair derivation.
 *   3. {@link colorPair} — given a picked OKLCH and the surface kind, decide
 *      whether the user picked it in light or dark mode, then derive the
 *      counterpart so the same span stays readable when the user toggles
 *      themes.
 *
 * Framework-free (no React, no DOM). Coefficients come from CSS Color 4 /
 * Björn Ottosson's reference Oklab matrices, so values round-trip cleanly
 * against any other CSS Color 4 implementation (browsers, Tailwind utilities,
 * etc.).
 */

// ---------------------------------------------------------------------------
// OklchColor brand — every CSS colour value that enters the DOM at runtime
// (inline styles, document marks, presence cursors, …) carries this nominal
// type, so the type system can guarantee the value came from an approved
// source. Constructed only by `parseOklch` (validates) or `unsafeOklch` (for
// allow-listed files: format-colors.ts, icons.tsx, custom-color-picker.tsx,
// globals.css). Pairs with the `local/no-raw-colors` ESLint rule — if the
// rule misses a literal, the branded type will catch it at the call site.
// ---------------------------------------------------------------------------

declare const oklchBrand: unique symbol;

/**
 * A validated OKLCH colour string. Nominal-typed via `oklchBrand` so a plain
 * `string` literal can't be assigned to one — every value that reaches an
 * inline `style`, a mark attribute, or a theme-token override has to come
 * through {@link parseOklch}, {@link oklchString}, {@link hexToOklch},
 * {@link hsvToOklch}, or the allow-listed {@link unsafeOklch} escape hatch.
 */
export type OklchColor = string & { readonly [oklchBrand]: true };

/**
 * Validate an `oklch(L C H)` literal and brand it as an {@link OklchColor}.
 * Returns null for anything that doesn't match the canonical format (see
 * {@link oklchParts} for the shape). Use this for any value crossing a trust
 * boundary — picker hex input, server payloads, persisted user settings.
 */
export function parseOklch(value: string): OklchColor | null {
  return oklchParts(value) === null ? null : (value as OklchColor);
}

/**
 * Brand a string as {@link OklchColor} without validation. ONLY for
 * allow-listed files that own colour values by construction — the static
 * preset palettes in `format-colors.ts`, fixed brand colours in `icons.tsx`,
 * and the canvas-rendered preview in `custom-color-picker.tsx`. New callers
 * should reach for {@link parseOklch} instead.
 */
export function unsafeOklch(value: string): OklchColor {
  return value as OklchColor;
}

// ---------------------------------------------------------------------------
// Parsing + formatting
// ---------------------------------------------------------------------------

/** Decomposed OKLCH triple. Lightness 0–1, chroma 0–~0.4, hue 0–360°. */
export interface OklchParts {
  L: number;
  C: number;
  H: number;
}

/**
 * Parse the canonical `oklch(L C H)` literal the app stores. Accepts spaces
 * or commas as separators and a trailing alpha (which we ignore — marks are
 * always opaque). Returns null for anything that doesn't match: callers treat
 * that as "fall back to the raw string and let the browser cope" (preset
 * values always match, so this only fires on tampered jsonb).
 */
export function oklchParts(s: string): OklchParts | null {
  const m =
    /^oklch\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*[\d.]+\s*)?\)$/i.exec(
      s.trim(),
    );
  if (!m) return null;
  let L = parseFloat(m[1] ?? "");
  const C = parseFloat(m[2] ?? "");
  const H = parseFloat(m[3] ?? "");
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) {
    return null;
  }
  // The spec allows `oklch(95% 0.05 90)` (percent lightness). Internally we
  // always keep L on 0–1; a literal that ends with `%` is rescaled.
  if ((m[1] ?? "").includes("%")) {
    L = L / 100;
  } else if (L > 1.5) {
    // Some hand-written values pass 95 instead of 0.95; tolerate it.
    L = L / 100;
  }
  if (L < 0 || L > 1.0 || C < 0 || C > 0.5 || H < 0 || H > 360) {
    return null;
  }
  return { L, C, H };
}

/**
 * Format `(L, C, H)` as the canonical literal the app stores everywhere else.
 * Two decimals on L+C and one on H is more than enough fidelity for highlight
 * / text colour: anything finer is invisible and inflates the doc JSON.
 */
export function oklchString(L: number, C: number, H: number): OklchColor {
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return `oklch(${String(round(L, 3))} ${String(round(C, 3))} ${String(round(H, 1))})` as OklchColor;
}

// ---------------------------------------------------------------------------
// OKLCH ↔ sRGB
// ---------------------------------------------------------------------------

/** Linear-sRGB triple, each component in [0, 1] before gamut clipping. */
type LinearRGB = readonly [number, number, number];

/** Gamma-encoded sRGB triple, each component in [0, 1]. */
type SRGB = readonly [number, number, number];

function oklchToLinear({ L, C, H }: OklchParts): LinearRGB {
  // OKLCH → OKLab
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  // OKLab → LMS (then cube)
  const lp = L + 0.3963377774 * a + 0.2158037573 * b;
  const mp = L - 0.1055613458 * a - 0.0638541728 * b;
  const sp = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lp * lp * lp;
  const m = mp * mp * mp;
  const s = sp * sp * sp;
  // LMS → Linear sRGB (Ottosson's reference matrix)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToOklch(r: number, g: number, b: number): OklchParts {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lp = Math.cbrt(l);
  const mp = Math.cbrt(m);
  const sp = Math.cbrt(s);
  const L = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

function srgbEncode(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function srgbDecode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** OKLCH → gamma-encoded sRGB in [0, 1], clamped to gamut. */
export function oklchToSrgb(parts: OklchParts): SRGB {
  const [lr, lg, lb] = oklchToLinear(parts);
  return [srgbEncode(lr), srgbEncode(lg), srgbEncode(lb)];
}

/** sRGB in [0, 1] → OKLCH. */
export function srgbToOklch(r: number, g: number, b: number): OklchParts {
  return linearToOklch(srgbDecode(r), srgbDecode(g), srgbDecode(b));
}

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hex8(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n * 255)));
  return v.toString(16).padStart(2, "0");
}

/** OKLCH literal → "#rrggbb" lowercase. Out-of-gamut values are clipped. */
export function oklchToHex(s: string): string | null {
  const parts = oklchParts(s);
  if (!parts) return null;
  const [r, g, b] = oklchToSrgb(parts);
  return `#${hex8(r)}${hex8(g)}${hex8(b)}`;
}

/** "#rrggbb" or "#rgb" → OKLCH literal. */
export function hexToOklch(hex: string): OklchColor | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let body = m[1] ?? "";
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  const { L, C, H } = srgbToOklch(r, g, b);
  return oklchString(L, C, H);
}

// ---------------------------------------------------------------------------
// HSV — bridge for react-colorful's HsvColorPicker
// ---------------------------------------------------------------------------

/** HSV triple in react-colorful's units: h 0–360, s 0–100, v 0–100. */
export interface HsvParts {
  h: number;
  s: number;
  v: number;
}

/** HSV (react-colorful units) → sRGB 0–1. Standard HSV cylinder. */
export function hsvToSrgb({ h, s, v }: HsvParts): SRGB {
  const sf = s / 100;
  const vf = v / 100;
  const c = vf * sf;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = vf - c;
  return [r + m, g + m, b + m];
}

function srgbToHsv([r, g, b]: SRGB): HsvParts {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  return { h, s, v: max * 100 };
}

/** OKLCH literal → HSV (for seeding the picker from a stored colour). */
export function oklchToHsv(s: string): HsvParts | null {
  const parts = oklchParts(s);
  if (!parts) return null;
  return srgbToHsv(oklchToSrgb(parts));
}

/** HSV (picker units) → OKLCH literal (for persisting the picker's choice). */
export function hsvToOklch(hsv: HsvParts): OklchColor {
  const { L, C, H } = srgbToOklch(...hsvToSrgb(hsv));
  return oklchString(L, C, H);
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

/** Relative luminance per WCAG 2.x (linear-light, Rec.709 coefficients). */
export function relativeLuminance([r, g, b]: SRGB): number {
  const rl = srgbDecode(r);
  const gl = srgbDecode(g);
  const bl = srgbDecode(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio in the range [1, 21]. Order-independent. */
export function contrastRatio(a: SRGB, b: SRGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convenience: contrast between two OKLCH literals. */
export function contrastRatioOklch(a: string, b: string): number {
  const pa = oklchParts(a);
  const pb = oklchParts(b);
  if (!pa || !pb) return 1;
  return contrastRatio(oklchToSrgb(pa), oklchToSrgb(pb));
}

// ---------------------------------------------------------------------------
// Light/dark variant derivation
// ---------------------------------------------------------------------------

/**
 * Move `L` along the lightness axis (hue + chroma frozen) until the resulting
 * colour clears 4.5:1 contrast against `targetSrgb`. We step toward whichever
 * end is *farther* from the target's luminance, since that's the direction
 * contrast can grow. Capped at 30 iterations of 0.02; in practice converges
 * in 1–3. Falls back to whichever endpoint we landed on if no value clears.
 */
function nudgeLightnessForContrast(
  startParts: OklchParts,
  targetSrgb: SRGB,
  threshold: number,
): OklchParts {
  const targetL = relativeLuminance(targetSrgb);
  const startLuma = relativeLuminance(oklchToSrgb(startParts));
  // Step away from the target's luminance — lighter if we're already lighter,
  // darker otherwise.
  const dir = startLuma >= targetL ? 1 : -1;
  let L = startParts.L;
  for (let i = 0; i < 30; i++) {
    if (
      contrastRatio(oklchToSrgb({ ...startParts, L }), targetSrgb) >= threshold
    ) {
      return { ...startParts, L };
    }
    L += dir * 0.02;
    if (L <= 0.02) return { ...startParts, L: 0.02 };
    if (L >= 0.98) return { ...startParts, L: 0.98 };
  }
  return { ...startParts, L };
}

/**
 * Theme-keyed colour pair for a stored mark. The schema's `toDOM` emits both
 * variants as CSS custom properties so the same span renders correctly in
 * either theme (see [[selection-bubble-and-color-marks]]).
 *
 * Logic: the picker enforces contrast against the *current* theme's target as
 * the user drags, so the stored value is guaranteed-readable in *one* theme.
 * We figure out which one by re-running the contrast check; the other variant
 * is derived by lightness-flipping then nudging until it clears.
 *
 * `surface` selects what counts as the contrast target:
 *   - "highlight" → contrast against the default ink colour (text overlaid).
 *   - "textColor" → contrast against the page background.
 */
export function colorPair(
  stored: OklchColor,
  surface: "highlight" | "textColor",
  targets: {
    /** Page bg + default ink in each theme; passed in so this stays pure. */
    lightBg: OklchColor;
    lightInk: OklchColor;
    darkBg: OklchColor;
    darkInk: OklchColor;
  },
): { light: OklchColor; dark: OklchColor } | null {
  const parts = oklchParts(stored);
  if (!parts) return null;
  const lightTarget =
    surface === "highlight" ? targets.lightInk : targets.lightBg;
  const darkTarget = surface === "highlight" ? targets.darkInk : targets.darkBg;
  const lightTargetParts = oklchParts(lightTarget);
  const darkTargetParts = oklchParts(darkTarget);
  if (!lightTargetParts || !darkTargetParts) {
    return { light: stored, dark: stored };
  }
  const lightTargetSrgb = oklchToSrgb(lightTargetParts);
  const darkTargetSrgb = oklchToSrgb(darkTargetParts);
  const storedSrgb = oklchToSrgb(parts);
  const passesLight = contrastRatio(storedSrgb, lightTargetSrgb) >= 4.5;
  const passesDark = contrastRatio(storedSrgb, darkTargetSrgb) >= 4.5;

  // The picker enforces 4.5:1 at pick-time, so at least one passes — but if
  // the user pasted a preset value that satisfies both, we keep it for both.
  if (passesLight && passesDark) {
    return { light: stored, dark: stored };
  }
  // Picked in the theme it passes in; flip L and nudge for the other.
  const pickedInLight = passesLight;
  const flipped: OklchParts = { ...parts, L: 1 - parts.L };
  const other = pickedInLight
    ? nudgeLightnessForContrast(flipped, darkTargetSrgb, 4.5)
    : nudgeLightnessForContrast(flipped, lightTargetSrgb, 4.5);
  const otherStr = oklchString(other.L, other.C, other.H);
  return pickedInLight
    ? { light: stored, dark: otherStr }
    : { light: otherStr, dark: stored };
}
