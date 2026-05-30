import { lift, toggleMark } from "prosemirror-commands";
import type { MarkType, Node, NodeType } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  TextSelection,
  type Transaction,
} from "prosemirror-state";

import { buildConvertTransaction } from "./convert-block";
import { type LinkAttrs, marks, MAX_INDENT, nodes } from "./schema";

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
 * Is the cursor (or any block the selection touches) a `list_row` with the
 * given `listType`? Flat-schema replacement for the old "inside a
 * bullet_list / ordered_list / task_list" `isAncestorActive` check — there's
 * no longer a list-wrapper ancestor, so callers (toolbar, slash menu's
 * active-state ring) read the row's attr directly.
 */
export function isListRowActive(
  state: EditorState,
  listType: "bullet" | "ordered" | "task",
): boolean {
  const { from, to, $from, empty } = state.selection;
  if (empty) {
    return (
      $from.parent.type === nodes.listRow &&
      $from.parent.attrs.listType === listType
    );
  }
  let active = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (active) return false;
    if (node.type === nodes.listRow && node.attrs.listType === listType) {
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

/**
 * Toggle the current textblock between a heading of `level` and a paragraph.
 * Both directions route through {@link buildConvertTransaction} so the slash
 * menu / Turn-into menu / toolbar all share the same context-aware behavior
 * the markdown shortcuts use — including dissolving a collapsible header,
 * splitting a list around the target item, and bridging cases where the
 * source block isn't a paragraph (e.g. "Heading 1" on a code-block).
 */
export function toggleHeading(level: number): Command {
  return (state, dispatch) => {
    const alreadyActive = isBlockActive(state, nodes.heading, { level });
    const target = alreadyActive
      ? ({ kind: "setblock", nodeType: nodes.paragraph } as const)
      : ({
          kind: "setblock",
          nodeType: nodes.heading,
          attrs: { level },
        } as const);
    const tr = buildConvertTransaction(state, target);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/**
 * Toggle the cursor's textblock between a `list_row` of the given listType
 * and a plain paragraph. When the cursor is already in a list_row of that
 * same listType we "toggle off" by converting to paragraph; otherwise we
 * route through {@link buildConvertTransaction} so collapsible-header dissolve
 * + indent preservation behave identically across input rules and menus.
 */
function toggleListRow(
  listType: "bullet" | "ordered" | "task",
  attrs?: { checked?: boolean },
): Command {
  return (state, dispatch) => {
    const parent = state.selection.$from.parent;
    const alreadyType =
      parent.type === nodes.listRow && parent.attrs.listType === listType;
    const target = alreadyType
      ? ({ kind: "setblock", nodeType: nodes.paragraph } as const)
      : ({ kind: "list_row", listType, attrs } as const);
    const tr = buildConvertTransaction(state, target);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

export const toggleBulletList: Command = toggleListRow("bullet");
export const toggleOrderedList: Command = toggleListRow("ordered");
/** Toggle a checklist; toggles off when already in a task row. */
export const toggleTaskList: Command = toggleListRow("task", {
  checked: false,
});

/**
 * Wrap (or unwrap) the cursor's textblock in a blockquote. When already
 * inside a quote, `lift` peels the cursor's range out of the surrounding
 * blockquote; otherwise {@link buildConvertTransaction} adds one. The
 * pipeline silently refuses a second nested level of blockquote per the
 * decided design — so the slash menu / Turn-into never produces stacked
 * quotes either.
 */
export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (isAncestorActive(state, nodes.blockquote)) {
    return lift(state, dispatch, view);
  }
  const tr = buildConvertTransaction(state, {
    kind: "wrap",
    nodeType: nodes.blockquote,
  });
  if (!tr) return false;
  if (dispatch) dispatch(tr);
  return true;
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

/** What {@link activeLinkRange} returns when the selection sits on a link. */
export interface ActiveLink {
  from: number;
  to: number;
  /** Full link mark attrs (href + cached preview fields). */
  attrs: LinkAttrs;
  /** The text covered by the link mark — display text the user edits. */
  text: string;
}

function readLinkAttrs(attrs: unknown): LinkAttrs {
  const source = (attrs ?? {}) as Partial<LinkAttrs>;
  return {
    href: source.href ?? "",
    title: source.title ?? null,
    displayTitle: source.displayTitle ?? null,
    favicon: source.favicon ?? null,
    siteName: source.siteName ?? null,
  };
}

/**
 * The link covering the selection (or the contiguous link run around an empty
 * cursor), or null when there's no single link to act on. Powers the link
 * control's edit/remove state, the hover preview plugin's range lookup, and
 * the click-to-edit handler.
 */
export function activeLinkRange(state: EditorState): ActiveLink | null {
  const linkType = marks.link;
  const { $from, from, to, empty } = state.selection;
  if (!empty) {
    const mark = linkType.isInSet(state.doc.resolve(from).marks());
    if (mark && state.doc.rangeHasMark(from, to, linkType)) {
      return {
        from,
        to,
        attrs: readLinkAttrs(mark.attrs),
        text: state.doc.textBetween(from, to, "", ""),
      };
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
    attrs: readLinkAttrs(cursorMark.attrs),
    text: state.doc.textBetween(foundFrom, foundTo, "", ""),
  };
}

/**
 * Apply a link to an explicit range (captured when the link popover opened, so
 * it survives the URL field stealing focus from the editor).
 *
 * - When `displayText` is supplied and differs from the current range text, the
 *   range text is replaced first; the mark is then applied to the new span.
 * - When the range is empty AND no display text is given, the href itself is
 *   inserted as the visible text (matching the old single-arg behavior so
 *   smart-paste and the keymap can drop a link at the caret with one call).
 * - Cache attrs in `attrs` (displayTitle/favicon/siteName) are preserved so the
 *   smart-paste flow can apply a freshly-fetched preview in the same step.
 */
export function applyLink(
  from: number,
  to: number,
  attrs: Partial<LinkAttrs> & { href: string },
  displayText?: string,
): Command {
  return (state, dispatch) => {
    const linkType = marks.link;
    const fullAttrs = readLinkAttrs(attrs);
    if (!dispatch) return true;
    const tr = state.tr;
    const rangeFrom = from;
    let rangeTo = to;
    if (rangeTo > rangeFrom) {
      const currentText = state.doc.textBetween(rangeFrom, rangeTo, "", "");
      if (displayText !== undefined && displayText !== currentText) {
        tr.insertText(displayText, rangeFrom, rangeTo);
        rangeTo = rangeFrom + displayText.length;
      }
      tr.removeMark(rangeFrom, rangeTo, linkType).addMark(
        rangeFrom,
        rangeTo,
        linkType.create(fullAttrs),
      );
    } else {
      const text = displayText ?? fullAttrs.href;
      tr.insertText(text, rangeFrom);
      tr.addMark(
        rangeFrom,
        rangeFrom + text.length,
        linkType.create(fullAttrs),
      );
      tr.removeStoredMark(linkType);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Textblocks that carry an `indent` attribute (Phase 2 flat schema). */
const indentableTextblocks: readonly NodeType[] = [
  nodes.paragraph,
  nodes.heading,
  nodes.listRow,
  nodes.codeBlock,
];

/**
 * Adjust the `indent` attribute on every indentable textblock the selection
 * touches by `delta`, clamped to [0, MAX_INDENT]. The flat-schema rewrite
 * collapsed the previous "sinkListItem first, attr fallback" hybrid: list
 * structure no longer exists, so Tab/Shift-Tab is a pure attribute edit on
 * the cursor's textblock(s).
 */
function adjustBlockIndent(delta: number): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!indentableTextblocks.includes(node.type)) return true;
      const current = (node.attrs.indent as number | undefined) ?? 0;
      const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
      if (next !== current) {
        // setNodeMarkup preserves node size, so positions from the original
        // doc stay valid for the remaining iterations.
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      }
      return false;
    });
    if (tr.steps.length === 0) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Tab / Shift-Tab. Adjusts the `indent` attribute on the cursor's textblock
 * (or every indentable textblock the selection touches). For Shift-Tab when
 * already at indent 0 we fall through to `lift`, which peels the textblock
 * out of its nearest non-doc wrapper (blockquote, callout, collapsible).
 */
function indentSelectedDir(delta: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (adjustBlockIndent(delta)(state, dispatch, view)) return true;
    if (delta < 0) return lift(state, dispatch);
    return false;
  };
}

/** Indent the selection one level (Tab). See {@link indentSelectedDir}. */
export const indentSelected: Command = indentSelectedDir(1);
/** Outdent the selection one level (Shift-Tab). See {@link indentSelectedDir}. */
export const outdentSelected: Command = indentSelectedDir(-1);

/**
 * Back-compat aliases for the previous paragraph-only indent commands. New
 * code should prefer {@link indentSelected} / {@link outdentSelected}; these
 * stay exported so external imports keep working.
 */
export const indentBlocks: Command = indentSelected;
export const outdentBlocks: Command = outdentSelected;

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
 * Find the deepest ancestor depth where inserting a fresh block child is
 * structurally valid AND the cursor is conceptually "inside" that container.
 * Used by the slash-menu inserters (`insertCallout` / `insertCollapsible` /
 * `insertTable`) so dropping a callout from inside a bullet row three levels
 * deep inserts the callout NEXT TO that row — not way up at the top of the
 * doc, which the old `$from.before(1)` did.
 *
 * Flat-schema simplification: list_rows are siblings of every other block,
 * so there's no longer a list-wrapper container to step past — we just walk
 * outward until we find an ancestor whose schema accepts the target.
 */
function insertionDepthFor(state: EditorState, nodeType: NodeType): number {
  const { $from } = state.selection;
  for (let d = $from.depth - 1; d >= 1; d--) {
    const ancestor = $from.node(d);
    if (ancestor.canReplaceWith(0, 0, nodeType)) {
      return d;
    }
  }
  return 1;
}

/**
 * Insert a callout of `variant` next to the cursor's current block, in
 * whichever container actually holds it. If the cursor sits in an empty
 * paragraph at that depth, the paragraph is replaced; otherwise the callout
 * is inserted right after the cursor's block. Drops the caret inside.
 */
export function insertCallout(variant: string): Command {
  return (state, dispatch) => {
    const callout = nodes.callout.createAndFill({ variant });
    if (!callout) return false;
    if (dispatch) {
      dispatch(insertNodeNextToCursor(state, callout).scrollIntoView());
    }
    return true;
  };
}

/** Insert a collapsible section next to the cursor's current block. */
export const insertCollapsible: Command = (state, dispatch) => {
  const node = nodes.collapsible.createAndFill({ summary: "" });
  if (!node) return false;
  if (dispatch) {
    dispatch(insertNodeNextToCursor(state, node).scrollIntoView());
  }
  return true;
};

/**
 * Shared placement logic for the slash-menu inserters. The new node lands at
 * the smallest enclosing depth that accepts it (so a callout summoned from
 * inside a bullet sits as a sibling of that bullet's list, not at the doc
 * top); the empty-paragraph-replacement convenience still applies at that
 * depth.
 */
export function insertNodeNextToCursor(
  state: EditorState,
  node: Node,
): Transaction {
  const depth = insertionDepthFor(state, node.type);
  const { $from } = state.selection;
  const blockStart = $from.before(depth);
  const blockEnd = $from.after(depth);
  const block = $from.node(depth);
  const tr = state.tr;
  let insertPos: number;
  // Replace a lone empty textblock (paragraph or list_row) rather than
  // appending a new node beside it.
  const replaceableEmpty =
    (block.type === nodes.paragraph || block.type === nodes.listRow) &&
    block.content.size === 0;
  if (replaceableEmpty) {
    tr.replaceRangeWith(blockStart, blockEnd, node);
    insertPos = blockStart;
  } else {
    tr.insert(blockEnd, node);
    insertPos = blockEnd;
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)));
  return tr;
}

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
  if (!table) return false;
  if (dispatch) {
    dispatch(insertNodeNextToCursor(state, table).scrollIntoView());
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
 *
 * Kept exported for any external caller that wants the legacy "always select
 * the depth-1 block" behaviour. Mod-A itself now uses the progressive
 * {@link makeModASelect} command instead.
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
 * Progressive Mod-A. First press selects the cursor's innermost textblock
 * content (the paragraph / heading the caret is in). A subsequent press
 * escalates the selection: in the body editor (`scope: "doc"`) it grows out
 * to the entire document; in the blocks editor (`scope: "study_block"`) it
 * grows to the surrounding `study_block`'s content, where it stops — the
 * study-block boundary is the natural ceiling for Mod-A there.
 *
 * Escalation is detected by checking whether the current selection EXACTLY
 * covers the cursor's parent textblock. That makes the progressive flow
 * resilient to selection-tweaks the user might make between presses (drag,
 * arrow, etc.): if the selection drifts, the next Mod-A starts over from the
 * inner textblock instead of jumping to the outer scope.
 */
export function makeModASelect(scope: "doc" | "study_block"): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const { $from } = sel;
    if ($from.depth === 0) return false;

    const innerStart = $from.start();
    const innerEnd = $from.end();
    const atInner = sel.from === innerStart && sel.to === innerEnd;

    let targetStart: number;
    let targetEnd: number;

    if (!atInner) {
      // First press (or selection drifted) — select the cursor's textblock.
      targetStart = innerStart;
      targetEnd = innerEnd;
    } else if (scope === "doc") {
      targetStart = 0;
      targetEnd = state.doc.content.size;
    } else {
      // Find the enclosing study_block; if there isn't one (cursor in the
      // notes index or a stray paragraph in the blocks doc) fall back to the
      // top-level block at depth 1.
      let blockDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === nodes.studyBlock) {
          blockDepth = d;
          break;
        }
      }
      if (blockDepth < 0) blockDepth = 1;
      targetStart = $from.start(blockDepth);
      targetEnd = $from.end(blockDepth);
    }

    if (targetStart === sel.from && targetEnd === sel.to) {
      // No movement (already at maximal scope) — don't fire a no-op tr.
      return false;
    }

    if (dispatch) {
      const selection = TextSelection.create(state.doc, targetStart, targetEnd);
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
    return true;
  };
}

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
