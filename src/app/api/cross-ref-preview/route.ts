/**
 * GET /api/cross-ref-preview?ref=John+3:16
 *
 * Server-side proxy that fetches a compact preview of a scripture reference.
 * The ESV API key is read from `process.env.ESV_API_KEY` and never leaves the
 * server. Used by the cross-ref click popover.
 *
 * Cap policy:
 *   - At most {@link MAX_VERSES} verses are fetched from ESV. If the user's
 *     reference spans more, we narrow the FETCH to the first N verses
 *     starting at `startVerse` (within the starting chapter) and return
 *     `truncated: true`. The chip's own link still targets the full range.
 *   - A trailing "…" is appended to the returned text whenever the verse cap
 *     fired, so the popover always shows a clear truncation indicator.
 *   - The client additionally clamps the rendered text to 7 visual lines via
 *     CSS, so even within the verse cap a wrapping preview stays compact.
 *
 * The route itself does no caching — it relies on the Next.js data cache on
 * the upstream `fetch` (the ESV provider sets `next: { revalidate: 30d }`)
 * plus the per-session Map the client maintains in `esv-preview.ts`.
 *
 * Auth: requires an authenticated user (no public preview endpoint), since
 * the ESV API quota is finite and shared.
 */

import { NextResponse } from "next/server";

import { getScriptureProvider } from "@/lib/scripture";
import {
  parseReference,
  WHOLE_CHAPTER_END,
  type ParsedReference,
} from "@/lib/scripture/reference";
import { createClient } from "@/lib/supabase/server";

/** Hard ceiling on how many verses we'll pull from ESV for a single preview. */
const MAX_VERSES = 3;

export interface CrossRefPreviewBody {
  /** Canonical reference (from the ESV response, e.g. "John 3:16"). */
  reference: string;
  /**
   * Plain-text verse content. If the requested range was longer than
   * {@link MAX_VERSES}, this is the first N verses only and ends with `…`.
   */
  text: string;
  /** True iff the verse cap fired and `text` represents only part of the
   * requested range. */
  truncated: boolean;
  version: string;
}

export interface CrossRefPreviewError {
  error: string;
}

export async function GET(
  request: Request,
): Promise<NextResponse<CrossRefPreviewBody | CrossRefPreviewError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const ref = url.searchParams.get("ref")?.trim();
  if (!ref) {
    return NextResponse.json({ error: "Missing ref" }, { status: 400 });
  }
  const parsed = parseReference(ref);
  if (!parsed) {
    return NextResponse.json(
      { error: "Unparseable reference" },
      { status: 400 },
    );
  }

  let provider;
  try {
    provider = getScriptureProvider();
  } catch {
    // No ESV_API_KEY configured — graceful 503 so the popover knows to fall
    // back to header-only rather than treating it as a transient failure.
    return NextResponse.json(
      { error: "Scripture provider not configured" },
      { status: 503 },
    );
  }

  // Narrow the fetch to ≤ MAX_VERSES verses before going to ESV. We never
  // pull more than we'll show, both to save API quota and to keep the
  // popover compact.
  const { fetchRef, truncated } = capForFetch(parsed);

  let passage;
  try {
    passage = await provider.getPassage(fetchRef);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch passage" },
      { status: 502 },
    );
  }

  const cleaned = cleanPassage(passage.content);
  // The verse cap is the only server-side cap. The 7-line VISUAL cap is
  // handled purely by CSS on the client (`-webkit-line-clamp: 7`), which
  // also renders the trailing ellipsis at the cut point. If the verse cap
  // fired we still append " …" so the truncation indicator is visible even
  // when the (3-verse) text happens to fit within 7 lines.
  const text = truncated ? `${cleaned} …` : cleaned;

  return NextResponse.json({
    reference: passage.reference,
    text,
    truncated,
    version: passage.version,
  });
}

/**
 * Decide the actual reference string to fetch from ESV. If the parsed range
 * spans more than {@link MAX_VERSES} verses (counted within the starting
 * chapter for simplicity — cross-chapter ranges are always considered "too
 * many" because we can't know per-chapter verse counts here), narrow it to
 * the first N verses. Returns the (possibly-narrowed) reference string and
 * a flag indicating whether narrowing happened.
 */
function capForFetch(parsed: ParsedReference): {
  fetchRef: string;
  truncated: boolean;
} {
  const { book, startChapter, startVerse, endChapter, endVerse } = parsed;
  const wholeChapter = endVerse >= WHOLE_CHAPTER_END;
  const crossChapter = endChapter !== startChapter;

  // Same-chapter, finite range: check the verse count directly.
  if (!wholeChapter && !crossChapter) {
    const verseCount = endVerse - startVerse + 1;
    if (verseCount <= MAX_VERSES) {
      return {
        fetchRef: buildRef(book, startChapter, startVerse, endVerse),
        truncated: false,
      };
    }
    return {
      fetchRef: buildRef(
        book,
        startChapter,
        startVerse,
        startVerse + MAX_VERSES - 1,
      ),
      truncated: true,
    };
  }

  // Whole chapter ("John 3") OR cross-chapter range OR ranges of chapters:
  // fetch the first MAX_VERSES verses starting at startVerse.
  return {
    fetchRef: buildRef(
      book,
      startChapter,
      startVerse,
      startVerse + MAX_VERSES - 1,
    ),
    truncated: true,
  };
}

function buildRef(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
): string {
  const sc = String(chapter);
  const sv = String(startVerse);
  const ev = String(endVerse);
  return startVerse === endVerse
    ? `${book} ${sc}:${sv}`
    : `${book} ${sc}:${sv}-${ev}`;
}

/**
 * Strip the verse-number markers (`[3]`, `[c:v]`) the ESV provider emits and
 * collapse internal whitespace so the popover shows clean prose.
 *
 * Keeps the leading-paragraph indentation the ESV API uses (a single space at
 * the start of a paragraph) out of the truncated string.
 */
function cleanPassage(raw: string): string {
  return (
    raw
      // Bracketed verse markers ESV emits before each verse number.
      .replace(/\[\d+(?::\d+)?\]\s*/g, "")
      // Trailing/leading whitespace and collapse runs of whitespace.
      .replace(/\s+/g, " ")
      .trim()
  );
}
