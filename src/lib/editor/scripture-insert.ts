import type { PMNodeJSON } from "./types";

// ESV verse markers look like `[1]` (or `[3:16]` across chapters).
const VERSE_MARKER = /\[(\d+(?::\d+)?)\]/g;

/**
 * Turn raw ESV passage text into editable paragraph nodes. Paragraph breaks
 * (`\n\n`) become separate paragraphs; each `[n]` marker becomes a protected
 * inline `verse_number` node placed immediately before the verse's first word
 * (we trim the space ESV prints after the marker so the number hugs the word).
 *
 * The result is ordinary editable content — once inserted, the user can split
 * it, format it, and write notes between verses; only the verse numbers stay
 * locked (via the verse-guard plugin).
 */
export function scriptureParagraphsToNodes(text: string): PMNodeJSON[] {
  const paragraphs: PMNodeJSON[] = [];
  for (const rawPara of text.split(/\n{2,}/)) {
    const para = rawPara.trim();
    if (para === "") {
      continue;
    }
    const content: PMNodeJSON[] = [];
    let lastIndex = 0;
    let afterMarker = false;
    VERSE_MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VERSE_MARKER.exec(para)) !== null) {
      let before = para.slice(lastIndex, match.index);
      // Drop the space ESV prints between a marker and the next word.
      if (afterMarker) {
        before = before.replace(/^\s+/, "");
      }
      if (before !== "") {
        content.push({ type: "text", text: before });
      }
      content.push({ type: "verse_number", attrs: { n: match[1] ?? "" } });
      afterMarker = true;
      lastIndex = match.index + match[0].length;
    }
    let rest = para.slice(lastIndex);
    if (afterMarker) {
      rest = rest.replace(/^\s+/, "");
    }
    if (rest !== "") {
      content.push({ type: "text", text: rest });
    }
    // A paragraph that was only whitespace around markers still needs content;
    // an all-empty paragraph (no markers, no text) is skipped above.
    if (content.length === 0) {
      content.push({ type: "text", text: para });
    }
    paragraphs.push({ type: "paragraph", content });
  }
  return paragraphs;
}
