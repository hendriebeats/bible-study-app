import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/**
 * Project a viewport-relative click coordinate onto a node-view's
 * `contentDOM`, resolve the nearest valid ProseMirror position there, and
 * move the caret to it. Used by every block node-view that wraps its
 * `contentDOM` in chrome (drag handles, gutters, color chips, chevrons,
 * empty-state hints, headers, etc.) so a click in the chrome zone — the
 * region the user can't actually type in — feels like a click into the body
 * instead of a dead zone.
 *
 * The hit-test logic mirrors what `NoteEntryView.placeCaretAtRowY` did
 * before extraction:
 *  1. If `y` falls *inside* the contentDOM's rect vertically, ask PM for the
 *     position at `(contentRect.left + 2, y)` — i.e. project the click onto
 *     the body's left edge, on the same line.
 *  2. Otherwise, fall back to the row's start (clicks above the body) or
 *     end (clicks below) via the caller-supplied `fallback`.
 *
 * The 2 px inset on `left` keeps us inside the content's first character
 * even when the click lands exactly on the body's left border.
 *
 * `fallback` returns the doc position to use when the click is outside the
 * content's vertical range — typically the caller passes in its node's
 * start/end positions (`myPos + 1` / `myPos + nodeSize - 1`).
 */
export function placeCaretInRect(
  view: EditorView,
  contentEl: HTMLElement,
  clientX: number,
  clientY: number,
  fallback: (clickedAbove: boolean) => number | null,
): void {
  const rect = contentEl.getBoundingClientRect();
  let pos: number | null = null;
  if (clientY >= rect.top && clientY <= rect.bottom) {
    // Clamp X into the content's horizontal range so a click that lands in
    // the chrome (left of the content) snaps to the body's left edge with a
    // 2 px inset, while clicks inside the content keep their X for caret
    // accuracy. Same for the right edge.
    const x = Math.min(
      Math.max(clientX, rect.left + 2),
      Math.max(rect.left + 2, rect.right - 2),
    );
    const found = view.posAtCoords({ left: x, top: clientY });
    pos = found?.pos ?? null;
  }
  pos ??= fallback(clientY < rect.top);
  if (pos == null) {
    return;
  }
  const $pos = view.state.doc.resolve(pos);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView(),
  );
  view.focus();
}
