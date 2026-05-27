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

export interface FormatColor {
  /** Human label, used for `aria-label` (e.g. "Highlight green"). */
  name: string;
  /** The raw oklch() literal stored in the doc and emitted as inline style. */
  value: string;
}

/** Background highlight colours (high lightness, behind dark ink). */
export const HIGHLIGHT_COLORS: readonly FormatColor[] = [
  { name: "Yellow", value: "oklch(0.93 0.10 95)" },
  { name: "Peach", value: "oklch(0.90 0.07 55)" },
  { name: "Coral", value: "oklch(0.90 0.07 30)" },
  { name: "Pink", value: "oklch(0.90 0.07 5)" },
  { name: "Lavender", value: "oklch(0.90 0.06 305)" },
  { name: "Periwinkle", value: "oklch(0.90 0.06 270)" },
  { name: "Blue", value: "oklch(0.90 0.06 235)" },
  { name: "Teal", value: "oklch(0.91 0.06 185)" },
  { name: "Green", value: "oklch(0.90 0.07 145)" },
] as const;

/** Foreground text colours (mid/low lightness, on the cream background). */
export const TEXT_COLORS: readonly FormatColor[] = [
  { name: "Terracotta", value: "oklch(0.56 0.13 47)" },
  { name: "Crimson", value: "oklch(0.50 0.15 20)" },
  { name: "Gold", value: "oklch(0.55 0.10 85)" },
  { name: "Forest", value: "oklch(0.50 0.09 145)" },
  { name: "Teal", value: "oklch(0.50 0.08 185)" },
  { name: "Ocean", value: "oklch(0.50 0.09 235)" },
  { name: "Plum", value: "oklch(0.45 0.10 305)" },
  { name: "Clay", value: "oklch(0.45 0.05 40)" },
  { name: "Slate", value: "oklch(0.45 0.02 260)" },
] as const;

/** The colour the highlight split-button applies before any history exists. */
export const DEFAULT_HIGHLIGHT_COLOR: string = HIGHLIGHT_COLORS[0]?.value ?? "";
/** The colour the text-colour split-button applies before any history exists. */
export const DEFAULT_TEXT_COLOR: string = TEXT_COLORS[0]?.value ?? "";

const HIGHLIGHT_VALUES = new Set(HIGHLIGHT_COLORS.map((c) => c.value));
const TEXT_VALUES = new Set(TEXT_COLORS.map((c) => c.value));

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
