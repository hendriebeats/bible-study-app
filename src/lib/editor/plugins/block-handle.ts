import { Plugin, TextSelection } from "prosemirror-state";

import { attachReorderHandle } from "../../dnd/pointer-reorder";
import { reorderSiblings } from "../reorder-node";
import { nodes } from "../schema";

/** Window event the handle fires (with `{ x, y }`) to open the React block menu. */
export const BLOCK_MENU_EVENT = "pm-block-menu";

export interface BlockMenuEventDetail {
  x: number;
  y: number;
}

/**
 * A hover "block options" handle in the left gutter of each top-level block.
 * Implemented as a single floating button positioned imperatively on mousemove
 * (robust across block types, unlike a per-block widget). Clicking it puts the
 * caret in that block and fires {@link BLOCK_MENU_EVENT}; the React `BlockMenu`
 * opens at that point (Turn into / Move up / Move down / Delete). Editable
 * editors only — added to the owner editor's plugins.
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
        if ($pos.depth < 1) {
          return;
        }
        const before = $pos.before(1);
        const dom = view.nodeDOM(before);
        if (!(dom instanceof HTMLElement)) {
          return;
        }
        currentPos = before;
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

      // Drag the handle to reorder the block among its top-level siblings (the
      // same set the menu's Move up/down walks, which stays as the keyboard path).
      const detachReorder = attachReorderHandle({
        handle,
        // The pinned notes index is not draggable (and nothing can be dropped
        // above it — see the clamp below).
        getItem: () =>
          currentDom && !currentDom.matches("[data-notes-index]")
            ? currentDom
            : null,
        getSiblings: () => Array.from(view.dom.children) as HTMLElement[],
        onReorder: (from, to) => {
          if (currentPos === null) {
            return;
          }
          const indexPinned =
            view.state.doc.firstChild?.type === nodes.notesIndex;
          reorderSiblings(
            view,
            currentPos,
            from,
            Math.max(to, indexPinned ? 1 : 0),
          );
        },
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
