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
