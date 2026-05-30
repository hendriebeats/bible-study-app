/**
 * Progressive reference matchers, built on {@link parseReference}.
 *
 * `parseReference` is anchored at both ends — it succeeds only when the WHOLE
 * input is a reference. The auto-detect plugin needs two looser variants:
 *
 *   1. {@link findReferenceEndingAt} — given the text run before a caret, find
 *      the LONGEST trailing reference (in characters), tolerating dangling
 *      trailing punctuation the user hasn't finished typing (e.g. `John 3:`
 *      still matches `John 3`). Used by the live detector each transaction.
 *
 *   2. {@link findAllReferences} — given a free chunk of text, return every
 *      non-overlapping reference span inside it. Used by paste handling and
 *      could later back a "Scan document" backfill action.
 *
 * Both return absolute offsets into the input string so the caller can map
 * them onto ProseMirror positions.
 */

import { parseReference, type ParsedReference } from "./reference";

export interface ReferenceMatch {
  /** Inclusive start offset in the input string. */
  start: number;
  /** Exclusive end offset in the input string. */
  end: number;
  parsed: ParsedReference;
}

/**
 * Characters that can appear INSIDE a reference run. Anything else marks the
 * boundary of a candidate run. Notably, sentence punctuation (`,`, `;`, `?`,
 * `!`, `(`, `)`, `"`, `'`) is excluded so e.g. `John 3:16, then ...` doesn't
 * try to swallow the comma.
 */
const REF_CHAR = /[A-Za-z0-9:.\- –—]/;

/** Any letter — used to anchor candidate "book name" starts. */
const ALPHA = /[A-Za-z]/;

/**
 * Find the longest reference ending at (or just before) `textBefore.length`.
 * Strips dangling unparsable trailing characters (a lone `:`, `-`, or `.`)
 * before giving up. Returns null when no candidate parses.
 *
 * Search strategy:
 *   - Walk back from the end through {@link REF_CHAR} characters to find the
 *     enclosing "run". Single internal spaces are allowed, but a double space,
 *     newline, or non-ref character ends the run.
 *   - For each candidate start (start of run, or a position immediately after
 *     an in-run whitespace), and each candidate end (the cursor position, and
 *     positions obtained by stripping trailing `:`/`-`/`.`/spaces), call
 *     `parseReference()` and keep the (start, end) pair that maximizes the
 *     span length.
 *
 * The search space is small (a typical run is <40 chars with <5 candidate
 * starts) so the naive double loop is fine.
 */
export function findReferenceEndingAt(
  textBefore: string,
): ReferenceMatch | null {
  if (textBefore.length === 0) return null;

  // Walk back to find the run start. Stop at a non-ref char, or at a double
  // space / newline (treated as a hard break in mid-prose).
  let runStart = textBefore.length;
  let lastWasSpace = false;
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const ch = textBefore[i] ?? "";
    if (!REF_CHAR.test(ch)) break;
    const isSpace = ch === " ";
    if (isSpace && lastWasSpace) break; // double space — end of run
    lastWasSpace = isSpace;
    runStart = i;
  }
  // Trim any leading whitespace from the candidate run.
  while (runStart < textBefore.length && textBefore[runStart] === " ") {
    runStart++;
  }
  if (runStart >= textBefore.length) return null;

  // Build candidate start positions: the run start, plus every position right
  // after an in-run space. A book name starts with a letter (with optional
  // numeric prefix), so filter to starts that look plausible.
  const candidateStarts: number[] = [];
  const pushIfPlausible = (i: number): void => {
    if (i >= textBefore.length) return;
    const ch = textBefore[i] ?? "";
    if (ALPHA.test(ch)) {
      candidateStarts.push(i);
      return;
    }
    // Numbered books: "1 John", "2 Peter" — the first char is a digit 1–3
    // followed (eventually) by a letter.
    if (ch >= "1" && ch <= "3") {
      candidateStarts.push(i);
    }
  };
  pushIfPlausible(runStart);
  for (let i = runStart; i < textBefore.length; i++) {
    if (textBefore[i] === " ") {
      pushIfPlausible(i + 1);
    }
  }

  // Build candidate end positions: the cursor, plus positions stripping
  // trailing dangling chars one at a time. We keep stripping while the
  // trailing char is one that, on its own, can't be the end of a reference
  // (`:`, `-`, `.`, em/en dash, or whitespace).
  const candidateEnds: number[] = [textBefore.length];
  let end = textBefore.length;
  while (end > 0) {
    const last = textBefore[end - 1] ?? "";
    if (
      last === ":" ||
      last === "-" ||
      last === "." ||
      last === " " ||
      last === "–" ||
      last === "—"
    ) {
      end--;
      candidateEnds.push(end);
    } else {
      break;
    }
  }

  let best: ReferenceMatch | null = null;
  for (const s of candidateStarts) {
    for (const e of candidateEnds) {
      if (e - s < 3) continue; // shortest plausible: "Ge 1"
      const parsed = parseReference(textBefore.slice(s, e));
      if (!parsed) continue;
      const span = e - s;
      if (!best || span > best.end - best.start) {
        best = { start: s, end: e, parsed };
      }
    }
  }
  return best;
}

/**
 * Scan an arbitrary text chunk for every non-overlapping reference. Walks
 * forward greedily: at each candidate start, takes the LONGEST parse, emits
 * it, and resumes scanning right after the match. Used by paste handling.
 */
export function findAllReferences(text: string): readonly ReferenceMatch[] {
  const out: ReferenceMatch[] = [];
  let i = 0;
  while (i < text.length) {
    // Skip to the next plausible book-name start.
    while (i < text.length) {
      const ch = text[i] ?? "";
      const prev = i > 0 ? (text[i - 1] ?? "") : " ";
      const atBoundary = !REF_CHAR.test(prev) || prev === " " || i === 0;
      if (atBoundary && (ALPHA.test(ch) || (ch >= "1" && ch <= "3"))) break;
      i++;
    }
    if (i >= text.length) break;

    // Find the run end (same rule as findReferenceEndingAt).
    let runEnd = i;
    let lastWasSpace = false;
    while (runEnd < text.length) {
      const ch = text[runEnd] ?? "";
      if (!REF_CHAR.test(ch)) break;
      const isSpace = ch === " ";
      if (isSpace && lastWasSpace) break;
      lastWasSpace = isSpace;
      runEnd++;
    }

    // Try the longest match starting at i, ending at runEnd or earlier (with
    // trailing-strip rules).
    let bestEnd = -1;
    let bestParsed: ParsedReference | null = null;
    for (let e = runEnd; e > i + 2; e--) {
      const last = text[e - 1] ?? "";
      if (
        last === " " ||
        last === ":" ||
        last === "-" ||
        last === "." ||
        last === "–" ||
        last === "—"
      ) {
        // Allow stripping; don't try parsing with a dangling tail.
        continue;
      }
      const parsed = parseReference(text.slice(i, e));
      if (parsed) {
        bestEnd = e;
        bestParsed = parsed;
        break;
      }
    }

    if (bestEnd > 0 && bestParsed) {
      out.push({ start: i, end: bestEnd, parsed: bestParsed });
      i = bestEnd;
    } else {
      // Advance past this candidate start so we don't loop forever.
      i++;
    }
  }
  return out;
}

/**
 * Render the canonical text for a parsed reference. Used at commit time to
 * rewrite the user's typed form to the canonical form, and by the popover
 * header for display.
 *
 * Uses the SBL Handbook short book name (`Gen`, `1 Cor`, `Song`) so chips
 * stay compact in prose. When the user typed the comma-list form (e.g.
 * `John 3:16, 18`), `parsed.verses` is set and we preserve that exact list
 * — collapsing it to a range like `John 3:16-18` would misrepresent the
 * user's intent (verses 16 AND 18, not the contiguous span).
 */
export function canonicalReferenceText(parsed: ParsedReference): string {
  const { bookShort, startChapter, startVerse, endChapter, endVerse, verses } =
    parsed;
  const sc = String(startChapter);
  // Comma-list form takes precedence: emit the verse list as the user typed it.
  if (verses && verses.length > 0 && startChapter === endChapter) {
    return `${bookShort} ${sc}:${verses.map((v) => String(v)).join(", ")}`;
  }
  const sv = String(startVerse);
  const ec = String(endChapter);
  const ev = String(endVerse);
  // Whole-chapter encoding (endVerse === WHOLE_CHAPTER_END=999) is the chapter
  // form. parseReference uses 999 as a sentinel that means "to end of
  // chapter", which we treat as the chapter-only display form here.
  const isWholeChapter = startVerse === 1 && endVerse >= 999;
  if (isWholeChapter) {
    return startChapter === endChapter
      ? `${bookShort} ${sc}`
      : `${bookShort} ${sc}-${ec}`;
  }
  if (startChapter === endChapter && startVerse === endVerse) {
    return `${bookShort} ${sc}:${sv}`;
  }
  if (startChapter === endChapter) {
    return `${bookShort} ${sc}:${sv}-${ev}`;
  }
  return `${bookShort} ${sc}:${sv}-${ec}:${ev}`;
}
