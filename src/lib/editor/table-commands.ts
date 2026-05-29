import type { Command, EditorState } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import {
  TableMap,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  deleteTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  toggleHeaderRow,
} from "prosemirror-tables";

import { allowVerseEdit } from "@/lib/editor/commands";

/**
 * Verse-safe wrappers for the table structural commands exposed by
 * prosemirror-tables. Every surface that drives table edits — the gutter ⋮
 * block-menu, the inline row/column handle popover, and the slash menu —
 * shares these so a row containing a verse marker can be moved or deleted
 * without tripping `verseGuard`.
 *
 * The four insert wrappers (`addRowBeforeSafe` etc.) do NOT just wrap
 * prosemirror-tables' high-level `addRowBefore` / `addRowAfter` / column
 * counterparts: those commands leave the selection on the SOURCE row/column
 * (where `CellSelection.rowSelection.head` was the rightmost cell), so after
 * "Insert row below" the caret stayed one row above and in the last column
 * — empty new row, no visible cursor in it. Instead we use the lower-level
 * `addRow(tr, rect, row)` / `addColumn(tr, rect, col)` helpers, then set a
 * `TextSelection` at the start of the new row's first cell (or new column's
 * first row's cell) so the caret lands where the user wants to type next.
 *
 * Movement and column-alignment live below as custom commands because
 * prosemirror-tables either doesn't ship a 1-step "move by direction" helper
 * (it ships `moveTableRow({from, to})` which takes absolute indices) or
 * doesn't model cell-attribute toggles at all.
 */

/**
 * Compose the four insert-and-place-caret commands. `axis` picks whether the
 * insert is a row or a column; `where` picks "before" (new row/col at the
 * current selection's leading edge) or "after" (trailing edge). Caret lands
 * at the first cell of the new row (column inserts → first row, new column).
 */
function makeInsertSafe(
  axis: "row" | "col",
  where: "before" | "after",
): Command {
  return allowVerseEdit((state, dispatch) => {
    let rect;
    try {
      rect = selectedRect(state);
    } catch {
      return false;
    }
    if (!dispatch) return true;
    const newIndex =
      axis === "row"
        ? where === "before"
          ? rect.top
          : rect.bottom
        : where === "before"
          ? rect.left
          : rect.right;
    const tr = state.tr;
    if (axis === "row") {
      addRow(tr, rect, newIndex);
    } else {
      addColumn(tr, rect, newIndex);
    }
    // Re-resolve the table after the structural insert. `tableStart` is the
    // position of cell (0,0) in the original doc; the table node sits at
    // `tableStart - 1`. Inserts happen INSIDE the table, so `tableStart`
    // remains valid against the new doc.
    const tablePos = rect.tableStart - 1;
    const newTable = tr.doc.nodeAt(tablePos);
    if (newTable) {
      const newMap = TableMap.get(newTable);
      // For row inserts: caret at (newIndex, 0). For column inserts: caret at
      // (0, newIndex). Both land at the visual "first" cell of the new strip.
      const row = axis === "row" ? newIndex : 0;
      const col = axis === "col" ? newIndex : 0;
      // Guard the lookup — `positionAt` requires the indices to be within
      // bounds. They should be, but a malformed rect could break things.
      if (row < newMap.height && col < newMap.width) {
        const cellPos = rect.tableStart + newMap.positionAt(row, col, newTable);
        // `cellPos + 1` is inside the cell's first child (the cell's content
        // is `block+`, so a paragraph sits there); `TextSelection.near` lands
        // at the start of that textblock.
        const $cell = tr.doc.resolve(cellPos + 1);
        tr.setSelection(TextSelection.near($cell));
      }
    }
    tr.scrollIntoView();
    dispatch(tr);
    return true;
  });
}

export const addRowBeforeSafe: Command = makeInsertSafe("row", "before");
export const addRowAfterSafe: Command = makeInsertSafe("row", "after");
export const addColumnBeforeSafe: Command = makeInsertSafe("col", "before");
export const addColumnAfterSafe: Command = makeInsertSafe("col", "after");
export const deleteRowSafe: Command = allowVerseEdit(deleteRow);
export const deleteColumnSafe: Command = allowVerseEdit(deleteColumn);
export const deleteTableSafe: Command = allowVerseEdit(deleteTable);
export const toggleHeaderRowSafe: Command = allowVerseEdit(toggleHeaderRow);

/**
 * Move the row containing the current selection up (-1) or down (+1) one slot.
 * Returns `false` (no-op) at the edges so callers can disable the affordance.
 * `selectedRect` throws when the selection isn't in a table, so we guard it.
 */
export function moveRow(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    let rect;
    try {
      rect = selectedRect(state);
    } catch {
      return false;
    }
    const from = rect.top;
    const to = from + direction;
    if (to < 0 || to >= rect.map.height) return false;
    return allowVerseEdit(moveTableRow({ from, to }))(state, dispatch, view);
  };
}

/**
 * Move the column containing the current selection left (-1) or right (+1) one
 * slot. Same shape as {@link moveRow}, just along the other axis.
 */
export function moveColumn(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    let rect;
    try {
      rect = selectedRect(state);
    } catch {
      return false;
    }
    const from = rect.left;
    const to = from + direction;
    if (to < 0 || to >= rect.map.width) return false;
    return allowVerseEdit(moveTableColumn({ from, to }))(state, dispatch, view);
  };
}

/**
 * Move a row by absolute index. Used by the row drag-reorder driver in
 * `TableViewWithHandles` once it has resolved the source/target indices from
 * pointer geometry. Falls through when `from === to` (a same-position drop)
 * so the indicator never commits an empty transaction.
 */
export function moveRowTo(from: number, to: number): Command {
  return (state, dispatch, view) => {
    if (from === to) return false;
    return allowVerseEdit(moveTableRow({ from, to }))(state, dispatch, view);
  };
}

/**
 * Move a column by absolute index. Mirror of {@link moveRowTo} for the
 * column-handle drag path.
 */
export function moveColumnTo(from: number, to: number): Command {
  return (state, dispatch, view) => {
    if (from === to) return false;
    return allowVerseEdit(moveTableColumn({ from, to }))(state, dispatch, view);
  };
}

/**
 * Apply (or clear) the cell-level `align` attribute on every cell in the
 * currently-selected column. The selection must be inside a table; otherwise
 * the command falls through.
 *
 * Passing `null` clears the attribute — keeps the JSON shape minimal and lets
 * the toolbar segmented control offer a tri-state ("no alignment chosen").
 *
 * Implementation: iterate the column once with `TableMap.map`, dedupe across
 * cells that span the column (a single cell can show up in multiple map
 * slots), and setNodeMarkup each at its absolute doc position. Wrapped in
 * `allowVerseEdit` because a cell may legitimately contain a verse marker.
 */
export function setColumnAlign(
  value: "left" | "center" | "right" | null,
): Command {
  return allowVerseEdit((state, dispatch) => {
    let rect;
    try {
      rect = selectedRect(state);
    } catch {
      return false;
    }
    if (!dispatch) return true;
    const tr = state.tr;
    const seen = new Set<number>();
    for (let row = 0; row < rect.map.height; row++) {
      const cellStart = rect.map.map[row * rect.map.width + rect.left];
      if (cellStart === undefined || seen.has(cellStart)) continue;
      seen.add(cellStart);
      const absPos = cellStart + rect.tableStart;
      const cell = state.doc.nodeAt(absPos);
      if (!cell) continue;
      tr.setNodeMarkup(absPos, undefined, { ...cell.attrs, align: value });
    }
    if (!tr.docChanged) return false;
    dispatch(tr);
    return true;
  });
}

/**
 * Probe the cell at the current selection for its `align` attr — drives the
 * popover's segmented control so it can show the active value. Returns `null`
 * when there's no usable selection (treated as "no alignment set").
 */
export function readColumnAlign(
  state: EditorState,
): "left" | "center" | "right" | null {
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }
  const cellStart = rect.map.map[rect.top * rect.map.width + rect.left];
  if (cellStart === undefined) return null;
  const cell = state.doc.nodeAt(cellStart + rect.tableStart);
  const value = cell?.attrs.align as unknown;
  return value === "left" || value === "center" || value === "right"
    ? value
    : null;
}
