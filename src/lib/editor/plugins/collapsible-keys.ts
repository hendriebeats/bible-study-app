import { type Command, TextSelection } from "prosemirror-state";

import { nodes } from "../schema";
import { FIRST_CHILD_IS_CHROME } from "../wrapper-chrome";

/**
 * Backspace at the start of a wrapper's chrome (the first child) dissolves
 * the wrapper — exactly like Backspace at the start of a `list_item` lifts
 * it. The wrapper is replaced by its content at the parent level, so the
 * chrome text becomes a flat sibling paragraph and any body children follow.
 *
 * Generalized over every node type in `FIRST_CHILD_IS_CHROME` (collapsible,
 * callout). Conservatively scoped: only fires when the selection is an
 * empty cursor at offset 0 of the FIRST child of one of those wrappers.
 * Cursor in body content, selection ranges, or deeper nested structures
 * falls through to the default chain.
 *
 * Naming kept (`collapsibleBackspace`) for keymap compat after Round-4's
 * imports. Behavior is now wrapper-generic.
 */
export const collapsibleBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;

  for (let d = $from.depth; d > 0; d--) {
    const ancestor = $from.node(d);
    if (!FIRST_CHILD_IS_CHROME.has(ancestor.type)) continue;

    // Chrome = first child. Body children sit at index > 0. Backspace at the
    // start of a body block keeps the default behavior (join with the
    // previous textblock — the end of the chrome — which feels right).
    if ($from.index(d) !== 0) return false;
    // Only act when the cursor's parent IS the chrome textblock. Cursor
    // nested deeper (a bullet or callout used as the chrome) falls through
    // so its inner structure lifts first; the next Backspace reaches here.
    if ($from.depth !== d + 1) return false;

    const before = $from.before(d);
    const after = $from.after(d);
    // Defensive: the range must be exactly the wrapper's own bounds. PM's
    // `before/after` should give us that, but if a future change to the
    // ancestor walk ever pointed us at a different node, refuse rather
    // than dispatch a replace that could swallow neighbors (e.g. an
    // ordered list sitting just above the wrapper).
    if (after - before !== ancestor.nodeSize) return false;
    if (dispatch) {
      // Replace the entire wrapper with its content — chrome becomes a flat
      // sibling paragraph; body blocks follow as their own siblings.
      const tr = state.tr.replaceWith(before, after, ancestor.content);
      const target = Math.min(before + 1, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, target));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  return false;
};

/**
 * Enter inside the header of a CLOSED collapsible inserts a new closed
 * collapsible as the toggle's next sibling — the alternative (insert a body
 * paragraph) would have the user typing into hidden content. When the toggle
 * is open, this command yields to the default chain so Enter behaves like a
 * normal "split paragraph / new body line" — which is what users expect.
 *
 * Fires from anywhere inside the header so a user mid-text isn't stuck — the
 * header text isn't split (we'd rather not silently break the user's title).
 * Enter inside a body paragraph (only reachable when the toggle is open) also
 * yields to default behavior.
 */
export const collapsibleEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;

  for (let d = $from.depth; d > 0; d--) {
    const ancestor = $from.node(d);
    if (ancestor.type !== nodes.collapsible) continue;
    // Only act on the header (first child) of a CLOSED toggle, AND only when
    // the cursor's parent is a direct child of the collapsible. If the header
    // has been converted to a bullet/heading/etc., fall through so the normal
    // split behavior (splitListItem / etc.) runs instead.
    if ($from.index(d) !== 0) return false;
    if ($from.depth !== d + 1) return false;
    if (ancestor.attrs.open !== false) return false;

    const newToggle = nodes.collapsible.createAndFill({
      open: false,
      summary: "",
    });
    if (!newToggle) return false;

    const afterPos = $from.after(d);
    if (dispatch) {
      const tr = state.tr.insert(afterPos, newToggle);
      // Land the caret in the new toggle's header: +1 enters the new
      // collapsible, +1 enters its first child paragraph.
      const target = Math.min(afterPos + 2, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, target));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  return false;
};
