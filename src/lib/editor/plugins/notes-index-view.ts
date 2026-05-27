import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { attachReorderHandle } from "../../dnd/pointer-reorder";
import { setNoteHover } from "../note-highlight";
import { reorderSiblings } from "../reorder-node";

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
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly refText: HTMLElement;
  private readonly handle: HTMLElement | null;
  private readonly detachReorder: (() => void) | null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
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

    // A drag handle (owners only) reorders the note among its siblings; it is
    // also keyboard-operable (↑/↓) as the accessible fallback to dragging.
    let handle: HTMLButtonElement | null = null;
    let detachReorder: (() => void) | null = null;
    if (editable) {
      handle = document.createElement("button");
      handle.type = "button";
      handle.className = "note-entry-drag reorder-handle";
      handle.setAttribute("aria-label", "Reorder note");
      handle.title = "Drag to reorder (or focus and press ↑/↓)";
      handle.innerHTML =
        '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="13" r="1.3"/><circle cx="10" cy="13" r="1.3"/></svg>';
      refEl.appendChild(handle);
    }

    const refText = document.createElement("span");
    refText.textContent = attrs.verseRef;
    refEl.appendChild(refText);

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
    this.refText = refText;
    this.handle = handle;

    if (handle) {
      detachReorder = attachReorderHandle({
        handle,
        getItem: () => this.dom,
        getSiblings: () => {
          const parent = this.dom.parentElement;
          return parent
            ? Array.from(
                parent.querySelectorAll<HTMLElement>(
                  ":scope > [data-note-entry]",
                ),
              )
            : [];
        },
        onReorder: (from, to) => {
          this.reorder(from, to);
        },
      });
    }
    this.detachReorder = detachReorder;
  }

  /** Move this note from index `from` to `to` within the notes index. */
  private reorder(from: number, to: number): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const id = readAttrs(this.node).id;
    if (!reorderSiblings(this.view, pos, from, to)) {
      return;
    }
    // The NodeView is rebuilt at its new position; refocus this note's handle so
    // keyboard reordering can continue with repeated ↑/↓ presses.
    requestAnimationFrame(() => {
      const next = this.view.dom.querySelector<HTMLElement>(
        `.note-entry[data-id="${id}"] .note-entry-drag`,
      );
      next?.focus();
    });
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
    this.refText.textContent = attrs.verseRef;
    return true;
  }

  stopEvent(event: Event): boolean {
    // Let the drag handle's own pointer/keyboard handling run instead of PM's.
    const target = event.target;
    return (
      this.handle != null &&
      target instanceof globalThis.Node &&
      this.handle.contains(target)
    );
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.detachReorder?.();
  }
}
