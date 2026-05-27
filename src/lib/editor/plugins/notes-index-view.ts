import type { Node } from "prosemirror-model";
import type { NodeView, ViewMutationRecord } from "prosemirror-view";

import { setNoteHover } from "../note-highlight";

/**
 * Renders the `notes_index` — the single pinned container (first block of the
 * Study-blocks document) holding every note's body for the section. A
 * non-editable "Notes" header sits over the entries (`contentDOM`). Reordering
 * and the non-removable guard arrive in a later sub-phase; this view just lays
 * it out for both the editor and the read-only viewer.
 */
export class NotesIndexView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;
  private readonly header: HTMLElement;

  constructor() {
    const wrapper = document.createElement("div");
    wrapper.className = "notes-index study-stack-item";
    wrapper.setAttribute("data-notes-index", "true");

    // Mirror the study-block layout so the index reads as one block in the
    // stack: a gray header column (the "Notes" title) beside the entries body.
    const layout = document.createElement("div");
    layout.className = "study-block-layout";

    const header = document.createElement("div");
    header.className = "study-block-header";
    header.contentEditable = "false";
    const title = document.createElement("div");
    title.className = "notes-index-title";
    title.textContent = "Notes";
    header.appendChild(title);

    const body = document.createElement("div");
    body.className = "notes-index-body study-block-body";

    layout.appendChild(header);
    layout.appendChild(body);
    wrapper.appendChild(layout);

    this.dom = wrapper;
    this.contentDOM = body;
    this.header = header;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLElement && this.header.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}

interface NoteEntryAttrs {
  id: string;
  source: string;
  verseRef: string;
}

function readAttrs(node: Node): NoteEntryAttrs {
  const a = node.attrs as Partial<NoteEntryAttrs>;
  return {
    id: typeof a.id === "string" ? a.id : "",
    source: typeof a.source === "string" ? a.source : "blocks",
    verseRef: typeof a.verseRef === "string" ? a.verseRef : "",
  };
}

/**
 * Renders one `note_entry` as a row: a non-editable left column for the verse
 * reference (blank until a verse anchor is resolved in a later sub-phase) and
 * the editable note body on the right (`contentDOM`). Editing here writes the
 * note body directly — the index is where the bodies actually live, so the
 * inline-icon popover and this row are two windows onto the same content.
 */
export class NoteEntryView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly refEl: HTMLElement;

  constructor(node: Node) {
    this.node = node;
    const attrs = readAttrs(node);

    const row = document.createElement("div");
    row.className = "note-entry";
    row.setAttribute("data-note-entry", "true");
    row.setAttribute("data-id", attrs.id);
    row.setAttribute("data-source", attrs.source);
    row.setAttribute("data-verse-ref", attrs.verseRef);

    const refEl = document.createElement("div");
    refEl.className = "note-entry-ref";
    refEl.contentEditable = "false";
    refEl.textContent = attrs.verseRef;

    const body = document.createElement("div");
    body.className = "note-entry-body";

    row.appendChild(refEl);
    row.appendChild(body);

    // Hovering the row lights up the note's anchored region in the document.
    row.addEventListener("mouseenter", () => {
      setNoteHover(attrs.id);
    });
    row.addEventListener("mouseleave", () => {
      setNoteHover(null);
    });

    this.dom = row;
    this.contentDOM = body;
    this.refEl = refEl;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const attrs = readAttrs(node);
    this.dom.setAttribute("data-id", attrs.id);
    this.dom.setAttribute("data-source", attrs.source);
    this.dom.setAttribute("data-verse-ref", attrs.verseRef);
    this.refEl.textContent = attrs.verseRef;
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
