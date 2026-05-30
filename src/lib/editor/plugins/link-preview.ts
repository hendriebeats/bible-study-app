import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { AnchorRect } from "../floating-position";
import { type LinkAttrs, marks } from "../schema";

/**
 * Hover detection for link marks. Emits a `link-preview:show` event after the
 * pointer has dwelled on an `<a>` for {@link HOVER_DELAY_MS}, and a
 * `link-preview:hide` event when the pointer leaves the link.
 *
 * The actual preview card lives in a React component (LinkPreviewCardPortal)
 * — that component decides whether to honour `hide` based on its own pointer
 * state, making "move onto the card to keep it open" possible without this
 * plugin needing to know about the card's DOM.
 *
 * `range` (the link mark's full span around the hovered DOM node) is included
 * in the show event so the card can lazy-backfill displayTitle/favicon onto
 * the mark when the preview resolves successfully.
 */

const KEY = new PluginKey("link-preview");

const HOVER_DELAY_MS = 400;

export const LINK_PREVIEW_SHOW_EVENT = "link-preview:show";
export const LINK_PREVIEW_HIDE_EVENT = "link-preview:hide";

export interface LinkPreviewShowDetail {
  view: EditorView;
  href: string;
  /** Cached attrs on the link mark — empty fields trigger a backfill. */
  attrs: LinkAttrs;
  anchor: AnchorRect;
  range: { from: number; to: number } | null;
}

export interface LinkPreviewHideDetail {
  /** href of the link that was last shown — for the card to ignore stale events. */
  href: string;
}

/**
 * Compute the link mark range that surrounds `pos`, or null. We look at both
 * the inline child at `pos` AND the one immediately before it (because
 * `posAtCoords` likes to return boundary positions where `$pos.marks()`
 * follows the AFTER-side conventions of ProseMirror — at the end of a link
 * the mark set is the next child's, not the link's), then expand by walking
 * siblings that carry the same mark.
 */
function findLinkRangeAt(
  view: EditorView,
  pos: number,
): { from: number; to: number; attrs: LinkAttrs } | null {
  const linkType = marks.link;
  let $pos;
  try {
    $pos = view.state.doc.resolve(pos);
  } catch {
    return null;
  }
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const parentStart = pos - $pos.parentOffset;

  // Locate the child containing `pos` AND its left neighbour — pos at a
  // boundary belongs to "the run touching this boundary on either side".
  let cursor = parentStart;
  let hitIdx = -1;
  let hitChildStart = parentStart;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childEnd = cursor + child.nodeSize;
    if (cursor <= pos && pos <= childEnd) {
      hitIdx = i;
      hitChildStart = cursor;
      break;
    }
    cursor = childEnd;
  }
  if (hitIdx === -1) return null;

  const findLinkMark = (i: number) => {
    const child = parent.child(i);
    return linkType.isInSet(child.marks);
  };

  // Prefer the child the position is inside; if that one isn't linked but
  // `pos` is exactly at its left boundary AND the previous child is, walk
  // back one. This handles the cursor-at-end-of-link case.
  let idx = hitIdx;
  let runStart = hitChildStart;
  let mark = findLinkMark(idx);
  if (!mark && pos === hitChildStart && idx > 0) {
    idx = idx - 1;
    runStart = hitChildStart - parent.child(idx).nodeSize;
    mark = findLinkMark(idx);
  }
  if (!mark) return null;

  // Walk left while the previous child carries the same link mark (mark
  // equality, not just same href — different links shouldn't merge).
  let from = runStart;
  for (let i = idx - 1; i >= 0; i--) {
    const child = parent.child(i);
    if (!mark.isInSet(child.marks)) break;
    from -= child.nodeSize;
  }
  // Walk right.
  let to = runStart + parent.child(idx).nodeSize;
  for (let i = idx + 1; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (!mark.isInSet(child.marks)) break;
    to += child.nodeSize;
  }

  return { from, to, attrs: mark.attrs as LinkAttrs };
}

function rectFromElement(el: HTMLElement): AnchorRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export function linkPreviewPlugin(): Plugin {
  return new Plugin({
    key: KEY,
    props: {
      handleDOMEvents: {
        mouseover(view, event) {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const anchor = target.closest("a");
          if (!anchor || !view.dom.contains(anchor)) return false;
          const href = anchor.getAttribute("href") ?? "";
          if (!href) return false;
          if (!/^(https?:\/\/|mailto:)/i.test(href)) {
            // Don't preview javascript: or unknown schemes.
            return false;
          }

          // Resolve the link mark range from the event position so the card
          // can backfill the mark's attrs after a successful preview fetch.
          let range: { from: number; to: number; attrs: LinkAttrs } | null =
            null;
          try {
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (coords) {
              range = findLinkRangeAt(view, coords.pos);
            }
          } catch {
            range = null;
          }
          const attrs: LinkAttrs = range?.attrs ?? {
            href,
            title: null,
            displayTitle: null,
            favicon: null,
            siteName: null,
          };

          window.dispatchEvent(
            new CustomEvent<LinkPreviewShowDetail>(LINK_PREVIEW_SHOW_EVENT, {
              detail: {
                view,
                href,
                attrs,
                anchor: rectFromElement(anchor),
                range: range ? { from: range.from, to: range.to } : null,
              },
            }),
          );
          return false;
        },
        mouseout(view, event) {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const anchor = target.closest("a");
          if (!anchor || !view.dom.contains(anchor)) return false;
          const related = event.relatedTarget;
          // If the pointer moved to another element still inside this link,
          // don't fire a hide — the show debounce keeps tracking.
          if (related instanceof Node && anchor.contains(related)) return false;
          const href = anchor.getAttribute("href") ?? "";
          window.dispatchEvent(
            new CustomEvent<LinkPreviewHideDetail>(LINK_PREVIEW_HIDE_EVENT, {
              detail: { href },
            }),
          );
          return false;
        },
      },
    },
  });
}

export { HOVER_DELAY_MS };
