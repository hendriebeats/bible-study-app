/**
 * Client-side cache + fetcher for the cross-reference preview popover.
 *
 * The popover shows a truncated verse preview each time the user clicks a
 * `cross-ref` chip. Each reference is fetched at most ONCE per session and
 * stored in an in-memory Map — the ESV verse text never changes within a
 * session, so refetching adds no value and spends API quota.
 *
 * Goes through `/api/cross-ref-preview` so the ESV API key stays server-side.
 */

import type { CrossRefAttrs } from "@/lib/editor/plugins/cross-ref-detect";

import { BOOKS } from "./books";
import { canonicalReferenceText } from "./progressive-reference";

export interface CrossRefPreview {
  reference: string;
  text: string;
  truncated: boolean;
  version: string;
}

/**
 * Result of a preview fetch. `state: "ok"` carries text; `"unavailable"`
 * means the request failed in a way the UI should degrade gracefully (no
 * ESV key configured, network error, 4xx); `"loading"` is the transient
 * state surfaced for skeletons.
 */
export type CrossRefPreviewResult =
  | { state: "ok"; preview: CrossRefPreview }
  | { state: "unavailable" }
  | { state: "loading" };

const cache = new Map<string, Promise<CrossRefPreviewResult>>();

/** Stable key so e.g. "John 3:16" maps to the same entry as the typed form. */
function cacheKey(attrs: CrossRefAttrs): string {
  return [
    attrs.book,
    attrs.startChapter,
    attrs.startVerse,
    attrs.endChapter,
    attrs.endVerse,
  ].join(":");
}

/** Synchronous read of an already-cached preview; null if not yet fetched. */
export function readCrossRefPreview(
  attrs: CrossRefAttrs,
): Promise<CrossRefPreviewResult> | null {
  return cache.get(cacheKey(attrs)) ?? null;
}

/**
 * Fetch (or return the cached promise for) the preview text for `attrs`. The
 * caller can await the promise and switch on the `state` discriminator.
 *
 * Falls back to `{ state: "unavailable" }` on any error so callers don't
 * need try/catch boilerplate.
 */
export function fetchCrossRefPreview(
  attrs: CrossRefAttrs,
): Promise<CrossRefPreviewResult> {
  const key = cacheKey(attrs);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = doFetch(attrs);
  cache.set(key, promise);
  return promise;
}

async function doFetch(attrs: CrossRefAttrs): Promise<CrossRefPreviewResult> {
  const ref = canonicalRefFromAttrs(attrs);
  if (!ref) return { state: "unavailable" };
  try {
    const url = `/api/cross-ref-preview?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      return { state: "unavailable" };
    }
    const data = (await res.json()) as CrossRefPreview;
    return { state: "ok", preview: data };
  } catch {
    return { state: "unavailable" };
  }
}

const BOOK_NAME_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.name]),
);
const BOOK_SHORT_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.short]),
);

/**
 * Build the canonical reference string ("Gen 1:1", "Ps 23", …) from the
 * chip's stored attributes. Used for the chip's `raw` text on first commit
 * and for the popover header when the chip's `raw` attr isn't available.
 *
 * Note: this rebuilds from the range-form attrs and can't recover the
 * comma-list form (`John 3:16, 18`) since `attrs` doesn't carry the verse
 * list. Callers that already have the chip's text (e.g. the popover, which
 * reads `attrs.raw`) should prefer that text to preserve the user's typed
 * form.
 */
export function canonicalRefFromAttrs(attrs: CrossRefAttrs): string | null {
  const name = BOOK_NAME_BY_ORDINAL.get(attrs.book);
  const short = BOOK_SHORT_BY_ORDINAL.get(attrs.book);
  if (!name || !short) return null;
  return canonicalReferenceText({
    book: name,
    bookShort: short,
    bookOrdinal: attrs.book,
    startChapter: attrs.startChapter,
    startVerse: attrs.startVerse,
    endChapter: attrs.endChapter,
    endVerse: attrs.endVerse,
    startVerseId: 0,
    endVerseId: 0,
  });
}
