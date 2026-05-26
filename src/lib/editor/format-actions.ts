/**
 * The "recently used" formatting model for the selection bubble's quick action.
 *
 * A {@link FormatAction} is one repeatable formatting choice — apply a specific
 * highlight/text colour, or toggle a mark. The bubble keeps a most-recently-used
 * list so re-applying "highlight green" or "text blue" is a single click, and
 * persists it to the user's account (the `user_settings.format_recents` jsonb).
 *
 * Framework-free (no "use client"/"use server") so the server reader, the server
 * action, and the client bubble all share one definition + trust boundary,
 * mirroring `@/lib/scripture/options`.
 */

import { isHighlightColor, isTextColor } from "@/lib/editor/format-colors";

/** A repeatable formatting action shown in the recents quick-action. */
export type FormatAction =
  | { type: "highlight"; color: string }
  | { type: "textColor"; color: string }
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" };

/** The persisted recents shape (object-wrapped for forward-compat, like scripture_options). */
export interface FormatRecents {
  /** Most-recently-used first. */
  actions: FormatAction[];
}

/** How many recents we keep (and render). */
export const MAX_RECENTS = 4;

export const DEFAULT_FORMAT_RECENTS: FormatRecents = { actions: [] };

const MARK_TYPES = new Set(["bold", "italic", "strike"]);

/** Two actions are "the same" entry for MRU de-duplication. */
export function sameAction(a: FormatAction, b: FormatAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "highlight" || a.type === "textColor") {
    return a.color === (b as { color: string }).color;
  }
  return true;
}

/** Validate one untrusted entry into a `FormatAction`, or `null` to drop it. */
function normalizeAction(input: unknown): FormatAction | null {
  if (typeof input !== "object" || input === null) return null;
  const type = (input as { type?: unknown }).type;
  if (type === "highlight" || type === "textColor") {
    const color = (input as { color?: unknown }).color;
    if (typeof color !== "string") return null;
    // Allow-list: only known palette colours survive (no CSS injection).
    if (type === "highlight" && !isHighlightColor(color)) return null;
    if (type === "textColor" && !isTextColor(color)) return null;
    return { type, color };
  }
  if (typeof type === "string" && MARK_TYPES.has(type)) {
    return { type } as FormatAction;
  }
  return null;
}

/**
 * Coerce an untrusted value (DB jsonb, older shape, or a client payload) into a
 * valid {@link FormatRecents}: keep only well-formed, allow-listed, de-duplicated
 * actions, capped at {@link MAX_RECENTS}. The defensive seam for both read+write.
 */
export function normalizeFormatRecents(
  input: { actions?: unknown } | null | undefined,
): FormatRecents {
  const raw = Array.isArray(input?.actions) ? input.actions : [];
  const actions: FormatAction[] = [];
  for (const entry of raw) {
    const action = normalizeAction(entry);
    if (action && !actions.some((a) => sameAction(a, action))) {
      actions.push(action);
    }
    if (actions.length >= MAX_RECENTS) break;
  }
  return { actions };
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
