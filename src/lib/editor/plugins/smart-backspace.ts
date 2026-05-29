import { lift } from "prosemirror-commands";
import { type Command, TextSelection } from "prosemirror-state";

import { nodes } from "../schema";
import { FIRST_CHILD_IS_CHROME } from "../wrapper-chrome";

/**
 * Progressive Backspace for empty textblocks: each keystroke peels off one
 * structural layer around the caret, so a deeply-nested empty block dissolves
 * one container at a time and stops cleanly at the document's natural
 * "containment boundaries" (the doc itself, a `note_entry`, a `study_block`,
 * the pinned `notes_index`).
 *
 * Concretely, when the caret sits at the start of an empty textblock:
 *
 *   1. The textblock IS an empty `list_row` (flat-schema list model).
 *      Progressive dissolve here means: indent > 0 → decrement the row's
 *      indent attr by 1; indent === 0 → swap the row for a plain paragraph
 *      at the same level. Matches the Notion-style "Backspace in an empty
 *      bullet dedents, then exits the list" behaviour.
 *
 *   2. Otherwise, walk up from the cursor's depth looking for the FIRST
 *      ancestor that is dissolvable (`blockquote` / `callout` / `collapsible`).
 *      Stop the walk early at a containment-boundary node so we never lift
 *      content out of a study block or note entry. Peel one layer via plain
 *      `lift`, which splits the wrapper when it had more children after the
 *      cursor.
 *
 * `chainCommands` runs this BEFORE `collapsibleBackspace` (which handles
 * non-empty collapsibles by dissolving them in one keystroke) and before the
 * baseKeymap's `joinBackward` / `selectNodeBackward` fallbacks.
 */
export const smartBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;
  if (!$from.parent.isTextblock) return false;

  const parent = $from.parent;

  // Case 1: list_row at the start of its content.
  //
  //   * EMPTY row at indent > 0 → decrement indent (progressive dedent).
  //   * EMPTY row at indent 0   → swap for a plain paragraph (exit the list).
  //   * NON-EMPTY row           → dissolve the listType: replace the row with
  //                                a paragraph at the same indent carrying the
  //                                row's inline content. The bullet/number/
  //                                checkbox marker disappears; the text stays
  //                                where it was. (Notion-style; user-chosen.)
  if (parent.type === nodes.listRow) {
    const indent = (parent.attrs.indent as number | undefined) ?? 0;
    const isEmpty = parent.content.size === 0;
    if (isEmpty && indent > 0) {
      if (dispatch) {
        const pos = $from.before($from.depth);
        const tr = state.tr.setNodeMarkup(pos, undefined, {
          ...parent.attrs,
          indent: indent - 1,
        });
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    // Build the replacement paragraph: empty if the row was empty, otherwise
    // carrying the row's content (which preserves marks + verse markers).
    const para = isEmpty
      ? nodes.paragraph.createAndFill({ indent })
      : nodes.paragraph.create({ indent }, parent.content);
    if (!para) return false;
    if (dispatch) {
      const pos = $from.before($from.depth);
      const end = $from.after($from.depth);
      const tr = state.tr.replaceRangeWith(pos, end, para);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // From here on the dissolvable-wrapper path only applies to empty textblocks.
  if (parent.content.size !== 0) return false;

  // Case 2: walk ancestors for a dissolvable wrapper. The condition
  // `$from.index(d) === 0` along the way means we're still on the "start of
  // the first child" path — the moment we hit a non-zero index, the caret is
  // past where lifting one layer would be intuitive, so we bail.
  for (let d = $from.depth - 1; d >= 0; d--) {
    const ancestor = $from.node(d);

    // Containment boundaries — never lift past one of these.
    if (
      ancestor.type === nodes.doc ||
      ancestor.type === nodes.studyBlock ||
      ancestor.type === nodes.noteEntry ||
      ancestor.type === nodes.notesIndex
    ) {
      break;
    }

    if ($from.index(d) !== 0) break;

    // Chrome wrappers (collapsible, callout) — handoff to
    // `collapsibleBackspace` next in the chain, which dissolves the WHOLE
    // wrapper in one step (replaces it with its content). A lift here
    // would only split the wrapper's chrome out, leaving the body behind
    // as a now-detached sibling toggle below the cursor — which the user
    // perceives as "a new toggle appeared beneath".
    if (FIRST_CHILD_IS_CHROME.has(ancestor.type)) break;

    // Blockquote is the only remaining "dissolve via lift" wrapper —
    // collapsible/callout were handed off above to `collapsibleBackspace`
    // for full dissolve. Lift splits the blockquote (header up, rest stays).
    if (ancestor.type === nodes.blockquote) {
      return lift(state, dispatch);
    }
  }

  return false;
};
