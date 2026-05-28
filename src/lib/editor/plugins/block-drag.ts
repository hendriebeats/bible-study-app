import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/**
 * Phase 4c plugin owning the *visual* side of the hierarchical block drag:
 * a ghost over the source run while the user holds, and a horizontal blue
 * drop-indicator line at the chosen insertion gap whose left margin snaps to
 * the chosen indent.
 *
 * The pointer driver (in `block-handle.ts`) is the only caller; it pokes
 * three lifecycle ops via meta transactions:
 *
 *   * {@link startBlockDrag}      — capture the source run.
 *   * {@link updateBlockDragTarget} — refresh the drop indicator's pos+indent.
 *   * {@link endBlockDrag}        — clear the visual state.
 *
 * Decoupling visual state from the pointer driver lets the driver dispatch
 * the real `applyIndentRunDrop` transaction on pointerup without also
 * dispatching a separate "stop indicator" tx — the same transaction can
 * carry both, keeping the drop atomic in the history.
 */

/** Indent step in CSS rem — kept in lockstep with `INDENT_STEP_REM` in schema.ts. */
const INDENT_STEP_REM = 1.75;

interface DragIdle {
  kind: "idle";
}

interface DragActive {
  kind: "active";
  runStart: number;
  runEnd: number;
  rootIndent: number;
  /** Null until the pointer moves into a valid drop gap. */
  target: { pos: number; indent: number } | null;
}

export type BlockDragState = DragIdle | DragActive;

const blockDragKey = new PluginKey<BlockDragState>("block-drag");

/** Build the drop-indicator DOM. Margin-inline-start matches the row indent. */
function createDropIndicator(indent: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "pm-drop-indicator";
  el.setAttribute("aria-hidden", "true");
  el.style.marginInlineStart = `${String(indent * INDENT_STEP_REM)}rem`;
  return el;
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
        const decos: Decoration[] = [];
        if (s.runStart < s.runEnd) {
          // Ghost the source range while dragging so the user can see what
          // they're moving (drops at 0.4 opacity; pointer-events off so the
          // ghost doesn't intercept the drag's own pointermove events).
          decos.push(
            Decoration.inline(s.runStart, s.runEnd, {
              class: "pm-drag-source",
            }),
          );
        }
        if (s.target) {
          const indent = s.target.indent;
          decos.push(
            Decoration.widget(s.target.pos, () => createDropIndicator(indent), {
              // side: -1 so the indicator paints BEFORE any block at the
              // same position (visually "between" the surrounding blocks).
              side: -1,
              // Re-create the DOM only when pos or indent actually changes
              // — keeps the indicator from flickering during pointermove.
              key: `drop-${String(s.target.pos)}-${String(indent)}`,
              ignoreSelection: true,
            }),
          );
        }
        return DecorationSet.create(state.doc, decos);
      },
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
      target: null,
    } satisfies DragActive),
  );
}

/** Refresh the drop indicator's position + indent (call on pointermove). */
export function updateBlockDragTarget(
  view: EditorView,
  target: { pos: number; indent: number } | null,
): void {
  const cur = blockDragKey.getState(view.state);
  if (cur?.kind !== "active") return;
  view.dispatch(
    view.state.tr.setMeta(blockDragKey, {
      ...cur,
      target,
    } satisfies DragActive),
  );
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
