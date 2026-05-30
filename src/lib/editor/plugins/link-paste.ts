import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { fetchLinkPreview } from "@/app/links/actions";

import { normalizeUrl } from "../commands";
import { type LinkAttrs, marks } from "../schema";

/**
 * Smart paste for URLs (Notion / Google Docs flavour). Owns one handlePaste
 * hook for the editor:
 *
 *   • Clipboard is a single URL + selection non-empty
 *       → wrap the selection in a link mark (text untouched).
 *   • Clipboard is a single URL + selection collapsed
 *       → insert the URL as linked text immediately, then asynchronously
 *         fetch the page title via {@link fetchLinkPreview} and (if the
 *         caret-inserted text wasn't touched in the meantime) replace it
 *         with the page title + cache title/favicon/siteName on the mark.
 *   • Anything else
 *       → return false; PM's default paste runs as usual.
 *
 * Read-only views are skipped (PM's view.editable). The async write back is
 * tagged `addToHistory: false` and `preview-backfill: true` so it doesn't
 * pollute undo (one Cmd-Z reverts the user's paste, not the title swap) and
 * autosave plugins can choose to ignore it.
 */

const KEY = new PluginKey("link-paste");

/**
 * Strict-ish URL detector. We accept what {@link normalizeUrl} would accept
 * (bare hostnames get https:// prepended) but require either an explicit
 * scheme OR a `www.` prefix OR a hostname-shape with a TLD — so unrelated
 * clipboard contents like a single bare word don't accidentally become a link.
 */
function looksLikeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed) && trimmed.includes(".")) {
    return `https://${trimmed}`;
  }
  // Bare hostname with at least one dot and a 2+ char TLD-ish tail.
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

/**
 * After the optimistic insert, walk the current doc to find a link-marked
 * text node whose `href` matches and whose visible text still equals that
 * href (i.e. the user hasn't edited it). Returns the absolute range + the
 * old attrs, or null.
 */
function findPendingLinkRange(
  view: EditorView,
  href: string,
): { from: number; to: number; attrs: LinkAttrs } | null {
  const linkType = marks.link;
  let hit: { from: number; to: number; attrs: LinkAttrs } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (hit) return false;
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type === linkType);
    if (!mark) return true;
    const attrs = mark.attrs as LinkAttrs;
    if (attrs.href !== href) return true;
    if (attrs.displayTitle) return true; // already populated
    if ((node.text ?? "") !== href) return true; // user edited
    hit = {
      from: pos,
      to: pos + node.nodeSize,
      attrs,
    };
    return false;
  });
  return hit;
}

/** Fire-and-forget the preview fetch + back-write. Never throws. */
function schedulePreviewBackfill(view: EditorView, href: string): void {
  void (async () => {
    let preview: Awaited<ReturnType<typeof fetchLinkPreview>>;
    try {
      preview = await fetchLinkPreview(href);
    } catch {
      return;
    }
    if (preview.status !== "ok") {
      // Even a failed preview can still update the favicon if we got one,
      // but for now we only act on successful title fetches — the hover
      // plugin will retry the failed preview later under its own cache TTL.
      return;
    }
    if (!preview.title || preview.title === href) return;
    if (view.isDestroyed) return;
    const hit = findPendingLinkRange(view, href);
    if (!hit) return;
    const linkType = marks.link;
    const newAttrs: LinkAttrs = {
      href: hit.attrs.href,
      title: hit.attrs.title,
      displayTitle: preview.title,
      favicon: preview.faviconUrl,
      siteName: preview.siteName,
    };
    const tr = view.state.tr;
    tr.insertText(preview.title, hit.from, hit.to);
    const newTo = hit.from + preview.title.length;
    tr.removeMark(hit.from, newTo, linkType).addMark(
      hit.from,
      newTo,
      linkType.create(newAttrs),
    );
    tr.setMeta("addToHistory", false);
    tr.setMeta("preview-backfill", true);
    view.dispatch(tr);
  })();
}

export function linkPastePlugin(): Plugin {
  return new Plugin({
    key: KEY,
    props: {
      handlePaste(view, event) {
        if (!view.editable) return false;
        const cd = event.clipboardData;
        if (!cd) return false;
        const text = cd.getData("text/plain");
        if (!text) return false;
        const candidate = looksLikeUrl(text);
        if (!candidate) return false;

        // Normalize once. `normalizeUrl` returns null only for empty input,
        // which `looksLikeUrl` already excluded.
        const href = normalizeUrl(candidate);
        if (!href) return false;

        event.preventDefault();
        const linkType = marks.link;
        const { from, to, empty } = view.state.selection;

        if (!empty) {
          // Wrap the existing selection. Don't replace the text — that's the
          // whole point of "paste a link onto selected text".
          const tr = view.state.tr;
          tr.removeMark(from, to, linkType).addMark(
            from,
            to,
            linkType.create({ href } satisfies Partial<LinkAttrs>),
          );
          view.dispatch(tr);
          // Kick off the preview fetch even though we don't update visible text:
          // the link mark's attrs get backfilled silently via the hover plugin
          // path the first time it's hovered. For now, just let the cache warm
          // up so the first hover is instant.
          void fetchLinkPreview(href).catch(() => undefined);
          return true;
        }

        // Empty cursor: drop the URL as linked text immediately, then fetch
        // the title in the background and (if untouched) swap the visible
        // text for the title.
        const tr = view.state.tr;
        tr.insertText(href, from);
        const insertEnd = from + href.length;
        tr.addMark(from, insertEnd, linkType.create({ href }));
        tr.removeStoredMark(linkType);
        view.dispatch(tr.scrollIntoView());

        schedulePreviewBackfill(view, href);
        return true;
      },
    },
  });
}
