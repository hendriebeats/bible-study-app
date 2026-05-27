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
