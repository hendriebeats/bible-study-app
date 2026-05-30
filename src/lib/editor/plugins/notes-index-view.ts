import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { attachReorderHandle } from "../../dnd/pointer-reorder";
import { jumpToNoteRef, setNoteHover } from "../note-highlight";
import { NOTE_FLASH_BG } from "../note-flash-colors";
import { reorderSiblings } from "../reorder-node";
import { placeCaretInRect } from "./node-view-utils";

/** ms — wait after kicking off smooth `scrollIntoView` before starting the
 * flash. Browsers run smooth scroll over ~250–350 ms; lighting up the row
 * before then means the user's eye is still tracking the scroll motion when
 * the highlight appears. We try `scrollend` for the precise settle signal
 * and fall back to this timer when the browser doesn't dispatch one (e.g.
 * the row was already in view, so no scroll, so no `scrollend`). */
const SCROLL_SETTLE_MS = 200;
/** ms — fade-in duration. Soft arrival so the highlight reads as a gentle
 * "look here" rather than a stamp landing on the row. */
const FLASH_FADE_IN_MS = 200;
/** ms — how long the row holds the full yellow before fading out. A brief
 * hold gives the eye a moment to register the peak before the fade-out
 * starts pulling the colour back. */
const FLASH_HOLD_MS = 300;
/** ms — fade-out duration. Slightly longer than the fade-in for a relaxed
 * tail end (entering bold, leaving soft). */
const FLASH_FADE_OUT_MS = 350;

/**
 * Flash the inline notes-index row briefly so the user's eye is drawn to it
 * — used when an open-note request resolves to "focus the inline row" instead
 * of opening the floating popover (blocks doc is detached + visible).
 *
 * Visual: the same translucent highlighter yellow used over the body's
 * anchored text (`--note-active-bg`) fades in over {@link FLASH_FADE_IN_MS},
 * holds for {@link FLASH_HOLD_MS}, then fades out over
 * {@link FLASH_FADE_OUT_MS}. No outline ring, no rounded corners — the row
 * just glows yellow for a moment and goes back. Tying the flash to the
 * anchor highlight colour means both surfaces read as the same "this note
 * is the active one" signal.
 *
 * We write inline styles directly (no `.note-entry-flash` class, no
 * `@keyframes`) for two reasons: (a) it survives stylesheet HMR misses
 * where the keyframes-driven class would silently no-op, and (b) inline
 * styles always paint through the main compositor path, where CSS
 * animations have a knack for going invisible in screenshots and certain
 * monitor calibrations.
 *
 * Two-phase: kick off the smooth scroll first, then start the flash after
 * scroll-settle so the highlight lands while the row is stationary in the
 * viewport instead of mid-scroll.
 */
export function flashNoteEntry(view: EditorView, entryPos: number): void {
  const node = view.nodeDOM(entryPos);
  if (!(node instanceof HTMLElement)) {
    return;
  }
  const row = node.closest<HTMLElement>(".note-entry") ?? node;

  let started = false;
  const startFlash = (): void => {
    if (started) return;
    started = true;

    // Snapshot any pre-existing inline values we're about to override so we
    // can restore them on fade-out rather than blowing them away.
    const prevTransition = row.style.transition;
    const prevBg = row.style.backgroundColor;

    // Install the fade-IN transition first, then change the background-
    // color on the next frame so the browser actually animates between
    // the old (transparent) and new (yellow) values. Setting both in the
    // same tick risks a jump-cut instead of a fade.
    row.style.transition = `background-color ${String(FLASH_FADE_IN_MS)}ms ease-out`;
    requestAnimationFrame(() => {
      row.style.backgroundColor = NOTE_FLASH_BG;
      // After fade-in + hold, swap to the fade-out transition and revert
      // the background-color so it animates out instead of snapping back.
      window.setTimeout(() => {
        row.style.transition = `background-color ${String(FLASH_FADE_OUT_MS)}ms ease-out`;
        row.style.backgroundColor = prevBg;
        // Restore the original transition after the fade finishes so the
        // row doesn't carry our overrides into its normal interaction state.
        window.setTimeout(() => {
          row.style.transition = prevTransition;
        }, FLASH_FADE_OUT_MS + 30);
      }, FLASH_FADE_IN_MS + FLASH_HOLD_MS);
    });
  };

  // `scrollend` doesn't bubble, so we listen on document in capture phase —
  // modern browsers fire it on the scrolling element AND on document. The
  // fallback timer covers (a) browsers without `scrollend` support and (b)
  // the "row already in view" no-scroll case where `scrollend` never fires.
  const onScrollEnd = (): void => {
    document.removeEventListener("scrollend", onScrollEnd, true);
    startFlash();
  };
  document.addEventListener("scrollend", onScrollEnd, { capture: true });
  window.setTimeout(() => {
    document.removeEventListener("scrollend", onScrollEnd, true);
    startFlash();
  }, SCROLL_SETTLE_MS);

  row.scrollIntoView({ block: "center", behavior: "smooth" });
}

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

    // Lock the outer wrapper out of contenteditable so a caret can't park
    // in the "Notes" header column, the empty placeholder strip, or the
    // bleed gaps around the entries body. Body is re-opted-in.
    wrapper.contentEditable = "false";
    body.contentEditable = "true";

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
    // caret in the entries body. The contentEditable=false on the outer
    // wrapper handles the broader gutter; this keeps PM consistent.
    if (this.header.contains(target) || this.empty.contains(target)) {
      return true;
    }
    if (event.type === "mousedown" && !this.contentDOM.contains(target)) {
      return true;
    }
    return false;
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
 * reference (with the clickable jump-to-anchor pill + drag handle) and the
 * editable note body on the right (`contentDOM`). Editing here writes the
 * note body directly. The floating popover for the same note is rendered by
 * the React {@link NotePopover} via `createPortal(document.body)` and runs its
 * own mini ProseMirror editor synced to this entry — see that component for
 * the routing rule + writeback contract.
 */
export class NoteEntryView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly refEl: HTMLElement;
  /** The clickable verse-ref / "Note" pill — entry → body jump target. */
  private readonly refPill: HTMLButtonElement;
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

    // Verse-ref pill doubles as the "jump to anchor in body" button. Falls
    // back to a neutral "Note" label when the entry has no verseRef (note
    // anchored on non-scripture text). The pill click scrolls the body's
    // `.note-ref` into view and flashes it via jumpToNoteRef; focus stays
    // here in the entry — see [[notes-two-way-navigation]] in the plan.
    const refPill = document.createElement("button");
    refPill.type = "button";
    refPill.className = "note-entry-ref-pill";
    refPill.dataset.noteId = attrs.id;
    refPill.dataset.hasVerseRef = attrs.verseRef ? "true" : "false";
    refPill.textContent = attrs.verseRef || "Note";
    refPill.setAttribute(
      "aria-label",
      attrs.verseRef
        ? `Jump to ${attrs.verseRef} in the study`
        : "Jump to note in the study",
    );
    refPill.title = "Jump to note location";
    const onRefPillClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      jumpToNoteRef(readAttrs(this.node).id);
    };
    refPill.addEventListener("click", onRefPillClick);
    refEl.appendChild(refPill);

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

    // Lock the outer row out of contenteditable — refEl is CE=false but the
    // outer row inherits CE=true from view.dom, leaving room for a caret in
    // the bleed area around the body (and arrow-key reachable). The body is
    // re-opted-in so PM keeps editing it normally. Clicks on the refEl are
    // still caught by the existing mousedown handler below; clicks anywhere
    // else outside the body are caught by the gutter redirect.
    row.contentEditable = "false";
    body.contentEditable = "true";

    this.dom = row;
    this.contentDOM = body;
    this.refEl = refEl;
    this.refPill = refPill;
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
      if (
        event.target instanceof globalThis.Node &&
        refPill.contains(event.target)
      ) {
        // The verse-ref pill owns this press — its click handler will fire
        // `jumpToNoteRef`; don't also drop the caret into the body, which
        // would steal focus away from wherever the user was editing.
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
   * line of text places the caret at that line. Delegates to the shared
   * `placeCaretInRect` helper that every block node-view uses to keep gutter
   * clicks consistent.
   */
  private placeCaretAtRowY(clientY: number): void {
    const myPos = this.getPos();
    const rect = this.contentDOM.getBoundingClientRect();
    placeCaretInRect(
      this.view,
      this.contentDOM,
      rect.left + 2,
      clientY,
      (clickedAbove) => {
        if (myPos == null) return null;
        return clickedAbove ? myPos + 1 : myPos + this.node.nodeSize - 1;
      },
    );
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
    this.refPill.dataset.noteId = attrs.id;
    this.refPill.dataset.hasVerseRef = attrs.verseRef ? "true" : "false";
    this.refPill.textContent = attrs.verseRef || "Note";
    this.refPill.setAttribute(
      "aria-label",
      attrs.verseRef
        ? `Jump to ${attrs.verseRef} in the study`
        : "Jump to note in the study",
    );
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
    if (this.handle?.contains(target)) {
      return true;
    }
    // Mousedown anywhere outside the body / refEl / handle is owned by the
    // outer CE=false barrier — keep PM from re-asserting a selection against
    // the same coords.
    if (event.type === "mousedown" && !this.contentDOM.contains(target)) {
      return true;
    }
    return false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.detachReorder?.();
    this.detachRefClick();
  }
}
