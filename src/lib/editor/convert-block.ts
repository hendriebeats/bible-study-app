import { Fragment, type Node, type NodeType } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { findWrapping } from "prosemirror-transform";

import { isAncestorActive } from "./commands";
import { nodes } from "./schema";

/**
 * The unified "convert this block to X" pipeline used by:
 *   - markdown shortcuts (input-rules.ts) — `- ` → bullet, `# ` → heading, etc.
 *   - the slash menu (Heading / Quote / Bullet list / Checklist / …)
 *   - the block-handle "Turn into" menu
 *   - the toolbar's heading + list toggles
 *
 * Before this existed, each entrypoint had its own variation of
 * `setBlockType` / `wrapIn` / `wrapInList`, which silently failed inside
 * containers whose schema rejected the result — most visibly: typing `# ` at
 * the start of an H1 (heading can't be wrapped in a `list_item` whose first
 * child must be a paragraph), typing `- ` in a collapsible header (the user
 * wants the WHOLE toggle to become a bullet, not a bullet inside the toggle),
 * and "Turn into Heading 1" in a list item (heading rejected as first child
 * of the `list_item`).
 *
 * The pipeline dispatches on cursor context:
 *
 *   * In a collapsible's first child (the "header" line) — the conversion
 *     dissolves the collapsible. The new structure absorbs the header AND the
 *     body content together, so a toggle with two body paragraphs that
 *     becomes a bullet renders as one `list_item` containing all three
 *     paragraphs (the body sits nested under the bullet, matching its
 *     pre-conversion visual position). Only collapsibles get this treatment;
 *     callouts and blockquotes keep their wrapper when their header converts.
 *
 *   * In a `list_item` / `task_item` — the conversion splits the parent list
 *     around the target item and places the converted shape in the gap.
 *     Surrounding siblings stay in their original list type. Ordered-list
 *     numbering continues across the seam.
 *
 *   * Plain block (paragraph, heading, code_block, blockquote body, callout
 *     body, etc.) — the conversion replaces the cursor's textblock. Where the
 *     source is non-paragraph and the target is a list, the source's inline
 *     content is wrapped in a fresh paragraph first (so a heading→bullet
 *     keeps the heading's text but loses its h-level styling).
 *
 * Guards:
 *
 *   * Same-type / same-attrs no-op when target == source list (e.g. `- ` in a
 *     bullet item). Returns null so the input rule leaves the trigger as
 *     literal text the user can keep typing.
 *
 *   * Blockquote nesting — `target = wrap(blockquote)` while the cursor is
 *     already inside a blockquote consumes the trigger (so `> ` doesn't sit
 *     visible as text) but otherwise does nothing. The slash menu hides the
 *     "Quote" option in the same state.
 */
export type ConvertTarget =
  | {
      kind: "list";
      listType: NodeType;
      itemType: NodeType;
      itemAttrs?: Record<string, unknown>;
    }
  | {
      kind: "setblock";
      nodeType: NodeType;
      attrs?: Record<string, unknown>;
    }
  | {
      kind: "wrap";
      nodeType: NodeType;
      attrs?: Record<string, unknown>;
    };

/** Optional inputs passed by input rules so the trigger text disappears and
 *  the conversion targets the post-deletion document. */
export interface ConvertOptions {
  triggerRange?: { from: number; to: number };
}

interface ListItemContext {
  itemType: NodeType;
  listType: NodeType;
  itemNode: Node;
  listNode: Node;
  listFrom: number;
  listTo: number;
  itemIndex: number;
}

interface CollapsibleHeaderContext {
  collapsibleNode: Node;
  collapsibleFrom: number;
  collapsibleTo: number;
  headerNode: Node;
}

/**
 * Walk up from the cursor looking for the innermost `list_item` / `task_item`
 * ancestor and resolve its enclosing list. Returns null when the cursor isn't
 * inside a list.
 */
function findListItemContext(
  state: EditorState,
  triggerStart?: number,
): ListItemContext | null {
  const pos = triggerStart ?? state.selection.from;
  const $from = state.doc.resolve(pos);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type !== nodes.listItem && node.type !== nodes.taskItem) continue;
    if (d - 1 < 0) return null;
    const list = $from.node(d - 1);
    return {
      itemType: node.type,
      listType: list.type,
      itemNode: node,
      listNode: list,
      listFrom: $from.before(d - 1),
      listTo: $from.after(d - 1),
      itemIndex: $from.index(d - 1),
    };
  }
  return null;
}

/**
 * Walk up looking for a `collapsible` whose FIRST child contains the cursor —
 * the only case where conversion dissolves the toggle. Cursor in body content
 * or in a header that's been converted to a nested structure (a list inside
 * the header line) falls through, so default conversion runs.
 */
function findCollapsibleHeaderContext(
  state: EditorState,
  triggerStart?: number,
): CollapsibleHeaderContext | null {
  const pos = triggerStart ?? state.selection.from;
  const $from = state.doc.resolve(pos);
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type !== nodes.collapsible) continue;
    if ($from.index(d) !== 0) return null; // cursor in body, not header
    const header = node.firstChild;
    if (!header) return null;
    return {
      collapsibleNode: node,
      collapsibleFrom: $from.before(d),
      collapsibleTo: $from.after(d),
      headerNode: header,
    };
  }
  return null;
}

/**
 * Remove `chars` leading characters from the first textblock that `node`
 * exposes — operating directly on the inline content of that textblock so we
 * don't accidentally recurse into a text node (whose `copy(Fragment)` returns
 * a malformed non-text Node and leaves the trimmed paragraph carrying a
 * "ghost" 2-size child). Used to strip the markdown trigger before
 * rewrapping the item / collapsible.
 */
function stripLeadingChars(node: Node, chars: number): Node {
  if (chars <= 0) return node;
  // Textblock — cut the inline content directly. `content.cut(chars)` slices
  // the Fragment along inline positions, splitting text nodes as needed and
  // never producing a broken text node.
  if (node.isTextblock) {
    return node.copy(node.content.cut(chars));
  }
  // Wrapper node — recurse into the first child until we hit a textblock.
  const first = node.firstChild;
  if (!first) return node;
  const trimmed = stripLeadingChars(first, chars);
  if (node.childCount === 1) {
    return node.copy(Fragment.from(trimmed));
  }
  const rest: Node[] = [];
  for (let i = 1; i < node.childCount; i++) rest.push(node.child(i));
  return node.copy(Fragment.fromArray([trimmed, ...rest]));
}

/** Step down the first-child chain of `middle` (adding 1 per open tag) until
 *  the first textblock — the caret-friendly position after a structural
 *  replacement.  */
function caretInsideMiddle(middleStart: number, middle: Node): number {
  let pos = middleStart + 1; // step inside middle's outer node
  let n: Node = middle;
  while (n.firstChild && !n.isTextblock) {
    n = n.firstChild;
    pos += 1;
  }
  return pos;
}

/**
 * Build the body-children array of a node, skipping its first child. Used by
 * the collapsible-dissolve path to peel the header off from "everything
 * else."
 */
function bodyChildrenAfter(node: Node, skipChars = 0): Node[] {
  void skipChars; // (the trigger only ever sits in the header; body is untouched)
  const rest: Node[] = [];
  for (let i = 1; i < node.childCount; i++) rest.push(node.child(i));
  return rest;
}

/**
 * Build the new "middle" node(s) and supporting siblings when the cursor sits
 * inside a `list_item`. Same shape as the previous in-list path that lived
 * inside `input-rules.ts`, lifted here so the slash menu can use it too.
 *
 * `triggerChars` strips that many characters from the front of the item's
 * first textblock — only the input-rule path supplies it; the slash menu
 * passes 0.
 */
function buildListSplit(
  ctx: ListItemContext,
  target: ConvertTarget,
  triggerChars: number,
): { children: Node[]; middle: Node; middleOffset: number } | null {
  const trimmedItem = stripLeadingChars(ctx.itemNode, triggerChars);
  if (!trimmedItem.firstChild) return null;

  let middle: Node | null = null;
  const extraTrailingMiddle: Node[] = [];

  if (target.kind === "list") {
    const newItem = target.itemType.createAndFill(
      target.itemAttrs ?? null,
      trimmedItem.content,
    );
    if (!newItem) return null;
    middle = target.listType.createAndFill(null, [newItem]);
  } else if (target.kind === "setblock") {
    // Keep the first textblock's inline content as the new block's content,
    // and emit the item's remaining block children as flat siblings after it
    // so a nested list under a list item isn't silently dropped on
    // heading-conversion. `trimmedItem.firstChild` is guaranteed non-null
    // here (we returned early above) — guard kept for type-narrowing.
    middle = target.nodeType.createAndFill(
      target.attrs ?? null,
      trimmedItem.firstChild.content,
    );
    for (let i = 1; i < trimmedItem.childCount; i++) {
      extraTrailingMiddle.push(trimmedItem.child(i));
    }
  } else {
    middle = target.nodeType.createAndFill(
      target.attrs ?? null,
      trimmedItem.content,
    );
  }
  if (!middle) return null;

  const children: Node[] = [];
  let middleOffset = 0;

  if (ctx.itemIndex > 0) {
    const beforeItems: Node[] = [];
    for (let i = 0; i < ctx.itemIndex; i++) {
      beforeItems.push(ctx.listNode.child(i));
    }
    const beforeList = ctx.listNode.type.create(
      ctx.listNode.attrs,
      Fragment.fromArray(beforeItems),
    );
    children.push(beforeList);
    middleOffset += beforeList.nodeSize;
  }

  children.push(middle);
  for (const extra of extraTrailingMiddle) children.push(extra);

  if (ctx.itemIndex < ctx.listNode.childCount - 1) {
    const afterItems: Node[] = [];
    for (let i = ctx.itemIndex + 1; i < ctx.listNode.childCount; i++) {
      afterItems.push(ctx.listNode.child(i));
    }
    // Keep ordered numbering continuous across the seam.
    let afterAttrs = ctx.listNode.attrs;
    if (ctx.listNode.type === nodes.orderedList) {
      const origOrder = (ctx.listNode.attrs.order as number | undefined) ?? 1;
      afterAttrs = {
        ...ctx.listNode.attrs,
        order: origOrder + ctx.itemIndex + 1,
      };
    }
    children.push(
      ctx.listNode.type.create(afterAttrs, Fragment.fromArray(afterItems)),
    );
  }

  return { children, middle, middleOffset };
}

/**
 * Dissolve a collapsible during a header conversion. The new structure
 * absorbs the trimmed header AND every body child together — so a toggle
 * with two body paragraphs converted into a bullet becomes one `list_item`
 * containing the (now-paragraph) header followed by the two original
 * paragraphs, matching the visual indent the user had.
 */
function buildCollapsibleDissolve(
  ctx: CollapsibleHeaderContext,
  target: ConvertTarget,
  triggerChars: number,
): { children: Node[] } | null {
  const trimmedHeader = stripLeadingChars(ctx.headerNode, triggerChars);
  const headerInline = trimmedHeader.isTextblock
    ? trimmedHeader.content
    : Fragment.empty;
  const body = bodyChildrenAfter(ctx.collapsibleNode);

  if (target.kind === "list") {
    // Build a list_item whose own content is [headerAsParagraph, ...body].
    // Going through paragraph (rather than reusing the header node directly)
    // means a heading-header keeps its TEXT but drops its h-level — which is
    // what "convert this block to a bullet" intuitively means.
    const headerPara = nodes.paragraph.create(null, headerInline);
    const itemContent = Fragment.fromArray([headerPara, ...body]);
    const item = target.itemType.createAndFill(
      target.itemAttrs ?? null,
      itemContent,
    );
    if (!item) return null;
    const list = target.listType.createAndFill(null, [item]);
    if (!list) return null;
    return { children: [list] };
  }

  if (target.kind === "setblock") {
    // Header becomes the new textblock (heading/code-block/paragraph); body
    // children fall out as flat siblings — they don't fit inside a textblock.
    const newBlock = target.nodeType.createAndFill(
      target.attrs ?? null,
      headerInline,
    );
    if (!newBlock) return null;
    return { children: [newBlock, ...body] };
  }

  // wrap (blockquote / callout / collapsible — though collapsible-to-collapsible
  // would be a no-op-style move; the same-type guard short-circuits it first.)
  const headerPara = nodes.paragraph.create(null, headerInline);
  const wrapper = target.nodeType.createAndFill(
    target.attrs ?? null,
    Fragment.fromArray([headerPara, ...body]),
  );
  if (!wrapper) return null;
  return { children: [wrapper] };
}

/**
 * Plain-block conversion (cursor isn't in a list item or a collapsible
 * header). Replaces the cursor's textblock with the target shape, lifting
 * non-paragraph inline content into a paragraph when the target is a list so
 * `- ` on a heading produces `bullet_list[item[paragraph(headingText)]]`
 * rather than silently failing schema validation.
 */
function buildPlainConversion(
  tr: Transaction,
  state: EditorState,
  target: ConvertTarget,
): Transaction | null {
  const $start = tr.doc.resolve(tr.mapping.map(state.selection.from));
  const range = $start.blockRange();
  if (!range) return null;
  const sourceBlock = $start.parent;

  if (target.kind === "setblock") {
    tr.setBlockType(range.start, range.end, target.nodeType, target.attrs);
    return tr.scrollIntoView();
  }

  if (target.kind === "wrap") {
    const wrap = findWrapping(range, target.nodeType, target.attrs);
    if (!wrap) return null;
    tr.wrap(range, wrap);
    return tr.scrollIntoView();
  }

  // list — when source is already a paragraph use the standard wrap (cheap,
  // preserves marks/atoms perfectly). When source is heading/code-block/etc.
  // build the list manually around a fresh paragraph carrying the source's
  // inline content, then replace the source block whole.
  if (sourceBlock.type === nodes.paragraph) {
    const wrap = findWrapping(range, target.listType);
    if (!wrap) return null;
    const decorated = target.itemAttrs
      ? wrap.map((step) =>
          step.type === target.itemType
            ? {
                type: step.type,
                attrs: { ...step.attrs, ...target.itemAttrs },
              }
            : step,
        )
      : wrap;
    tr.wrap(range, decorated);
    return tr.scrollIntoView();
  }

  // Non-paragraph source textblock → manual replace.
  const paragraph = nodes.paragraph.create(null, sourceBlock.content);
  const item = target.itemType.createAndFill(target.itemAttrs ?? null, [
    paragraph,
  ]);
  if (!item) return null;
  const list = target.listType.createAndFill(null, [item]);
  if (!list) return null;
  const blockStart = $start.before($start.depth);
  const blockEnd = $start.after($start.depth);
  tr.replaceWith(blockStart, blockEnd, list);
  tr.setSelection(
    TextSelection.create(tr.doc, caretInsideMiddle(blockStart, list)),
  );
  return tr.scrollIntoView();
}

/**
 * Detect "the cursor is already in the same type the user is asking for" so
 * markdown shortcuts like `- ` typed inside an existing bullet item don't
 * fire a redundant transformation. Returns the matching list_item context
 * when conversion would be a no-op; null otherwise. (Plain-block same-type
 * detection — e.g. `# ` in an existing H1 — is handled by setBlockType which
 * returns false on a no-op.)
 */
function isNoopListConversion(
  state: EditorState,
  target: ConvertTarget,
  triggerStart?: number,
): boolean {
  if (target.kind !== "list") return false;
  const ctx = findListItemContext(state, triggerStart);
  if (!ctx) return false;
  if (target.listType !== ctx.listType) return false;
  if (target.itemType !== ctx.itemType) return false;
  const currentChecked =
    ctx.itemType === nodes.taskItem
      ? Boolean(ctx.itemNode.attrs.checked)
      : false;
  const wantedChecked = Boolean(target.itemAttrs?.checked);
  return currentChecked === wantedChecked;
}

/**
 * The shared entry point. Returns a Transaction ready to dispatch, or null
 * when the conversion is structurally impossible / a no-op (caller leaves the
 * trigger as literal text). When the conversion is *intentionally* a no-op
 * but the trigger should still disappear (e.g. `> ` while already inside a
 * blockquote), returns a Transaction whose only step is the trigger delete.
 */
export function buildConvertTransaction(
  state: EditorState,
  target: ConvertTarget,
  opts: ConvertOptions = {},
): Transaction | null {
  // Same-type list conversions are a no-op — and for input rules the trigger
  // should stay as literal text (so the user can type `- list item` without
  // re-conversion). Return null.
  if (isNoopListConversion(state, target, opts.triggerRange?.from)) {
    return null;
  }

  // Blockquote inside blockquote: consume the trigger (so `> ` doesn't loiter
  // visibly) but don't actually wrap. Slash menu / Turn-into doesn't reach
  // this path because the menu hides Quote when the cursor's inside a quote.
  if (
    target.kind === "wrap" &&
    target.nodeType === nodes.blockquote &&
    isAncestorActive(state, nodes.blockquote)
  ) {
    if (!opts.triggerRange) return null;
    return state.tr.delete(opts.triggerRange.from, opts.triggerRange.to);
  }

  const triggerChars = opts.triggerRange
    ? opts.triggerRange.to - opts.triggerRange.from
    : 0;

  // 1. Collapsible header dissolve.
  const collapsibleCtx = findCollapsibleHeaderContext(
    state,
    opts.triggerRange?.from,
  );
  if (collapsibleCtx) {
    const built = buildCollapsibleDissolve(
      collapsibleCtx,
      target,
      triggerChars,
    );
    if (!built) return null;
    const tr = state.tr.replaceWith(
      collapsibleCtx.collapsibleFrom,
      collapsibleCtx.collapsibleTo,
      built.children,
    );
    const first = built.children[0];
    if (first) {
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          caretInsideMiddle(collapsibleCtx.collapsibleFrom, first),
        ),
      );
    }
    return tr.scrollIntoView();
  }

  // 2. List item split.
  const listCtx = findListItemContext(state, opts.triggerRange?.from);
  if (listCtx) {
    const built = buildListSplit(listCtx, target, triggerChars);
    if (!built) return null;
    const tr = state.tr.replaceWith(
      listCtx.listFrom,
      listCtx.listTo,
      built.children,
    );
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        caretInsideMiddle(listCtx.listFrom + built.middleOffset, built.middle),
      ),
    );
    return tr.scrollIntoView();
  }

  // 3. Plain block — delete trigger first if the caller asked for it, then
  // perform the conversion against the post-deletion document.
  const tr = state.tr;
  if (opts.triggerRange) {
    tr.delete(opts.triggerRange.from, opts.triggerRange.to);
  }
  return buildPlainConversion(tr, state, target);
}

/**
 * Wrap {@link buildConvertTransaction} as a Command for the slash menu /
 * Turn-into menu / toolbar. Returns false (so chainCommands moves on) when
 * the conversion isn't possible from the current cursor.
 */
export function convertCurrentBlock(target: ConvertTarget): Command {
  return (state, dispatch) => {
    const tr = buildConvertTransaction(state, target, {});
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}
