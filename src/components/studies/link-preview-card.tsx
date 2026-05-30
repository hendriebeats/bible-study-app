"use client";

import { Copy, ExternalLink, Globe, Pencil, Unlink } from "lucide-react";
import type { EditorView } from "prosemirror-view";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { fetchLinkPreview, type LinkPreview } from "@/app/links/actions";
import { clearLink } from "@/lib/editor/commands";
import { placeNearAnchor } from "@/lib/editor/floating-position";
import {
  HOVER_DELAY_MS,
  LINK_PREVIEW_HIDE_EVENT,
  LINK_PREVIEW_SHOW_EVENT,
  type LinkPreviewShowDetail,
} from "@/lib/editor/plugins/link-preview";
import { type LinkAttrs, marks } from "@/lib/editor/schema";

const CARD_WIDTH = 360;
const CARD_ESTIMATED_HEIGHT = 180;
/** Grace period after pointer leaves the link before we actually hide. */
const HIDE_GRACE_MS = 180;

type CardState =
  | { kind: "loading" }
  | { kind: "ok"; preview: LinkPreview }
  | { kind: "failed"; url: string };

interface ActiveCard {
  href: string;
  anchor: { left: number; top: number; right: number; bottom: number };
  /** PM view + range — used for Edit/Remove and lazy backfill. */
  view: EditorView;
  range: { from: number; to: number } | null;
  /** Cached attrs already on the link mark; drives whether to back-write. */
  markAttrs: LinkAttrs;
}

/**
 * Lazily back-write fetched preview data onto the link mark so future hovers
 * are instant AND the cached attrs round-trip through copy/paste / version
 * history. Tagged `addToHistory: false` + `preview-backfill: true` so it
 * doesn't pollute Cmd-Z and autosave plugins can skip it.
 */
function backfillMarkAttrs(
  view: EditorView,
  range: { from: number; to: number },
  current: LinkAttrs,
  preview: LinkPreview,
): void {
  if (!view.editable || view.isDestroyed) return;
  // Only write when there's *new* data.
  const next: LinkAttrs = {
    href: current.href,
    title: current.title,
    displayTitle: current.displayTitle ?? preview.title,
    favicon: current.favicon ?? preview.faviconUrl,
    siteName: current.siteName ?? preview.siteName,
  };
  const unchanged =
    next.displayTitle === current.displayTitle &&
    next.favicon === current.favicon &&
    next.siteName === current.siteName;
  if (unchanged) return;
  try {
    const linkType = marks.link;
    const tr = view.state.tr;
    // Verify the link mark still spans the range and still matches the href
    // we fetched — defensive in case the doc shifted before backfill resolves.
    const stillThere = { value: false };
    view.state.doc.nodesBetween(range.from, range.to, (node) => {
      if (!node.isText) return true;
      const mark = node.marks.find((m) => m.type === linkType);
      if (mark && (mark.attrs as LinkAttrs).href === current.href) {
        stillThere.value = true;
      }
      return false;
    });
    if (!stillThere.value) return;
    tr.removeMark(range.from, range.to, linkType).addMark(
      range.from,
      range.to,
      linkType.create(next),
    );
    tr.setMeta("addToHistory", false);
    tr.setMeta("preview-backfill", true);
    view.dispatch(tr);
  } catch {
    // Doc could be in mid-mutation; ignore.
  }
}

/**
 * Render a Google-Docs-style hover preview card for the editor's link marks.
 *
 * Listens to the {@link LINK_PREVIEW_SHOW_EVENT} / {@link LINK_PREVIEW_HIDE_EVENT}
 * events emitted by the hover plugin, debounces show by {@link HOVER_DELAY_MS}
 * so a quick mouse-by doesn't flash a card, and stays open while the pointer
 * is over the card itself (sticky-on-card). Owns a session-scoped Promise
 * cache so re-hovers within one session are instant.
 *
 * Mount once per editor surface (alongside SelectionBubble / LinkPopover);
 * the component manages its own portal under `document.body`.
 */
export function LinkPreviewCardPortal() {
  const ctx = useEditorContext();
  const openLinkPopover = ctx?.openLinkPopover;
  const closeLinkPopover = ctx?.closeLinkPopover;

  const [card, setCard] = useState<ActiveCard | null>(null);
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Session cache: per-href, shared across all hovers within this editor mount.
  const cacheRef = useRef<Map<string, Promise<LinkPreview>>>(new Map());
  // Synchronously-tracked "what href is the card currently showing for"
  // — set BEFORE setCard so an awaiting fetch resolver can tell whether
  // it's still on-target (cardRef would be null during the React commit
  // window, dropping fast cache hits and leaving the card stuck on the
  // partial seed; this ref dodges that race).
  const currentHrefRef = useRef<string | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOnCardRef = useRef(false);

  const clearShowTimer = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };
  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  // Close the card AND clear the active-href ref so a subsequent hover of
  // any link (including the same one) gets its fetch resolver re-armed.
  const dismiss = () => {
    currentHrefRef.current = null;
    setCard(null);
  };

  const fetchPreview = useCallback((href: string): Promise<LinkPreview> => {
    const cached = cacheRef.current.get(href);
    if (cached) return cached;
    const promise = fetchLinkPreview(href).catch(
      (): LinkPreview => ({
        status: "failed",
        url: href,
        title: null,
        description: null,
        imageUrl: null,
        faviconUrl: null,
        siteName: null,
      }),
    );
    cacheRef.current.set(href, promise);
    return promise;
  }, []);

  // Subscribe to show / hide events.
  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<LinkPreviewShowDetail>).detail;
      clearHideTimer();
      // If the same href is already showing, just update position so the
      // card tracks across text that wraps to a new line.
      if (card?.href === detail.href) {
        setCard({
          href: detail.href,
          anchor: detail.anchor,
          view: detail.view,
          range: detail.range,
          markAttrs: detail.attrs,
        });
        return;
      }
      clearShowTimer();
      // Kick the fetch off NOW (in parallel with the hover-delay timer) so
      // by the time the delay elapses the preview is usually already in the
      // session cache. The card itself doesn't mount until both the delay
      // has elapsed AND the fetch has resolved — no interim "loading" or
      // partial-seed flash.
      const preview$ = fetchPreview(detail.href);
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        // Synchronously mark which href we're awaiting so the resolver can
        // bail if the user moves on before it lands.
        currentHrefRef.current = detail.href;
        void preview$.then((preview) => {
          if (currentHrefRef.current !== detail.href) return;
          // Position synchronously with the same render batch so the first
          // paint already lands at the anchor — otherwise the card briefly
          // flashes at (0, 0) before the layout-effect refinement moves it.
          // Initial estimate uses CARD_ESTIMATED_HEIGHT; the layout effect
          // below tightens it up once the real height is measured (still
          // pre-paint via useLayoutEffect).
          const placement = placeNearAnchor(
            detail.anchor,
            { width: CARD_WIDTH, height: CARD_ESTIMATED_HEIGHT },
            { preferred: "below", gap: 8, align: "start" },
          );
          setPos({ left: placement.left, top: placement.top });
          setCard({
            href: detail.href,
            anchor: detail.anchor,
            view: detail.view,
            range: detail.range,
            markAttrs: detail.attrs,
          });
          setState(
            preview.status === "ok"
              ? { kind: "ok", preview }
              : { kind: "failed", url: detail.href },
          );
          if (preview.status === "ok" && detail.range) {
            backfillMarkAttrs(detail.view, detail.range, detail.attrs, preview);
          }
        });
      }, HOVER_DELAY_MS);
    };

    const onHide = (_event: Event) => {
      clearShowTimer();
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        if (pointerOnCardRef.current) return;
        dismiss();
      }, HIDE_GRACE_MS);
    };

    window.addEventListener(LINK_PREVIEW_SHOW_EVENT, onShow);
    window.addEventListener(LINK_PREVIEW_HIDE_EVENT, onHide);
    return () => {
      window.removeEventListener(LINK_PREVIEW_SHOW_EVENT, onShow);
      window.removeEventListener(LINK_PREVIEW_HIDE_EVENT, onHide);
      clearShowTimer();
      clearHideTimer();
    };
  }, [card?.href, fetchPreview]);

  // Refine the position once the real card height is known. useLayoutEffect
  // (not useEffect) so the corrected position is committed BEFORE the
  // browser paints — pairs with the same-batch initial setPos in the show
  // handler to give a single, jitter-free paint.
  useLayoutEffect(() => {
    if (!card) return;
    const size = {
      width: CARD_WIDTH,
      height: cardRef.current?.offsetHeight ?? CARD_ESTIMATED_HEIGHT,
    };
    const placement = placeNearAnchor(card.anchor, size, {
      preferred: "below",
      gap: 8,
      align: "start",
    });
    setPos((prev) =>
      prev.left === placement.left && prev.top === placement.top
        ? prev
        : { left: placement.left, top: placement.top },
    );
  }, [card, state]);

  // Global "modifier key down" tracker — lets us swap the cursor over
  // editor links to a pointer while Cmd/Ctrl is held, signalling that a
  // click will open the link in a new tab. Toggles a data-attr on <body>
  // that a single CSS rule keys off (no per-link listeners or React
  // re-renders). Cleared on blur to handle Cmd-Tab away.
  useEffect(() => {
    const update = (down: boolean) => {
      if (down) document.body.dataset.modKeyDown = "true";
      else delete document.body.dataset.modKeyDown;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") update(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") update(false);
    };
    const onBlur = () => {
      update(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      update(false);
    };
  }, []);

  if (!card) return null;

  const preview =
    state.kind === "ok"
      ? state.preview
      : ({
          status: "failed",
          url: card.href,
          title: null,
          description: null,
          imageUrl: null,
          faviconUrl: card.markAttrs.favicon,
          siteName: card.markAttrs.siteName,
        } satisfies LinkPreview);

  const handleOpen = () => {
    window.open(card.href, "_blank", "noopener,noreferrer");
  };
  const handleCopy = () => {
    void navigator.clipboard
      .writeText(card.href)
      .then(() => {
        toast.success("Link copied");
      })
      .catch(() => {
        toast.error("Couldn't copy link");
      });
  };
  const handleEdit = () => {
    if (!openLinkPopover || !card.range) return;
    const { view, range, markAttrs } = card;
    const text = view.state.doc.textBetween(range.from, range.to, "", "");
    openLinkPopover({
      mode: "edit",
      anchor: card.anchor,
      range,
      initialUrl: markAttrs.href,
      initialText: text,
      view,
    });
    dismiss();
  };
  const handleRemove = () => {
    if (!card.range) return;
    const { view, range } = card;
    clearLink(range.from, range.to)(view.state, view.dispatch, view);
    closeLinkPopover?.();
    dismiss();
  };

  const canMutate = card.view.editable && card.range !== null;
  const host = (() => {
    try {
      return new URL(card.href).hostname.replace(/^www\./, "");
    } catch {
      return card.href;
    }
  })();

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Link preview"
      onPointerEnter={() => {
        pointerOnCardRef.current = true;
        clearHideTimer();
      }}
      onPointerLeave={() => {
        pointerOnCardRef.current = false;
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          dismiss();
        }, HIDE_GRACE_MS);
      }}
      className="fixed z-50 w-link-preview overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="flex gap-3 p-3">
        {preview.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-16 shrink-0 rounded-md object-cover"
            onError={(e) => {
              // Hide the broken thumbnail rather than collapse the card.
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {preview.faviconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.faviconUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-8"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <Globe className="size-6" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {state.kind === "loading" && !preview.title ? (
            <>
              <div className="h-4 w-3/4 animate-pulse rounded-sm bg-muted" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded-sm bg-muted" />
              <div className="mt-2 h-3 w-full animate-pulse rounded-sm bg-muted" />
            </>
          ) : (
            <>
              <div className="line-clamp-2 text-ui font-semibold">
                {preview.title ?? host}
              </div>
              <div className="mt-0.5 truncate text-caption text-muted-foreground">
                {host}
              </div>
              {preview.description ? (
                <div className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                  {preview.description}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-border px-2 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleOpen}
          className="gap-1"
        >
          <ExternalLink className="size-3.5" />
          Open
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="gap-1"
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
        {canMutate ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleEdit}
              className="gap-1"
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              className="ml-auto gap-1 text-destructive hover:text-destructive"
            >
              <Unlink className="size-3.5" />
              Remove
            </Button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
