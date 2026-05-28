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
 * Flat-schema design (Phase 2): a "list" is no longer a structural
 * `bullet_list → list_item → paragraph` triple. It's a single `list_row`
 * textblock carrying `listType` / `indent` / `checked` / `listStart` attrs.
 * Converting a paragraph into a bullet (or a bullet into a task, or a task
 * into a heading) is therefore a pure `setBlockType` — neighboring blocks
 * don't know or care, so we never need to split a list around the cursor.
 *
 * The pipeline dispatches on cursor context:
 *
 *   * In a collapsible's first child (the "header" line) — the conversion
 *     dissolves the collapsible. The new structure absorbs the converted
 *     header AND the body content together, so a toggle with two body
 *     paragraphs that becomes a bullet renders as one `list_row` followed by
 *     the original body siblings at the same level. Only collapsibles get
 *     this treatment; callouts and blockquotes keep their wrapper when their
 *     header converts.
 *
 *   * Otherwise — `setBlockType` (for list_row / heading / paragraph /
 *     code_block) or `findWrapping` (for blockquote / callout / collapsible)
 *     against the cursor's parent textblock. Indent attribute is carried
 *     across the conversion so "Tab Tab type `# `" stays at the same depth.
 *
 * Guards:
 *
 *   * Same-type / same-attrs no-op when target == source (e.g. `- ` in a
 *     bullet row). Returns null so the input rule leaves the trigger as
 *     literal text the user can keep typing.
 *
 *   * Blockquote nesting — `target = wrap(blockquote)` while the cursor is
 *     already inside a blockquote consumes the trigger (so `> ` doesn't sit
 *     visible as text) but otherwise does nothing. The slash menu hides the
 *     "Quote" option in the same state.
 */
export type ConvertTarget =
  | {
      kind: "list_row";
      listType: "bullet" | "ordered" | "task";
      attrs?: { checked?: boolean; listStart?: number | null };
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

interface CollapsibleHeaderContext {
  collapsibleNode: Node;
  collapsibleFrom: number;
  collapsibleTo: number;
  headerNode: Node;
}

/**
 * Walk up looking for a `collapsible` whose FIRST child contains the cursor —
 * the only case where conversion dissolves the toggle. Cursor in body content
 * or in a header that's been converted to a nested structure falls through,
 * so the default `setBlockType`/`findWrapping` path runs against just the
 * cursor's textblock.
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
 * Remove `chars` leading characters from a textblock — operating directly on
 * its inline content (cutting the Fragment along inline positions) so we
 * never produce a malformed text-node with a "ghost" 2-size child.
 */
function stripLeadingChars(node: Node, chars: number): Node {
  if (chars <= 0) return node;
  if (node.isTextblock) return node.copy(node.content.cut(chars));
  const first = node.firstChild;
  if (!first) return node;
  const trimmed = stripLeadingChars(first, chars);
  if (node.childCount === 1) return node.copy(Fragment.from(trimmed));
  const rest: Node[] = [];
  for (let i = 1; i < node.childCount; i++) rest.push(node.child(i));
  return node.copy(Fragment.fromArray([trimmed, ...rest]));
}

/** Step down the first-child chain of `middle` until the first textblock —
 *  the caret-friendly position after a structural replacement.  */
function caretInsideMiddle(middleStart: number, middle: Node): number {
  let pos = middleStart + 1;
  let n: Node = middle;
  while (n.firstChild && !n.isTextblock) {
    n = n.firstChild;
    pos += 1;
  }
  return pos;
}

/**
 * Build the resulting node for the converted header in the dissolve path.
 * For list_row: a fresh row carrying the header's inline content + target
 * listType/checked/indent. For setblock/wrap: same pattern as the plain
 * conversion below.
 */
function buildHeaderReplacement(
  headerInline: Fragment,
  target: ConvertTarget,
): Node | null {
  if (target.kind === "list_row") {
    return nodes.listRow.createAndFill(
      {
        listType: target.listType,
        checked: target.attrs?.checked ?? false,
        listStart: target.attrs?.listStart ?? null,
        indent: 0,
      },
      headerInline,
    );
  }
  if (target.kind === "setblock") {
    return target.nodeType.createAndFill(target.attrs ?? null, headerInline);
  }
  // wrap: wrap a fresh paragraph (carrying the header inline) in the target.
  const headerPara = nodes.paragraph.create(null, headerInline);
  return target.nodeType.createAndFill(target.attrs ?? null, [headerPara]);
}

/**
 * Dissolve a collapsible during a header conversion. The new structure
 * absorbs the trimmed header AND every body child together — so a toggle
 * with two body paragraphs converted into a bullet becomes one `list_row`
 * containing the (now-bullet) header text followed by the two original
 * paragraphs as flat siblings at the same level.
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

  const body: Node[] = [];
  for (let i = 1; i < ctx.collapsibleNode.childCount; i++) {
    body.push(ctx.collapsibleNode.child(i));
  }

  const newHeader = buildHeaderReplacement(headerInline, target);
  if (!newHeader) return null;
  return { children: [newHeader, ...body] };
}

/**
 * Plain-block conversion: replace the cursor's textblock with the target
 * shape via `setBlockType` (or wrap it with `findWrapping`). Preserves the
 * source block's `indent` attribute across the conversion when both the
 * source and the target carry one — `Tab Tab type `# `` lands a heading at
 * the same depth, not back at 0.
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
  const sourceIndent =
    typeof sourceBlock.attrs.indent === "number" ? sourceBlock.attrs.indent : 0;

  if (target.kind === "wrap") {
    const wrap = findWrapping(range, target.nodeType, target.attrs);
    if (!wrap) return null;
    tr.wrap(range, wrap);
    return tr.scrollIntoView();
  }

  if (target.kind === "list_row") {
    const attrs = {
      listType: target.listType,
      checked: target.attrs?.checked ?? false,
      listStart: target.attrs?.listStart ?? null,
      indent: sourceIndent,
    };
    tr.setBlockType(range.start, range.end, nodes.listRow, attrs);
    return tr.scrollIntoView();
  }

  // setblock — preserve the source's indent on the new textblock when its
  // schema carries an indent attr (paragraph / heading / code_block all do).
  const targetAttrSpec = target.nodeType.spec.attrs;
  const carriesIndent = targetAttrSpec ? "indent" in targetAttrSpec : false;
  const attrs = carriesIndent
    ? { ...(target.attrs ?? {}), indent: sourceIndent }
    : (target.attrs ?? null);
  tr.setBlockType(range.start, range.end, target.nodeType, attrs);
  return tr.scrollIntoView();
}

/**
 * Detect "the cursor is already in the same shape the user is asking for" so
 * `- ` in an existing bullet row, `# ` in an existing H1, etc., don't fire a
 * redundant transformation. Returns true when the conversion would be a
 * no-op; the caller leaves the trigger as literal text.
 */
function isNoopConversion(state: EditorState, target: ConvertTarget): boolean {
  const parent = state.selection.$from.parent;

  if (target.kind === "list_row") {
    if (parent.type !== nodes.listRow) return false;
    if (parent.attrs.listType !== target.listType) return false;
    if (target.listType === "task") {
      const want = target.attrs?.checked ?? false;
      if (Boolean(parent.attrs.checked) !== want) return false;
    }
    return true;
  }

  if (target.kind === "setblock") {
    if (parent.type !== target.nodeType) return false;
    if (!target.attrs) return true;
    for (const [k, v] of Object.entries(target.attrs)) {
      if (parent.attrs[k] !== v) return false;
    }
    return true;
  }

  return false;
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
  // Same-type no-op — input rule leaves the trigger as literal text.
  if (isNoopConversion(state, target)) {
    return null;
  }

  // Blockquote inside blockquote: consume the trigger so `> ` doesn't loiter
  // visibly, but don't actually wrap. Slash menu / Turn-into never reaches
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

  // 2. Plain block — delete trigger first if the caller asked for it, then
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
