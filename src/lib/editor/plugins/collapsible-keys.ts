import { type Command, TextSelection } from "prosemirror-state";

import { nodes } from "../schema";

/**
 * Backspace at the start of a collapsible's header (the first child paragraph)
 * dissolves the toggle — exactly like Backspace at the start of a `list_item`
 * lifts it. The collapsible is replaced by its children at the parent level,
 * so the header text becomes a flat sibling paragraph and any body paragraphs
 * follow. With the Notion-style schema the cursor can naturally arrow-left out
 * of the header too, so the user no longer feels "trapped" inside a toggle.
 *
 * Conservatively scoped: only fires when the selection is an empty cursor at
 * offset 0 of the FIRST child of a collapsible (the header). Cursor in body
 * paragraphs, or in selection ranges, falls through to the default chain.
 */
export const collapsibleBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  // Cursor must be at the very start of its parent textblock — that's how we
  // recognise "the user is trying to outdent / dissolve from here."
  if ($from.parentOffset !== 0) return false;

  for (let d = $from.depth; d > 0; d--) {
    const ancestor = $from.node(d);
    if (ancestor.type !== nodes.collapsible) continue;

    // Header = first child of the collapsible. Body children sit at index > 0.
    // Backspace at start of a body paragraph keeps the default behavior (join
    // with the previous textblock — the end of the header — which is exactly
    // what list_item does and feels right here too).
    if ($from.index(d) !== 0) return false;
    // Only act when the cursor sits DIRECTLY inside the header textblock —
    // i.e. the cursor's parent is the first child of the collapsible. Cursor
    // nested deeper (a bullet item, a callout, etc. used as the header)
    // falls through to the default chain so the inner structure can lift
    // first; one more Backspace there will eventually reach this case.
    if ($from.depth !== d + 1) return false;

    const before = $from.before(d);
    const after = $from.after(d);
    if (dispatch) {
      // Replace the entire collapsible with its content — header becomes a
      // flat sibling paragraph, body paragraphs follow as their own siblings.
      const tr = state.tr.replaceWith(before, after, ancestor.content);
      // Drop the caret into what used to be the header (now the first new
      // sibling). `before + 1` skips past that paragraph's open tag.
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
