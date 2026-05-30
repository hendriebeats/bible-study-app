/**
 * Cursor / presence palette. Eight perceptually-distinct hues used for
 * collaborative cursors + presence avatars. Stored as branded
 * {@link OklchColor} values so the per-theme variant can be derived via the
 * existing OKLCH contrast logic (see {@link cursorColor} in
 * `@/lib/theme/resolve-color`).
 *
 * The source hex values are preserved here for reference — they match the
 * legacy presence palette so existing sessions keep their colour identity
 * across the migration. Conversion happens once at module load via
 * `hexToOklch`. This file is the only place hex literals are permitted
 * outside the colour-authority allow-list in `lint-rules/no-raw-colors.mjs`.
 */

import { hexToOklch, type OklchColor } from "@/lib/editor/oklch";

const CURSOR_HEX_PALETTE = [
  "#1971c2", // blue
  "#e8590c", // orange
  "#2f9e44", // green
  "#9c36b5", // purple
  "#c2255c", // pink
  "#0c8599", // teal
  "#5f3dc4", // violet
  "#e67700", // amber
] as const;

/**
 * The cursor palette as branded OKLCH values. Typed as a non-empty tuple so
 * callers can index `[0]` (the safe fallback) without a non-null assertion.
 * Throws at module load if conversion fails — the source list is constant,
 * so a failure here is a programmer error worth catching loudly.
 */
export const CURSOR_PALETTE: readonly [
  OklchColor,
  OklchColor,
  ...OklchColor[],
] = CURSOR_HEX_PALETTE.map((h) => {
  const parsed = hexToOklch(h);
  if (parsed === null) {
    throw new Error(`Invalid cursor palette hex: ${h}`);
  }
  return parsed;
}) as unknown as readonly [OklchColor, OklchColor, ...OklchColor[]];
