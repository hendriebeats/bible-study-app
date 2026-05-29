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
 * Bounds of the nearest block-host container of the block at `blockPos`.
 * The drop indicator's left/right come from this rect so the line spans only
 * the actual container the drop will land in — not the outer editor. Without
 * this, dropping inside a `.study-block-body` paints the line across the
 * sibling `.study-block-header` column too.
 *
 * `closest(".pm-block-host")` walks up FROM the block's own DOM through its
 * ancestors; the block's own DOM is never itself a host (hosts ARE the
 * `contentDOM` of node views like `study_block`, `callout`, `collapsible`,
 * `notes_index`), so the walk always lands on the enclosing container.
 * When no host is found (top-level blocks at the document root), falls back
 * to `view.dom` — preserving today's behavior at the root.
 */
function hostRect(view: EditorView, blockPos: number): DOMRect {
  const dom = view.nodeDOM(blockPos);
  if (dom instanceof HTMLElement) {
    const host = dom.closest<HTMLElement>(".pm-block-host");
    if (host) return host.getBoundingClientRect();
  }
  return view.dom.getBoundingClientRect();
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
      const host = hostRect(view, state.runStart);
      const left = host.left - wrapperRect.left + instruction.indent * step;
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
      const host = hostRect(view, anchorPos);
      const left = host.left - wrapperRect.left + instruction.indent * step;
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
      const host = hostRect(view, instruction.parentPos);
      const left = host.left - wrapperRect.left + (parentIndent + 1) * step;
      const right = host.right - wrapperRect.left;
      return {
        top: parentRect.bottom - wrapperRect.top - 1,
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
