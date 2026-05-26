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
    content.push({ type: "verse_number", attrs: { n: match[1] ?? "" } });
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
function buildInline(chunk: string, opts: InlineOptions): PMNodeJSON[] {
  const content: PMNodeJSON[] = [];
  const state = { afterMarker: false };
  if (!opts.preservePoetry) {
    buildLineInto(content, chunk.replace(/\n+/g, " "), opts.smallCaps, state);
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
    buildLineInto(content, trimmed, opts.smallCaps, state);
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
): PMNodeJSON[] {
  const opts = normalizeScriptureOptions(options);

  if (opts.layout === "single-block") {
    // One continuous paragraph: all breaks collapse to spaces (poetry n/a).
    const content = buildInline(text.replace(/\s*\n+\s*/g, " ").trim(), {
      smallCaps: opts.smallCaps,
      preservePoetry: false,
    });
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
    const content = buildInline(para, inlineOpts);
    if (opts.layout === "verse-per-line") {
      paragraphs.push(...splitByVerse(content));
    } else if (hasVisibleContent(content)) {
      paragraphs.push({ type: "paragraph", content: trimBreaks(content) });
    }
  }
  return paragraphs;
}
