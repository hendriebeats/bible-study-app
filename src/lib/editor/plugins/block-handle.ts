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
      handle.className = "block-handle";
      handle.setAttribute("aria-label", "Block options");
      handle.title = "Drag to reorder · click for options";
      handle.contentEditable = "false";
      handle.textContent = "⋮⋮";
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
        // Pointer is back inside the editor — keep the handle alive.
        cancelHide();
        const found = view.posAtCoords({
          left: event.clientX,
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
        if (!(dom instanceof HTMLElement) || !wrapper) {
          return;
        }
        currentPos = before;
        currentDom = dom;
        const blockRect = dom.getBoundingClientRect();
        const wrapRect = wrapper.getBoundingClientRect();
        handle.style.display = "flex";
        handle.style.top = `${String(blockRect.top - wrapRect.top)}px`;
      };

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
      wrapper?.addEventListener("mousemove", onMouseMove);
      wrapper?.addEventListener("mouseleave", scheduleHide);
      wrapper?.appendChild(handle);

      return {
        destroy() {
          cancelHide();
          detachReorder();
          handle.removeEventListener("click", onClick);
          handle.removeEventListener("mouseenter", cancelHide);
          handle.removeEventListener("mouseleave", scheduleHide);
          wrapper?.removeEventListener("mousemove", onMouseMove);
          wrapper?.removeEventListener("mouseleave", scheduleHide);
          handle.remove();
        },
      };
    },
  });
}
