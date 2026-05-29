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
 *   * {@link applyIndentRunDrop} — moves or reparents a captured run per a
 *     {@link DropInstruction}. Same-position indent-only edits go through a
 *     `setNodeMarkup` branch that never touches positions; cross-position
 *     drops use delete+insert with indents rewritten so the root lands at the
 *     chosen indent and children's relative depths are preserved.
 *
 * Both functions are pure: they don't read or write to a view, don't
 * dispatch, and don't mutate the source state. The pointer driver in
 * `block-handle.ts` translates cursor geometry into a `DropInstruction` and
 * dispatches the returned Transaction.
 *
 * The instruction model replaces the old `(targetPos, targetIndent)` tuple
 * for three reasons (see plans/i-want-paragraph-buzzing-quilt.md):
 *   1. "Same row, different indent" (reparent) is a first-class gesture
 *      instead of a guard-rejected edge case.
 *   2. The driver decides intent from geometry once, instead of the apply
 *      function reconstructing intent from a coordinate pair.
 *   3. The indicator can render per-instruction so the user reads intent
 *      directly (horizontal line vs. left-edge column bar).
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
 * A drop intent computed by the pointer driver. The apply function switches
 * on `kind` rather than reconstructing intent from a position+indent pair.
 *
 *   * `reorder-above` — insert the captured run immediately BEFORE the block
 *     at `siblingPos`, with the run's root landing at `indent`.
 *   * `reorder-below` — insert the run immediately AFTER the block at
 *     `siblingPos`, with the root at `indent`.
 *   * `make-child`    — insert the run immediately after `parentPos`, with
 *     the root at `parent.indent + 1` (clamped to MAX_INDENT). The user
 *     reads this as "become a child of the row above"; structurally it's a
 *     reorder-below at one extra indent.
 *   * `reparent`      — leave the run where it is; only update each block's
 *     `indent` attribute so the root lands at `indent`. This is the gesture
 *     that turns C (a child of B) into a sibling of B without moving C in
 *     document order.
 *
 * `siblingPos` / `parentPos` are positions *immediately before* the named
 * block (matching the convention {@link indentRunBounds} returns).
 */
export type DropInstruction =
  | {
      readonly kind: "reorder-above";
      readonly siblingPos: number;
      readonly indent: number;
    }
  | {
      readonly kind: "reorder-below";
      readonly siblingPos: number;
      readonly indent: number;
    }
  | { readonly kind: "make-child"; readonly parentPos: number }
  | { readonly kind: "reparent"; readonly indent: number };

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
 * Wrapper node types that DON'T visually render their `indent` attribute.
 * Their NodeViews build the DOM manually and ignore the schema's toDOM
 * indent emit, so a non-zero indent would be silently stored but never
 * shown — which mis-places the drag handle and confuses every other piece
 * of UI that reads indent. We clamp drops onto these to 0.
 *
 * Currently only `callout`. `collapsible` *does* render indent (see its
 * NodeView), so it's intentionally NOT in this set.
 */
const INDENT_IGNORING_WRAPPERS: ReadonlySet<string> = new Set(["callout"]);

/**
 * Compute the legal indent for `node` given a `requested` value. Most nodes
 * accept any `[0, MAX_INDENT]`; nodes in {@link INDENT_IGNORING_WRAPPERS}
 * always pin to 0 regardless of what the driver asked for.
 */
function legalIndent(node: Node, requested: number): number {
  if (INDENT_IGNORING_WRAPPERS.has(node.type.name)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, requested));
}

/**
 * Return a copy of `node` with its `indent` attr shifted by `shift`, clamped
 * to the node's legal range (see {@link legalIndent}). Returns `node`
 * unchanged when the shift is 0 or when the schema doesn't carry an indent
 * attr (so e.g. a `horizontal_rule` in the run stays unmolested).
 */
function shiftIndent(node: Node, shift: number): Node {
  if (!("indent" in node.attrs)) return node;
  const current = readIndent(node);
  const next = legalIndent(node, current + shift);
  if (next === current) return node;
  return node.type.create(
    { ...node.attrs, indent: next },
    node.content,
    node.marks,
  );
}

/**
 * Resolve `pos` (which must point immediately before a block child of some
 * container) into the block at that index. Returns null if `pos` doesn't
 * land on a child boundary.
 */
function blockAt(
  state: EditorState,
  pos: number,
): { node: Node; size: number; indent: number } | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  const child = $pos.parent.maybeChild($pos.index());
  if (!child) return null;
  return { node: child, size: child.nodeSize, indent: readIndent(child) };
}

/**
 * Walk the captured run and emit one `setNodeMarkup` per block whose indent
 * actually changes. Returns null when the new root indent equals the current
 * one (identity drop) or when the run has no blocks with indent attrs.
 *
 * Children of the run shift by the same delta as the root, clamped to
 * `[0, MAX_INDENT]`. Doing this preserves the *visual* relative shape of
 * the run while letting the user drag a child block (e.g. C in
 * A / B / C-indent-1 / D-indent-2) out to its own column.
 */
function reparentRun(
  state: EditorState,
  sourceStart: number,
  sourceEnd: number,
  newRootIndent: number,
): Transaction | null {
  if (sourceEnd <= sourceStart) return null;
  const $start = state.doc.resolve(sourceStart);
  const parent = $start.parent;
  const startIndex = $start.index();

  // Capture the root indent before we start emitting setNodeMarkup ops.
  const root = parent.maybeChild(startIndex);
  if (!root) return null;
  const rootIndent = readIndent(root);
  const shift = newRootIndent - rootIndent;
  if (shift === 0) return null;

  const tr = state.tr;
  let offset = sourceStart;
  let i = startIndex;
  while (offset < sourceEnd && i < parent.childCount) {
    const child = parent.child(i);
    if ("indent" in child.attrs) {
      const current = readIndent(child);
      const next = legalIndent(child, current + shift);
      if (next !== current) {
        tr.setNodeMarkup(offset, undefined, {
          ...child.attrs,
          indent: next,
        });
      }
    }
    offset += child.nodeSize;
    i++;
  }
  if (!tr.docChanged) return null;
  tr.setMeta("allowVerseEdit", true);
  return tr;
}

/**
 * Resolve a non-reparent instruction into the absolute target position the
 * delete+insert needs. Returns null when the instruction's anchor doesn't
 * point at a valid block boundary or when applying it would re-insert the
 * run into its own hole (the driver should never produce such an instruction;
 * we defensively reject it).
 */
function resolveMoveTarget(
  state: EditorState,
  instruction: Exclude<DropInstruction, { kind: "reparent" }>,
): { targetPos: number; targetIndent: number } | null {
  switch (instruction.kind) {
    case "reorder-above": {
      const block = blockAt(state, instruction.siblingPos);
      if (!block) return null;
      return {
        targetPos: instruction.siblingPos,
        targetIndent: clamp(instruction.indent, 0, MAX_INDENT),
      };
    }
    case "reorder-below": {
      const block = blockAt(state, instruction.siblingPos);
      if (!block) return null;
      return {
        targetPos: instruction.siblingPos + block.size,
        targetIndent: clamp(instruction.indent, 0, MAX_INDENT),
      };
    }
    case "make-child": {
      const parent = blockAt(state, instruction.parentPos);
      if (!parent) return null;
      return {
        targetPos: instruction.parentPos + parent.size,
        targetIndent: clamp(parent.indent + 1, 0, MAX_INDENT),
      };
    }
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Apply a {@link DropInstruction} against a captured run at
 * `[sourceStart, sourceEnd)`. Returns null when the instruction is a no-op,
 * targets inside the run, or fails a structural precondition.
 *
 * The returned Transaction is flagged `allowVerseEdit` so verse markers and
 * the notes-index pin guard let the move pass.
 */
export function applyIndentRunDrop(
  state: EditorState,
  sourceStart: number,
  sourceEnd: number,
  instruction: DropInstruction,
): Transaction | null {
  if (sourceEnd <= sourceStart) return null;

  if (instruction.kind === "reparent") {
    return reparentRun(
      state,
      sourceStart,
      sourceEnd,
      clamp(instruction.indent, 0, MAX_INDENT),
    );
  }

  const resolved = resolveMoveTarget(state, instruction);
  if (!resolved) return null;
  const { targetPos, targetIndent } = resolved;

  // No-op: dropping a run before/after itself in a way that produces the same
  // document. Boundary targets that equal sourceStart or sourceEnd map to the
  // existing layout; reject them so the dispatcher doesn't push an identity
  // transaction onto the history.
  if (targetPos === sourceStart || targetPos === sourceEnd) {
    // Special case: a same-position move whose indent differs from the
    // captured root is a reparent in disguise. Driver should have emitted
    // `reparent` instead — but rather than silently dropping it, run the
    // reparent path so the user's intent isn't lost.
    const root = blockAt(state, sourceStart);
    if (root && targetIndent !== root.indent) {
      return reparentRun(state, sourceStart, sourceEnd, targetIndent);
    }
    return null;
  }
  // Target strictly inside the source range would mean re-inserting into
  // the deletion's hole. Driver bug; refuse defensively.
  if (targetPos > sourceStart && targetPos < sourceEnd) return null;

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

/**
 * Legacy tuple-shaped entrypoint preserved for the e2e debug hook and the
 * keyboard-fallback callers that pre-date the instruction model. Translates
 * `(targetPos, targetIndent)` into the equivalent reorder instruction by
 * looking at the block immediately before / at `targetPos`.
 *
 * Prefer {@link applyIndentRunDrop} with an explicit instruction in new code.
 */
export function applyIndentRunDropAtPosition(
  state: EditorState,
  sourceStart: number,
  sourceEnd: number,
  targetPos: number,
  targetIndent: number,
): Transaction | null {
  // Translate a raw position into a reorder-above/below instruction. We pick
  // the block that the position *anchors* against — preferring the block
  // immediately AT targetPos (reorder-above) and falling back to the block
  // immediately BEFORE (reorder-below at its end).
  if (targetPos < 0 || targetPos > state.doc.content.size) return null;
  const at = blockAt(state, targetPos);
  if (at) {
    return applyIndentRunDrop(state, sourceStart, sourceEnd, {
      kind: "reorder-above",
      siblingPos: targetPos,
      indent: targetIndent,
    });
  }
  // targetPos is at the very end of a container; rewind to the previous block.
  const $pos = state.doc.resolve(targetPos);
  const parent = $pos.parent;
  const index = $pos.index();
  if (index === 0) return null;
  const prev = parent.child(index - 1);
  const prevStart = targetPos - prev.nodeSize;
  return applyIndentRunDrop(state, sourceStart, sourceEnd, {
    kind: "reorder-below",
    siblingPos: prevStart,
    indent: targetIndent,
  });
}
