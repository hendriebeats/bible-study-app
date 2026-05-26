import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import type { MarkType, NodeType } from "prosemirror-model";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import type { Command, EditorState } from "prosemirror-state";

import { marks, nodes } from "./schema";

type Attrs = Record<string, unknown>;

/** Is `markType` active in the current selection (or stored for the cursor)? */
export function isMarkActive(state: EditorState, markType: MarkType): boolean {
  const { empty, $from, from, to } = state.selection;
  if (empty) {
    return Boolean(markType.isInSet(state.storedMarks ?? $from.marks()));
  }
  return state.doc.rangeHasMark(from, to, markType);
}

/**
 * Does any textblock in the selection have this node type + attrs (e.g. a
 * heading)? Range-aware so it's correct for a cursor, a multi-block selection,
 * and a full select-all (whose `$from` resolves to the doc, not a textblock).
 */
export function isBlockActive(
  state: EditorState,
  nodeType: NodeType,
  attrs: Attrs = {},
): boolean {
  const { from, to, $from, empty } = state.selection;
  if (empty) {
    return $from.parent.hasMarkup(nodeType, attrs);
  }
  let active = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (active) {
      return false;
    }
    if (node.isTextblock && node.hasMarkup(nodeType, attrs)) {
      active = true;
    }
    return !active;
  });
  return active;
}

/**
 * Is the selection inside (or spanning) an ancestor of this type (e.g. a list
 * or quote)? Checks ancestors of the cursor and, for ranges, any node of the
 * type the selection touches.
 */
export function isAncestorActive(
  state: EditorState,
  nodeType: NodeType,
): boolean {
  const { $from, from, to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === nodeType) {
      return true;
    }
  }
  let active = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (active) {
      return false;
    }
    if (node.type === nodeType) {
      active = true;
    }
    return !active;
  });
  return active;
}

export const toggleBold: Command = toggleMark(marks.strong);
export const toggleItalic: Command = toggleMark(marks.em);
export const toggleStrike: Command = toggleMark(marks.strikethrough);

/** Toggle the current textblock between a heading of `level` and a paragraph. */
export function toggleHeading(level: number): Command {
  return (state, dispatch, view) => {
    if (isBlockActive(state, nodes.heading, { level })) {
      return setBlockType(nodes.paragraph)(state, dispatch, view);
    }
    return setBlockType(nodes.heading, { level })(state, dispatch, view);
  };
}

function toggleList(listType: NodeType): Command {
  return (state, dispatch, view) => {
    if (isAncestorActive(state, listType)) {
      return liftListItem(nodes.listItem)(state, dispatch, view);
    }
    return wrapInList(listType)(state, dispatch, view);
  };
}

export const toggleBulletList: Command = toggleList(nodes.bulletList);
export const toggleOrderedList: Command = toggleList(nodes.orderedList);

export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (isAncestorActive(state, nodes.blockquote)) {
    return lift(state, dispatch, view);
  }
  return wrapIn(nodes.blockquote)(state, dispatch, view);
};

/**
 * The single colour the whole selection shares for a colour mark (`highlight`/
 * `text_color`), or `null` if the selection is unmarked or mixes colours. Used
 * by the bubble to ring the active swatch and to decide toggle-off. For an empty
 * selection it reports the stored/inset mark's colour.
 */
export function markColorActive(
  state: EditorState,
  markType: MarkType,
): string | null {
  const { empty, $from, from, to } = state.selection;
  if (empty) {
    const mark = markType.isInSet(state.storedMarks ?? $from.marks());
    return mark ? (mark.attrs as { color: string }).color : null;
  }
  // Collect the colour each inline run carries (null for unmarked text). One
  // distinct value means the whole selection shares it; anything else (mixed,
  // or no inline content) means "not uniformly active".
  const colors = new Set<string | null>();
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      const mark = markType.isInSet(node.marks);
      colors.add(mark ? (mark.attrs as { color: string }).color : null);
    }
    return true;
  });
  if (colors.size !== 1) {
    return null;
  }
  return colors.values().next().value ?? null;
}

/**
 * Apply a colour mark, with replace + toggle semantics. Re-applying the SAME
 * colour clears it; a DIFFERENT colour replaces the old one (we removeMark
 * before addMark so a range with mixed colours ends up uniform, not stacked).
 * An empty selection uses a stored mark so the next typed text picks it up.
 */
function setColorMark(markType: MarkType, color: string): Command {
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    if (dispatch) {
      const tr = state.tr;
      if (markColorActive(state, markType) === color) {
        if (empty) {
          tr.removeStoredMark(markType);
        } else {
          tr.removeMark(from, to, markType);
        }
      } else {
        const mark = markType.create({ color });
        if (empty) {
          tr.addStoredMark(mark);
        } else {
          tr.removeMark(from, to, markType).addMark(from, to, mark);
          tr.scrollIntoView();
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Apply (or toggle off) a highlight (background) colour on the selection. */
export function setHighlight(color: string): Command {
  return setColorMark(marks.highlight, color);
}

/** Apply (or toggle off) a text (foreground) colour on the selection. */
export function setTextColor(color: string): Command {
  return setColorMark(marks.textColor, color);
}

// Marks "clear formatting" strips. Deliberately excludes `small_caps` (scripture
// typography) and never touches the verse_number atom (it carries no marks).
const clearableMarks: MarkType[] = [
  marks.highlight,
  marks.textColor,
  marks.strong,
  marks.em,
  marks.strikethrough,
  marks.code,
];

/** Remove highlight, colour, and the basic character marks from the selection. */
export const clearFormatting: Command = (state, dispatch) => {
  const { empty, $from, from, to } = state.selection;
  if (empty) {
    const here = state.storedMarks ?? $from.marks();
    const present = clearableMarks.filter((m) => m.isInSet(here));
    if (present.length === 0) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr;
      for (const m of present) {
        tr.removeStoredMark(m);
      }
      dispatch(tr);
    }
    return true;
  }
  const present = clearableMarks.filter((m) =>
    state.doc.rangeHasMark(from, to, m),
  );
  if (present.length === 0) {
    return false;
  }
  if (dispatch) {
    const tr = state.tr;
    for (const m of present) {
      tr.removeMark(from, to, m);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};
