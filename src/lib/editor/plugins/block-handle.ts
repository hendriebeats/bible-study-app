import type { Node, NodeType, ResolvedPos } from "prosemirror-model";
import { type EditorState, Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { applyIndentRunDrop, indentRunBounds } from "../indent-run";
import { MAX_INDENT, nodes } from "../schema";
import {
  endBlockDrag,
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
 * Wrappers like `blockquote` / `callout` / `collapsible` are intentionally
 * NOT in this list: those are atomic drag units (the wrapper itself moves as
 * a whole; its children don't get their own handles), matching the Phase 4
 * sign-off ("wrapper moves as one atomic block").
 *
 * `note_entry` is also intentionally absent so the handle next to a paragraph
 * *inside* a note attaches to the WHOLE note (reordering notes within the
 * notes_index) rather than to that paragraph — which matches what users
 * actually grab a notes handle for. Editing within a single note's body is a
 * rare case that the keyboard's Mod-Shift-↑/↓ still covers.
 */
const DRAG_CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  nodes.doc,
  nodes.studyBlock,
  nodes.notesIndex,
]);

/** Pixels the pointer must travel before a press becomes a drag (vs. a click). */
const DRAG_THRESHOLD = 4;
/** Indent step in pixels — matches schema.ts `INDENT_STEP_REM = 1.75` at 16px root font. */
const INDENT_STEP_PX = 28;

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
function draggableAt(
  $pos: ResolvedPos,
): { node: Node; pos: number; depth: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const parent = $pos.node(d - 1);
    if (DRAG_CONTAINER_TYPES.has(parent.type)) {
      return { node: $pos.node(d), pos: $pos.before(d), depth: d };
    }
  }
  return null;
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
  let scanStart = $pos.start();
  for (let i = 0; i < indexInParent; i++) {
    const child = parent.child(i);
    const childStart = scanStart;
    const childEnd = scanStart + child.nodeSize;
    scanStart = childEnd;
    // Skip neighbors that fall inside the source range — they're going to
    // disappear from this position when the drop applies.
    if (childStart >= sourceStart && childEnd <= sourceEnd) continue;
    // The most-recent valid above neighbor wins; keep scanning so we report
    // the IMMEDIATE non-source neighbor (loop assignment overwrites until
    // we exhaust pre-drop siblings).
  }
  // Re-scan to find the LAST non-source sibling before dropPos (the loop
  // above just verifies the column exists; we now grab its indent).
  let lastValidIndent = -1;
  let walk = $pos.start();
  for (let i = 0; i < indexInParent; i++) {
    const child = parent.child(i);
    const childStart = walk;
    const childEnd = walk + child.nodeSize;
    walk = childEnd;
    if (childStart >= sourceStart && childEnd <= sourceEnd) continue;
    const indent =
      typeof child.attrs.indent === "number" ? child.attrs.indent : 0;
    lastValidIndent = indent;
  }
  return lastValidIndent;
}

/**
 * Compute the drop target (pos + indent) for a pointermove during a block
 * drag. Returns null when the pointer isn't over a valid gap (off-editor, or
 * over the dragged run itself).
 *
 *   * Vertical: find the deepest draggable block under the pointer Y, then
 *     decide above/below based on the cursor's position relative to that
 *     block's vertical midpoint.
 *   * Horizontal: snap `cursorX - editorContentLeft` to the nearest indent
 *     step (28px = 1.75rem at the default root font), clamped to
 *     `[0, aboveNeighborIndent + 1]`.
 */
function computeDropTarget(
  view: EditorView,
  event: PointerEvent,
  sourceStart: number,
  sourceEnd: number,
): { pos: number; indent: number } | null {
  const editorRect = view.dom.getBoundingClientRect();
  // Clamp x into the editor so cursor positions left of the content still
  // resolve to a block at the pointer's y.
  const lookupX = Math.max(event.clientX, editorRect.left + 5);
  const found = view.posAtCoords({ left: lookupX, top: event.clientY });
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.pos);
  const draggable = draggableAt($pos);
  if (!draggable) return null;
  const blockDom = view.nodeDOM(draggable.pos);
  if (!(blockDom instanceof HTMLElement)) return null;
  const rect = blockDom.getBoundingClientRect();
  const dropAbove = event.clientY < rect.top + rect.height / 2;
  const dropPos = dropAbove
    ? draggable.pos
    : draggable.pos + draggable.node.nodeSize;
  // Refuse to drop inside the source range (would be a no-op or self-insert).
  if (dropPos > sourceStart && dropPos < sourceEnd) return null;
  const above = aboveNeighborIndent(
    view.state,
    dropPos,
    sourceStart,
    sourceEnd,
  );
  const maxIndent = Math.min(MAX_INDENT, above + 1);
  // Use the editor's content-left edge as indent 0. The handle gutter sits to
  // the LEFT of that; cursor in the gutter clamps to 0.
  const contentLeft = editorRect.left + 8; // small padding allowance
  const rawIndent = Math.round((event.clientX - contentLeft) / INDENT_STEP_PX);
  const indent = Math.min(maxIndent, Math.max(0, rawIndent));
  return { pos: dropPos, indent };
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
    const target = computeDropTarget(view, event, runStart, runEnd);
    updateBlockDragTarget(view, target);
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDragging = dragging;
    const sourceStart = runStart;
    const sourceEnd = runEnd;
    teardown();
    if (wasDragging) {
      suppressNextClick();
      const target = computeDropTarget(view, event, sourceStart, sourceEnd);
      endBlockDrag(view);
      if (target) {
        const tr = applyIndentRunDrop(
          view.state,
          sourceStart,
          sourceEnd,
          target.pos,
          target.indent,
        );
        if (tr) view.dispatch(tr.scrollIntoView());
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
    // Resolve the position of the target sibling so we can call the same
    // applyIndentRunDrop helper.
    let walk = $pos.start();
    for (let i = 0; i < parent.childCount; i++) {
      if (i === target) break;
      walk += parent.child(i).nodeSize;
    }
    const dropPos =
      target < index ? walk : walk + parent.child(target).nodeSize;
    const tr = applyIndentRunDrop(
      view.state,
      run.start,
      run.end,
      dropPos,
      run.rootIndent,
    );
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
      let currentDom: HTMLElement | null = null;

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
        currentDom = null;
      };
      const scheduleHide = () => {
        if (document.body.classList.contains("reorder-active")) {
          return;
        }
        cancelHide();
        hideTimer = setTimeout(hideNow, 300);
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
        const wrapRect = wrapper.getBoundingClientRect();
        // Clamp x into the editor so events from the gutter sensor (which sits
        // to the LEFT of the editor content) still resolve to the block at the
        // pointer's y rather than returning null.
        const lookupX = Math.max(event.clientX, wrapRect.left + 1);
        const found = view.posAtCoords({
          left: lookupX,
          top: event.clientY,
        });
        if (!found) {
          return;
        }
        const $pos = view.state.doc.resolve(found.pos);
        const draggable = draggableAt($pos);
        if (!draggable) {
          return;
        }
        const dom = view.nodeDOM(draggable.pos);
        if (!(dom instanceof HTMLElement)) {
          return;
        }
        currentPos = draggable.pos;
        currentDom = dom;
        const blockRect = dom.getBoundingClientRect();
        handle.style.display = "flex";
        handle.style.top = `${String(blockRect.top - wrapRect.top)}px`;
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
      // drop indicator whose vertical position lands at the nearest block gap
      // and whose horizontal indent snaps to the cursor's distance from the
      // editor's content-left, and on release calls `applyIndentRunDrop` so
      // the whole run lands at the chosen indent with relative depths
      // preserved.
      const detachReorder = attachIndentRunDrag(handle, view, () => {
        if (currentPos === null) return null;
        // Refuse to drag the pinned notes_index (it must always be the doc's
        // first child of a body editor). Same rule the old reorder enforced.
        if (currentDom?.matches("[data-notes-index]")) return null;
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
