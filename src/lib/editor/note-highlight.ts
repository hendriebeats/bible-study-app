/**
 * Highlights a note's anchored source region (the `note`-marked text) yellow.
 *
 * The `note` mark renders its run as `<span class="note-ref" data-note-id>`, so
 * we toggle a `.note-active` class on the matching span(s) directly in the DOM —
 * no ProseMirror transactions (which would churn the editor's active state) and
 * it spans both editors via one query. Two independent sources combine: a
 * transient `hover` (the inline icon or an index row under the pointer) and a
 * sticky id (the note whose popover is open). The hover wins; the sticky keeps
 * the region lit while its popover stays open.
 */

/** ms — flash duration when jumping to an anchor; matches `flashNoteEntry`. */
const FLASH_MS = 800;

let hoverId: string | null = null;
let stickyId: string | null = null;

function refresh(): void {
  const id = hoverId ?? stickyId;
  document.querySelectorAll(".note-ref.note-active").forEach((el) => {
    if (!(el instanceof HTMLElement) || el.dataset.noteId !== id) {
      el.classList.remove("note-active");
    }
  });
  if (id != null && id !== "") {
    document
      .querySelectorAll(`.note-ref[data-note-id="${id}"]`)
      .forEach((el) => {
        if (el instanceof HTMLElement) {
          el.classList.add("note-active");
        }
      });
  }
}

/** Set the transiently-hovered note (the icon or index row under the pointer). */
export function setNoteHover(id: string | null): void {
  hoverId = id;
  refresh();
}

/** Set the sticky note (the one whose popover is open); kept lit until closed. */
export function setNoteSticky(id: string | null): void {
  stickyId = id;
  refresh();
}

/**
 * Scroll the note's anchored region into view and flash it for {@link FLASH_MS}.
 * Used by the verse-ref pill on a note_entry — entry → body navigation, the
 * mirror of the body-icon → entry routing in `note-popover.tsx`.
 *
 * DOM-only on purpose: the `.note-ref[data-note-id]` span exists regardless of
 * which editor hosts it (notes doc or blocks doc) and regardless of whether
 * the blocks panel is inline or detached, so we don't need to look up an
 * EditorView or dispatch a transaction. Focus stays where it was — this is a
 * "show me where it lives" action, not "go edit it".
 *
 * Layers under the existing sticky highlight: the pill flash adds itself to
 * `stickyId` for the flash window, then clears. If a popover is open for the
 * same note (its own setNoteSticky in flight), the timer no-ops cleanly when
 * `stickyId` has already moved on.
 */
export function jumpToNoteRef(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(
    `.note-ref[data-note-id="${CSS.escape(id)}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  setNoteSticky(id);
  window.setTimeout(() => {
    if (stickyId === id) {
      setNoteSticky(null);
    }
  }, FLASH_MS);
}
