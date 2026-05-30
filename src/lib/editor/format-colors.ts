/**
 * The fixed palettes for the `highlight` (background) and `text_color`
 * (foreground) marks. These are the ONLY colours the bubble menu can apply.
 *
 * Why literal oklch() values rather than CSS tokens (despite the globals.css
 * "never hardcode colors" rule): these colours are baked into the document
 * itself (the mark's inline `style`), and the doc is rendered in contexts with
 * no app/theme variables — the read-only viewer and history previews. They must
 * be self-contained literals so a passage looks the same everywhere. The rule
 * targets UI chrome; this is document content.
 *
 * The values stay in the warm OKLCH family of the brand palette: high lightness
 * for highlights (legible behind the dark `--foreground` ink) and mid/low
 * lightness for text colours (legible on the cream `--background`).
 *
 * This module is framework-free so the server normalizer and the client bubble
 * can both import it. It also doubles as the security allow-list: only these
 * exact strings may end up in a mark's inline style, so untrusted jsonb or a
 * crafted payload can never inject arbitrary CSS.
 */

import {
  contrastRatioOklch,
  type OklchColor,
  unsafeOklch,
} from "@/lib/editor/oklch";

export interface FormatColor {
  /** Human label, used for `aria-label` (e.g. "Highlight green"). */
  name: string;
  /** The raw oklch() literal stored in the doc and emitted as inline style. */
  value: OklchColor;
}

/** Background highlight colours (high lightness, behind dark ink). */
export const HIGHLIGHT_COLORS: readonly FormatColor[] = [
  { name: "Yellow", value: unsafeOklch("oklch(0.93 0.10 95)") },
  { name: "Peach", value: unsafeOklch("oklch(0.90 0.07 55)") },
  { name: "Coral", value: unsafeOklch("oklch(0.90 0.07 30)") },
  { name: "Pink", value: unsafeOklch("oklch(0.90 0.07 5)") },
  { name: "Lavender", value: unsafeOklch("oklch(0.90 0.06 305)") },
  { name: "Periwinkle", value: unsafeOklch("oklch(0.90 0.06 270)") },
  { name: "Blue", value: unsafeOklch("oklch(0.90 0.06 235)") },
  { name: "Teal", value: unsafeOklch("oklch(0.91 0.06 185)") },
  { name: "Green", value: unsafeOklch("oklch(0.90 0.07 145)") },
] as const;

/** Foreground text colours (mid/low lightness, on the cream background). */
export const TEXT_COLORS: readonly FormatColor[] = [
  { name: "Terracotta", value: unsafeOklch("oklch(0.56 0.13 47)") },
  { name: "Crimson", value: unsafeOklch("oklch(0.50 0.15 20)") },
  { name: "Gold", value: unsafeOklch("oklch(0.55 0.10 85)") },
  { name: "Forest", value: unsafeOklch("oklch(0.50 0.09 145)") },
  { name: "Teal", value: unsafeOklch("oklch(0.50 0.08 185)") },
  { name: "Ocean", value: unsafeOklch("oklch(0.50 0.09 235)") },
  { name: "Plum", value: unsafeOklch("oklch(0.45 0.10 305)") },
  { name: "Clay", value: unsafeOklch("oklch(0.45 0.05 40)") },
  { name: "Slate", value: unsafeOklch("oklch(0.45 0.02 260)") },
] as const;

/** The colour the highlight split-button applies before any history exists. */
export const DEFAULT_HIGHLIGHT_COLOR: OklchColor =
  HIGHLIGHT_COLORS[0]?.value ?? unsafeOklch("");
/** The colour the text-colour split-button applies before any history exists. */
export const DEFAULT_TEXT_COLOR: OklchColor =
  TEXT_COLORS[0]?.value ?? unsafeOklch("");

// Widen the set element type to `string` so the allow-list guards below
// can accept the untrusted strings they're meant to validate. Set membership
// is value-based, so this is purely a type relaxation.
const HIGHLIGHT_VALUES: ReadonlySet<string> = new Set<string>(
  HIGHLIGHT_COLORS.map((c) => c.value),
);
const TEXT_VALUES: ReadonlySet<string> = new Set<string>(
  TEXT_COLORS.map((c) => c.value),
);

/** Is `value` a known highlight colour? (allow-list guard) */
export function isHighlightColor(value: string): boolean {
  return HIGHLIGHT_VALUES.has(value);
}

/** Is `value` a known text colour? (allow-list guard) */
export function isTextColor(value: string): boolean {
  return TEXT_VALUES.has(value);
}

/** The label for a colour value, for building accessible labels. */
export function colorName(value: string): string {
  return (
    HIGHLIGHT_COLORS.find((c) => c.value === value)?.name ??
    TEXT_COLORS.find((c) => c.value === value)?.name ??
    value
  );
}

/**
 * The page background and default ink colour in each theme — the contrast
 * targets the custom-colour picker validates against, and the schema's mark
 * `toDOM` uses to derive a light/dark pair for a stored custom colour.
 *
 * These mirror the `--background` / `--foreground` literals in `globals.css`
 * (and have to stay in sync with them by hand — they're consumed in framework-
 * free contexts where a CSSOM lookup of the resolved variable isn't available,
 * namely the schema's `toDOM` and the picker's pure colour-math). The schema
 * comment about doc colours being self-contained literals already justifies
 * pinning brand colours here; this is the same trade-off.
 */
export const PAGE_BG_LIGHT: OklchColor = unsafeOklch("oklch(0.993 0.006 83)");
export const PAGE_BG_DARK: OklchColor = unsafeOklch("oklch(0.2 0.014 56)");
export const INK_COLOR_LIGHT: OklchColor = unsafeOklch("oklch(0.24 0.02 56)");
export const INK_COLOR_DARK: OklchColor = unsafeOklch("oklch(0.95 0.008 83)");

/** Re-exported here so callers don't have to import `oklch.ts` separately. */
export { contrastRatioOklch, colorPair } from "@/lib/editor/oklch";

/**
 * Does `color` clear WCAG AA (4.5:1) against `against`? Used by the picker's
 * mask paint and the schema's `colorPair` selection. Defaults to "no" on any
 * malformed input — safer to clamp the picker than to apply an unverifiable
 * colour.
 */
export function meetsContrastAA(color: string, against: string): boolean {
  return contrastRatioOklch(color, against) >= 4.5;
}
