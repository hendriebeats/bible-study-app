/**
 * User-configurable options for inserting a scripture passage. They drive the
 * ESV fetch query params (Selahs) AND post-fetch node building (layout, poetry
 * line breaks, small-caps divine name).
 *
 * This module is intentionally framework-free (no "use client"/"use server") so
 * both the server (esv.ts, server actions) and the client (editor context,
 * toolbar) can import it.
 *
 * Deliberately NOT options (all hardcoded in esv.ts): verse numbers are always
 * on; footnotes and the "(ESV)" copyright line are always off. And red letter /
 * words of Christ can't be derived at all — the ESV API has no such markup.
 */

/**
 * How inserted scripture is broken into paragraphs.
 * - `"single-block"` — every verse flows into ONE paragraph (no breaks).
 * - `"verse-per-line"` — each verse starts its own paragraph (needs verse numbers).
 * - `"translator-paragraphs"` — honor the ESV's own paragraph breaks (default).
 */
export type ScriptureLayout =
  | "single-block"
  | "verse-per-line"
  | "translator-paragraphs";

export interface ScriptureOptions {
  /** ESV `include-selahs` — "Selah" markers in the Psalms. */
  includeSelahs: boolean;
  /** Paragraph layout (post-processing; no ESV equivalent). */
  layout: ScriptureLayout;
  /** Keep poetry line breaks (Psalms/Proverbs) as hard breaks; ignored for single-block. */
  preservePoetry: boolean;
  /** Render the covenant name (LORD/GOD) in small caps, as printed ESVs do. */
  smallCaps: boolean;
}

/**
 * Defaults a user who never opens the options panel gets: Selahs off, the
 * translator's paragraphs, no poetry breaks, no small caps.
 */
export const DEFAULT_SCRIPTURE_OPTIONS: ScriptureOptions = {
  includeSelahs: false,
  layout: "translator-paragraphs",
  preservePoetry: false,
  smallCaps: false,
};

/**
 * Coerce an untrusted value (from the DB jsonb column, an older saved shape, or
 * a client payload) into a complete options object. Missing/new fields fall back
 * to defaults rather than crashing — the defensive seam for both read and write.
 */
export function normalizeScriptureOptions(
  input: Partial<ScriptureOptions> | null | undefined,
): ScriptureOptions {
  return { ...DEFAULT_SCRIPTURE_OPTIONS, ...(input ?? {}) };
}
