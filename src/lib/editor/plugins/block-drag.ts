import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import type { DropInstruction } from "../indent-run";

/**
 * Phase 4c plugin owning the *visual* side of the hierarchical block drag.
 *
 * Two visuals layered on top of the editor while a drag is in flight:
 *
 *   1. A semi-transparent ghost over the source range so the user can see
 *      what they're moving. Implemented as an inline DecorationSet — inline
 *      decorations only add CSS class names, never inject new DOM, so they
 *      don't perturb layout.
 *   2. A drop indicator whose orientation + position encode the chosen
 *      {@link DropInstruction}. Implemented as a SINGLE absolutely-positioned
 *      `<div>` appended to the editor's wrapper, NOT as a widget Decoration.
 *      Widget decorations are in-flow nodes — a 2 px line plus margin shifts
 *      surrounding rows down by ~6 px and creates a layout-shift feedback
 *      loop when the cursor sits near a row boundary. An absolute overlay
 *      reads `getBoundingClientRect()` once per instruction change and
 *      paints over the editor without affecting reflow.
 *
 * The pointer driver (in `block-handle.ts`) is the only caller; it pokes
 * three lifecycle ops via meta transactions:
 *
 *   * {@link startBlockDrag}      — capture the source run.
 *   * {@link updateBlockDragTarget} — refresh the drop instruction.
 *   * {@link endBlockDrag}        — clear the visual state.
 *
 * Decoupling visual state from the pointer driver lets the driver dispatch
 * the real `applyIndentRunDrop` transaction on pointerup without also
 * dispatching a separate "stop indicator" tx — the same transaction can
 * carry both, keeping the drop atomic in the history.
 */

/** Indent step in CSS rem — kept in lockstep with `INDENT_STEP_REM` in schema.ts. */
const INDENT_STEP_REM = 1.75;
const INDENT_STEP_PX_DEFAULT = INDENT_STEP_REM * 16;

interface DragIdle {
  kind: "idle";
}

interface DragActive {
  kind: "active";
  runStart: number;
  runEnd: number;
  rootIndent: number;
  /** Null until the pointer enters a valid target zone. */
  instruction: DropInstruction | null;
}

export type BlockDragState = DragIdle | DragActive;

const blockDragKey = new PluginKey<BlockDragState>("block-drag");

/**
 * Read the runtime indent-step in pixels by measuring 1 rem on the editor.
 * Falls back to the schema-default 28 px (1.75 rem at 16 px root font) when
 * the document isn't laid out yet.
 */
function indentStepPx(view: EditorView): number {
  const styles = getComputedStyle(view.dom);
  const fontSize = parseFloat(styles.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    return fontSize * INDENT_STEP_REM;
  }
  return INDENT_STEP_PX_DEFAULT;
}

/**
 * For the block at `blockPos`, return the bottom Y of its previous sibling
 * (when `which === "prev"`) or the top Y of its next sibling (when `"next"`).
 * Returns null when there is no such sibling, or the sibling's DOM hasn't
 * been laid out. Used by the indicator's gap-midpoint anchor so the line
 * paints in the visual gap between two rows instead of on a row's edge.
 */
function neighborEdgeY(
  view: EditorView,
  blockPos: number,
  which: "prev" | "next",
): number | null {
  const $pos = view.state.doc.resolve(blockPos);
  const parent = $pos.parent;
  const index = $pos.index();
  if (which === "prev") {
    if (index === 0) return null;
    const prev = parent.child(index - 1);
    const prevPos = blockPos - prev.nodeSize;
    const dom = view.nodeDOM(prevPos);
    if (!(dom instanceof HTMLElement)) return null;
    return dom.getBoundingClientRect().bottom;
  }
  const here = parent.child(index);
  if (index === parent.childCount - 1) return null;
  const nextPos = blockPos + here.nodeSize;
  const dom = view.nodeDOM(nextPos);
  if (!(dom instanceof HTMLElement)) return null;
  return dom.getBoundingClientRect().top;
}

/**
 * Nearest `.pm-block-host` ancestor of the block at `blockPos`, or null when
 * the block is at the doc root (no enclosing host).
 *
 * `closest(".pm-block-host")` walks up FROM the block's own DOM through its
 * ancestors; the block's own DOM is never itself a host (hosts ARE the
 * `contentDOM` of node views like `study_block`, `callout`, `collapsible`,
 * `notes_index`), so the walk always lands on the enclosing container when
 * one exists.
 *
 * Exposed so `block-handle.ts` can identity-compare the source's host against
 * a candidate target's host — the cheapest "are these two blocks in the same
 * container?" check, since two distinct host containers are always distinct
 * DOM nodes.
 */
export function findHostElement(
  view: EditorView,
  blockPos: number,
): HTMLElement | null {
  const dom = view.nodeDOM(blockPos);
  return dom instanceof HTMLElement
    ? dom.closest<HTMLElement>(".pm-block-host")
    : null;
}

/**
 * Drop-indicator geometry for the host container of the block at `blockPos`:
 *
 *   - `contentLeft` — viewport X of the container's CONTENT edge (its border
 *     box left plus its `padding-left`). This is the indent-0 baseline: the
 *     line should start where text actually starts, not at the host's outer
 *     border, because the host's `padding-inline-start` reserves the gutter
 *     column for the drag handle. Reading the live padding (rather than
 *     assuming it equals `INDENT_STEP_PX`) means this stays correct in two
 *     forward-looking scenarios:
 *       1. Users who don't have drag enabled will see the gutter rule turned
 *          off entirely — padding becomes 0, content edge collapses onto the
 *          border edge, indicator stays aligned with text.
 *       2. The design system can retune `--block-gutter` without an
 *          indicator regression.
 *   - `right` — viewport X of the container's right edge. Hosts in this
 *     codebase use only `padding-inline-start`, so the indicator's right
 *     stays at the border-box right.
 *
 * When no `.pm-block-host` is found (top-level blocks at the document root),
 * falls back to `view.dom` and reads ITS padding-left — so doc-root drags in
 * the study-body / notes editors get the same content-edge alignment.
 */
function hostMetrics(
  view: EditorView,
  blockPos: number,
): { contentLeft: number; right: number } {
  const host = findHostElement(view, blockPos);
  const el = host ?? view.dom;
  const rect = el.getBoundingClientRect();
  const paddingRaw = parseFloat(getComputedStyle(el).paddingLeft);
  const padding = Number.isFinite(paddingRaw) ? paddingRaw : 0;
  return { contentLeft: rect.left + padding, right: rect.right };
}

/**
 * Test-only entry into {@link computeIndicatorRect} for probing what the
 * drop line WOULD paint at, given a hypothetical instruction + source run.
 * Lives next to the real painter so the two never drift. Returns a rect in
 * VIEWPORT (clientX/clientY) coordinates so callers can compare against
 * the rects they read from `getBoundingClientRect()`.
 *
 * Used by `e2e/editor/drag-seam-indicator.spec.ts` (via `__PM_DEBUG__`) to
 * lock down the rule that crossing the seam between R.lower and
 * R.next.upper at the indent-(R.indent + 1) column produces an identical
 * paint Y — i.e. `make-child R` and `reorder-above R.next` anchor at the
 * same point.
 */
export function probeIndicatorRect(
  view: EditorView,
  instruction: DropInstruction,
  runStart: number,
  runEnd: number,
): { top: number; left: number; width: number; height: number } | null {
  const wrapper = view.dom.parentElement;
  if (!wrapper) return null;
  const rect = computeIndicatorRect(view, wrapper, {
    kind: "active",
    runStart,
    runEnd,
    rootIndent: 0,
    instruction,
  });
  if (!rect) return null;
  // computeIndicatorRect returns coords RELATIVE to the wrapper; convert
  // back to viewport coords so comparisons against client rects work
  // without ambiguity.
  const wrapRect = wrapper.getBoundingClientRect();
  return {
    top: rect.top + wrapRect.top,
    left: rect.left + wrapRect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Compute the indicator's rect (in wrapper-relative coordinates) for the
 * given instruction. Returns null when the instruction's anchor can't be
 * resolved to a layout box (rare — e.g. the doc reflowed between the
 * driver's geometry capture and the indicator's paint).
 */
function computeIndicatorRect(
  view: EditorView,
  wrapper: HTMLElement,
  state: DragActive,
): {
  top: number;
  left: number;
  width: number;
  height: number;
} | null {
  const instruction = state.instruction;
  if (!instruction) return null;
  const wrapperRect = wrapper.getBoundingClientRect();
  const step = indentStepPx(view);

  switch (instruction.kind) {
    case "reparent": {
      // Horizontal line at the source row's TOP edge, inset to the new
      // indent column. Same visual vocabulary as reorder-above: a single
      // horizontal line where the run will land. The cue that this is
      // reparent (not a move) is the source row's existing ghost (opacity
      // 0.4) sitting directly below the indicator — the user sees the
      // line is on the row they're already dragging.
      const sourceDom = view.nodeDOM(state.runStart);
      if (!(sourceDom instanceof HTMLElement)) return null;
      const sourceRect = sourceDom.getBoundingClientRect();
      const host = hostMetrics(view, state.runStart);
      const left =
        host.contentLeft - wrapperRect.left + instruction.indent * step;
      const right = host.right - wrapperRect.left;
      return {
        top: sourceRect.top - wrapperRect.top - 1,
        left,
        width: Math.max(0, right - left),
        height: 2,
      };
    }
    case "reorder-above":
    case "reorder-below": {
      const anchorPos = instruction.siblingPos;
      const anchorDom = view.nodeDOM(anchorPos);
      if (!(anchorDom instanceof HTMLElement)) return null;
      const anchorRect = anchorDom.getBoundingClientRect();
      // Anchor the line in the visual gap rather than on a row's edge so the
      // indicator stays put as the cursor moves across the seam (cursor in
      // R's lower half AND cursor in N's upper half both paint at the same
      // gap-midpoint Y). For reorder-above N, the relevant gap is between
      // N's previous sibling and N. For reorder-below R, between R and its
      // next sibling. Falls back to the row's own edge when no neighbor
      // exists (top / bottom of container).
      const neighborY = neighborEdgeY(
        view,
        anchorPos,
        instruction.kind === "reorder-above" ? "prev" : "next",
      );
      const seamY =
        instruction.kind === "reorder-above"
          ? neighborY !== null
            ? (neighborY + anchorRect.top) / 2
            : anchorRect.top
          : neighborY !== null
            ? (anchorRect.bottom + neighborY) / 2
            : anchorRect.bottom;
      const host = hostMetrics(view, anchorPos);
      const left =
        host.contentLeft - wrapperRect.left + instruction.indent * step;
      const right = host.right - wrapperRect.left;
      return {
        top: seamY - wrapperRect.top - 1, // center the 2 px line on the seam
        left,
        width: Math.max(0, right - left),
        height: 2,
      };
    }
    case "make-child": {
      const parentDom = view.nodeDOM(instruction.parentPos);
      if (!(parentDom instanceof HTMLElement)) return null;
      const parentRect = parentDom.getBoundingClientRect();
      // Find the parent's own indent so the indicator lands at parent + 1.
      const parentNode = view.state.doc.nodeAt(instruction.parentPos);
      const parentIndent =
        typeof parentNode?.attrs.indent === "number"
          ? parentNode.attrs.indent
          : 0;
      // The new child becomes a sibling of `parentPos` inside the same host,
      // so the host bounds come from the parent's container — same lookup as
      // the other cases.
      const host = hostMetrics(view, instruction.parentPos);
      const left =
        host.contentLeft - wrapperRect.left + (parentIndent + 1) * step;
      const right = host.right - wrapperRect.left;
      // Anchor at the gap midpoint between parent and parent's next sibling.
      // `make-child P` and `reorder-above (P.next)` describe the same
      // structural drop with different intent flags — `make-child` carries
      // the explicit "become P's child" semantic, `reorder-above` is the
      // shape the driver emits when the cursor crosses into P.next's upper
      // half. Painting them at the same Y means crossing the P.lower /
      // P.next.upper seam at the indent-(P.indent + 1) column never moves
      // the line. (Previously this anchored at `parentRect.bottom`, which
      // sat ~half a gap height above the seam midpoint — 6 px in the user's
      // verse-per-line scripture layout, hence the "two snap zones" feel.)
      // Falls back to `parentRect.bottom` when parent has no next sibling
      // (end of container), where the make-child target is the visual edge
      // anyway.
      const nextTop = neighborEdgeY(view, instruction.parentPos, "next");
      const seamY =
        nextTop !== null
          ? (parentRect.bottom + nextTop) / 2
          : parentRect.bottom;
      return {
        top: seamY - wrapperRect.top - 1,
        left,
        width: Math.max(0, right - left),
        height: 2,
      };
    }
  }
}

export function blockDragPlugin(): Plugin<BlockDragState> {
  return new Plugin<BlockDragState>({
    key: blockDragKey,
    state: {
      init: (): BlockDragState => ({ kind: "idle" }),
      apply(tr, prev): BlockDragState {
        const meta = tr.getMeta(blockDragKey) as BlockDragState | undefined;
        return meta ?? prev;
      },
    },
    props: {
      decorations(state) {
        const s = blockDragKey.getState(state);
        if (s?.kind !== "active") return null;
        if (s.runStart >= s.runEnd) return null;
        // Inline decoration only — no DOM injection, no layout shift. The
        // drop indicator lives in the absolute-overlay plugin view (below).
        return DecorationSet.create(state.doc, [
          Decoration.inline(s.runStart, s.runEnd, {
            class: "pm-drag-source",
          }),
        ]);
      },
    },
    view(view) {
      const wrapper = view.dom.parentElement;
      const indicator = document.createElement("div");
      indicator.className = "pm-drop-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.style.position = "absolute";
      indicator.style.display = "none";
      indicator.style.pointerEvents = "none";
      wrapper?.appendChild(indicator);

      const paint = (): void => {
        if (!wrapper) {
          indicator.style.display = "none";
          return;
        }
        const s = blockDragKey.getState(view.state);
        if (s?.kind !== "active" || !s.instruction) {
          indicator.style.display = "none";
          return;
        }
        const rect = computeIndicatorRect(view, wrapper, s);
        if (!rect) {
          indicator.style.display = "none";
          return;
        }
        indicator.style.display = "block";
        indicator.style.top = `${String(rect.top)}px`;
        indicator.style.left = `${String(rect.left)}px`;
        indicator.style.width = `${String(rect.width)}px`;
        indicator.style.height = `${String(rect.height)}px`;
      };

      paint();

      return {
        update() {
          paint();
        },
        destroy() {
          indicator.remove();
        },
      };
    },
  });
}

/** Begin painting the source ghost + (eventually) drop indicator. */
export function startBlockDrag(
  view: EditorView,
  runStart: number,
  runEnd: number,
  rootIndent: number,
): void {
  view.dispatch(
    view.state.tr.setMeta(blockDragKey, {
      kind: "active",
      runStart,
      runEnd,
      rootIndent,
      instruction: null,
    } satisfies DragActive),
  );
}

/** Refresh the drop indicator's chosen instruction (call on pointermove). */
export function updateBlockDragTarget(
  view: EditorView,
  instruction: DropInstruction | null,
): void {
  const cur = blockDragKey.getState(view.state);
  if (cur?.kind !== "active") return;
  // Cheap reference-equality dedupe so identical pointermove ticks don't
  // dispatch a new transaction. Driver typically produces a fresh object
  // per move, but no-op moves (same instruction kind + same fields) can be
  // skipped here once we compare structurally.
  if (instructionsEqual(cur.instruction, instruction)) return;
  view.dispatch(
    view.state.tr.setMeta(blockDragKey, {
      ...cur,
      instruction,
    } satisfies DragActive),
  );
}

function instructionsEqual(
  a: DropInstruction | null,
  b: DropInstruction | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "reorder-above":
    case "reorder-below":
      return (
        a.siblingPos === (b as typeof a).siblingPos &&
        a.indent === (b as typeof a).indent
      );
    case "make-child":
      return a.parentPos === (b as typeof a).parentPos;
    case "reparent":
      return a.indent === (b as typeof a).indent;
  }
}

/** Clear the visual drag state (call on pointerup, pointercancel, or Escape). */
export function endBlockDrag(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(blockDragKey, { kind: "idle" } satisfies DragIdle),
  );
}

/** Read the current drag state (for tests / debugging). */
export function getBlockDragState(view: EditorView): BlockDragState | null {
  return blockDragKey.getState(view.state) ?? null;
}
