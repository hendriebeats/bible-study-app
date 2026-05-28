import { Fragment, type Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

import { MAX_INDENT } from "./schema";

/**
 * Phase 4 hierarchical-drag pure transforms (no UI).
 *
 * Two stateless helpers used by the pointer-driven block drag:
 *
 *   * {@link indentRunBounds} — given a block position, returns the half-open
 *     `[start, end)` range that covers that block plus every immediately-
 *     following sibling at strictly greater indent. The "run" is the atomic
 *     unit a drag picks up so that grabbing a parent (e.g. a bullet at
 *     indent 0) also moves its indented children (e.g. bullets at indent 1).
 *
 *   * {@link applyIndentRunDrop} — moves a captured run to a new sibling
 *     position, rewriting each child's `indent` so the root lands at the
 *     dropped indent and the children's relative depths are preserved.
 *     Indents are clamped to `[0, MAX_INDENT]` per block.
 *
 * Both functions are pure: they don't read or write to a view, don't
 * dispatch, and don't mutate the source state. The pointer driver in
 * Phase 4c is responsible for converting pointer coordinates into
 * `(sourceStart, sourceEnd, targetPos, targetIndent)` and dispatching the
 * returned Transaction.
 */

/** Half-open range covering one indent run. */
export interface IndentRun {
  /** Position immediately before the root block (the drag's grab point). */
  start: number;
  /** Position immediately after the last block in the run. */
  end: number;
  /** The root block's `indent` attribute (default 0 for blocks without one). */
  rootIndent: number;
}

/**
 * Read the `indent` attribute off `node`. Returns 0 for blocks whose schema
 * doesn't carry one (paragraph-/heading-/list_row-/code_block-/wrapper-typed
 * nodes all do; tables, horizontal_rule, atoms, etc. do not).
 */
function readIndent(node: Node): number {
  const raw: unknown = node.attrs.indent;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Walk forward from `pos` (which must point immediately before a block child
 * of some container) collecting that block plus every following sibling at
 * strictly greater indent. Returns null if `pos` doesn't resolve to a block
 * child of any container.
 */
export function indentRunBounds(
  state: EditorState,
  pos: number,
): IndentRun | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const rootChild = parent.maybeChild(index);
  if (!rootChild) return null;

  const rootIndent = readIndent(rootChild);
  let end = pos + rootChild.nodeSize;
  for (let i = index + 1; i < parent.childCount; i++) {
    const sibling = parent.child(i);
    if (readIndent(sibling) <= rootIndent) break;
    end += sibling.nodeSize;
  }
  return { start: pos, end, rootIndent };
}

/**
 * Return a copy of `node` with its `indent` attr shifted by `shift`, clamped
 * to `[0, MAX_INDENT]`. Returns `node` unchanged when the shift is 0 or when
 * the schema doesn't carry an indent attr (so e.g. a `horizontal_rule` in
 * the run stays unmolested).
 */
function shiftIndent(node: Node, shift: number): Node {
  if (shift === 0) return node;
  if (!("indent" in node.attrs)) return node;
  const current = readIndent(node);
  const next = Math.min(MAX_INDENT, Math.max(0, current + shift));
  if (next === current) return node;
  return node.type.create(
    { ...node.attrs, indent: next },
    node.content,
    node.marks,
  );
}

/**
 * Move the indent run at `[sourceStart, sourceEnd)` to `targetPos`, with the
 * root block landing at `targetIndent`. Every child in the run is rewritten
 * with `newIndent = targetIndent + (child.indent - rootIndent)`, clamped.
 *
 * Returns null if:
 *   * The source range is empty (`sourceEnd <= sourceStart`).
 *   * The target sits INSIDE the source (would re-insert into a hole).
 *   * The source range doesn't decode into whole sibling blocks of one
 *     container (defensive — shouldn't happen when called from
 *     {@link indentRunBounds}'s output).
 *
 * The returned Transaction is flagged `allowVerseEdit` so verse markers and
 * the notes-index pin guard let the move pass.
 */
export function applyIndentRunDrop(
  state: EditorState,
  sourceStart: number,
  sourceEnd: number,
  targetPos: number,
  targetIndent: number,
): Transaction | null {
  if (sourceEnd <= sourceStart) return null;
  if (targetPos >= sourceStart && targetPos <= sourceEnd) return null;

  const $start = state.doc.resolve(sourceStart);
  const parent = $start.parent;
  const startIndex = $start.index();

  const blocks: Node[] = [];
  let offset = sourceStart;
  let i = startIndex;
  while (offset < sourceEnd && i < parent.childCount) {
    const child = parent.child(i);
    blocks.push(child);
    offset += child.nodeSize;
    i++;
  }
  if (blocks.length === 0) return null;
  if (offset !== sourceEnd) return null; // didn't land on a clean child boundary

  const root = blocks[0];
  if (!root) return null;
  const rootIndent = readIndent(root);
  const shift = targetIndent - rootIndent;
  const rewritten = blocks.map((b) => shiftIndent(b, shift));

  const tr = state.tr.delete(sourceStart, sourceEnd);
  // After the deletion the target shifts left by the deleted size whenever
  // it was past the source. Targets before the source stay put.
  const removed = sourceEnd - sourceStart;
  const insertAt = targetPos >= sourceEnd ? targetPos - removed : targetPos;
  tr.insert(insertAt, Fragment.fromArray(rewritten));
  tr.setMeta("allowVerseEdit", true);
  return tr;
}
