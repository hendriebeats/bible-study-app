import { type Command, TextSelection } from "prosemirror-state";

import { nodes } from "../schema";

/**
 * Enter inside a `list_row` (flat-schema list model).
 *
 *   * Empty row → exit to a paragraph at the same `indent`. This is the
 *     Notion-style "Enter on a blank bullet drops you out of the list" move.
 *   * Non-empty row → split at the cursor: the left half keeps the current
 *     row's attrs, the right half is a fresh `list_row` inheriting `listType`
 *     and `indent` but resetting `checked` (so new task rows start unchecked)
 *     and `listStart` (so a new ordered row continues the implicit count
 *     instead of restarting it).
 *
 * Returns false (so `chainCommands` moves on) when the caret isn't in a
 * list_row or the selection isn't collapsed — `stickyVerseEnter` and
 * `collapsibleEnter` get their turn first via the chain in keymap.ts; the
 * baseKeymap's paragraph-split runs last for everything else.
 */
export const listRowEnter: Command = (state, dispatch) => {
  if (!state.selection.empty) return false;
  const { $from } = state.selection;
  if ($from.parent.type !== nodes.listRow) return false;

  const row = $from.parent;
  const indent = (row.attrs.indent as number | undefined) ?? 0;
  const rowStart = $from.before($from.depth);
  const rowEnd = $from.after($from.depth);

  // Empty row → swap for an empty paragraph at the same indent.
  if (row.content.size === 0) {
    const para = nodes.paragraph.createAndFill({ indent });
    if (!para) return false;
    if (dispatch) {
      const tr = state.tr.replaceRangeWith(rowStart, rowEnd, para);
      tr.setSelection(TextSelection.create(tr.doc, rowStart + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // Non-empty row → split at the cursor. `tr.split(pos, depth, typesAfter)`
  // creates a sibling node after the split with the specified type/attrs.
  if (dispatch) {
    const rightAttrs = {
      ...row.attrs,
      checked: false,
      listStart: null,
    };
    const tr = state.tr.split($from.pos, 1, [
      { type: nodes.listRow, attrs: rightAttrs },
    ]);
    dispatch(tr.scrollIntoView());
  }
  return true;
};
