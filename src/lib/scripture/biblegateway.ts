import type { ParsedReference } from "./reference";

/**
 * Bible Gateway URL builder for cross-reference chip navigation.
 *
 * Unlike BibleHub (which only supports single-verse or whole-chapter URLs),
 * Bible Gateway renders any verse range natively via its `?search=…` query
 * param, e.g. `John 3:16-18` or `John 3:16-4:2`. It also supports 100+
 * translations through `&version=…` and lets the user switch translations
 * once they land on the page.
 *
 * URL pattern (verified against the live site):
 *   https://www.biblegateway.com/passage/?search=John+3%3A16-18&version=ESV
 *
 * For chapter-only refs we render just the chapter (`John 3`); for
 * cross-chapter ranges (`John 3:16-4:2`) we keep the colon form intact.
 */

export type BibleGatewayTranslation = "ESV" | "NLT" | "NIV";

/**
 * Bible Gateway URL for a parsed reference. The translation defaults to ESV
 * to match the preview-text source. Returns `null` only if `parsed.book` is
 * empty (defensive — `parseReference` never produces that).
 */
export function bibleGatewayUrl(
  parsed: ParsedReference,
  translation: BibleGatewayTranslation = "ESV",
): string | null {
  const refQuery = referenceQueryString(parsed);
  if (!refQuery) return null;
  const url = new URL("https://www.biblegateway.com/passage/");
  url.searchParams.set("search", refQuery);
  url.searchParams.set("version", translation);
  return url.toString();
}

/**
 * Render the canonical reference as Bible Gateway expects in its `search`
 * query param. URLSearchParams will URL-encode the colon and spaces on its
 * own, so we just produce the human-readable form.
 *
 * Whole-chapter encoding (`endVerse >= 999`) is the sentinel
 * {@link import("./reference").WHOLE_CHAPTER_END} uses; render as a bare
 * chapter (no `:verse`) so Bible Gateway shows the whole chapter.
 */
function referenceQueryString(parsed: ParsedReference): string | null {
  if (!parsed.book) return null;
  const { book, startChapter, startVerse, endChapter, endVerse } = parsed;
  const sc = String(startChapter);
  const sv = String(startVerse);
  const ec = String(endChapter);
  const ev = String(endVerse);
  const isWholeChapter = startVerse === 1 && endVerse >= 999;
  if (isWholeChapter) {
    return startChapter === endChapter
      ? `${book} ${sc}`
      : `${book} ${sc}-${ec}`;
  }
  if (startChapter === endChapter && startVerse === endVerse) {
    return `${book} ${sc}:${sv}`;
  }
  if (startChapter === endChapter) {
    return `${book} ${sc}:${sv}-${ev}`;
  }
  return `${book} ${sc}:${sv}-${ec}:${ev}`;
}
