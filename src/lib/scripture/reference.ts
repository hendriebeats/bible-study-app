import { type BibleBook, findBook } from "./books";

/**
 * Parses a free-text scripture reference into a normalized verse range and
 * computes packed absolute verse ids for overlap math.
 *
 * A packed verse id is `bookOrdinal * 1_000_000 + chapter * 1_000 + verse`.
 * This keeps a whole reference range as a single integer interval
 * `[startVerseId, endVerseId]`, so cross-study overlap is pure (indexable)
 * integer arithmetic. Max real chapter is 150 (Psalms) and max real verse is
 * 176, both well under their 1,000 multipliers, so ids never collide.
 *
 * Whole-chapter ranges (e.g. "John 3", "John 3-4") use {@link WHOLE_CHAPTER_END}
 * as the upper verse bound instead of a real last-verse count — sufficient for
 * overlap/containment scoring without shipping a per-chapter verse table.
 */

/** Verse sentinel for "to the end of the chapter" (above any real verse). */
export const WHOLE_CHAPTER_END = 999;

const VERSE_ID_BOOK = 1_000_000;
const VERSE_ID_CHAPTER = 1_000;

export interface ParsedReference {
  book: string;
  bookOrdinal: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  startVerseId: number;
  endVerseId: number;
}

export function packVerseId(
  bookOrdinal: number,
  chapter: number,
  verse: number,
): number {
  return bookOrdinal * VERSE_ID_BOOK + chapter * VERSE_ID_CHAPTER + verse;
}

// book (optional leading 1-3 for numbered books) + chapter[:verse][ - chapter[:verse] | - verse ]
const REFERENCE_RE =
  /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)\s+(\d+)(?::(\d+))?(?:\s*[-–—]\s*(\d+)(?::(\d+))?)?\s*$/;

/**
 * Parse a single reference like "John 3:16", "John 3:1-21", "John 3",
 * "John 3-4", or "John 3:16-4:2". Returns null if it can't be parsed or names
 * an unknown book / out-of-range chapter.
 */
export function parseReference(input: string): ParsedReference | null {
  const match = REFERENCE_RE.exec(input);
  if (!match) return null;

  const [, bookToken, c1, v1, c2OrV2, v2] = match;
  if (!bookToken || !c1) return null;

  const book: BibleBook | undefined = findBook(bookToken);
  if (!book) return null;

  const startChapter = Number(c1);
  if (startChapter < 1 || startChapter > book.chapters) return null;

  let startVerse: number;
  let endChapter: number;
  let endVerse: number;

  if (v1 !== undefined) {
    // A start verse was given: ranges extend by verse or by chapter:verse.
    startVerse = Number(v1);
    if (v2 !== undefined && c2OrV2 !== undefined) {
      // "C:V - C:V"
      endChapter = Number(c2OrV2);
      endVerse = Number(v2);
    } else if (c2OrV2 !== undefined) {
      // "C:V - V" (same chapter)
      endChapter = startChapter;
      endVerse = Number(c2OrV2);
    } else {
      // "C:V"
      endChapter = startChapter;
      endVerse = startVerse;
    }
  } else {
    // No start verse: whole chapter(s).
    startVerse = 1;
    if (c2OrV2 !== undefined) {
      // "C - C"
      endChapter = Number(c2OrV2);
    } else {
      // "C"
      endChapter = startChapter;
    }
    endVerse = WHOLE_CHAPTER_END;
  }

  if (endChapter < startChapter || endChapter > book.chapters) return null;
  if (endChapter === startChapter && endVerse < startVerse) return null;

  return {
    book: book.name,
    bookOrdinal: book.ordinal,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
    startVerseId: packVerseId(book.ordinal, startChapter, startVerse),
    endVerseId: packVerseId(book.ordinal, endChapter, endVerse),
  };
}
