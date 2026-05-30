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
  /** Full canonical name, e.g. "Genesis", "1 Corinthians". */
  book: string;
  /** SBL Handbook short name, e.g. "Gen", "1 Cor". Used by chip display. */
  bookShort: string;
  bookOrdinal: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  startVerseId: number;
  endVerseId: number;
  /**
   * When the user typed a comma-list verse form like `John 3:16, 18`, this
   * holds the full list of verse numbers (`[16, 18]`). `endVerse` is
   * extended to `max(verses)` so range-based math still works, but the
   * chip's display preserves the comma form rather than collapsing to
   * `John 3:16-18`. Absent for any non-comma-form reference.
   */
  verses?: readonly number[];
}

export function packVerseId(
  bookOrdinal: number,
  chapter: number,
  verse: number,
): number {
  return bookOrdinal * VERSE_ID_BOOK + chapter * VERSE_ID_CHAPTER + verse;
}

// book (optional leading 1-3 for numbered books) + chapter[:verse][ - chapter[:verse] | - verse ]
//
// The `\s*` between the book name and chapter (rather than `\s+`) is what
// lets `John3:16` and `1John3:16` parse — the lazy book-name match plus the
// permissive whitespace means the chapter digits can sit flush against the
// book name. Standard `John 3:16` still matches the same way.
const REFERENCE_RE =
  /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)\s*(\d+)(?::(\d+))?(?:\s*[-–—]\s*(\d+)(?::(\d+))?)?\s*$/;

/**
 * Tail pattern matching a comma-separated verse list: ", 18" or ", 18, 20".
 * Stripped from the input before the main regex runs; the captured verse
 * numbers are merged into `verses` and used to extend `endVerse`.
 */
const COMMA_LIST_TAIL_RE = /(\s*,\s*\d+)+\s*$/;

/**
 * Parse a single reference like "John 3:16", "John 3:1-21", "John 3",
 * "John 3-4", or "John 3:16-4:2". Also accepts:
 *   - the no-space numeric-prefix form (`1John 3:16`)
 *   - the no-space book↔chapter form (`John3:16`)
 *   - the comma-list verse form (`John 3:16, 18` → start 16, end 18, with
 *     `verses: [16, 18]` so the canonical display preserves the comma)
 *
 * Returns null if it can't be parsed or names an unknown book / out-of-range
 * chapter.
 */
export function parseReference(input: string): ParsedReference | null {
  // Step 1: peel off any trailing comma-list (`, 18, 20`) so the main regex
  // sees only the base reference. We only honor the list when the base
  // reference also has an explicit start verse — `John 3, 4` with no colon
  // is too ambiguous (could mean "chapters 3 and 4") so we leave it for the
  // base regex to fail on.
  let core = input;
  const commaListMatch = COMMA_LIST_TAIL_RE.exec(input);
  let listVerses: number[] = [];
  if (commaListMatch) {
    const tail = commaListMatch[0];
    listVerses = Array.from(tail.matchAll(/\d+/g)).map((m) => Number(m[0]));
    core = input.slice(0, input.length - tail.length);
  }

  const match = REFERENCE_RE.exec(core);
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
    // No start verse: whole chapter(s). Comma-list isn't meaningful here
    // (it would mean "chapters 3, 4" which we don't support), so drop it.
    listVerses = [];
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

  // Merge any comma-list verses into the range. We keep the user-typed list
  // (start-verse + list-verses) as `verses` so the canonical text display
  // can preserve the comma form, and we extend `endVerse` to the max so any
  // range-based math (overlap, Bible Gateway URL, ESV preview cap) still
  // covers the whole span the user implicated.
  let verses: number[] | undefined;
  if (listVerses.length > 0) {
    verses = [startVerse, ...listVerses];
    const maxV = Math.max(...verses);
    if (maxV > endVerse) {
      endVerse = maxV;
    }
    // Reject if any listed verse is BEFORE the start verse (e.g. "3:16, 1"
    // mid-typing) — that's not a meaningful list, and pretending it is
    // would let the chip commit on garbage.
    if (verses.some((v) => v < startVerse)) return null;
  }

  if (endChapter < startChapter || endChapter > book.chapters) return null;
  if (endChapter === startChapter && endVerse < startVerse) return null;

  return {
    book: book.name,
    bookShort: book.short,
    bookOrdinal: book.ordinal,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
    startVerseId: packVerseId(book.ordinal, startChapter, startVerse),
    endVerseId: packVerseId(book.ordinal, endChapter, endVerse),
    ...(verses ? { verses } : {}),
  };
}
