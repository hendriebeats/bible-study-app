import { BOOKS } from "./books";

/**
 * BibleHub verse-page slugs. Almost every book is its canonical name lowercased
 * with spaces joined by underscores ("1 Corinthians" → `1_corinthians`,
 * "Psalms" → `psalms`); the handful that don't follow that rule are overridden
 * here, keyed by canonical book ordinal (1–66). Verify against live pages when
 * adding more (e.g. https://biblehub.com/genesis/1-1.htm).
 */
const SLUG_OVERRIDES: Readonly<Record<number, string>> = {
  22: "songs", // Song of Solomon → biblehub.com/songs/...
};

const SLUG_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((book) => [
    book.ordinal,
    SLUG_OVERRIDES[book.ordinal] ??
      book.name.toLowerCase().replace(/\s+/g, "_"),
  ]),
);

/**
 * The BibleHub page URL for a single verse, or `null` for an unknown book
 * ordinal. Pattern: `https://biblehub.com/{slug}/{chapter}-{verse}.htm`.
 */
export function bibleHubUrl(
  bookOrdinal: number,
  chapter: number,
  verse: number,
): string | null {
  const slug = SLUG_BY_ORDINAL.get(bookOrdinal);
  if (!slug) {
    return null;
  }
  return `https://biblehub.com/${slug}/${String(chapter)}-${String(verse)}.htm`;
}
