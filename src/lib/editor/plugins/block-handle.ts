import type { Node, NodeType, ResolvedPos } from "prosemirror-model";
import { type EditorState, Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import {
  applyIndentRunDrop,
  type DropInstruction,
  indentRunBounds,
  normalizeInstruction,
} from "../indent-run";
import { MAX_INDENT, nodes } from "../schema";
import { isChromeChild } from "../wrapper-chrome";
import {
  endBlockDrag,
  findHostElement,
  startBlockDrag,
  updateBlockDragTarget,
} from "./block-drag";

/** Window event the handle fires (with `{ x, y }`) to open the React block menu. */
export const BLOCK_MENU_EVENT = "pm-block-menu";

export interface BlockMenuEventDetail {
  x: number;
  y: number;
}

/**
 * Node types whose CHILDREN are independently draggable — the handle appears
 * next to each child, and pointer-reorder shuffles them within the container.
 *
 * `collapsible` and `callout` are both included so each block inside the
 * wrapper has its own handle and drops land naturally inside the body. The
 * wrapper itself stays drag-targetable: the column-ownership rule in
 * {@link rowUnderCursor} gives the OUTER column (left of the contentDOM,
 * around the chevron / variant header) to the wrapper, and the INNER column
 * (inside the body's gutter) to the inner block. Matches the Notion / Craft
 * pattern for nested gutters.
 *
 * For collapsibles only, {@link draggableCandidatesAt} skips the FIRST child
 * — it's the toggle's header (its "name"), part of the chrome, not a body
 * block. Callouts have no equivalent first-child chrome: their variant
 * header is rendered by the NodeView OUTSIDE `contentDOM`, so every
 * `callout` child is body.
 *
 * `blockquote` stays atomic — no inner handles.
 *
 * `note_entry` is intentionally absent so the handle next to a paragraph
 * *inside* a note attaches to the WHOLE note (reordering notes within the
 * notes_index) rather than to that paragraph.
 */
const DRAG_CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  nodes.doc,
  nodes.studyBlock,
  nodes.notesIndex,
  nodes.collapsible,
  nodes.callout,
]);

/** Pixels the pointer must travel before a press becomes a drag (vs. a click). */
const DRAG_THRESHOLD = 4;
/** Indent step in pixels — matches schema.ts `INDENT_STEP_REM = 1.75` at 16px root font. */
const INDENT_STEP_PX = 28;
/**
 * Pixel width of a draggable block's "left gutter column" — the band
 * immediately to the LEFT of the row's content where the drag handle sits.
 * When the cursor is in this column, the handle attaches to this row; when
 * the cursor is right of `rect.right`, no column claim applies and the
 * outermost candidate wins (cursor is past the block's content area).
 */
const GUTTER_WIDTH = INDENT_STEP_PX;

/** Read the indent attr off a node, defaulting to 0 if absent or invalid. */
function readBlockIndent(node: Node): number {
  const raw: unknown = node.attrs.indent;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Walk `$pos` outward looking for the deepest block whose PARENT is one of the
 * drag-container types. That block is the draggable unit at this position:
 *
 *   - In doc → returns the top-level block.
 *   - Inside a `study_block` body → returns the cursor's paragraph/list_row.
 *   - Inside a `note_entry` body → same.
 *   - Inside a `notes_index` → returns the cursor's `note_entry`.
 *   - Inside a `callout` / `blockquote` / `collapsible` body → walks PAST the
 *     wrapper and returns the wrapper itself (because the wrapper's parent is
 *     a drag-container — usually doc or a study_block).
 *
 * Returns null when no ancestor up to the doc is a drag container — e.g. a
 * cursor inside a `table_cell` (table is the atomic unit; cells don't get
 * individual handles).
 */
/**
 * Collect EVERY draggable ancestor at `$pos` — from deepest to shallowest.
 * Used by the column-ownership rule when nested draggable containers (e.g.
 * a collapsible inside the doc) put multiple candidates under the same
 * cursor Y. Returns an empty array when no ancestor up to the doc is a
 * drag container.
 *
 * Special-case: the FIRST child of a `collapsible` is the toggle's header
 * (its "name") — visually it sits next to the chevron and is conceptually
 * part of the collapsible's chrome, not a draggable body block. Skipping it
 * means the hover handle attaches to the collapsible itself when the cursor
 * is over the header row, leaving the chevron clickable. Body children
 * (index ≥ 1) keep their individual handles.
 */
function draggableCandidatesAt(
  $pos: ResolvedPos,
): { node: Node; pos: number; depth: number }[] {
  const out: { node: Node; pos: number; depth: number }[] = [];
  for (let d = $pos.depth; d > 0; d--) {
    const parent = $pos.node(d - 1);
    if (DRAG_CONTAINER_TYPES.has(parent.type)) {
      // Skip the wrapper's chrome child (collapsible header, callout title).
      // The cursor over the chrome falls through to the wrapper itself, so
      // hovering it surfaces the OUTER wrapper handle, not a separate inner
      // handle that would render over the chevron / chip and block clicks.
      if (isChromeChild(parent, $pos.index(d - 1))) continue;
      // Top-level `study_block` and `notes_index` are managed exclusively
      // through the blocks dialog (`study-blocks-dialog.tsx`), which drives
      // its own React `useReorderHandle` — no ProseMirror drag is involved
      // there. Skipping them here is the single source of truth that both
      // (a) hides the floating handle next to top-level blocks and
      // (b) prevents `rowUnderCursor` from nominating them as drop targets
      // for an in-body drag, so a paragraph dragged out of a body has no
      // legal top-level landing zone. Nested children inside a study_block
      // body still resolve normally — their parent is `study_block`, which
      // remains a drag container, so inner reorder is unaffected.
      const node = $pos.node(d);
      if (
        parent.type === nodes.doc &&
        (node.type === nodes.studyBlock || node.type === nodes.notesIndex)
      ) {
        continue;
      }
      out.push({ node, pos: $pos.before(d), depth: d });
    }
  }
  return out;
}

/**
 * For a doc position `dropPos` (immediately BEFORE some block in a container),
 * find the indent of the closest sibling above it that ISN'T part of the
 * source range being moved. The drop's indent picker is clamped to
 * `[0, above+1]` so the user can only land the dropped run at a depth that
 * makes structural sense beside its surrounding blocks.
 *
 * Returns -1 when there is no above-neighbor outside the source range — i.e.
 * the drop is at the very top of its container, where only indent 0 is valid.
 */
function aboveNeighborIndent(
  state: EditorState,
  dropPos: number,
  sourceStart: number,
  sourceEnd: number,
): number {
  if (dropPos <= 0) return -1;
  const $pos = state.doc.resolve(dropPos);
  const parent = $pos.parent;
  const indexInParent = $pos.index();
  let lastValidIndent = -1;
  let walk = $pos.start();
  for (let i = 0; i < indexInParent; i++) {
    const child = parent.child(i);
    const childStart = walk;
    const childEnd = walk + child.nodeSize;
    walk = childEnd;
    if (childStart >= sourceStart && childEnd <= sourceEnd) continue;
    // Skip the wrapper's chrome child (collapsible header, callout title)
    // so a drop at the first body position (e.g. index 1 of a collapsible)
    // doesn't inherit the chrome's indent as its above-neighbor — keeping
    // first-body drops hard-clamped to indent 0.
    if (isChromeChild(parent, i)) continue;
    lastValidIndent = readBlockIndent(child);
  }
  return lastValidIndent;
}

interface RowHit {
  node: Node;
  pos: number;
  depth: number;
  rect: DOMRect;
  /** Y at which this row's vertical ownership begins (midpoint of gap above). */
  claimTop: number;
  /** Y at which this row's vertical ownership ends (midpoint of gap below). */
  claimBottom: number;
}

/**
 * For a draggable block at `blockPos` in a known container, look up the
 * bounding-rect bottom of its immediate previous sibling and the top of its
 * immediate next sibling (same container). Returns null for missing siblings
 * (document boundary, or sibling DOM not laid out yet).
 */
function siblingEdges(
  view: EditorView,
  blockPos: number,
): { prevBottom: number | null; nextTop: number | null } {
  const $pos = view.state.doc.resolve(blockPos);
  const parent = $pos.parent;
  const index = $pos.index();
  let prevBottom: number | null = null;
  let nextTop: number | null = null;
  if (index > 0) {
    const prev = parent.child(index - 1);
    const prevPos = blockPos - prev.nodeSize;
    const prevDom = view.nodeDOM(prevPos);
    if (prevDom instanceof HTMLElement) {
      prevBottom = prevDom.getBoundingClientRect().bottom;
    }
  }
  if (index < parent.childCount - 1) {
    const here = parent.child(index);
    const nextPos = blockPos + here.nodeSize;
    const nextDom = view.nodeDOM(nextPos);
    if (nextDom instanceof HTMLElement) {
      nextTop = nextDom.getBoundingClientRect().top;
    }
  }
  return { prevBottom, nextTop };
}

/**
 * Locate the draggable block whose vertical claim zone contains the pointer Y.
 *
 * The naive `posAtCoords({left: event.clientX, top: event.clientY})` call
 * loses the correct row whenever the cursor sits left of an indented row's
 * content box, or in the margin-block gap between two rows. We dodge both
 * with two compounding techniques:
 *
 *   1. **Multi-X probe.** Try several X values (right-side first, since
 *      rows extend to the editor's right edge regardless of indent), so
 *      indented rows resolve even when the cursor is far left.
 *   2. **Asymmetric claim-zone Y acceptance.**
 *      * Non-source rows: claim extends through the gaps with their
 *        neighbors (from midpoint of gap-above to midpoint of gap-below).
 *      * Source rows (the run being dragged): claim is the rect only.
 *      The asymmetry exists so the gap between the source row and a
 *      non-source neighbor belongs unambiguously to the non-source row.
 *      If we widened the source's claim too, both adjacent rows would
 *      compete for the seam Y and a probe that resolved to the source
 *      would return reparent-at-rootIndent → no-op → indicator vanishes
 *      for the 1-px seam → "dead pixel between nodes" UX bug.
 *
 * If no candidate's claim contains Y, we fall back to picking the row
 * whose edge is *closest* to the cursor Y. This catches the rare case
 * where the cursor is genuinely outside any block's claim (well above
 * the first row, well below the last) but still inside the editor.
 */
/**
 * Build a {@link RowHit} for a single draggable block, computing its Y
 * claim-zone (asymmetric — source rows claim only their rect; non-source
 * widen through gaps with neighbors).
 */
function buildRowHit(
  view: EditorView,
  draggable: { node: Node; pos: number; depth: number },
  sourceStart: number,
  sourceEnd: number,
): RowHit | null {
  const dom = view.nodeDOM(draggable.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  const blockEnd = draggable.pos + draggable.node.nodeSize;
  const isSource = draggable.pos >= sourceStart && blockEnd <= sourceEnd;
  let claimTop: number;
  let claimBottom: number;
  if (isSource) {
    claimTop = rect.top;
    claimBottom = rect.bottom;
  } else {
    const { prevBottom, nextTop } = siblingEdges(view, draggable.pos);
    claimTop = prevBottom !== null ? (prevBottom + rect.top) / 2 : -Infinity;
    claimBottom = nextTop !== null ? (rect.bottom + nextTop) / 2 : Infinity;
  }
  return { ...draggable, rect, claimTop, claimBottom };
}

function rowUnderCursor(
  view: EditorView,
  event: { clientX: number; clientY: number },
  sourceStart: number,
  sourceEnd: number,
): RowHit | null {
  const editorRect = view.dom.getBoundingClientRect();
  const probes = [
    editorRect.right - 4,
    editorRect.right - 24,
    editorRect.left + editorRect.width * 0.66,
    editorRect.left + editorRect.width * 0.33,
    Math.min(
      Math.max(event.clientX, editorRect.left + 5),
      editorRect.right - 5,
    ),
  ];
  const candidates: RowHit[] = [];
  const seen = new Set<number>();
  for (const lookupX of probes) {
    if (lookupX < editorRect.left || lookupX > editorRect.right) continue;
    let found = view.posAtCoords({ left: lookupX, top: event.clientY });
    // posAtCoords returns null when Y lands in the whitespace between two
    // block elements (the browser can't seat a caret there). Sweep Y in
    // small steps until we land on one side of the gap; we still evaluate
    // the resulting row's claim zone against the ORIGINAL Y so claim
    // semantics stay honest.
    if (!found) {
      for (let dy = 1; dy <= 16 && !found; dy++) {
        found =
          view.posAtCoords({ left: lookupX, top: event.clientY - dy }) ??
          view.posAtCoords({ left: lookupX, top: event.clientY + dy });
      }
    }
    if (!found) continue;
    let $pos = view.state.doc.resolve(found.pos);
    let chain = draggableCandidatesAt($pos);
    // posAtCoords can return a position right BETWEEN two doc children when
    // the cursor sits in the vertical gap separating them. That position
    // resolves at depth 0 (doc level) and the chain is empty. Step forward
    // one position so we land inside the block AFTER the gap; if that
    // fails, step backward into the block before.
    if (chain.length === 0 && found.pos < view.state.doc.content.size) {
      $pos = view.state.doc.resolve(found.pos + 1);
      chain = draggableCandidatesAt($pos);
    }
    if (chain.length === 0 && found.pos > 0) {
      $pos = view.state.doc.resolve(found.pos - 1);
      chain = draggableCandidatesAt($pos);
    }
    for (const cand of chain) {
      if (seen.has(cand.pos)) continue;
      seen.add(cand.pos);
      const hit = buildRowHit(view, cand, sourceStart, sourceEnd);
      if (hit) candidates.push(hit);
    }
  }
  if (candidates.length === 0) return null;

  // Among candidates whose Y claim contains the cursor, apply column
  // ownership: each draggable owns the horizontal column
  // `[rect.left - GUTTER_WIDTH, rect.right]`. Prefer the DEEPEST candidate
  // (innermost nesting) whose column contains cursor X. Non-source rows
  // always beat source rows at the same depth so a drag-source seam still
  // hands the indicator off to the non-source neighbor.
  const inClaimY = candidates.filter(
    (c) => event.clientY >= c.claimTop && event.clientY <= c.claimBottom,
  );
  if (inClaimY.length > 0) {
    const pickFromY = pickByColumn(
      inClaimY,
      event.clientX,
      sourceStart,
      sourceEnd,
    );
    if (pickFromY) return pickFromY;
  }

  // No candidate's Y claim contained the cursor — fall back to closest by
  // vertical-edge distance (cursor above first row, below last, or in a
  // gap none widened into). Still prefer non-source on ties.
  return pickByYDistance(candidates, event.clientY, sourceStart, sourceEnd);
}

function isSourceHit(
  hit: RowHit,
  sourceStart: number,
  sourceEnd: number,
): boolean {
  return hit.pos >= sourceStart && hit.pos + hit.node.nodeSize <= sourceEnd;
}

/**
 * Among a set of Y-matching candidates, pick the one whose horizontal
 * column claims cursor X. Walk DEEPEST-first so a nested inner block beats
 * its outer container (Notion-style: cursor in inner gutter selects inner).
 * Non-source candidates beat source ones at any depth.
 */
function pickByColumn(
  candidates: RowHit[],
  clientX: number,
  sourceStart: number,
  sourceEnd: number,
): RowHit | null {
  const byDepthDesc = [...candidates].sort((a, b) => b.depth - a.depth);
  const claimsX = (c: RowHit): boolean =>
    clientX >= c.rect.left - GUTTER_WIDTH && clientX <= c.rect.right;
  // First pass: deepest non-source whose column claims X.
  for (const c of byDepthDesc) {
    if (isSourceHit(c, sourceStart, sourceEnd)) continue;
    if (claimsX(c)) return c;
  }
  // Second pass: deepest source whose column claims X.
  for (const c of byDepthDesc) {
    if (!isSourceHit(c, sourceStart, sourceEnd)) continue;
    if (claimsX(c)) return c;
  }
  // No column match — fall back to the SHALLOWEST non-source candidate
  // (outermost container), or shallowest source if none.
  const byDepthAsc = [...candidates].sort((a, b) => a.depth - b.depth);
  for (const c of byDepthAsc) {
    if (!isSourceHit(c, sourceStart, sourceEnd)) return c;
  }
  return byDepthAsc[0] ?? null;
}

function pickByYDistance(
  candidates: RowHit[],
  clientY: number,
  sourceStart: number,
  sourceEnd: number,
): RowHit | null {
  let best: RowHit | null = null;
  let bestDist = Infinity;
  let bestIsSource = true;
  for (const c of candidates) {
    const d = Math.min(
      Math.abs(clientY - c.rect.top),
      Math.abs(clientY - c.rect.bottom),
    );
    const cIsSource = isSourceHit(c, sourceStart, sourceEnd);
    const better =
      d < bestDist || (d === bestDist && bestIsSource && !cIsSource);
    if (better) {
      bestDist = d;
      best = c;
      bestIsSource = cIsSource;
    }
  }
  return best;
}

/**
 * Translate cursor geometry into a {@link DropInstruction} describing the
 * gesture the user is making. Returns null when the pointer isn't over a
 * valid target (off-editor, over an empty area not covered by any block).
 *
 * Gestures (matching plans/i-want-paragraph-buzzing-quilt.md):
 *
 *   * Over a row that's NOT part of the captured run:
 *     - Upper half of the row → `reorder-above` at the cursor's indent column.
 *     - Lower half AND cursor X is at the row's indent or shallower →
 *       `reorder-below` at the cursor's indent column.
 *     - Lower half AND cursor X is one indent step (or more) past the row's
 *       own indent → `make-child` (the row becomes the run's new parent).
 *   * Over a row that IS in the captured run → `reparent` at the cursor's
 *     indent column. This is the "drag C onto its own slot, but at B's
 *     indent" gesture that the old `(pos, indent)` model couldn't express.
 *
 * Cursor X → indent column math: `round((cursorX - contentLeft) / step)`,
 * then clamped to `[0, aboveNeighbor.indent + 1]` so the resulting indent
 * is always a structurally legal sibling depth.
 */
export function computeDropInstruction(
  view: EditorView,
  event: PointerEvent,
  sourceStart: number,
  sourceEnd: number,
  // `rootIndent` was used by the old no-op filter (since dropped — see
  // `normalizeInstruction`); the source's current indent is now read off
  // the doc inside `applyIndentRunDrop` when it needs it. The parameter
  // stays in the signature so external callers (debug hook,
  // `attachIndentRunDrag`) don't have to thread a new shape — a future
  // gesture might want it back as the "this is the indent the drag
  // *started* at" hint.
  _rootIndent: number,
): DropInstruction | null {
  const row = rowUnderCursor(view, event, sourceStart, sourceEnd);
  if (!row) return null;

  // Confine drops to the source's `.pm-block-host` container — body items
  // dragged out of a study_block (or callout / collapsible / notes_index)
  // cannot land in another container, including the doc root. Identity
  // compare on the host element is the cheapest "same body?" check; two
  // distinct host containers are always distinct DOM nodes. When the source
  // has no host (top-level — only reachable historically; the candidate
  // filter in `draggableCandidatesAt` now blocks new top-level grabs), the
  // check is skipped so legacy / programmatic paths keep working.
  const sourceHost = findHostElement(view, sourceStart);
  if (sourceHost !== null) {
    const targetHost = findHostElement(view, row.pos);
    if (targetHost !== sourceHost) return null;
  }

  const blockStart = row.pos;
  const blockEnd = row.pos + row.node.nodeSize;
  const blockIndent = readBlockIndent(row.node);

  // Container-relative indent: the row's rect.left already reflects its own
  // indent within its container (`container.contentLeft + row.indent * step`).
  // Subtract `blockIndent * step` to recover the container's content-left, so
  // cursor X is measured RELATIVE TO the immediate container the drop will
  // land in. For top-level rows this collapses to `editorRect.left`; for
  // rows inside a collapsible / study_block it correctly anchors indent 0 to
  // the container's own content edge (rather than the editor's outer edge).
  // Without this, a drop inside a toggle inherits an extra indent step from
  // the wrapper's chevron offset.
  const containerLeft = row.rect.left - blockIndent * INDENT_STEP_PX;
  // `Math.floor` (not round) so the cursor's "indent N zone" is exactly
  // [containerLeft + N*step, containerLeft + (N+1)*step) — the cursor must
  // move a FULL step past the content edge to flip to the next indent.
  // This aligns the threshold with where the indicator line at indent N
  // renders (its left edge sits at `contentLeft + N*step`); under round,
  // the flip happened at the half-step midpoint and the line visually
  // jumped a half-step early.
  const rawIndent = Math.floor(
    (event.clientX - containerLeft) / INDENT_STEP_PX,
  );

  const isSourceRow = blockStart >= sourceStart && blockEnd <= sourceEnd;

  // Translate cursor geometry into a candidate instruction. The no-op filter
  // at the bottom of this function decides whether that instruction is worth
  // showing — we never short-circuit on "same indent" / "next sibling is
  // source" up here. Those used to be ad-hoc guards (each born from a
  // different seam bug) and they're what put the indicator in the wrong gap
  // when a structural redirect carried the paint anchor across the source.
  let candidate: DropInstruction;

  if (isSourceRow) {
    // Cursor is over the run itself — the only legal gesture is to change
    // the run's indent in place. Clamp against the source's above-neighbor
    // so the resulting indent is still a valid sibling depth.
    const above = aboveNeighborIndent(
      view.state,
      sourceStart,
      sourceStart,
      sourceEnd,
    );
    const maxIndent = Math.min(MAX_INDENT, above + 1);
    const indent = Math.min(maxIndent, Math.max(0, rawIndent));
    candidate = { kind: "reparent", indent };
  } else {
    // Use the claim-zone midpoint (which collapses into the rect midpoint
    // when there are no gaps) so Y values in a margin gap above the row read
    // as "upper half" — i.e. dropAbove — rather than flipping at the rect's
    // top.
    const claimTop = Number.isFinite(row.claimTop)
      ? row.claimTop
      : row.rect.top;
    const claimBottom = Number.isFinite(row.claimBottom)
      ? row.claimBottom
      : row.rect.bottom;
    const dropAbove = event.clientY < (claimTop + claimBottom) / 2;

    if (dropAbove) {
      const above = aboveNeighborIndent(
        view.state,
        blockStart,
        sourceStart,
        sourceEnd,
      );
      const maxIndent = Math.min(MAX_INDENT, above + 1);
      const indent = Math.min(maxIndent, Math.max(0, rawIndent));
      candidate = { kind: "reorder-above", siblingPos: blockStart, indent };
    } else {
      // Lower half — `row` is the above-neighbor of the insertion point.
      const maxIndent = Math.min(MAX_INDENT, blockIndent + 1);
      const indent = Math.min(maxIndent, Math.max(0, rawIndent));
      if (indent > blockIndent) {
        // Cursor pushed past the row's own indent column — that's the
        // "make me your child" gesture. Distinct instruction so the
        // indicator can render it distinctly even though the structural
        // outcome equals `reorder-below` at `blockIndent + 1`.
        candidate = { kind: "make-child", parentPos: blockStart };
      } else {
        // Anchor to the row directly under the cursor's lower half. We do
        // NOT redirect to the next non-source sibling — the indicator
        // painter reads the LITERAL next sibling for its gap-midpoint Y, so
        // anchoring here paints the line in the gap the cursor is actually
        // in. When that next sibling IS the source, the gap reduces to a
        // no-op (caught by the filter below) and the indicator hides.
        candidate = { kind: "reorder-below", siblingPos: blockStart, indent };
      }
    }
  }

  // Canonicalize: any candidate whose structural target lands at the
  // source's own boundary (R.lower → reorder-below R where R.end === src,
  // X.upper → reorder-above X where X.start === srcEnd, V1.lower at indent
  // R.indent+1 → make-child R where R.end === src) is *structurally* a
  // reparent of the run in place — `applyIndentRunDrop` already collapses
  // them. Collapsing here too means the indicator painter (which keys on
  // instruction kind) sees one canonical `reparent` for the whole seam
  // region around the source, so the drop line stays anchored to the
  // source row instead of jumping between R.bottom..src.top and
  // src.bottom..X.top as the cursor crosses the seam.
  //
  // No-ops (reparent at the source's own root indent) are intentionally
  // NOT filtered out — the indicator should still paint at the source row
  // so the user has a continuous, predictable visual whether or not their
  // cursor position would actually change the document. `applyIndentRunDrop`
  // already returns null for those, so pointerup won't push an identity
  // transaction onto history.
  return normalizeInstruction(view.state, sourceStart, sourceEnd, candidate);
}

/**
 * Wire pointer events on the block handle so a press → drag → release fires
 * a hierarchical drop via {@link applyIndentRunDrop}. Returns a teardown
 * function. Replaces the old depth-1 `attachReorderHandle` for the editor.
 */
function attachIndentRunDrag(
  handle: HTMLElement,
  view: EditorView,
  getCurrentPos: () => number | null,
): () => void {
  let armed = false;
  let dragging = false;
  let runStart = -1;
  let runEnd = -1;
  let rootIndent = 0;
  let startX = 0;
  let startY = 0;

  const reset = (): void => {
    armed = false;
    dragging = false;
    runStart = -1;
    runEnd = -1;
    rootIndent = 0;
  };

  const teardown = (): void => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("keydown", onEscape, true);
    document.body.classList.remove("reorder-active", "pm-dragging");
  };

  const suppressNextClick = (): void => {
    const suppressor = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    handle.addEventListener("click", suppressor, { capture: true, once: true });
    window.setTimeout(() => {
      handle.removeEventListener("click", suppressor, { capture: true });
    }, 0);
  };

  function onPointerMove(event: PointerEvent): void {
    if (!armed) return;
    if (!dragging) {
      if (
        Math.hypot(event.clientX - startX, event.clientY - startY) <
        DRAG_THRESHOLD
      ) {
        return;
      }
      dragging = true;
      document.body.classList.add("reorder-active", "pm-dragging");
      startBlockDrag(view, runStart, runEnd, rootIndent);
    }
    event.preventDefault();
    const instruction = computeDropInstruction(
      view,
      event,
      runStart,
      runEnd,
      rootIndent,
    );
    updateBlockDragTarget(view, instruction);
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDragging = dragging;
    const sourceStart = runStart;
    const sourceEnd = runEnd;
    const sourceRootIndent = rootIndent;
    teardown();
    if (wasDragging) {
      suppressNextClick();
      const instruction = computeDropInstruction(
        view,
        event,
        sourceStart,
        sourceEnd,
        sourceRootIndent,
      );
      endBlockDrag(view);
      if (instruction) {
        const tr = applyIndentRunDrop(
          view.state,
          sourceStart,
          sourceEnd,
          instruction,
        );
        // Dispatch WITHOUT `scrollIntoView()`. The user drove the drop from
        // a specific visual position — their viewport already contains the
        // drop site. After delete+insert, the selection lands inside the
        // moved run, which may be far from the cursor's release point;
        // letting ProseMirror chase it yanks the viewport (commonly 60+ px,
        // sometimes a full page) for no UX benefit. The keyboard fallback
        // below still calls `scrollIntoView` because the user is operating
        // blind there — Arrow-reordering a row off-screen should keep it
        // visible. Pointer drops have their own visual locus already.
        if (tr) view.dispatch(tr);
      }
    }
    reset();
  }

  function onPointerCancel(): void {
    teardown();
    endBlockDrag(view);
    reset();
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onPointerCancel();
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const pos = getCurrentPos();
    if (pos === null) return;
    const run = indentRunBounds(view.state, pos);
    if (!run) return;
    runStart = run.start;
    runEnd = run.end;
    rootIndent = run.rootIndent;
    armed = true;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("keydown", onEscape, true);
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Keyboard fallback: ArrowUp / ArrowDown reorder the cursor's block among
    // its siblings WITHOUT changing its indent. Useful for the same handle as
    // a no-pointer alternative; matches the legacy attachReorderHandle keyboard
    // behaviour. (Indent changes still go through Tab / Shift-Tab in the
    // editor itself.)
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const pos = getCurrentPos();
    if (pos === null) return;
    const run = indentRunBounds(view.state, pos);
    if (!run) return;
    const $pos = view.state.doc.resolve(pos);
    const parent = $pos.parent;
    const index = $pos.index();
    const target = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (target < 0 || target >= parent.childCount) return;
    event.preventDefault();
    event.stopPropagation();
    // Resolve the position of the target sibling and emit a reorder
    // instruction against it. Indent stays at run.rootIndent.
    let walk = $pos.start();
    for (let i = 0; i < parent.childCount; i++) {
      if (i === target) break;
      walk += parent.child(i).nodeSize;
    }
    const instruction: DropInstruction =
      target < index
        ? {
            kind: "reorder-above",
            siblingPos: walk,
            indent: run.rootIndent,
          }
        : {
            kind: "reorder-below",
            siblingPos: walk,
            indent: run.rootIndent,
          };
    const tr = applyIndentRunDrop(view.state, run.start, run.end, instruction);
    if (tr) view.dispatch(tr.scrollIntoView());
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("keydown", onKeyDown);
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("keydown", onKeyDown);
    teardown();
  };
}

/**
 * A hover "block options" handle in the left gutter of each draggable block.
 * Implemented as a single floating button positioned imperatively on mousemove
 * (robust across block types, unlike a per-block widget). Clicking it puts the
 * caret in that block and fires {@link BLOCK_MENU_EVENT}; the React `BlockMenu`
 * opens at that point (Turn into / Move up / Move down / Delete). Editable
 * editors only — added to the owner editor's plugins.
 *
 * Phase 4a: the handle now resolves the deepest draggable block via
 * {@link draggableAt}, so it surfaces next to paragraphs/list_rows INSIDE
 * study_blocks and note_entries — not just top-level blocks. Wrappers
 * (callout/blockquote/collapsible) still surface a handle on the wrapper
 * itself; their children don't get their own. Drag-reorder is scoped to the
 * draggable block's actual container.
 */
export function blockHandle(): Plugin {
  return new Plugin({
    view(view) {
      const wrapper = view.dom.parentElement;
      if (wrapper) {
        wrapper.style.position = "relative";
      }

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle block-handle";
      handle.setAttribute("aria-label", "Block options");
      handle.title = "Drag to reorder · click for options";
      handle.contentEditable = "false";
      // 2×3 grid of filled dots, matched to the React handle in
      // src/components/ui/drag-handle.tsx so all sites render the same glyph.
      // Final size is set by `.drag-handle > svg` in globals.css.
      handle.innerHTML =
        '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="13" r="1.3"/><circle cx="10" cy="13" r="1.3"/></svg>';
      handle.style.display = "none";

      let currentPos: number | null = null;

      // Hide on a short delay, not instantly: the handle sits in the negative-
      // left gutter OUTSIDE the wrapper, so moving the pointer off the text and
      // across the gap to reach it fires the wrapper's mouseleave mid-travel.
      // The delay (plus the handle's own mouseenter cancelling it) lets the
      // pointer land on the handle before it vanishes.
      let hideTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelHide = () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      };
      const hideNow = () => {
        // Don't retract the handle mid-drag (the drag uses window listeners).
        if (document.body.classList.contains("reorder-active")) {
          return;
        }
        handle.style.display = "none";
        currentPos = null;
      };
      const scheduleHide = () => {
        if (document.body.classList.contains("reorder-active")) {
          return;
        }
        cancelHide();
        hideTimer = setTimeout(hideNow, 300);
      };

      // Place the handle next to a known row. Shared by `onMouseMove` (every
      // pointer movement) and the plugin's `update` hook (every transaction)
      // so the handle scoots horizontally the instant a Tab updates the row's
      // indent — without waiting for the next mousemove.
      //
      // X math is rect-based, not indent-based: handle sits 24 px (the
      // existing `-1.5rem` CSS offset) to the LEFT of the row's actual left
      // edge. This unifies three cases that the old indent-based formula
      // got wrong for nested content:
      //   - Top-level un-indented rows: `rect.left == wrapper.left` → handle
      //     at -24 (matches the previous CSS default).
      //   - Top-level indented rows: `rect.left == wrapper.left + indent *
      //     step` → handle at `indent * step - 24` (matches the previous
      //     indent-based scoot).
      //   - Rows inside a `study_block`: `rect.left == study_block.left +
      //     padding + indent * step` → handle sits in the STUDY-BLOCK's own
      //     gutter, not at the editor's outer edge.
      const positionHandle = (dom: HTMLElement): void => {
        if (!wrapper) return;
        const wrapRect = wrapper.getBoundingClientRect();
        const blockRect = dom.getBoundingClientRect();
        handle.style.display = "flex";
        handle.style.top = `${String(blockRect.top - wrapRect.top)}px`;
        handle.style.left = `${String(blockRect.left - wrapRect.left - 24)}px`;
      };

      const onMouseMove = (event: MouseEvent) => {
        if (event.target === handle) {
          return;
        }
        // Freeze the handle on the block being dragged.
        if (document.body.classList.contains("reorder-active")) {
          return;
        }
        if (!wrapper) {
          return;
        }
        // Pointer is back inside the editor — keep the handle alive.
        cancelHide();
        // Reuse the drag-side row resolver so hover gets the same multi-X
        // probe, claim-zone Y acceptance, pos±1 step at container boundaries,
        // and Y-sweep through whitespace. Pass an empty source range so every
        // candidate is treated as non-source (no asymmetric claim shrinking).
        const row = rowUnderCursor(view, event, -1, -1);
        if (!row) {
          return;
        }
        const dom = view.nodeDOM(row.pos);
        if (!(dom instanceof HTMLElement)) {
          return;
        }
        currentPos = row.pos;
        positionHandle(dom);
      };

      // Invisible sensor strip in the negative-left gutter where the handle
      // lives. Without it, hovering directly into the handle's slot from
      // outside the editor never fires mousemove (the wrapper's hitbox stops
      // at its left edge), so the handle stayed hidden until the pointer first
      // crossed the editor's text. The sensor surfaces the handle on direct
      // gutter hover; the existing handle hover/300ms-hide logic still owns
      // the show/hide lifecycle once the handle is up.
      const sensor = document.createElement("div");
      sensor.setAttribute("aria-hidden", "true");
      sensor.style.position = "absolute";
      sensor.style.left = "-1.5rem";
      sensor.style.top = "0";
      sensor.style.bottom = "0";
      sensor.style.width = "1.5rem";

      // Hierarchical drag — Phase 4c. Press-and-hold on the handle captures
      // the indent run rooted at the hovered block (the block plus every
      // immediately-following sibling at strictly greater indent), tracks a
      // drop indicator whose position+orientation encode the chosen gesture
      // (reorder-above/below, make-child, reparent), and on release calls
      // `applyIndentRunDrop` with that instruction.
      const detachReorder = attachIndentRunDrag(handle, view, () => {
        if (currentPos === null) return null;
        // notes_index used to be drag-locked (it was pinned to position 0);
        // now it's a normal top-level block, draggable like any study_block.
        // Deletion stays blocked by `notesIndexGuard`.
        return currentPos;
      });

      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        if (currentPos === null) {
          return;
        }
        const selection = TextSelection.near(
          view.state.doc.resolve(currentPos + 1),
        );
        view.dispatch(view.state.tr.setSelection(selection));
        view.focus();
        const rect = handle.getBoundingClientRect();
        window.dispatchEvent(
          new CustomEvent<BlockMenuEventDetail>(BLOCK_MENU_EVENT, {
            detail: { x: rect.right, y: rect.top },
          }),
        );
      };

      handle.addEventListener("click", onClick);
      handle.addEventListener("mouseenter", cancelHide);
      handle.addEventListener("mouseleave", scheduleHide);
      sensor.addEventListener("mousemove", onMouseMove);
      sensor.addEventListener("mouseleave", scheduleHide);
      wrapper?.addEventListener("mousemove", onMouseMove);
      wrapper?.addEventListener("mouseleave", scheduleHide);
      wrapper?.appendChild(sensor);
      wrapper?.appendChild(handle);

      return {
        update(view, prevState) {
          // Re-position the handle whenever the doc changes so a Tab on the
          // hovered row updates the handle's X immediately, instead of
          // waiting for the next mousemove. We trust currentPos to still
          // resolve to a draggable block — Tab is `setNodeMarkup` which
          // preserves positions; other edits that shift positions will be
          // self-corrected on the next mousemove.
          if (currentPos === null) return;
          if (view.state.doc === prevState.doc) return;
          if (document.body.classList.contains("reorder-active")) return;
          const $pos = view.state.doc.resolve(currentPos);
          const node = $pos.parent.maybeChild($pos.index());
          if (!node) return;
          const dom = view.nodeDOM(currentPos);
          if (!(dom instanceof HTMLElement)) return;
          positionHandle(dom);
        },
        destroy() {
          cancelHide();
          detachReorder();
          handle.removeEventListener("click", onClick);
          handle.removeEventListener("mouseenter", cancelHide);
          handle.removeEventListener("mouseleave", scheduleHide);
          sensor.removeEventListener("mousemove", onMouseMove);
          sensor.removeEventListener("mouseleave", scheduleHide);
          wrapper?.removeEventListener("mousemove", onMouseMove);
          wrapper?.removeEventListener("mouseleave", scheduleHide);
          sensor.remove();
          handle.remove();
        },
      };
    },
  });
}
