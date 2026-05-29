/**
 * Custom-event channel between `TableViewWithHandles` (vanilla DOM NodeView)
 * and the React `TableHandlePopover` mount point. Clicking a row/column
 * handle in the NodeView selects that row/column (so prosemirror-tables
 * decorates it) and fires this event with the handle's screen rect; the
 * popover renders Notion-style row or column actions and dispatches commands
 * back through the active editor view.
 *
 * Mirrors `CALLOUT_COLOR_EVENT` in shape (custom event on window, detail
 * carries an anchor rect + a callback). Routing through a window event
 * decouples the NodeView from React entirely; the popover lives anywhere in
 * the React tree (currently `study-workspace.tsx`) and works for whichever
 * editor view holds the focus.
 */
export const TABLE_HANDLE_EVENT = "pm-table-handle";

export interface TableHandleAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TableHandleEventDetail {
  /** Which axis the handle owns. */
  kind: "row" | "col";
  /** 0-indexed row or column the handle points at. */
  index: number;
  /** Total rows / cols in the table — drives "Move up/down" disabled state. */
  total: number;
  /**
   * True when `kind === "row"` AND the row is currently styled as the table's
   * header (every cell in row 0 is a `table_header`). Only row 0 ever
   * surfaces the "Toggle header row" action.
   */
  isHeaderRow: boolean;
  /** Current `align` value of the column's cells (col-mode only). */
  currentAlign: "left" | "center" | "right" | null;
  /** The handle's bounding rect, in viewport coords, for `placeNearAnchor`. */
  anchorRect: TableHandleAnchorRect;
}
