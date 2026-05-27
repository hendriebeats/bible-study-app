import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import type { MarkType, Node, NodeType } from "prosemirror-model";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import {
  type Command,
  type EditorState,
  TextSelection,
} from "prosemirror-state";

import { marks, MAX_INDENT, nodes } from "./schema";

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
export const toggleUnderline: Command = toggleMark(marks.underline);

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

/** Toggle a checklist (task list); lifts items out when already in one. */
export const toggleTaskList: Command = (state, dispatch, view) => {
  if (isAncestorActive(state, nodes.taskList)) {
    return liftListItem(nodes.taskItem)(state, dispatch, view);
  }
  return wrapInList(nodes.taskList)(state, dispatch, view);
};

export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (isAncestorActive(state, nodes.blockquote)) {
    return lift(state, dispatch, view);
  }
  return wrapIn(nodes.blockquote)(state, dispatch, view);
};

/** Coerce typed input into a usable href (default to https, allow mailto). */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * The link covering the selection (or the contiguous link run around an empty
 * cursor), or null when there's no single link to act on. Powers the link
 * control's edit/remove state and `unsetLink`'s range.
 */
export function activeLinkRange(
  state: EditorState,
): { from: number; to: number; href: string } | null {
  const linkType = marks.link;
  const { $from, from, to, empty } = state.selection;
  if (!empty) {
    const mark = linkType.isInSet(state.doc.resolve(from).marks());
    if (mark && state.doc.rangeHasMark(from, to, linkType)) {
      return { from, to, href: (mark.attrs as { href: string }).href };
    }
    return null;
  }
  const cursorMark = linkType.isInSet($from.marks());
  if (!cursorMark) {
    return null;
  }
  // Expand to the contiguous run of inline children carrying this exact link.
  const parent = $from.parent;
  let pos = $from.start();
  let runStart = -1;
  let foundFrom = -1;
  let foundTo = -1;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = pos;
    const childTo = pos + child.nodeSize;
    if (cursorMark.isInSet(child.marks)) {
      if (runStart === -1) {
        runStart = childFrom;
      }
      if ($from.pos >= childFrom && $from.pos <= childTo) {
        foundFrom = runStart;
        foundTo = childTo;
      } else if (foundFrom === runStart && foundFrom !== -1) {
        foundTo = childTo;
      }
    } else {
      runStart = -1;
    }
    pos = childTo;
  }
  if (foundFrom === -1) {
    return null;
  }
  return {
    from: foundFrom,
    to: foundTo,
    href: (cursorMark.attrs as { href: string }).href,
  };
}

/**
 * Apply a link to an explicit range (captured when the link popover opened, so
 * it survives the URL field stealing focus from the editor). A non-empty range
 * is wrapped/retargeted; an empty range inserts the href as linked text.
 */
export function applyLink(from: number, to: number, href: string): Command {
  return (state, dispatch) => {
    const linkType = marks.link;
    if (dispatch) {
      const tr = state.tr;
      if (to > from) {
        tr.removeMark(from, to, linkType).addMark(
          from,
          to,
          linkType.create({ href }),
        );
      } else {
        tr.insertText(href, from);
        tr.addMark(from, from + href.length, linkType.create({ href }));
        tr.removeStoredMark(linkType);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Indent (`delta > 0`) or outdent every paragraph/heading the selection touches
 * by one level, clamped to [0, MAX_INDENT]. Works from any cursor position in a
 * block (it ranges over the whole selection, not the cursor offset) and spans
 * multi-block selections. Paragraphs inside list items are skipped — list
 * nesting is Tab's job there, handled by the list keymap before this runs.
 */
function adjustIndent(delta: number): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (parent?.type === nodes.listItem) {
        return false;
      }
      if (node.type === nodes.paragraph || node.type === nodes.heading) {
        const current = (node.attrs.indent as number | undefined) ?? 0;
        const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
        if (next !== current) {
          // setNodeMarkup preserves node size, so positions from the original
          // doc stay valid for the remaining iterations.
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        }
        return false;
      }
      return true;
    });
    if (tr.steps.length === 0) {
      return false;
    }
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Indent the selected blocks one level (Tab, after list nesting). */
export const indentBlocks: Command = adjustIndent(1);
/** Outdent the selected blocks one level (Shift-Tab, after list nesting). */
export const outdentBlocks: Command = adjustIndent(-1);

/**
 * Move the top-level block containing the selection up (`-1`) or down (`+1`) by
 * swapping it with its sibling. `allowVerseEdit` lets the move re-insert blocks
 * that contain verse markers past the verse guard.
 */
function moveBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth < 1) {
      return false;
    }
    const index = $from.index(0);
    const target = index + dir;
    if (target < 0 || target >= state.doc.childCount) {
      return false;
    }
    const block = state.doc.child(index);
    const sibling = state.doc.child(target);
    // The notes index is pinned to the top: it can't be moved, and no block can
    // move above it.
    if (block.type === nodes.notesIndex || sibling.type === nodes.notesIndex) {
      return false;
    }
    if (dispatch) {
      const blockStart = $from.before(1);
      const insertAt =
        dir === -1
          ? blockStart - sibling.nodeSize
          : blockStart + sibling.nodeSize;
      const tr = state.tr;
      tr.delete(blockStart, blockStart + block.nodeSize);
      tr.insert(insertAt, block);
      tr.setMeta("allowVerseEdit", true);
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Insert a callout of `variant` at the cursor: replaces the current block if
 * it's an empty paragraph (the slash-menu case), otherwise inserts after it.
 * Drops the caret inside the new callout.
 */
export function insertCallout(variant: string): Command {
  return (state, dispatch) => {
    const callout = nodes.callout.createAndFill({ variant });
    if (!callout) {
      return false;
    }
    if (dispatch) {
      const { $from } = state.selection;
      const blockStart = $from.before(1);
      const blockEnd = $from.after(1);
      const block = $from.node(1);
      const tr = state.tr;
      let insertPos: number;
      if (block.type === nodes.paragraph && block.content.size === 0) {
        tr.replaceRangeWith(blockStart, blockEnd, callout);
        insertPos = blockStart;
      } else {
        tr.insert(blockEnd, callout);
        insertPos = blockEnd;
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Insert a collapsible section at the cursor (same placement rules as callouts). */
export const insertCollapsible: Command = (state, dispatch) => {
  const node = nodes.collapsible.createAndFill({ summary: "" });
  if (!node) {
    return false;
  }
  if (dispatch) {
    const { $from } = state.selection;
    const blockStart = $from.before(1);
    const blockEnd = $from.after(1);
    const block = $from.node(1);
    const tr = state.tr;
    let insertPos: number;
    if (block.type === nodes.paragraph && block.content.size === 0) {
      tr.replaceRangeWith(blockStart, blockEnd, node);
      insertPos = blockStart;
    } else {
      tr.insert(blockEnd, node);
      insertPos = blockEnd;
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Build a `rows` × `cols` table: a header row of `table_header` cells over
 * `rows - 1` body rows of `table_cell`s, every cell filled with an empty
 * paragraph. Returns null if the schema can't fill a cell (shouldn't happen).
 */
function buildTable(rows: number, cols: number): Node | null {
  const headerCell = nodes.tableHeader.createAndFill();
  const bodyCell = nodes.tableCell.createAndFill();
  if (!headerCell || !bodyCell) {
    return null;
  }
  const rowNodes: Node[] = [
    nodes.tableRow.create(
      null,
      Array.from({ length: cols }, () => headerCell),
    ),
  ];
  for (let r = 1; r < rows; r++) {
    rowNodes.push(
      nodes.tableRow.create(
        null,
        Array.from({ length: cols }, () => bodyCell),
      ),
    );
  }
  return nodes.table.create(null, rowNodes);
}

/**
 * Insert a 3×3 table (one header row + two body rows) at the cursor — same
 * placement rules as callouts (replace a lone empty paragraph, else insert
 * after the current block). Drops the caret in the first cell.
 */
export const insertTable: Command = (state, dispatch) => {
  const table = buildTable(3, 3);
  if (!table) {
    return false;
  }
  if (dispatch) {
    const { $from } = state.selection;
    const blockStart = $from.before(1);
    const blockEnd = $from.after(1);
    const block = $from.node(1);
    const tr = state.tr;
    let insertPos: number;
    if (block.type === nodes.paragraph && block.content.size === 0) {
      tr.replaceRangeWith(blockStart, blockEnd, table);
      insertPos = blockStart;
    } else {
      tr.insert(blockEnd, table);
      insertPos = blockEnd;
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Wrap a command so the transaction it dispatches is flagged `allowVerseEdit`,
 * letting it past the verse guard. For structural edits (e.g. deleting a table
 * row/column) that may legitimately remove verse markers caught in the way.
 */
export function allowVerseEdit(command: Command): Command {
  return (state, dispatch, view) =>
    command(
      state,
      dispatch
        ? (tr) => {
            dispatch(tr.setMeta("allowVerseEdit", true));
          }
        : undefined,
      view,
    );
}

/** Move the current top-level block up one position. */
export const moveBlockUp: Command = moveBlock(-1);
/** Move the current top-level block down one position. */
export const moveBlockDown: Command = moveBlock(1);

/**
 * Select the content of the top-level block the cursor is in — a study block's
 * body, the notes index's entries, or a stray paragraph. Bound to Mod-a in the
 * locked blocks editor so "select all" stays scoped to one block instead of
 * spanning the whole document. (When focus is in a block's title `<input>`, this
 * never fires — the header is non-editable and `StudyBlockView.stopEvent` hides
 * its events from ProseMirror — so the title keeps its native select-all.)
 */
export const selectCurrentBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth < 1) {
    return false;
  }
  const before = $from.before(1);
  const node = state.doc.child($from.index(0));
  if (dispatch) {
    const selection = TextSelection.between(
      state.doc.resolve(before + 1),
      state.doc.resolve(before + node.nodeSize - 1),
    );
    dispatch(state.tr.setSelection(selection).scrollIntoView());
  }
  return true;
};

/**
 * Delete the top-level block containing the selection. If it's the only block,
 * replace it with an empty paragraph so the doc stays non-empty.
 */
export const deleteCurrentBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth < 1) {
    return false;
  }
  if (dispatch) {
    const blockStart = $from.before(1);
    const block = $from.node(1);
    const tr = state.tr;
    if (state.doc.childCount <= 1) {
      tr.replaceWith(
        blockStart,
        blockStart + block.nodeSize,
        nodes.paragraph.create(),
      );
    } else {
      tr.delete(blockStart, blockStart + block.nodeSize);
    }
    tr.setMeta("allowVerseEdit", true);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Remove the link mark across an explicit range (captured at popover open). */
export function clearLink(from: number, to: number): Command {
  return (state, dispatch) => {
    if (to <= from) {
      return false;
    }
    if (dispatch) {
      dispatch(state.tr.removeMark(from, to, marks.link).scrollIntoView());
    }
    return true;
  };
}

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
  marks.underline,
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
