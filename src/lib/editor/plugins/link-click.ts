import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { AnchorRect } from "../floating-position";

/**
 * Click handling for link marks rendered as `<a>` inside the editor.
 *
 *   • Cmd/Ctrl+click → open in a new tab. `noopener,noreferrer` so the
 *     new tab can't reach `window.opener` (the editor's `<a>` tags don't
 *     carry `rel="noopener"` themselves).
 *   • Plain click → no-op (we preventDefault so the browser doesn't try
 *     to navigate away from the editor). Editing happens via the toolbar
 *     Link button, Cmd-K, or the hover preview card's Edit button.
 *
 * Always installed (including in read-only views) so a stray click never
 * navigates the user away unexpectedly.
 */

const KEY = new PluginKey("link-click");

/**
 * Detail shape for {@link LINK_POPOVER_OPEN_EVENT}. `anchor` is optional —
 * the hover-card Edit button passes one; keyboard triggers (Mod-K) omit it
 * so the popover bridge derives one from the current selection.
 *
 * The event constant + interface live in this module (rather than a fresh
 * one) for historical reasons — the click plugin used to be the primary
 * dispatcher, and the rest of the codebase already imports from here.
 */
export interface LinkPopoverOpenDetail {
  view: EditorView;
  anchor?: AnchorRect;
}

/** Window-level event the LinkPopover bridge subscribes to. */
export const LINK_POPOVER_OPEN_EVENT = "link-popover:open";

export function linkClickPlugin(): Plugin {
  return new Plugin({
    key: KEY,
    props: {
      handleDOMEvents: {
        // mousedown comes BEFORE click and is when PM decides selections.
        // Without this, Cmd/Ctrl+mousedown on a link triggers PM's NodeSelection
        // (selecting the whole textblock or list_row), which then visibly
        // flashes before our click handler opens the new tab. Returning true
        // both preventDefaults and tells PM to skip its own mousedown.
        mousedown(view, event) {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const anchor = target.closest("a");
          if (!anchor || !view.dom.contains(anchor)) return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
        click(view, event) {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const anchor = target.closest("a");
          if (!anchor || !view.dom.contains(anchor)) return false;

          // Always intercept — the editor's <a> tags have no rel="noopener"
          // and unguarded navigation both loses the user's place AND lets
          // the new window reach the opener. Plain click → no-op; modifier
          // click → new tab with safe rel flags.
          event.preventDefault();

          if (event.metaKey || event.ctrlKey) {
            const href = anchor.getAttribute("href");
            if (href) {
              window.open(href, "_blank", "noopener,noreferrer");
            }
          }
          return true;
        },
      },
    },
  });
}
