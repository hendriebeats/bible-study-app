/**
 * The "recently used" formatting model for the selection bubble's quick action.
 *
 * A {@link FormatAction} is one repeatable formatting choice — apply a specific
 * highlight/text colour, or toggle a mark. The bubble keeps a most-recently-used
 * list so re-applying "highlight green" or "text blue" is a single click, and
 * persists it to the user's account (the `user_settings.format_recents` jsonb).
 *
 * Custom-colour recents live alongside in two sibling arrays so they're kept
 * separate from the strict preset-only allow-list of `actions`. The picker
 * writes into the appropriate sibling; the bubble renders them as a second
 * row of swatches. See [[selection-bubble-and-color-marks]] for the wider
 * picker design.
 *
 * Framework-free (no "use client"/"use server") so the server reader, the server
 * action, and the client bubble all share one definition + trust boundary,
 * mirroring `@/lib/scripture/options`.
 */

import { isHighlightColor, isTextColor } from "@/lib/editor/format-colors";
import { oklchParts, oklchString } from "@/lib/editor/oklch";

/** A repeatable formatting action shown in the recents quick-action. */
export type FormatAction =
  | { type: "highlight"; color: string }
  | { type: "textColor"; color: string }
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" };

/** The persisted recents shape. Object-wrapped so we can grow fields without
 * a schema migration — older rows that pre-date `customHighlights` /
 * `customTextColors` are accepted; the normalizer just fills them with []. */
export interface FormatRecents {
  /** Preset-palette quick actions (MRU first), capped at {@link MAX_RECENTS}. */
  actions: FormatAction[];
  /** Custom highlight colours (OKLCH literals, MRU first), capped at {@link MAX_CUSTOM_RECENTS}. */
  customHighlights: string[];
  /** Custom text colours (OKLCH literals, MRU first), capped at {@link MAX_CUSTOM_RECENTS}. */
  customTextColors: string[];
}

/** How many quick-action recents we keep (and render). */
export const MAX_RECENTS = 4;
/** How many custom-colour recents we keep per surface. */
export const MAX_CUSTOM_RECENTS = 8;

export const DEFAULT_FORMAT_RECENTS: FormatRecents = {
  actions: [],
  customHighlights: [],
  customTextColors: [],
};

const MARK_TYPES = new Set(["bold", "italic", "strike"]);

/** Two actions are "the same" entry for MRU de-duplication. */
export function sameAction(a: FormatAction, b: FormatAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "highlight" || a.type === "textColor") {
    return a.color === (b as { color: string }).color;
  }
  return true;
}

/**
 * Validate one untrusted entry into a `FormatAction`, or `null` to drop it.
 *
 * For colour-bearing actions we accept TWO classes of value: the preset
 * palette literal (`isHighlightColor` / `isTextColor`) AND any strict OKLCH
 * literal (`isValidCustomOklch`) so the selection bubble's "Recent" row can
 * cycle through customs alongside presets. Both pass through the same CSS-
 * injection trust boundary — the OKLCH regex forbids stray characters that
 * could break out of the inline `style` attribute.
 */
function normalizeAction(input: unknown): FormatAction | null {
  if (typeof input !== "object" || input === null) return null;
  const type = (input as { type?: unknown }).type;
  if (type === "highlight" || type === "textColor") {
    const color = (input as { color?: unknown }).color;
    if (typeof color !== "string") return null;
    const presetOk =
      type === "highlight" ? isHighlightColor(color) : isTextColor(color);
    if (!presetOk) {
      // Try the custom-colour allow-list. Survivors are re-formatted to the
      // canonical OKLCH shape so two equivalent literals dedup cleanly in
      // `sameAction` / `pushRecent`.
      const clean = isValidCustomOklch(color);
      if (!clean) return null;
      return { type, color: clean };
    }
    return { type, color };
  }
  if (typeof type === "string" && MARK_TYPES.has(type)) {
    return { type } as FormatAction;
  }
  return null;
}

/**
 * Validate an untrusted string into a canonical OKLCH literal, or `null` to
 * drop it. The strict shape — value range checks via {@link oklchParts} plus
 * a re-format via {@link oklchString} — guarantees the survivor cannot carry
 * stray characters, semicolons, or alternate syntaxes that could inject CSS
 * when written into a mark's inline `style`. Same defensive seam as
 * {@link normalizeAction} but for the open-ended custom-colour arrays.
 */
export function isValidCustomOklch(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const parts = oklchParts(input);
  if (!parts) return null;
  return oklchString(parts.L, parts.C, parts.H);
}

/**
 * Coerce an untrusted value (DB jsonb, older shape, or a client payload) into a
 * valid {@link FormatRecents}: keep only well-formed, allow-listed, de-duplicated
 * actions and custom colours, each capped at its own MRU limit. The defensive
 * seam for both read+write.
 */
export function normalizeFormatRecents(
  input:
    | {
        actions?: unknown;
        customHighlights?: unknown;
        customTextColors?: unknown;
      }
    | null
    | undefined,
): FormatRecents {
  const rawActions = Array.isArray(input?.actions) ? input.actions : [];
  const actions: FormatAction[] = [];
  for (const entry of rawActions) {
    const action = normalizeAction(entry);
    if (action && !actions.some((a) => sameAction(a, action))) {
      actions.push(action);
    }
    if (actions.length >= MAX_RECENTS) break;
  }

  const normalizeColors = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
      const clean = isValidCustomOklch(entry);
      if (clean && !out.includes(clean)) out.push(clean);
      if (out.length >= MAX_CUSTOM_RECENTS) break;
    }
    return out;
  };

  return {
    actions,
    customHighlights: normalizeColors(input?.customHighlights),
    customTextColors: normalizeColors(input?.customTextColors),
  };
}

/**
 * Move `action` to the front of the MRU list (removing any equal entry first),
 * capped at {@link MAX_RECENTS}. Pure — returns a new array.
 */
export function pushRecent(
  list: FormatAction[],
  action: FormatAction,
): FormatAction[] {
  return [action, ...list.filter((a) => !sameAction(a, action))].slice(
    0,
    MAX_RECENTS,
  );
}

/**
 * Move `color` to the front of a custom-colour MRU list (removing any equal
 * entry first), capped at {@link MAX_CUSTOM_RECENTS}. Pure — returns a new
 * array. De-dup is case-insensitive after re-formatting through
 * {@link isValidCustomOklch} so `oklch(0.5 0.10 60)` and `oklch(0.500 0.10 60)`
 * collapse to one entry.
 */
export function pushCustomColor(list: string[], color: string): string[] {
  const clean = isValidCustomOklch(color);
  if (!clean) return list;
  return [clean, ...list.filter((c) => c !== clean)].slice(
    0,
    MAX_CUSTOM_RECENTS,
  );
}

/** Drop a custom colour from its MRU list. Pure — returns a new array. */
export function removeCustomColor(list: string[], color: string): string[] {
  const clean = isValidCustomOklch(color) ?? color;
  return list.filter((c) => c !== clean);
}
