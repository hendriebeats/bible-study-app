import type { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  CellSelection,
  TableMap,
  TableView,
  columnResizingPluginKey,
  moveTableColumn,
  moveTableRow,
} from "prosemirror-tables";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { allowVerseEdit } from "@/lib/editor/commands";
import {
  addColumnAfterSafe,
  addRowAfterSafe,
  readColumnAlign,
} from "@/lib/editor/table-commands";
import {
  TABLE_HANDLE_EVENT,
  type TableHandleEventDetail,
} from "@/lib/editor/plugins/table-handle-events";

/**
 * The 2×3 dot grid the rest of the app uses for drag handles (see
 * `block-handle.ts` and `src/components/ui/drag-handle.tsx`). Size comes from
 * the shared `.drag-handle > svg` rule in `globals.css`.
 */
const GRIP_SVG =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<circle cx="6" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/>' +
  '<circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/>' +
  '<circle cx="6" cy="13" r="1.3"/><circle cx="10" cy="13" r="1.3"/></svg>';

const PLUS_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

/** Pointer travel (in px) before a click counts as the start of a drag. */
const DRAG_START_THRESHOLD = 4;

/** Render a number to a `Npx` string. Centralized so the strict
 * `restrict-template-expressions` lint sees one cast site instead of dozens. */
function px(value: number): string {
  return `${String(value)}px`;
}

/**
 * Subclass of `prosemirror-tables`' default `TableView` that paints Notion-
 * style row and column handles in the gutter around the table, plus a `+`
 * quick-add at the bottom and the right.
 *
 * The base class already wraps the `<table>` in a `<div>` and manages the
 * `<colgroup>` so column-resizing works; we keep all of that, just add a
 * `pm-table-wrap` class, install absolutely-positioned overlay buttons inside
 * the same wrapper, and reposition them on every `update()` + on layout
 * changes (`ResizeObserver` on the `<table>`).
 *
 * The library invokes the `View` factory with `(node, cellMinWidth, view)` —
 * verified against `node_modules/prosemirror-tables/dist/index.d.ts`'s
 * `ColumnResizingOptions.View` type — even though `TableView` itself only
 * declares two constructor args. We accept three and stash the view so click /
 * drag handlers can resolve positions and dispatch transactions.
 */
export class TableViewWithHandles extends TableView implements NodeView {
  private readonly view: EditorView;

  /** Container for the row-handle buttons (absolutely positioned). */
  private readonly rowGutter: HTMLDivElement;
  /** Container for the column-handle buttons. */
  private readonly colGutter: HTMLDivElement;
  /** "+" button below the table (adds a row after the last one). */
  private readonly addRowBtn: HTMLButtonElement;
  /** "+" button to the right of the table (adds a column after the last one). */
  private readonly addColBtn: HTMLButtonElement;

  private resizeObserver: ResizeObserver | null = null;
  /** Cached counts so we only rebuild handle DOM on structural change. */
  private renderedRows = -1;
  private renderedCols = -1;
  /** Pending rAF id for reposition coalescing. */
  private repositionRaf: number | null = null;
  /** Single shared drop-line indicator, lazily created on first drag. */
  private dragIndicator: HTMLDivElement | null = null;
  /**
   * Translucent overlay drawn on top of the source row/column during a drag
   * to signal "you are moving THIS". Body-fixed for the same reason as
   * `dragIndicator` — ProseMirror's view layer also strips unknown attributes
   * off cells during re-renders, so we can't reliably mark cells inline.
   */
  private sourceOverlay: HTMLDivElement | null = null;

  constructor(node: PMNode, cellMinWidth: number, view: EditorView) {
    super(node, cellMinWidth);
    this.view = view;
    this.dom.classList.add("pm-table-wrap");

    this.rowGutter = document.createElement("div");
    this.rowGutter.className = "pm-table-row-gutter";
    this.rowGutter.contentEditable = "false";

    this.colGutter = document.createElement("div");
    this.colGutter.className = "pm-table-col-gutter";
    this.colGutter.contentEditable = "false";

    this.addRowBtn = this.buildAddButton("row");
    this.addColBtn = this.buildAddButton("col");

    // Append after the table so the rendered DOM order is table → gutters →
    // quick-adds. Absolute positioning means visual order is independent of
    // DOM order; this just keeps the table itself first (so screen readers see
    // the data before the chrome).
    this.dom.appendChild(this.rowGutter);
    this.dom.appendChild(this.colGutter);
    this.dom.appendChild(this.addRowBtn);
    this.dom.appendChild(this.addColBtn);

    this.syncHandles(node);

    // Reposition handles when the table's bounding box changes (column resize
    // drag, font/layout reflow, etc). The constructor's measurement runs once
    // before the table is laid out — schedule one for after the first paint
    // too, otherwise handles flash at (0, 0) on initial mount.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleReposition();
      });
      this.resizeObserver.observe(this.table);
    }
    this.scheduleReposition();

    // Per-row / per-column handle visibility: hover any cell to surface its
    // owning row + column handles (and nothing else). Delegated on the wrap
    // so we don't have to re-bind listeners every time syncHandles() rebuilds
    // children, and so it catches hover transitions for cells AND for the
    // handles themselves.
    this.dom.addEventListener("mouseover", this.onWrapMouseOver);
    this.dom.addEventListener("mouseout", this.onWrapMouseOut);
    // Double-click on prosemirror-tables' `.column-resize-handle` widget
    // resets that column's manual width (clears `colwidth` on every cell in
    // the column). Lets users undo a drag-resize without having to drag back
    // to a precise width.
    this.dom.addEventListener("dblclick", this.onDblClickResize);
    // Capture-phase: when the user mouses down on a column resize handle
    // (prosemirror-tables sets `columnResizingPluginKey.activeHandle` to the
    // cell's pos as the pointer enters the handle's hot zone), anchor the
    // editor's selection inside that cell BEFORE PM-tables' bubble-phase
    // `handleMouseDown` starts the resize. PM-tables' subsequent
    // `updateColumnWidth` dispatch then records the in-cell selection in
    // history, so Cmd-Z scrolls back to the table instead of launching the
    // viewport to wherever the caret happened to be sitting.
    this.dom.addEventListener("mousedown", this.onMaybeResizeStart, true);
  }

  override update(node: PMNode): boolean {
    const ok = super.update(node);
    if (ok) {
      this.syncHandles(node);
      this.scheduleReposition();
    }
    return ok;
  }

  override ignoreMutation(record: ViewMutationRecord): boolean {
    // Defer to the base class for everything it cares about (cell width
    // attributes etc); also ignore any mutation that happens inside our own
    // gutter / quick-add elements (they're not part of the document).
    if (
      record.target instanceof Node &&
      (this.rowGutter.contains(record.target) ||
        this.colGutter.contains(record.target) ||
        this.addRowBtn.contains(record.target) ||
        this.addColBtn.contains(record.target))
    ) {
      return true;
    }
    return super.ignoreMutation(record);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.repositionRaf !== null) {
      cancelAnimationFrame(this.repositionRaf);
      this.repositionRaf = null;
    }
    this.dom.removeEventListener("mouseover", this.onWrapMouseOver);
    this.dom.removeEventListener("mouseout", this.onWrapMouseOut);
    this.dom.removeEventListener("dblclick", this.onDblClickResize);
    this.dom.removeEventListener("mousedown", this.onMaybeResizeStart, true);
  }

  // ---------------------------------------------------------------------------
  // Per-row / per-column hover tracking
  // ---------------------------------------------------------------------------

  /**
   * Mark the row + column handles for whichever cell (or handle) the pointer
   * has entered as `data-active="true"`. The CSS reveals only `data-active`
   * handles, so the rest stay hidden — gives the user a "this row / this
   * column" affordance instead of showing every handle at once.
   *
   * Arrow function so the `this` binding survives the `addEventListener`
   * registration in the constructor without an extra `.bind(this)`.
   */
  private readonly onWrapMouseOver = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Directly hovering a handle? Just mark it.
    const directRow = target.closest(".pm-table-handle-row");
    if (directRow instanceof HTMLElement) {
      const idx = Number(directRow.dataset.index);
      if (Number.isFinite(idx)) this.setActive(idx, null);
      return;
    }
    const directCol = target.closest(".pm-table-handle-col");
    if (directCol instanceof HTMLElement) {
      const idx = Number(directCol.dataset.index);
      if (Number.isFinite(idx)) this.setActive(null, idx);
      return;
    }
    // Otherwise: hovering a cell. Mark both its row and column handles in a
    // single call — earlier this was two calls and the second cleared the
    // first, so only the column handle ever showed.
    const cell = target.closest<HTMLTableCellElement>("td, th");
    if (!cell) return;
    const row = cell.parentElement;
    if (!(row instanceof HTMLTableRowElement)) return;
    const rowIndex = this.rowIndexOf(row);
    // `cellIndex` is the cell's position within its row — the column index in
    // a table with no colspan, which our schema doesn't surface anyway. Good
    // enough for the visual hint.
    const colIndex = cell.cellIndex;
    this.setActive(
      rowIndex !== -1 ? rowIndex : null,
      colIndex >= 0 ? colIndex : null,
    );
  };

  /**
   * Clear the active handles when the pointer leaves the wrap entirely (i.e.
   * `relatedTarget` is outside `this.dom`). Crossing between siblings inside
   * the wrap doesn't fire a wrap-leave, so the active handles stay put until
   * another hover takes over.
   */
  private readonly onWrapMouseOut = (event: MouseEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && this.dom.contains(next)) return;
    this.clearActiveHandles();
  };

  /**
   * Translate a `<tr>` element to its 0-based row index. Walks `thead` /
   * `tbody` sections so a header row counts as row 0 even though it lives in
   * a different parent than the body rows.
   */
  private rowIndexOf(row: HTMLTableRowElement): number {
    if (!this.table.isConnected) return -1;
    const rows = this.table.querySelectorAll("tr");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === row) return i;
    }
    return -1;
  }

  /**
   * Apply the `data-active="true"` attribute to a row and/or column handle in
   * one pass, replacing any previously-active handle. Pass `null` for an axis
   * you don't want to highlight (e.g. when hovering a column-only handle).
   * Earlier we had separate setActiveRow / setActiveCol, but each cleared all
   * handles first, so calling them back-to-back (cell hover → row THEN col)
   * left only the column handle visible. Single combined entry-point fixes
   * that.
   */
  private setActive(rowIndex: number | null, colIndex: number | null): void {
    this.clearActiveHandles();
    if (rowIndex !== null) {
      const handle = this.rowGutter.children[rowIndex];
      if (handle instanceof HTMLElement) {
        handle.setAttribute("data-active", "true");
      }
    }
    if (colIndex !== null) {
      const handle = this.colGutter.children[colIndex];
      if (handle instanceof HTMLElement) {
        handle.setAttribute("data-active", "true");
      }
    }
  }

  private clearActiveHandles(): void {
    for (const child of this.rowGutter.children) {
      if (child instanceof HTMLElement) child.removeAttribute("data-active");
    }
    for (const child of this.colGutter.children) {
      if (child instanceof HTMLElement) child.removeAttribute("data-active");
    }
  }

  // ---------------------------------------------------------------------------
  // Column-resize reset (double-click .column-resize-handle to clear colwidth)
  // ---------------------------------------------------------------------------

  /**
   * Double-clicking near a column edge resets that column's manual width.
   *
   * We can't rely on `event.target` being the `.column-resize-handle` widget
   * because that widget has `pointer-events: none` in our CSS (so the
   * underlying cell still receives click/double-click for content selection).
   * Instead we read `columnResizingPluginKey`'s `activeHandle`: the resize
   * plugin sets that to the doc position of the cell whose right edge the
   * pointer is near (within `handleWidth` px, default 5). When the dblclick
   * lands on a cell AND `activeHandle >= 0`, we treat it as "reset this
   * column" — same affordance the user sees the resize cursor for.
   */
  private readonly onDblClickResize = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Only trigger when the dblclick lands inside (or on) a table cell.
    const cell = target.closest<HTMLTableCellElement>("td, th");
    if (!cell) return;
    const pluginState = columnResizingPluginKey.getState(this.view.state);
    if (!pluginState || pluginState.activeHandle < 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.resetColumnWidth(cell, pluginState.activeHandle);
  };

  /**
   * Capture-phase mousedown on the table wrap. When the pointer is on a
   * prosemirror-tables column resize handle (signalled by
   * `columnResizingPluginKey.activeHandle >= 0`), anchor the editor's
   * selection inside that cell so the resize commit's history record carries
   * an in-cell "before". On Cmd-Z, PM-history restores selection to the cell
   * and scrolls back to the table — instead of launching the viewport to
   * wherever the caret happened to be (often the doc top).
   *
   * Capture phase guarantees we run before PM-tables' own bubble-phase
   * `handleMouseDown`. We don't preventDefault or stopPropagation — PM-tables
   * still needs to receive the event to start the resize drag.
   */
  private readonly onMaybeResizeStart = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const state = columnResizingPluginKey.getState(this.view.state);
    if (!state || state.activeHandle < 0) return;
    const cellPos = state.activeHandle;
    try {
      const $cell = this.view.state.doc.resolve(cellPos + 1);
      const tr = this.view.state.tr.setSelection(TextSelection.near($cell));
      tr.setMeta("addToHistory", false);
      this.view.dispatch(tr);
    } catch {
      // Cell pos couldn't be resolved (NodeView recycling race) — let
      // PM-tables proceed without our anchor; worst case is the existing
      // scroll-jump behavior on undo, not a broken resize.
    }
  };

  /**
   * Clear `colwidth` on every cell of the column whose right edge has the
   * active resize handle. `activeHandle` is the doc position of the cell at
   * that edge — we resolve it to the enclosing table + column index, then
   * walk every cell in that column.
   */
  private resetColumnWidth(
    anchorCell: HTMLTableCellElement,
    activeHandle: number,
  ): void {
    const $activeCell = this.view.state.doc.resolve(activeHandle);
    let tableNode: PMNode | null = null;
    let tableStart = 0;
    for (let d = $activeCell.depth; d > 0; d--) {
      const node = $activeCell.node(d);
      if (node.type.spec.tableRole === "table") {
        tableNode = node;
        tableStart = $activeCell.start(d);
        break;
      }
    }
    if (!tableNode) return;
    const map = TableMap.get(tableNode);
    // `activeHandle` is the cell node's own position. Translate it to the
    // cell's slot in the TableMap to derive the column index.
    const cellStartInTable = activeHandle - tableStart;
    const slot = map.map.indexOf(cellStartInTable);
    if (slot < 0) return;
    const colIndex = slot % map.width;
    if (colIndex < 0 || colIndex >= map.width) return;

    // Anchor the editor's selection inside the affected column's top cell
    // BEFORE we dispatch the structural change. Otherwise, the post-edit
    // history record carries whatever selection was active when the user
    // dblclick'd (often somewhere far away, e.g. the top of the doc) — and
    // Cmd-Z, which always calls `scrollIntoView` on the restored selection,
    // launches the viewport to that location instead of leaving the user
    // looking at the table they just edited. Same pattern as `commitMove`'s
    // pre-dispatch selection anchor for the drag-reorder commands.
    const topCellStart = map.map[colIndex];
    if (topCellStart !== undefined) {
      try {
        const selTr = this.view.state.tr.setSelection(
          TextSelection.near(
            this.view.state.doc.resolve(topCellStart + tableStart + 1),
          ),
        );
        selTr.setMeta("addToHistory", false);
        this.view.dispatch(selTr);
      } catch {
        // If the resolve / setSelection fails the cell DOM may have been
        // detached mid-dblclick. Fall through and try the reset anyway.
      }
    }

    // Mirrors the `setColumnAlign` pattern in `table-commands.ts`: walk every
    // row at `colIndex`, dedupe via `seen` to skip cells that span multiple
    // rows, and write `colwidth: null` so `columnResizing` falls back to its
    // `defaultCellMinWidth`. Build the tr against the FRESH state (selection
    // now anchored in the cell) so PM-history records that selection as the
    // "before" — Cmd-Z restores it.
    const tr = this.view.state.tr;
    const seen = new Set<number>();
    for (let row = 0; row < map.height; row++) {
      const cellStart = map.map[row * map.width + colIndex];
      if (cellStart === undefined || seen.has(cellStart)) continue;
      seen.add(cellStart);
      const absPos = cellStart + tableStart;
      const cellNode = tr.doc.nodeAt(absPos);
      if (!cellNode) continue;
      if (cellNode.attrs.colwidth === null) continue;
      tr.setNodeMarkup(absPos, undefined, {
        ...cellNode.attrs,
        colwidth: null,
      });
    }
    if (!tr.docChanged) return;
    this.view.dispatch(tr);
    void anchorCell; // kept in signature for future use / breakpointing
  }

  // ---------------------------------------------------------------------------
  // Handle DOM
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the row + column handle buttons to match the current table shape.
   * Cheap-skips when the row + col counts haven't changed (the only structural
   * trigger that matters here — alignment / colwidth tweaks don't need new
   * DOM, only repositioning).
   */
  private syncHandles(node: PMNode): void {
    const map = TableMap.get(node);
    if (map.height === this.renderedRows && map.width === this.renderedCols) {
      return;
    }
    this.renderedRows = map.height;
    this.renderedCols = map.width;

    this.rowGutter.replaceChildren();
    for (let row = 0; row < map.height; row++) {
      this.rowGutter.appendChild(this.buildHandle("row", row));
    }
    this.colGutter.replaceChildren();
    for (let col = 0; col < map.width; col++) {
      this.colGutter.appendChild(this.buildHandle("col", col));
    }
  }

  private buildHandle(kind: "row" | "col", index: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `drag-handle pm-table-handle pm-table-handle-${kind}`;
    button.contentEditable = "false";
    button.setAttribute("data-index", String(index));
    button.setAttribute(
      "aria-label",
      kind === "row"
        ? `Row ${String(index + 1)} options`
        : `Column ${String(index + 1)} options`,
    );
    button.title = button.getAttribute("aria-label") ?? "";
    button.innerHTML = GRIP_SVG;
    // CRITICAL: prevent Chrome's default native HTML5 drag from hijacking the
    // gesture. The button is `contentEditable="false"` inside a contenteditable
    // surface — Chrome's default for non-editable embedded elements there is
    // to FIRE dragstart on a mouse-and-move, taking over the gesture for
    // native drag-and-drop. That stops the pointer events our drag handler
    // relies on. `draggable=false` + `dragstart.preventDefault()` belt-and-
    // suspenders the suppression so our pointer-driven reorder works.
    button.draggable = false;
    button.setAttribute("draggable", "false");
    button.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });
    this.attachHandleInteraction(button, kind, index);
    return button;
  }

  private buildAddButton(kind: "row" | "col"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pm-table-add pm-table-add-${kind}`;
    button.contentEditable = "false";
    button.setAttribute(
      "aria-label",
      kind === "row" ? "Add row below" : "Add column right",
    );
    button.title = button.getAttribute("aria-label") ?? "";
    button.innerHTML = PLUS_SVG;
    // Block the editor from claiming focus on press (which would clobber the
    // selection we set just before dispatching the structural transaction).
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.quickAdd(kind);
    });
    return button;
  }

  // ---------------------------------------------------------------------------
  // Handle interaction (click → popover, drag → reorder)
  // ---------------------------------------------------------------------------

  private attachHandleInteraction(
    button: HTMLButtonElement,
    kind: "row" | "col",
    index: number,
  ): void {
    // Don't let pointerdown bubble — the outer block-handle plugin's
    // `mousemove`/`pointerdown` driver lives in the page gutter, but it
    // observes the editor surface broadly; stopping propagation keeps
    // confusing double-handles from racing each other.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    let dragState: {
      startX: number;
      startY: number;
      pointerId: number;
      startedDrag: boolean;
    } | null = null;

    /**
     * Run while a handle drag is active. Listeners go on `window` with
     * `{ capture: true }` so they run BEFORE the editor's bubble-phase
     * mouse/pointer handlers — without that, `tableEditing()` sees the
     * pointermoves passing over cells and starts its own cell-selection
     * drag, which flickers visibly and steals the gesture. The capture
     * phase + `stopPropagation` keeps the editor entirely unaware of the
     * gesture until pointerup, when we dispatch the move ourselves.
     */
    const onPointerMove = (event: PointerEvent) => {
      if (dragState?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (!dragState.startedDrag) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) {
          return;
        }
        dragState.startedDrag = true;
        button.setAttribute("data-dragging", "true");
        // Fade the source row/column so the user can see what they're moving.
        // `event` carries the current pointer position, which `liveTable` uses
        // for a fallback DOM lookup when the cached `this.table` is stale.
        this.markSourceDrag(kind, index, button, event);
      }
      this.updateDragIndicator(kind, event, button);
    };

    const finalize = (event: PointerEvent, commit: boolean) => {
      if (dragState?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      // releasePointerCapture is safe even though we attached listeners on
      // window — the capture was set on the button at pointerdown.
      try {
        button.releasePointerCapture(dragState.pointerId);
      } catch {
        // No active capture (browser may have already released on pointercancel).
      }
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("keydown", onEscape, true);
      const wasDrag = dragState.startedDrag;
      dragState = null;
      button.removeAttribute("data-dragging");
      this.clearDragIndicator();
      this.clearSourceDragHighlight();
      if (!wasDrag) {
        // No drag — treat as a click and open the popover.
        this.openPopover(button, kind, index);
        return;
      }
      if (!commit) return;
      const target = this.resolveDropIndex(kind, event, button);
      if (target === null || target === index) return;
      this.commitMove(kind, index, target, button, event);
    };

    const onPointerUp = (event: PointerEvent) => {
      finalize(event, true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      finalize(event, false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragState) return;
      event.stopPropagation();
      // Synthesize a fake pointer event with the current state so finalize()'s
      // cleanup path runs without committing.
      const fake = new PointerEvent("pointercancel", {
        pointerId: dragState.pointerId,
      });
      finalize(fake, false);
    };

    button.addEventListener("pointerdown", (event) => {
      // Only the primary button starts a drag/click; right-click etc. ignored.
      if (event.button !== 0) return;
      event.preventDefault();
      // Critical: stop pointerdown from reaching the editor surface, otherwise
      // prosemirror-tables' tableEditing plugin starts a cell-selection drag
      // in parallel with ours (the flicker the user reported on column drag).
      event.stopPropagation();
      button.setPointerCapture(event.pointerId);
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        startedDrag: false,
      };
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
      window.addEventListener("keydown", onEscape, true);
    });
  }

  /**
   * Resolve a LIVE `<table>` reference for measurement. `this.table` is the
   * `<table>` element the NodeView created in its constructor, but ProseMirror
   * frequently replaces a `table` NodeView (destroy + new ctor) when adjacent
   * structure changes — even if our `update()` returns true, a parent rebuild
   * can swap this NodeView out. The pointer-down closure captures `this`, so
   * `this.table` ends up pointing at a detached element whose
   * `getBoundingClientRect()` is `{0,0,0,0}`. To stay robust:
   *   1. If `this.table` is still connected, use it directly.
   *   2. Otherwise look up the table under the cursor via `elementsFromPoint`.
   *   3. Otherwise walk from the button (still in DOM during the drag) to the
   *      sibling `<table>` inside the same `.pm-table-wrap`.
   */
  /**
   * Resolve a LIVE `<table>` element for measurement, robust to NodeView
   * recycling. ProseMirror sometimes destroys and recreates a NodeView even
   * when our `update()` returns true (the inner reconciliation may bail on
   * adjacent mutations or plugin-driven invalidations). The handle's pointer
   * closure captures `this`, so `this.table` can end up pointing at a
   * detached element whose `getBoundingClientRect()` is `{0,0,0,0}`. To stay
   * robust:
   *   1. If `this.table` is still connected, use it.
   *   2. Walk the elements under the cursor — pick the first that is, is
   *      inside, or is the wrapper of a `<table>`. The base prosemirror-
   *      tables NodeView puts `.tableWrapper` on its wrapper div; our
   *      subclass adds `.pm-table-wrap`; either identifies a wrap whose
   *      child `<table>` is live.
   *   3. As a last resort, if the captured button is still in the document,
   *      walk up from it to its wrap and find the table there.
   */
  private liveTable(
    button: HTMLElement,
    event: PointerEvent,
  ): HTMLTableElement | null {
    if (this.table.isConnected) return this.table;
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of stack) {
      if (el instanceof HTMLTableElement) return el;
      const inside = el.closest("table");
      if (inside instanceof HTMLTableElement) return inside;
      if (
        el instanceof Element &&
        (el.classList.contains("pm-table-wrap") ||
          el.classList.contains("tableWrapper"))
      ) {
        const child = el.querySelector("table");
        if (child instanceof HTMLTableElement) return child;
      }
    }
    if (button.isConnected) {
      const wrap = button.closest(".pm-table-wrap");
      const fromWrap = wrap?.querySelector("table");
      if (fromWrap instanceof HTMLTableElement) return fromWrap;
    }
    return null;
  }

  /**
   * Compute the target row/column index from the current pointer position by
   * comparing it against the midpoints of every row's <tr> or column's first-
   * row <td>. Returns `null` when the pointer is far enough outside the table
   * that no drop should commit.
   */
  private resolveDropIndex(
    kind: "row" | "col",
    event: PointerEvent,
    button: HTMLElement,
  ): number | null {
    const table = this.liveTable(button, event);
    if (!table) return null;
    const tableRect = table.getBoundingClientRect();
    // Generous slack: lets the user park the pointer beside the table without
    // losing the gesture. Beyond this, treat as "cancel".
    const SLACK = 80;
    if (
      event.clientX < tableRect.left - SLACK ||
      event.clientX > tableRect.right + SLACK ||
      event.clientY < tableRect.top - SLACK ||
      event.clientY > tableRect.bottom + SLACK
    ) {
      return null;
    }
    if (kind === "row") {
      const rows = Array.from(
        table.querySelectorAll<HTMLTableRowElement>("tr"),
      );
      let best = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]?.getBoundingClientRect();
        if (!r) continue;
        const mid = (r.top + r.bottom) / 2;
        const delta = Math.abs(event.clientY - mid);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = i;
        }
      }
      return best;
    }
    // Column: probe the first row's cells for their X midpoints.
    const firstRow = table.querySelector<HTMLTableRowElement>("tr");
    if (!firstRow) return null;
    const cells = Array.from(firstRow.children) as HTMLElement[];
    let best = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i]?.getBoundingClientRect();
      if (!r) continue;
      const mid = (r.left + r.right) / 2;
      const delta = Math.abs(event.clientX - mid);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  }

  /**
   * Paint a single drop-line indicator at the seam between two rows/columns
   * closest to the pointer. Lives in `document.body` with `position: fixed`
   * so it stays visible even when the NodeView gets recycled mid-drag (which
   * would orphan an indicator appended into `this.dom`).
   */
  private updateDragIndicator(
    kind: "row" | "col",
    event: PointerEvent,
    button: HTMLElement,
  ): void {
    // Keep the source-overlay anchored to the live source rect on every move,
    // so it survives column-width changes / scrolls during a long drag.
    this.refreshSourceOverlay(event);
    const table = this.liveTable(button, event);
    if (!table) return;
    const indicator = this.ensureDragIndicator();
    const tableRect = table.getBoundingClientRect();
    if (kind === "row") {
      const rows = Array.from(
        table.querySelectorAll<HTMLTableRowElement>("tr"),
      );
      if (rows.length === 0) return;
      let bestY = rows[0]?.getBoundingClientRect().top ?? tableRect.top;
      let bestDelta = Infinity;
      const seamYs: number[] = [];
      for (const row of rows) seamYs.push(row.getBoundingClientRect().top);
      const last = rows[rows.length - 1]?.getBoundingClientRect();
      if (last) seamYs.push(last.bottom);
      for (const y of seamYs) {
        const delta = Math.abs(event.clientY - y);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestY = y;
        }
      }
      indicator.className = "pm-table-drop-line pm-table-drop-line-row";
      indicator.style.left = px(tableRect.left);
      indicator.style.width = px(tableRect.width);
      indicator.style.top = px(bestY - 1);
      indicator.style.height = "3px";
    } else {
      const firstRow = table.querySelector<HTMLTableRowElement>("tr");
      if (!firstRow) return;
      const cells = Array.from(firstRow.children) as HTMLElement[];
      const seamXs: number[] = [];
      for (const cell of cells) seamXs.push(cell.getBoundingClientRect().left);
      const lastCell = cells[cells.length - 1];
      if (lastCell) seamXs.push(lastCell.getBoundingClientRect().right);
      let bestX = seamXs[0] ?? tableRect.left;
      let bestDelta = Infinity;
      for (const x of seamXs) {
        const delta = Math.abs(event.clientX - x);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestX = x;
        }
      }
      indicator.className = "pm-table-drop-line pm-table-drop-line-col";
      indicator.style.top = px(tableRect.top);
      indicator.style.height = px(tableRect.height);
      indicator.style.left = px(bestX - 1);
      indicator.style.width = "3px";
    }
  }

  private ensureDragIndicator(): HTMLDivElement {
    if (this.dragIndicator?.isConnected) return this.dragIndicator;
    const el = document.createElement("div");
    el.contentEditable = "false";
    el.className = "pm-table-drop-line";
    document.body.appendChild(el);
    this.dragIndicator = el;
    return el;
  }
  private clearDragIndicator(): void {
    if (this.dragIndicator) {
      this.dragIndicator.remove();
      this.dragIndicator = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Source-row / source-column "I am dragging this" affordance
  // ---------------------------------------------------------------------------

  /**
   * While dragging row `index`, fade every cell in that row to half opacity
   * via `data-source-drag="true"`. Same for column drags. Cleared by
   * `clearSourceDragHighlight` from `finalize`.
   */
  /**
   * Cache the source row/column geometry at the moment the drag crosses the
   * threshold, then paint a translucent overlay across that strip. The overlay
   * is body-fixed (just like `dragIndicator`) and refreshed on every pointer
   * move so it tracks scroll / window-resize during the drag.
   */
  private sourceDragInfo: {
    kind: "row" | "col";
    index: number;
    button: HTMLElement;
  } | null = null;

  private markSourceDrag(
    kind: "row" | "col",
    index: number,
    button: HTMLElement,
    event: PointerEvent,
  ): void {
    this.sourceDragInfo = { kind, index, button };
    this.refreshSourceOverlay(event);
  }

  /**
   * Repaint the source overlay to the current row/column rect. Called once
   * when the drag starts AND from `updateDragIndicator` on every pointer move
   * so the overlay stays anchored even if the table reflows under it.
   */
  private refreshSourceOverlay(event: PointerEvent): void {
    if (!this.sourceDragInfo) return;
    const { kind, index, button } = this.sourceDragInfo;
    const table = this.liveTable(button, event);
    if (!table) return;
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));
    if (rows.length === 0) return;
    let rect: DOMRect | null = null;
    if (kind === "row") {
      const row = rows[index];
      rect = row ? row.getBoundingClientRect() : null;
    } else {
      const tableRect = table.getBoundingClientRect();
      // Use the first row's index-th cell for the X range; the Y range spans
      // the whole table top-to-bottom.
      const firstRow = rows[0];
      const cell = firstRow?.children[index];
      if (cell instanceof HTMLElement) {
        const cellRect = cell.getBoundingClientRect();
        rect = new DOMRect(
          cellRect.left,
          tableRect.top,
          cellRect.width,
          tableRect.height,
        );
      }
    }
    if (!rect) return;
    const overlay = this.ensureSourceOverlay();
    overlay.style.left = px(rect.left);
    overlay.style.top = px(rect.top);
    overlay.style.width = px(rect.width);
    overlay.style.height = px(rect.height);
  }

  private ensureSourceOverlay(): HTMLDivElement {
    if (this.sourceOverlay?.isConnected) return this.sourceOverlay;
    const el = document.createElement("div");
    el.contentEditable = "false";
    el.className = "pm-table-source-overlay";
    document.body.appendChild(el);
    this.sourceOverlay = el;
    return el;
  }

  private clearSourceDragHighlight(): void {
    this.sourceDragInfo = null;
    if (this.sourceOverlay) {
      this.sourceOverlay.remove();
      this.sourceOverlay = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Commands (click, drag-commit, +)
  // ---------------------------------------------------------------------------

  /**
   * Select the targeted row/column (so prosemirror-tables decorates it) and
   * fire `TABLE_HANDLE_EVENT` with the handle's screen rect so the React
   * popover can position over it.
   */
  private openPopover(
    button: HTMLButtonElement,
    kind: "row" | "col",
    index: number,
  ): void {
    const tablePos = this.tablePos();
    if (tablePos === null) return;
    const node = this.view.state.doc.nodeAt(tablePos);
    if (!node) return;
    const map = TableMap.get(node);
    if (map.height === 0 || map.width === 0) return;
    const tableStart = tablePos + 1;

    const cellPos =
      kind === "row" ? map.map[index * map.width] : map.map[index];
    if (cellPos === undefined) return;

    // Build a CellSelection spanning the whole row or column and apply it. The
    // popover reads back the resulting selection for its alignment swatch.
    const $cell = this.view.state.doc.resolve(cellPos + tableStart);
    const selection =
      kind === "row"
        ? CellSelection.rowSelection($cell)
        : CellSelection.colSelection($cell);
    const tr = this.view.state.tr.setSelection(selection);
    this.view.dispatch(tr);
    // Focus is unwanted: the popover lives outside the editor and grabs its
    // own focus on first interactive element render.

    // Compute the freshest isHeaderRow / currentAlign AFTER dispatching the
    // selection so `readColumnAlign` resolves against the right cells.
    const updatedNode = this.view.state.doc.nodeAt(tablePos);
    if (!updatedNode) return;
    const isHeaderRow =
      kind === "row" && index === 0 && this.rowIsAllHeaders(updatedNode);
    const currentAlign =
      kind === "col" ? readColumnAlign(this.view.state) : null;

    const rect = button.getBoundingClientRect();
    const detail: TableHandleEventDetail = {
      kind,
      index,
      total: kind === "row" ? map.height : map.width,
      isHeaderRow,
      currentAlign,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
    window.dispatchEvent(
      new CustomEvent<TableHandleEventDetail>(TABLE_HANDLE_EVENT, { detail }),
    );
  }

  /**
   * Dispatch the move-row / move-column command for the dragged handle.
   *
   * `prosemirror-tables`' `moveTableRow` / `moveTableColumn` accept an optional
   * `pos` field but DEFAULT it to `state.selection.from`. The internal helpers
   * (`moveColumn` / `moveRow` → `getCellsInColumn` → `findTable(selection.$from)`)
   * then identify the target table FROM THAT selection — they don't look at
   * `from` / `to` for table identity. So if the caret happens to be in a
   * different table (or non-table content) when the user drops, the command
   * walks the wrong table, can't match the source index there, and returns
   * `false` without dispatching. No error, no toast — the drop just doesn't
   * commit. (User reported this as a flaky "sometimes the drop doesn't move
   * the column" behavior.)
   *
   * Fix: resolve the LIVE source table from the DOM (the same `liveTable`
   * helper that already keeps `resolveDropIndex` / `updateDragIndicator`
   * resilient to NodeView recycling), pull its doc position via
   * `view.posAtDOM`, and hand that to the move command as `pos`. Now the
   * table identity is independent of selection state.
   */
  private commitMove(
    kind: "row" | "col",
    from: number,
    to: number,
    button: HTMLElement,
    event: PointerEvent,
  ): void {
    const table = this.liveTable(button, event);
    if (!table) {
      console.warn("[pm-table] commitMove: no live table at drop", {
        kind,
        from,
        to,
      });
      return;
    }
    const pos = this.resolveTablePos(table);
    if (pos === null) {
      console.warn("[pm-table] commitMove: could not resolve table pos", {
        kind,
        from,
        to,
      });
      return;
    }

    // `moveTableRow` / `moveTableColumn` accept `pos`, but the internal
    // helpers `getSelectionRangeInRow` / `getSelectionRangeInColumn` they
    // delegate to call `getCellsInRow(i, tr.selection)` / its column twin,
    // which walks `findTable(tr.selection.$from)` and ignores `pos`. So if
    // the editor's selection is in a different table (or in non-table
    // content), those helpers return `undefined`, `moveRow`/`moveColumn`
    // return false, and the move is silently dropped. Set the selection
    // inside the target table first — a no-history selection-only tr — so
    // those helpers walk THIS table. This is the actual fix for the
    // "sometimes drop doesn't reorder" flake; passing `pos` alone wasn't
    // enough.
    if (!this.selectionIsInTableAt(pos)) {
      try {
        const selTr = this.view.state.tr.setSelection(
          TextSelection.near(this.view.state.doc.resolve(pos)),
        );
        selTr.setMeta("addToHistory", false);
        this.view.dispatch(selTr);
      } catch (err) {
        console.warn(
          "[pm-table] commitMove: failed to set selection in target table",
          err,
        );
        return;
      }
    }

    const command =
      kind === "row"
        ? allowVerseEdit(moveTableRow({ from, to, pos }))
        : allowVerseEdit(moveTableColumn({ from, to, pos }));
    const ok = command(
      this.view.state,
      this.view.dispatch.bind(this.view),
      this.view,
    );
    if (!ok) {
      console.warn("[pm-table] commitMove: moveTable command returned false", {
        kind,
        from,
        to,
        pos,
        selectionFrom: this.view.state.selection.from,
      });
    }
  }

  /**
   * Quick check: does the editor's current selection live inside the same
   * table as `pos`? If yes, we don't need to dispatch a selection-only tr
   * before the move — saves one extra round-trip through the view.
   */
  private selectionIsInTableAt(pos: number): boolean {
    try {
      const $sel = this.view.state.doc.resolve(this.view.state.selection.from);
      const $tablePos = this.view.state.doc.resolve(pos);
      // Walk up the selection's resolved-pos ancestors looking for a table
      // whose start matches the resolved table for `pos`.
      for (let d = $sel.depth; d > 0; d--) {
        const node = $sel.node(d);
        if (node.type.spec.tableRole === "table") {
          // Same table iff the table's start position matches.
          const selTableStart = $sel.start(d);
          for (let td = $tablePos.depth; td > 0; td--) {
            if ($tablePos.node(td).type.spec.tableRole === "table") {
              return $tablePos.start(td) === selTableStart;
            }
          }
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Map a live `<table>` element to a doc position that
   * prosemirror-tables' `findTable($pos)` can resolve to this exact table.
   * Tries the most reliable source first and falls back through a chain:
   *
   *   1. The first cell (`td` or `th`) — cells are their own NodeViews so
   *      PM tracks them directly. `posAtDOM(cell, 0)` returns a position
   *      inside the cell, which is inside the table.
   *   2. The `<tbody>` (which IS the base TableView's contentDOM) at offset 0.
   *   3. The `<table>` element itself at offset 0 (least reliable — PM
   *      doesn't necessarily track this wrapper, but `posAtDOM` can usually
   *      figure it out by walking ancestors).
   *
   * Returns null when nothing maps — caller logs + bails.
   */
  private resolveTablePos(table: HTMLTableElement): number | null {
    const firstCell = table.querySelector<HTMLTableCellElement>("td, th");
    const candidates: HTMLElement[] = [];
    if (firstCell) candidates.push(firstCell);
    const tbody = table.querySelector("tbody");
    if (tbody instanceof HTMLElement) candidates.push(tbody);
    candidates.push(table);
    for (const el of candidates) {
      try {
        const pos = this.view.posAtDOM(el, 0, 1);
        if (pos >= 0) return pos;
      } catch {
        // Element isn't in PM's tree; try the next candidate.
      }
    }
    return null;
  }

  private quickAdd(kind: "row" | "col"): void {
    const tablePos = this.tablePos();
    if (tablePos === null) return;
    const node = this.view.state.doc.nodeAt(tablePos);
    if (!node) return;
    const map = TableMap.get(node);
    if (map.height === 0 || map.width === 0) return;
    const tableStart = tablePos + 1;
    // Place the selection in the last row (for +row) or last column (for +col)
    // so add{Row,Column}After targets the right slot.
    const targetRow = kind === "row" ? map.height - 1 : 0;
    const targetCol = kind === "col" ? map.width - 1 : 0;
    const cellPos = map.map[targetRow * map.width + targetCol];
    if (cellPos === undefined) return;
    const $cell = this.view.state.doc.resolve(cellPos + tableStart);
    const selection =
      kind === "row"
        ? CellSelection.rowSelection($cell)
        : CellSelection.colSelection($cell);
    this.view.dispatch(this.view.state.tr.setSelection(selection));
    const command = kind === "row" ? addRowAfterSafe : addColumnAfterSafe;
    command(this.view.state, this.view.dispatch.bind(this.view), this.view);
    this.view.focus();
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve this NodeView's `<table>` back to the document position of the
   * `table` node. We walk up from `this.dom` (the wrapper `<div>`) until
   * `posAtDOM` returns a valid pos, then back off by one (posAtDOM lands at
   * the position INSIDE the table wrapper; we want the table node itself).
   */
  private tablePos(): number | null {
    try {
      const wrapperPos = this.view.posAtDOM(this.dom, 0);
      if (wrapperPos < 0) return null;
      // posAtDOM(dom, 0) returns the position immediately inside `dom` — for a
      // top-level NodeView, that's the table node's start (i.e. the position
      // RIGHT AFTER the table's opening token). The table node's pos is one
      // less. Sanity-check the lookup by verifying we land on a table.
      const candidate = wrapperPos - 1;
      const node = this.view.state.doc.nodeAt(candidate);
      if (node?.type === this.node.type) return candidate;
      // Fallback: scan ancestors via the DOM until we find a parent that
      // resolves to this exact node.
      for (let p = candidate - 1; p >= 0; p--) {
        const n = this.view.state.doc.nodeAt(p);
        if (n?.type === this.node.type) return p;
      }
      return null;
    } catch {
      return null;
    }
  }

  private rowIsAllHeaders(table: PMNode): boolean {
    const firstRow = table.firstChild;
    if (!firstRow) return false;
    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      if (cell.type.name !== "table_header") return false;
    }
    return firstRow.childCount > 0;
  }

  // ---------------------------------------------------------------------------
  // Reposition
  // ---------------------------------------------------------------------------

  /**
   * Coalesce reposition requests into one rAF tick so a flurry of mutations
   * (column resize, multi-cell paste) doesn't thrash layout reads.
   */
  private scheduleReposition(): void {
    if (this.repositionRaf !== null) return;
    this.repositionRaf = requestAnimationFrame(() => {
      this.repositionRaf = null;
      this.reposition();
    });
  }

  private reposition(): void {
    const tableRect = this.table.getBoundingClientRect();
    const wrapRect = this.dom.getBoundingClientRect();
    // Tables that aren't laid out yet (display:none ancestor, off-screen on
    // mount) report zero rects — skip gracefully so we don't write NaNs.
    if (tableRect.width === 0 || tableRect.height === 0) return;

    // Row handles sit in the left gutter, one per <tr>.
    const rows = Array.from(
      this.table.querySelectorAll<HTMLTableRowElement>("tr"),
    );
    const rowButtons = Array.from(
      this.rowGutter.children,
    ) as HTMLButtonElement[];
    for (let i = 0; i < rowButtons.length; i++) {
      const row = rows[i];
      const btn = rowButtons[i];
      if (!row || !btn) continue;
      const r = row.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2 - wrapRect.top;
      btn.style.top = px(mid - 12);
      btn.style.left = px(tableRect.left - wrapRect.left - 22);
    }

    // Column handles sit above the first row, one per column.
    const firstRow = this.table.querySelector<HTMLTableRowElement>("tr");
    const colButtons = Array.from(
      this.colGutter.children,
    ) as HTMLButtonElement[];
    if (firstRow) {
      const cells = Array.from(firstRow.children) as HTMLElement[];
      for (let i = 0; i < colButtons.length; i++) {
        const cell = cells[i];
        const btn = colButtons[i];
        if (!cell || !btn) continue;
        const r = cell.getBoundingClientRect();
        const mid = (r.left + r.right) / 2 - wrapRect.left;
        btn.style.left = px(mid - 10);
        btn.style.top = px(tableRect.top - wrapRect.top - 22);
      }
    }

    // `+` buttons: row-add directly under the last row, col-add to the right
    // of the table at vertical center.
    this.addRowBtn.style.left = px(tableRect.left - wrapRect.left);
    this.addRowBtn.style.width = px(tableRect.width);
    this.addRowBtn.style.top = px(tableRect.bottom - wrapRect.top + 4);

    this.addColBtn.style.top = px(tableRect.top - wrapRect.top);
    this.addColBtn.style.height = px(tableRect.height);
    this.addColBtn.style.left = px(tableRect.right - wrapRect.left + 4);
  }
}
