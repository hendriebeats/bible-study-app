import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { setNoteHover } from "../note-highlight";
import { marks } from "../schema";

/** Window event the inline note icon fires (with `{ id }`) to open a note. */
export const NOTE_OPEN_EVENT = "pm-open-note";

export interface NoteOpenEventDetail {
  id: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build the clickable inline note icon (a small speech-bubble) for note `id`. */
function buildIcon(id: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-anchor-icon";
  button.contentEditable = "false";
  button.setAttribute("data-note-id", id);
  button.setAttribute("aria-label", "Open note");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  );
  svg.appendChild(path);
  button.appendChild(svg);

  // Hovering the icon lights up the note's anchored region.
  button.addEventListener("mouseenter", () => {
    setNoteHover(id);
  });
  button.addEventListener("mouseleave", () => {
    setNoteHover(null);
  });
  // Don't let the click move the caret / blur; just signal "open this note".
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(
      new CustomEvent<NoteOpenEventDetail>(NOTE_OPEN_EVENT, { detail: { id } }),
    );
  });
  return button;
}

/** One inline icon at the end of each note-anchored range (last marked spot). */
function buildDecorations(doc: Node): DecorationSet | null {
  const noteType = marks.note;
  const ends = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }
    const mark = noteType.isInSet(node.marks);
    if (mark) {
      const id = (mark.attrs as { id: string }).id;
      if (id !== "") {
        const end = pos + node.nodeSize;
        if (end > (ends.get(id) ?? 0)) {
          ends.set(id, end);
        }
      }
    }
    return true;
  });
  if (ends.size === 0) {
    return null;
  }
  const decorations: Decoration[] = [];
  for (const [id, end] of ends) {
    decorations.push(
      Decoration.widget(end, () => buildIcon(id), {
        side: 1,
        key: `note-icon-${id}`,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Draws the inline, clickable note icon at the end of every note-anchored text
 * run (see the `note` mark). Clicking an icon fires {@link NOTE_OPEN_EVENT} with
 * the note id; the React layer opens the note from there. Used by both the
 * editor and the read-only viewer so read-along members see the same icons.
 * Recomputed per call (cheap; PM reuses each icon's DOM via its `key`).
 */
export function noteAnchors(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        return buildDecorations(state.doc);
      },
    },
  });
}
