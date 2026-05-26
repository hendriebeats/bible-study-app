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
