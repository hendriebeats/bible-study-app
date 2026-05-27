import { Plugin, TextSelection } from "prosemirror-state";

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
      handle.contentEditable = "false";
      handle.textContent = "⋮⋮";
      handle.style.display = "none";

      let currentPos: number | null = null;

      const hide = () => {
        handle.style.display = "none";
        currentPos = null;
      };

      const onMouseMove = (event: MouseEvent) => {
        if (event.target === handle) {
          return;
        }
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
        const blockRect = dom.getBoundingClientRect();
        const wrapRect = wrapper.getBoundingClientRect();
        handle.style.display = "flex";
        handle.style.top = `${String(blockRect.top - wrapRect.top)}px`;
      };

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
      wrapper?.addEventListener("mousemove", onMouseMove);
      wrapper?.addEventListener("mouseleave", hide);
      wrapper?.appendChild(handle);

      return {
        destroy() {
          handle.removeEventListener("click", onClick);
          wrapper?.removeEventListener("mousemove", onMouseMove);
          wrapper?.removeEventListener("mouseleave", hide);
          handle.remove();
        },
      };
    },
  });
}
