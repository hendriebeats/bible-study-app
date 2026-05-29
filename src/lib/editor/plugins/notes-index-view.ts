import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { attachReorderHandle } from "../../dnd/pointer-reorder";
import { setNoteHover } from "../note-highlight";
import { reorderSiblings } from "../reorder-node";

/**
 * Place the caret at the first valid position inside the `note_entry` body at
 * `entryPos` (the entry node's start position in the doc). Used by the stationary-
 * click handler on the drag handle AND by `createNote` when the new note's
 * blocks panel is already on-screen, so we focus the entry instead of opening
 * the popover.
 */
export function focusNoteEntryBody(view: EditorView, entryPos: number): void {
  const $pos = view.state.doc.resolve(entryPos + 1);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView(),
  );
  view.focus();
}

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
  /** Non-PM "no notes yet" placeholder; CSS hides it when the body has entries. */
  private readonly empty: HTMLElement;

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

    // bodyCol owns the body-side padding + wide-layout flex; contentDOM (the
    // entries) is its inner child, with an empty-state placeholder sibling
    // *after* the body — `globals.css` uses an adjacent-sibling rule to hide
    // the placeholder whenever the body has at least one entry.
    const bodyCol = document.createElement("div");
    // `pm-block-host` marks this as the draggable-block container so
    // `block-drag.ts`'s `hostRect` sizes the drop indicator to the body column
    // (not the outer editor). Notes use their own per-row `.note-entry-drag`
    // handle rather than the gutter `.block-handle`, so the host's inline-
    // start gutter is zeroed by the `.notes-index .notes-index-body-col.pm-block-host`
    // override in globals.css (keeps the verse-ref column flush left).
    bodyCol.className = "notes-index-body-col study-block-body pm-block-host";

    const body = document.createElement("div");
    body.className = "notes-index-body";

    const empty = document.createElement("div");
    empty.className = "notes-index-empty";
    empty.contentEditable = "false";
    // Speech-bubble path mirrors the inline note-anchor icon (see
    // note-anchors.ts buildIcon) so the empty state visually points at the
    // affordance users click on a block's text to create a note.
    empty.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      "<span>Notes you add will appear here.</span>";

    bodyCol.appendChild(body);
    bodyCol.appendChild(empty);
    layout.appendChild(header);
    layout.appendChild(bodyCol);
    wrapper.appendChild(layout);

    this.dom = wrapper;
    this.contentDOM = body;
    this.header = header;
    this.empty = empty;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    // Keep PM out of the non-editable chrome: the header label and the empty
    // placeholder are both `contentEditable=false`, but PM still tries to
    // place selections on mousedown — bail on those so it doesn't disturb the
    // caret in the entries body.
    return this.header.contains(target) || this.empty.contains(target);
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
  private readonly refEl: HTMLElement;
  private readonly refText: HTMLElement;
  private readonly handle: HTMLElement | null;
  private readonly detachReorder: (() => void) | null;
  private readonly detachRefClick: () => void;

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
      handle.className = "drag-handle note-entry-drag";
      handle.setAttribute("aria-label", "Reorder note");
      handle.title = "Drag to reorder (or focus and press ↑/↓)";
      // 2×3 grid of filled dots, matched to the React handle in
      // src/components/ui/drag-handle.tsx so all sites render the same glyph.
      // Final size is set by `.drag-handle > svg` in globals.css.
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
    this.refEl = refEl;
    this.refText = refText;
    this.handle = handle;

    // Clicking the ref gutter (the column to the left of the body) drops the
    // caret on the body line nearest the click — turning the verse-ref column
    // into a tap target for the row's text field. The drag handle button gets
    // its own caret-on-stationary-click via the reorder helper's `onClick`.
    const onRefMouseDown = (event: MouseEvent): void => {
      if (
        handle &&
        event.target instanceof globalThis.Node &&
        handle.contains(event.target)
      ) {
        // The handle owns this press (drag-or-click); don't double-handle it.
        return;
      }
      event.preventDefault();
      this.placeCaretAtRowY(event.clientY);
    };
    refEl.addEventListener("mousedown", onRefMouseDown);
    this.detachRefClick = () => {
      refEl.removeEventListener("mousedown", onRefMouseDown);
    };

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
        // Stationary press on the handle drops the caret at the row's start.
        onClick: () => {
          this.placeCaretAtBodyStart();
        },
      });
    }
    this.detachReorder = detachReorder;
  }

  /**
   * Map a vertical pixel coordinate inside the row to a position inside the
   * note body — used by the gutter-click handler so clicking next to a given
   * line of text places the caret at that line. Clicks above/below the body
   * fall back to the body's start/end.
   */
  private placeCaretAtRowY(clientY: number): void {
    const view = this.view;
    const body = this.contentDOM;
    const bodyRect = body.getBoundingClientRect();
    let pos: number | null = null;
    if (clientY >= bodyRect.top && clientY <= bodyRect.bottom) {
      const found = view.posAtCoords({
        left: bodyRect.left + 2,
        top: clientY,
      });
      pos = found?.pos ?? null;
    }
    if (pos == null) {
      const myPos = this.getPos();
      if (myPos == null) {
        return;
      }
      pos =
        clientY > bodyRect.bottom ? myPos + this.node.nodeSize - 1 : myPos + 1;
    }
    const $pos = view.state.doc.resolve(pos);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView(),
    );
    view.focus();
  }

  /** Set the caret at the first valid position inside the note body. */
  private placeCaretAtBodyStart(): void {
    const myPos = this.getPos();
    if (myPos == null) {
      return;
    }
    focusNoteEntryBody(this.view, myPos);
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
    // Let the drag handle's own pointer/keyboard handling run instead of PM's,
    // and route gutter clicks through `onRefMouseDown` (which places the caret
    // explicitly) rather than PM's default selection logic.
    const target = event.target;
    if (!(target instanceof globalThis.Node)) {
      return false;
    }
    if (this.refEl.contains(target)) {
      return true;
    }
    return this.handle?.contains(target) ?? false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.detachReorder?.();
    this.detachRefClick();
  }
}
