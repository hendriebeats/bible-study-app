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

/** Does the selection's textblock have this node type + attrs (e.g. a heading)? */
export function isBlockActive(
  state: EditorState,
  nodeType: NodeType,
  attrs: Attrs = {},
): boolean {
  return state.selection.$from.parent.hasMarkup(nodeType, attrs);
}

/** Is the selection inside an ancestor of this type (e.g. a list or quote)? */
export function isAncestorActive(
  state: EditorState,
  nodeType: NodeType,
): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === nodeType) {
      return true;
    }
  }
  return false;
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
