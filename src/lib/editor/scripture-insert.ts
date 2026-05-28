import {
  normalizeScriptureOptions,
  type ScriptureOptions,
} from "@/lib/scripture/options";

import type { PMNodeJSON } from "./types";

// ESV verse markers look like `[1]` (or `[3:16]` across chapters).
const VERSE_MARKER = /\[(\d+(?::\d+)?)\]/g;
// The covenant name as ESV prints it in caps (Yahweh → LORD, Yahweh-Elohim → GOD).
const DIVINE_NAME = /\b(?:LORD|GOD)\b/g;

interface InlineOptions {
  smallCaps: boolean;
  preservePoetry: boolean;
}

/**
 * The passage's location, threaded through the walk so each `verse_number` gets
 * its structured `book`/`chapter`/`verse`. ESV only prints the chapter on the
 * marker at a chapter boundary (`[3:16]`); a bare `[v]` belongs to whatever
 * chapter is current, seeded from the parsed reference's start chapter.
 */
interface VerseLocation {
  bookOrdinal: number | null;
  /** Chapter the next bare `[v]` marker belongs to. */
  currentChapter: number | null;
  /**
   * The last verse number stamped, in reading order. ESV never prints a `[c:v]`
   * marker at a chapter boundary — it just resets the bare `[v]` to a lower
   * number — so a marker whose verse doesn't increase signals a new chapter.
   */
  prevVerse: number | null;
}

/** Structured location passed in by the caller (from the parsed reference). */
export interface ScriptureLocation {
  bookOrdinal: number;
  startChapter: number;
}

/** Stamp a verse_number's `chapter`/`verse` from its ESV marker, advancing the
 * running chapter at a boundary. The boundary signal is the verse number
 * RESETTING (the ESV text API does not emit `[c:v]` between chapters — it just
 * restarts the bare marker at a lower number, typically `[1]`); the `[c:v]`
 * branch below is a defensive fallback the parser still honors. */
function verseNumberNode(marker: string, loc: VerseLocation): PMNodeJSON {
  let chapter = loc.currentChapter;
  let verse: number | null = null;
  const colon = marker.indexOf(":");
  if (colon >= 0) {
    const c = Number.parseInt(marker.slice(0, colon), 10);
    const v = Number.parseInt(marker.slice(colon + 1), 10);
    if (Number.isFinite(c)) {
      chapter = c;
      loc.currentChapter = c;
    }
    if (Number.isFinite(v)) verse = v;
  } else {
    const v = Number.parseInt(marker, 10);
    if (Number.isFinite(v)) {
      // A contiguous passage's intermediate chapters always start at verse 1,
      // and verses strictly increase within a chapter, so a non-increasing verse
      // marker reliably means we crossed into the next chapter.
      if (
        loc.currentChapter != null &&
        loc.prevVerse != null &&
        v <= loc.prevVerse
      ) {
        loc.currentChapter += 1;
        chapter = loc.currentChapter;
      }
      verse = v;
    }
  }
  if (verse != null) {
    loc.prevVerse = verse;
  }
  return {
    type: "verse_number",
    attrs: { n: marker, book: loc.bookOrdinal, chapter, verse },
  };
}

/**
 * Push a run of text, wrapping the covenant name (LORD/GOD) in the `small_caps`
 * mark when enabled so it renders like a printed ESV. Heuristic: ESV only
 * uppercases these tokens for the divine name.
 */
function pushText(
  content: PMNodeJSON[],
  text: string,
  smallCaps: boolean,
): void {
  if (text === "") {
    return;
  }
  if (!smallCaps) {
    content.push({ type: "text", text });
    return;
  }
  let last = 0;
  DIVINE_NAME.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIVINE_NAME.exec(text)) !== null) {
    if (match.index > last) {
      content.push({ type: "text", text: text.slice(last, match.index) });
    }
    content.push({
      type: "text",
      text: match[0],
      marks: [{ type: "small_caps" }],
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    content.push({ type: "text", text: text.slice(last) });
  }
}

/**
 * Append a single line's inline content (no newlines) to `content`: each `[n]`
 * marker becomes a protected `verse_number` atom and the space ESV prints after
 * it is trimmed so the number hugs the verse's first word. `state.afterMarker`
 * carries across calls so the hug survives a line break.
 */
function buildLineInto(
  content: PMNodeJSON[],
  line: string,
  smallCaps: boolean,
  state: { afterMarker: boolean },
  loc: VerseLocation,
): void {
  let lastIndex = 0;
  VERSE_MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VERSE_MARKER.exec(line)) !== null) {
    let before = line.slice(lastIndex, match.index);
    if (state.afterMarker) {
      before = before.replace(/^\s+/, "");
    }
    pushText(content, before, smallCaps);
    content.push(verseNumberNode(match[1] ?? "", loc));
    state.afterMarker = true;
    lastIndex = match.index + match[0].length;
  }
  let rest = line.slice(lastIndex);
  if (state.afterMarker) {
    rest = rest.replace(/^\s+/, "");
  }
  pushText(content, rest, smallCaps);
}

/**
 * Build the inline content for one paragraph chunk (an ESV `\n\n`-delimited
 * block). With `preservePoetry`, single newlines become `hard_break` nodes so
 * Psalms/Proverbs keep their line structure; otherwise they collapse to spaces.
 */
function buildInline(
  chunk: string,
  opts: InlineOptions,
  loc: VerseLocation,
): PMNodeJSON[] {
  const content: PMNodeJSON[] = [];
  const state = { afterMarker: false };
  if (!opts.preservePoetry) {
    buildLineInto(
      content,
      chunk.replace(/\n+/g, " "),
      opts.smallCaps,
      state,
      loc,
    );
    return content;
  }
  const lines = chunk.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (index > 0) {
      content.push({ type: "hard_break" });
      // A hard break starts a fresh line, so don't trim its text as a hug.
      state.afterMarker = false;
    }
    buildLineInto(content, trimmed, opts.smallCaps, state, loc);
  });
  return content;
}

/** Does this inline content hold anything other than hard breaks? */
function hasVisibleContent(content: PMNodeJSON[]): boolean {
  return content.some((node) => node.type !== "hard_break");
}

/** Trim leading/trailing hard breaks left at a paragraph's edges. */
function trimBreaks(content: PMNodeJSON[]): PMNodeJSON[] {
  let start = 0;
  let end = content.length;
  while (start < end && content[start]?.type === "hard_break") {
    start += 1;
  }
  while (end > start && content[end - 1]?.type === "hard_break") {
    end -= 1;
  }
  return content.slice(start, end);
}

/**
 * Split a chunk's inline content into one paragraph per verse: a new paragraph
 * starts at each `verse_number` once the current one already holds a verse.
 * Any lead-in text before the first verse stays with that first verse, and a
 * chunk with no verses (e.g. the copyright line) becomes a single paragraph.
 */
function splitByVerse(content: PMNodeJSON[]): PMNodeJSON[] {
  const paragraphs: PMNodeJSON[] = [];
  let current: PMNodeJSON[] = [];
  let currentHasVerse = false;
  const flush = () => {
    const trimmed = trimBreaks(current);
    if (hasVisibleContent(trimmed)) {
      paragraphs.push({ type: "paragraph", content: trimmed });
    }
  };
  for (const node of content) {
    if (node.type === "verse_number" && currentHasVerse) {
      flush();
      current = [node];
    } else {
      if (node.type === "verse_number") {
        currentHasVerse = true;
      }
      current.push(node);
    }
  }
  flush();
  return paragraphs;
}

/**
 * Turn raw ESV passage text into editable paragraph nodes, honoring the user's
 * insertion {@link ScriptureOptions}. Each `[n]` marker becomes a protected
 * inline `verse_number` node (locked by the verse-guard plugin); everything else
 * is ordinary editable content the user can split, format, and annotate.
 *
 * Layout:
 *  - `translator-paragraphs` (default) — one paragraph per ESV `\n\n` block.
 *  - `verse-per-line` — each verse becomes its own paragraph.
 *  - `single-block` — the whole passage flows into one paragraph (no breaks).
 */
export function scriptureParagraphsToNodes(
  text: string,
  options?: Partial<ScriptureOptions>,
  location?: ScriptureLocation,
): PMNodeJSON[] {
  const opts = normalizeScriptureOptions(options);
  // Seed the running chapter from the parsed reference so the opening verse —
  // whose ESV marker omits the chapter — still gets its structured location.
  const loc: VerseLocation = {
    bookOrdinal: location?.bookOrdinal ?? null,
    currentChapter: location?.startChapter ?? null,
    prevVerse: null,
  };

  if (opts.layout === "single-block") {
    // One continuous paragraph: all breaks collapse to spaces (poetry n/a).
    const content = buildInline(
      text.replace(/\s*\n+\s*/g, " ").trim(),
      { smallCaps: opts.smallCaps, preservePoetry: false },
      loc,
    );
    return hasVisibleContent(content) ? [{ type: "paragraph", content }] : [];
  }

  const inlineOpts: InlineOptions = {
    smallCaps: opts.smallCaps,
    preservePoetry: opts.preservePoetry,
  };
  const paragraphs: PMNodeJSON[] = [];
  for (const rawPara of text.split(/\n{2,}/)) {
    const para = rawPara.trim();
    if (para === "") {
      continue;
    }
    const content = buildInline(para, inlineOpts, loc);
    if (opts.layout === "verse-per-line") {
      paragraphs.push(...splitByVerse(content));
    } else if (hasVisibleContent(content)) {
      paragraphs.push({ type: "paragraph", content: trimBreaks(content) });
    }
  }
  return paragraphs;
}
