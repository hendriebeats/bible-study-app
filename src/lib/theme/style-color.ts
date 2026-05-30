/**
 * Type-safe wrappers around React's `style` prop for colour-bearing
 * properties. The {@link OklchColor} brand guarantees the value came through
 * an approved source — the format-colors preset palette, the custom-colour
 * picker's `hsvToOklch` output, {@link parseOklch}, etc. The `local/
 * no-raw-colors` ESLint rule covers the rest of the surface (CSS literals in
 * className strings, raw hex in non-allowlisted files); together they make
 * "a colour reached the DOM without going through the theme system" a
 * compile-time error.
 *
 * Callers spread the returned object into the JSX `style` prop:
 *
 *     <span style={{ ...styleBackgroundColor(color), padding: 4 }} />
 *
 * Spreading (rather than assigning the whole `style`) keeps neighbouring
 * non-colour style entries intact and reads as just-another-property.
 */

import type { CSSProperties } from "react";

import type { OklchColor } from "@/lib/editor/oklch";

/** Inline `color` (foreground). */
export function styleColor(c: OklchColor): CSSProperties {
  return { color: c };
}

/** Inline `background-color` (fill). */
export function styleBackgroundColor(c: OklchColor): CSSProperties {
  return { backgroundColor: c };
}

/** Inline `border-color` (stroke). */
export function styleBorderColor(c: OklchColor): CSSProperties {
  return { borderColor: c };
}
