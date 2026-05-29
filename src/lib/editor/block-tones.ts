/**
 * The palette of background tones an action-variant study_block can carry.
 * The single source of truth for tone IDs across the schema, the NodeView,
 * the dialog swatch picker, and the CSS class names. Adding a tone is a
 * three-file change: this list + a `--tone-{id}-bg` variable in the `:root`
 * and `.dark` blocks of globals.css.
 *
 * `group` drives the dialog picker layout (one row per group) — grayscale
 * shades on top, accents below. The five accents map 1:1 to the existing
 * callout palette (sky=note, amber=insight, coral=warning, plum=prayer,
 * sage=application) so action bars and callout boxes read as one cohesive
 * color system — tweaking a callout token retunes the matching tone.
 */
export const BLOCK_TONES = [
  { id: "default", label: "Default", group: "gray" },
  { id: "stone", label: "Stone", group: "gray" },
  { id: "slate", label: "Slate", group: "gray" },
  { id: "sky", label: "Sky", group: "accent" },
  { id: "amber", label: "Amber", group: "accent" },
  { id: "coral", label: "Coral", group: "accent" },
  { id: "plum", label: "Plum", group: "accent" },
  { id: "sage", label: "Sage", group: "accent" },
] as const;

export type BlockTone = (typeof BLOCK_TONES)[number]["id"];

/** Set of valid tone IDs, used by schema parseDOM + the helpers to sanitize
 * untrusted strings (legacy docs, hand-edited JSON, …) back to "default". */
const TONE_IDS = new Set<string>(BLOCK_TONES.map((t) => t.id));

/** Normalize any untrusted value to a known tone (default fallback). */
export function normalizeTone(value: unknown): BlockTone {
  return typeof value === "string" && TONE_IDS.has(value)
    ? (value as BlockTone)
    : "default";
}
