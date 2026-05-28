import { closeHistory, isHistoryTransaction } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";

/**
 * Google-Docs-style undo grouping. ProseMirror's history only groups changes by
 * time (`newGroupDelay`) and adjacency, so deliberate typing fragments into tiny
 * undo units. We layer word/action boundaries on top: a transaction that begins a
 * new word — or that is a discrete action (paste, formatting, structural/block
 * edit) — is tagged with `closeHistory`, forcing its steps into a fresh undo
 * event. The result is that each Cmd-Z removes roughly one word or one action.
 *
 * The boundary decision is **stateless** — derived only from `view.state.doc` and
 * the incoming transaction's steps — so it stays consistent with the section-undo
 * coordinator, which tracks `undoDepth` deltas with no extra bookkeeping.
 */

/**
 * Backstop pause (ms) passed to `history({ newGroupDelay })` in every editor.
 * Longer than the 500ms default so brief intra-word pauses don't split a word;
 * the explicit word boundaries below do the precise splitting.
 */
export const UNDO_GROUP_DELAY_MS = 1800;

/** Letters and numbers count as "inside a word"; everything else is a boundary. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(c: string): boolean {
  return WORD_CHAR.test(c);
}

/** The character immediately before `pos`, or "" at a block start / non-text spot. */
function charBefore(doc: Node, pos: number): string {
  if (pos <= 0) {
    return "";
  }
  return doc.textBetween(pos - 1, pos);
}

/**
 * If `step` is a plain insertion of text (no deletion, no structure, no nodes),
 * return the inserted string; otherwise null. Single-char inserts are normal
 * typing; null covers deletions, replacements, node/block inserts and pastes.
 */
function plainTextInsert(step: ReplaceStep): string | null {
  if (step.from !== step.to) {
    return null; // replacing a range (e.g. typing over a selection)
  }
  const slice = step.slice;
  if (slice.openStart !== 0 || slice.openEnd !== 0) {
    return null; // structured slice
  }
  const content = slice.content;
  if (content.childCount !== 1) {
    return null;
  }
  const child = content.firstChild;
  if (!child?.isText) {
    return null; // a node (hard_break, verse_number, study_block, …)
  }
  return child.text ?? "";
}

/**
 * Whether `tr` should start a fresh undo group relative to `view.state`. See the
 * module comment for the policy. Exported for unit testing.
 */
export function isUndoBoundary(view: EditorView, tr: Transaction): boolean {
  // Selection-only and non-history transactions never affect grouping.
  if (!tr.docChanged) {
    return false;
  }
  if (tr.getMeta("addToHistory") === false) {
    return false;
  }
  // Undo/redo itself, and verse-guard's orphan-cleanup append, must stay glued
  // to the edit they belong to — never open a new group on them.
  if (isHistoryTransaction(tr) || tr.getMeta("appendedTransaction")) {
    return false;
  }
  // Never split mid-IME-composition (CJK, accents, mobile autocorrect).
  if (view.composing || tr.getMeta("composition") != null) {
    return false;
  }
  // Paste / cut / drop are each their own undo unit.
  if (tr.getMeta("paste") || tr.getMeta("uiEvent")) {
    return true;
  }

  // Any non-Replace step (mark add/remove, attr, wrap/lift/split) is a discrete
  // formatting/structural action → its own undo unit.
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) {
      return true;
    }
  }
  // A single ReplaceStep is the common typing case; multiple at once is discrete.
  if (tr.steps.length !== 1) {
    return true;
  }
  const step = tr.steps[0] as ReplaceStep;
  const inserted = plainTextInsert(step);
  if (inserted === null) {
    return true; // deletion, range replace, or node/block insert
  }
  if (inserted.length !== 1) {
    return true; // multi-char insert (autocomplete, expansion) → its own unit
  }
  // Single typed character: a new group starts only when this character begins a
  // new word (a word char following a boundary char / block start). Trailing
  // whitespace and punctuation stay attached to the word just typed.
  if (!isWordChar(inserted)) {
    return false;
  }
  const prev = charBefore(view.state.doc, step.from);
  return prev === "" || !isWordChar(prev);
}

/**
 * Tag `tr` with `closeHistory` when it represents a word/action boundary, so its
 * steps open a fresh undo event. Pure: returns the same transaction (possibly
 * meta-tagged); never dispatches. Apply the returned transaction as usual.
 */
export function withUndoBoundary(
  view: EditorView,
  tr: Transaction,
): Transaction {
  return isUndoBoundary(view, tr) ? closeHistory(tr) : tr;
}
