import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import { nodes } from "../schema";

/** Count top-level `study_block` nodes. */
function studyBlockCount(doc: Node): number {
  let count = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (doc.child(i).type === nodes.studyBlock) {
      count += 1;
    }
  }
  return count;
}

/**
 * Snapshot of the top-level study_block sequence by `lineageId`. Used by
 * {@link blocksStructureGuard} to detect any rearrangement — reorders,
 * nesting one block inside another's body, promoting a nested block out —
 * that the existing count-only check can't see.
 *
 * Anonymous blocks (legacy / pre-lineageId docs) appear as `null`. A swap of
 * two `null`-lineage blocks passes the pairwise compare; acceptable, because
 * every block created via `blocks.ts` now gets `crypto.randomUUID()`, so this
 * is a narrow legacy-only crack rather than a live regression surface.
 */
function topLevelStudyBlockLineageIds(doc: Node): (string | null)[] {
  const ids: (string | null)[] = [];
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type === nodes.studyBlock) {
      const raw: unknown = child.attrs.lineageId;
      ids.push(typeof raw === "string" ? raw : null);
    }
  }
  return ids;
}

function lineageSequenceEqual(
  a: readonly (string | null)[],
  b: readonly (string | null)[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Count top-level nodes that don't belong in the blocks doc — anything other
 * than a `study_block` or the pinned `notes_index` (freeform paragraphs,
 * headings, lists, callouts, tables, …). The fresh/empty placeholder (a single
 * empty paragraph) counts as zero.
 *
 * The guard compares this before/after a transaction rather than requiring the
 * result to be pristine, so a doc that ALREADY holds stray top-level content
 * (e.g. a section edited before this lockdown shipped) stays editable — we just
 * forbid ADDING more. Otherwise every edit to such a doc would be vetoed.
 */
function foreignTopLevelCount(doc: Node): number {
  const first = doc.firstChild;
  if (
    doc.childCount === 1 &&
    first?.type === nodes.paragraph &&
    first.content.size === 0
  ) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const type = doc.child(i).type;
    if (type !== nodes.studyBlock && type !== nodes.notesIndex) {
      count += 1;
    }
  }
  return count;
}

/**
 * Locks down the Study-blocks document so the top level holds only study blocks
 * and the notes index — no freeform text outside a block — and so whole study
 * blocks can't be removed by a stray selection (the verse guard already
 * protects scripture; this protects the blocks themselves).
 *
 * `filterTransaction` (mirroring {@link verseGuard}/{@link notesIndexGuard})
 * vetoes any user edit that ADDS a foreign node to the top level, that
 * reduces the study-block count, or that rearranges the top-level study_block
 * sequence (reorder, nest one inside another's body, promote a nested block
 * out) — unless flagged `allowVerseEdit` (the escape hatch used by Add block,
 * the block menu's Delete, Move, drag-reorder, the dialog's section apply,
 * and version restore). It compares before/after (not "result is pristine")
 * so a doc with pre-existing stray content stays editable.
 *
 * Note: the notes index is NOT pinned to position 0 anymore — it's a normal
 * top-level block that the user can drag-reorder freely (deletion is still
 * blocked by `notesIndexGuard`). The previous `appendTransaction` re-pin was
 * dropped when the dialog gained a draggable Notes card.
 *
 * Added to the BLOCKS editor only (the Study Body stays freeform).
 */
export function blocksStructureGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta("allowVerseEdit") === true) {
        return true;
      }
      // No NEW freeform text/blocks at the top level.
      if (foreignTopLevelCount(tr.doc) > foreignTopLevelCount(state.doc)) {
        return false;
      }
      // Study blocks are removed only through the explicit, flagged Delete.
      if (studyBlockCount(tr.doc) < studyBlockCount(state.doc)) {
        return false;
      }
      // The top-level study_block sequence (by `lineageId`) is immutable
      // outside the `allowVerseEdit` escape hatch. This is the structural
      // backstop behind the UI-level guards in `block-handle.ts`: even if a
      // future code path (keyboard, paste, programmatic) bypasses the drag
      // handle and tries to rearrange the top-level blocks, the transaction
      // is rejected here. Edits inside any block body leave the lineage
      // sequence intact and pass through.
      if (
        !lineageSequenceEqual(
          topLevelStudyBlockLineageIds(state.doc),
          topLevelStudyBlockLineageIds(tr.doc),
        )
      ) {
        return false;
      }
      return true;
    },
  });
}
