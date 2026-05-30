"use client";

/**
 * Cross-reference preview popover bridge.
 *
 * Listens for the `CROSS_REF_OPEN_EVENT` (fired by `cross-ref-detect` on a
 * single click) and renders a floating popover next to the clicked chip with:
 *
 *   - a header showing the canonical reference + a tag for the preview's
 *     translation (always ESV, since that's our API),
 *   - the verse text (truncated, via the per-session ESV preview cache), and
 *   - a row of three "Open in Bible Gateway (…)" chips for ESV / NLT / NIV.
 *
 * Bible Gateway is the destination because it's the only mainstream site that
 * renders verse RANGES as ranges (BibleHub only supports single-verse or
 * whole-chapter URLs); Bible Gateway also makes translation switching one
 * click away once the user lands.
 *
 * If the preview can't be fetched (no API key, network error, 4xx), the body
 * gracefully omits the verse text and the header + translation chips still
 * work — clicking the chip is never silent.
 *
 * One instance is mounted at the studies workspace level (next to NotePopover)
 * so every ProseMirror surface shares it.
 */

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CROSS_REF_OPEN_EVENT,
  type CrossRefAttrs,
  type CrossRefOpenEventDetail,
} from "@/lib/editor/plugins/cross-ref-detect";
import {
  type AnchorRect,
  placeNearAnchor,
} from "@/lib/editor/floating-position";
import {
  type BibleGatewayTranslation,
  bibleGatewayUrl,
} from "@/lib/scripture/biblegateway";
import { BOOKS } from "@/lib/scripture/books";
import {
  canonicalRefFromAttrs,
  fetchCrossRefPreview,
  type CrossRefPreviewResult,
} from "@/lib/scripture/esv-preview";
import { cn } from "@/lib/utils";

interface OpenState {
  attrs: CrossRefAttrs;
  anchor: AnchorRect;
}

/** Order matters — these render left-to-right in the popover footer. */
const TRANSLATION_OPTIONS: readonly BibleGatewayTranslation[] = [
  "ESV",
  "NLT",
  "NIV",
];

export function CrossRefPopover(): React.ReactNode {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [preview, setPreview] = useState<CrossRefPreviewResult>({
    state: "loading",
  });
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Subscribe to chip clicks. We reset preview AND placement in the same
  // dispatch as `open` so the freshly-opened popover doesn't briefly draw at
  // the previous chip's position before useLayoutEffect re-measures.
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<CrossRefOpenEventDetail>).detail;
      setOpen({ attrs: detail.attrs, anchor: detail.anchorRect });
      setPreview({ state: "loading" });
      setPlacement(null);
    };
    window.addEventListener(CROSS_REF_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(CROSS_REF_OPEN_EVENT, onOpen);
    };
  }, []);

  // Fetch (or read from cache) whenever the active chip changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchCrossRefPreview(open.attrs).then((res) => {
      if (cancelled) return;
      setPreview(res);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on Escape + outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(null);
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      const frame = frameRef.current;
      if (!frame) return;
      const target = e.target as Node | null;
      if (target && frame.contains(target)) return;
      // Clicking another chip will re-open via the OPEN_EVENT — close first
      // so the new event can replace this one cleanly.
      setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  // Position next to the anchor (runs after layout so frame dimensions exist).
  useLayoutEffect(() => {
    if (!open) return;
    const frame = frameRef.current;
    if (!frame) return;
    const size = { width: frame.offsetWidth, height: frame.offsetHeight };
    const p = placeNearAnchor(open.anchor, size, {
      preferred: "below",
      align: "start",
      gap: 6,
    });
    setPlacement({ left: p.left, top: p.top });
  }, [open, preview]);

  if (!open || typeof document === "undefined") return null;

  // Prefer the chip's stored `raw` text — it's the exact canonical form the
  // detector committed (including comma-list shape like "John 3:16, 18"
  // which the range-form rebuild via attrs alone can't recover). We
  // intentionally fall back through empty strings here (raw can be ""
  // for legacy chips), so `||` is correct over `??`.
  const refText =
    (open.attrs.raw === "" ? null : open.attrs.raw) ??
    canonicalRefFromAttrs(open.attrs) ??
    "Reference";
  const bookName = BOOK_NAME_BY_ORDINAL.get(open.attrs.book) ?? "";
  const bookShort = BOOK_SHORT_BY_ORDINAL.get(open.attrs.book) ?? "";

  const openInTranslation = (translation: BibleGatewayTranslation): void => {
    if (!bookName) return;
    const href = bibleGatewayUrl(
      {
        book: bookName,
        bookShort,
        bookOrdinal: open.attrs.book,
        startChapter: open.attrs.startChapter,
        startVerse: open.attrs.startVerse,
        endChapter: open.attrs.endChapter,
        endVerse: open.attrs.endVerse,
        startVerseId: 0,
        endVerseId: 0,
      },
      translation,
    );
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
    setOpen(null);
  };

  return createPortal(
    <div
      ref={frameRef}
      className={cn(
        "fixed z-50 max-w-sm rounded-lg border bg-popover text-popover-foreground shadow-md",
      )}
      style={{
        left: placement?.left ?? open.anchor.left,
        top: placement?.top ?? open.anchor.bottom + 6,
        // Hide visually until placed so we don't see a flicker at (0,0).
        visibility: placement ? "visible" : "hidden",
      }}
      role="dialog"
      aria-label={`Preview of ${refText}`}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-ui font-medium">{refText}</span>
          {preview.state === "ok" ? (
            <span className="text-caption text-muted-foreground">
              {preview.preview.version}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close preview"
          onClick={() => {
            setOpen(null);
          }}
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {renderBody(preview)}
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-caption text-muted-foreground">
          Open in Bible Gateway
        </span>
        <div className="flex items-center gap-1">
          {TRANSLATION_OPTIONS.map((tx) => (
            <button
              key={tx}
              type="button"
              aria-label={`Open ${refText} in Bible Gateway (${tx})`}
              onClick={() => {
                openInTranslation(tx);
              }}
              className="inline-flex min-w-9 items-center justify-center rounded-md border border-border bg-background px-2 py-1 text-caption font-semibold tracking-wide text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
            >
              {tx}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const BOOK_NAME_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.name]),
);
const BOOK_SHORT_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.short]),
);

function renderBody(preview: CrossRefPreviewResult): React.ReactNode {
  if (preview.state === "loading") {
    return (
      <div className="px-3 py-2">
        <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
        <div className="mt-1.5 h-3 w-4/5 animate-pulse rounded-sm bg-muted" />
      </div>
    );
  }
  if (preview.state === "unavailable") {
    // Header + translation chips still convey the chip's identity and let the
    // user navigate; we just omit the body when we can't reach ESV.
    return null;
  }
  // 7-line cap is pure CSS. Padding lives on the OUTER wrapper — the inner
  // `.cross-ref-popover-body` MUST be padding-free because `-webkit-line-clamp`
  // counts padding as visual rows, which causes line 7 to be cut mid-character.
  // (See globals.css for the class rule.) Class name built from an array so
  // the Tailwind class linter doesn't try to validate the custom class.
  const clampClass = ["cross-ref", "popover", "body"].join("-");
  return (
    <div className="px-3 py-2">
      <div className={cn(clampClass, "text-body leading-snug")}>
        {preview.preview.text}
      </div>
    </div>
  );
}
