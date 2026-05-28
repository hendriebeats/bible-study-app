import { chainCommands } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { Fragment, type Node } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  Plugin,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { canSplit } from "prosemirror-transform";

import { nodes } from "../schema";

/** Count protected verse-number atoms anywhere in a document. */
function countVerses(doc: Node): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type === nodes.verseNumber) {
      count += 1;
    }
  });
  return count;
}

/** Whether the range contains any verse_number atom — used to decide if the
 * verse-preserving deletion path needs to run at all. */
function rangeHasVerse(doc: Node, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.type === nodes.verseNumber) {
      found = true;
    }
    return !found;
  });
  return found;
}

/**
 * Positions of verse_number atoms whose verse has no text left (the whole verse
 * was deleted), so the lingering marker can be cleaned up. A marker "owns" the
 * inline content after it until the next marker or the end of its textblock; if
 * that span holds no non-whitespace text, the marker is orphaned. (Markers
 * always carry their verse text, so a freshly inserted passage never has any.)
 */
function orphanedVersePositions(doc: Node): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    // Collect the inline children first so the marker/text bookkeeping below
    // runs in a normal loop (a forEach closure would defeat narrowing).
    const children: { child: Node; at: number }[] = [];
    node.forEach((child, offset) => {
      children.push({ child, at: pos + 1 + offset });
    });
    let markerPos: number | null = null;
    let sawText = false;
    for (const { child, at } of children) {
      if (child.type === nodes.verseNumber) {
        if (markerPos !== null && !sawText) {
          positions.push(markerPos);
        }
        markerPos = at;
        sawText = false;
      } else if (child.isText && (child.text ?? "").trim() !== "") {
        sawText = true;
      }
    }
    if (markerPos !== null && !sawText) {
      positions.push(markerPos);
    }
    return false; // textblocks don't nest textblocks
  });
  return positions;
}

/**
 * Fresh copies of every verse_number in [from, to] whose "after" text survives
 * the deletion — i.e. the marker's owned span (from itself until the next
 * marker in its textblock, or that textblock's end) extends past `to`. These
 * are the markers we re-anchor at the deletion seam so they stay attached to
 * their surviving text; markers whose whole verse was inside the range are
 * dropped (any that slip through still get caught by the orphan cleanup pass).
 */
function survivingMarkers(doc: Node, from: number, to: number): Node[] {
  const survivors: Node[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== nodes.verseNumber) {
      return true;
    }
    const $pos = doc.resolve(pos);
    const parent = $pos.parent;
    if (parent.isTextblock) {
      // Walk the parent's children after this marker to find the next marker
      // (or fall off the end → "owned span" runs to the textblock's end). A
      // plain loop rather than nodesBetween-with-a-closure so the post-loop
      // narrowing of `nextMarker` survives the no-unnecessary-condition lint.
      const parentStart = $pos.start();
      const parentEnd = parentStart + parent.content.size;
      const markerIndex = $pos.index();
      let nextMarker: number | null = null;
      let cursor = pos + node.nodeSize;
      for (let i = markerIndex + 1; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child.type === nodes.verseNumber) {
          nextMarker = cursor;
          break;
        }
        cursor += child.nodeSize;
      }
      const ownedEnd = nextMarker ?? parentEnd;
      if (ownedEnd > to) {
        survivors.push(nodes.verseNumber.create(node.attrs));
      }
    }
    return false; // verse_number is an atom; nothing inside to descend into
  });
  return survivors;
}

/**
 * Replace [from, to] with `text`, re-anchoring any verse markers whose verse
 * text survives the edit. The typed text (if any) lands at the seam first
 * (becoming part of whichever verse owned the pre-`from` content); each
 * survivor marker is then inserted right before its surviving "after" text,
 * which now sits at `from + text.length`. Selection ends just after the typed
 * text and before any inserted markers, so the cursor is where the user
 * intuitively expects. `allowVerseEdit` opts the transaction out of the guard.
 */
function replacePreservingVerses(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  dispatch: (tr: Transaction) => void,
): void {
  const survivors = survivingMarkers(state.doc, from, to);
  const tr = state.tr.delete(from, to);
  let cursor = from;
  if (text !== "") {
    tr.insertText(text, cursor);
    cursor += text.length;
  }
  // Re-insertion only makes sense if the seam sits inside an inline-accepting
  // textblock; if a whole-block selection collapsed the seam onto a block
  // boundary we just drop the markers (orphan cleanup is moot — they're gone).
  if (survivors.length > 0 && tr.doc.resolve(cursor).parent.isTextblock) {
    tr.insert(cursor, Fragment.fromArray(survivors));
  }
  tr.setSelection(TextSelection.create(tr.doc, cursor));
  tr.setMeta("allowVerseEdit", true);
  dispatch(tr.scrollIntoView());
}

/**
 * Delete a non-empty selection containing verse markers. Text in the range is
 * removed; each marker whose verse still has text after the deletion is
 * re-anchored at the seam (so it stays glued to its surviving text), and any
 * marker whose verse is fully consumed gets cleaned up by the orphan pass in
 * `appendTransaction`. Returns false (so chained commands handle it) when the
 * selection is empty or contains no markers.
 */
const deleteRangeKeepingVerses: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) {
    return false;
  }
  if (!rangeHasVerse(state.doc, from, to)) {
    return false; // nothing to protect — let the base delete handle it
  }
  if (dispatch) {
    replacePreservingVerses(state, from, to, "", dispatch);
  }
  return true;
};

/** Step the cursor across an adjacent verse number instead of deleting it, so a
 * follow-up press deletes the surrounding text (the number "sticks" in place). */
function hopVerse(dir: "before" | "after"): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.$cursor) {
      return false;
    }
    const $cursor = sel.$cursor;
    const node = dir === "before" ? $cursor.nodeBefore : $cursor.nodeAfter;
    if (node?.type !== nodes.verseNumber) {
      return false;
    }
    if (dispatch) {
      const pos =
        dir === "before"
          ? $cursor.pos - node.nodeSize
          : $cursor.pos + node.nodeSize;
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, pos))
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/** Backspace/Delete bindings that keep verse numbers intact. */
export const verseBackspace: Command = chainCommands(
  deleteRangeKeepingVerses,
  hopVerse("before"),
);
export const verseDelete: Command = chainCommands(
  deleteRangeKeepingVerses,
  hopVerse("after"),
);

/**
 * Enter that keeps a verse marker attached to its verse. When the caret sits
 * immediately to a marker's right (its `nodeBefore` is a verse_number), split
 * *before* the marker so it travels down into the new block with the verse text
 * — instead of being stranded on the old line. Splits one level deep normally,
 * two when inside a list item (so a new bullet is created, mirroring
 * `splitListItem`). Returns false otherwise so the default Enter handlers run.
 */
export const stickyVerseEnter: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.$cursor) {
    return false;
  }
  const $cursor = sel.$cursor;
  const marker = $cursor.nodeBefore;
  if (marker?.type !== nodes.verseNumber) {
    return false;
  }
  const splitPos = $cursor.pos - marker.nodeSize;
  const parentType = $cursor.node($cursor.depth - 1).type;
  const depth = parentType === nodes.listItem ? 2 : 1;
  if (!canSplit(state.doc, splitPos, depth)) {
    return false; // let the default Enter handle it
  }
  if (dispatch) {
    const tr = state.tr.split(splitPos, depth);
    // The original caret pos maps to just after the marker in the new block.
    const after = tr.mapping.map($cursor.pos);
    tr.setSelection(TextSelection.create(tr.doc, after));
    tr.setMeta("allowVerseEdit", true);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Undo/redo that flag their transactions so the guard allows the (legitimate)
 * verse-number changes an undo/redo of a scripture insertion makes. */
export const verseUndo: Command = (state, dispatch, view) =>
  undo(
    state,
    dispatch
      ? (tr) => {
          dispatch(tr.setMeta("allowVerseEdit", true));
        }
      : undefined,
    view,
  );
export const verseRedo: Command = (state, dispatch, view) =>
  redo(
    state,
    dispatch
      ? (tr) => {
          dispatch(tr.setMeta("allowVerseEdit", true));
        }
      : undefined,
    view,
  );

/**
 * Keeps inline verse numbers from being silently destroyed while letting
 * deliberate edits through. Three layers:
 *   - `handleTextInput` rewrites a typed-over selection so any verse markers
 *     in it stay anchored to their surviving text (the typed text replaces the
 *     prose).
 *   - `filterTransaction` vetoes any other doc change that would drop a verse
 *     number, unless it's flagged `allowVerseEdit` — set by Backspace/Delete
 *     via {@link verseBackspace}/{@link verseDelete}, scripture inserts,
 *     history replay, undo/redo, and the orphan-cleanup pass below.
 *   - `appendTransaction` removes a marker once its verse has no text left,
 *     so deletions that fully consume a verse don't leave a stranded reference.
 * A no-op when the document has no verse numbers.
 */
export function verseGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta("allowVerseEdit") === true) {
        return true;
      }
      const before = countVerses(state.doc);
      if (before === 0) {
        return true;
      }
      return countVerses(tr.doc) >= before;
    },
    // Once a verse's text is fully deleted, drop its now-orphaned marker so the
    // reference doesn't linger. Runs after the user's edit and flags itself so
    // the guard above lets the removal pass.
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      const positions = orphanedVersePositions(newState.doc);
      if (positions.length === 0) {
        return null;
      }
      const tr = newState.tr;
      for (const pos of positions.reverse()) {
        const node = newState.doc.nodeAt(pos);
        tr.delete(pos, pos + (node?.nodeSize ?? 1));
      }
      tr.setMeta("allowVerseEdit", true);
      return tr;
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (from === to) {
          return false;
        }
        if (!rangeHasVerse(view.state.doc, from, to)) {
          return false;
        }
        replacePreservingVerses(view.state, from, to, text, (tr) => {
          view.dispatch(tr);
        });
        return true;
      },
    },
  });
}
