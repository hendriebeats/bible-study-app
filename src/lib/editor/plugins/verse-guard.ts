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

/** Copies of every verse_number node within [from, to], in document order. */
function versesInRange(doc: Node, from: number, to: number): Node[] {
  const verses: Node[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.type === nodes.verseNumber) {
      verses.push(nodes.verseNumber.create(node.attrs));
    }
  });
  return verses;
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

/** Only rewrite ranges within a single textblock — multi-block ranges fall back
 * to the filterTransaction guard (which simply protects the numbers). */
function rangePreservable(doc: Node, from: number, to: number): boolean {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  return $from.sameParent($to) && $from.parent.isTextblock;
}

/**
 * Replace [from, to] with `text`, re-inserting any verse numbers that were in
 * the range (in order) at the replacement point so they survive the edit. The
 * `allowVerseEdit` meta tells the guard's filterTransaction to let it through.
 */
function replacePreservingVerses(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  dispatch: (tr: Transaction) => void,
): void {
  const verses = versesInRange(state.doc, from, to);
  const tr = state.tr.delete(from, to);
  let at = from;
  if (verses.length > 0) {
    const frag = Fragment.fromArray(verses);
    tr.insert(at, frag);
    at += frag.size;
  }
  if (text !== "") {
    tr.insertText(text, at);
    at += text.length;
  }
  tr.setSelection(TextSelection.create(tr.doc, at));
  tr.setMeta("allowVerseEdit", true);
  dispatch(tr.scrollIntoView());
}

/** Delete a non-empty selection but keep any verse numbers it contains. */
const deleteRangeKeepingVerses: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) {
    return false;
  }
  if (versesInRange(state.doc, from, to).length === 0) {
    return false; // nothing to protect — let the base delete handle it
  }
  if (!rangePreservable(state.doc, from, to)) {
    return false; // guard's filterTransaction protects the numbers instead
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

/**
 * Delete a non-empty selection INCLUDING any verse numbers it contains — the
 * deliberate escape-hatch the guard otherwise blocks (`allowVerseEdit`). Lets a
 * user remove scripture they added by mistake; surfaced in the selection bubble
 * and bound to a keyboard shortcut. No-op on an empty selection.
 */
export const deleteSelectionWithVerses: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) {
    return false;
  }
  if (dispatch) {
    dispatch(
      state.tr
        .delete(from, to)
        .setMeta("allowVerseEdit", true)
        .scrollIntoView(),
    );
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
 * Protects inline verse numbers from being deleted. Two layers:
 *   - `handleTextInput` preserves numbers when the user types over a selection
 *     that contains one (the typed text replaces the prose, the number stays).
 *   - `filterTransaction` vetoes any other doc change that would drop a verse
 *     number, unless it's flagged `allowVerseEdit` (our own verse-preserving
 *     edits, scripture inserts, history replay, and undo/redo all set it).
 * Backspace/Delete are handled by {@link verseBackspace}/{@link verseDelete} in
 * the keymap. A no-op when the document has no verse numbers.
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
    // reference doesn't linger. Runs after the user's edit (which the guard
    // above kept the marker through), and flags itself so that same guard lets
    // the removal pass.
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
        if (versesInRange(view.state.doc, from, to).length === 0) {
          return false;
        }
        if (!rangePreservable(view.state.doc, from, to)) {
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
