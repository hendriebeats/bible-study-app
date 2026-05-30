import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { MAX_INDENT } from "../schema";
import { placeCaretInRect } from "./node-view-utils";

/** Clamp an untrusted indent value to a whole number in [0, MAX_INDENT]. */
function clampIndent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(value)));
}

/** Inline left margin for an `indent` level — matches `indentDOMAttrs` in
 *  schema.ts (kept in lockstep with `INDENT_STEP_REM` over there).  */
const INDENT_STEP_REM = 1.75;

/**
 * Renders a `list_row` (flat-schema unified list node — see schema.ts).
 *
 * Layout: a row `<div>` that always carries a `.list-row-content` span
 * holding the editable inline content. For `listType === "task"` we also
 * insert a leading `<input type="checkbox">` whose `change` handler commits a
 * `setNodeMarkup` step (so the toggle flows through the normal persist /
 * broadcast / history path). For `bullet` and `ordered` the marker is drawn
 * by a CSS `::before` pseudo-element (bullet: literal `•`, ordered: a CSS
 * counter incremented across the contiguous run of ordered siblings); this
 * keeps numbering correct as rows are inserted/removed/reordered without any
 * cross-row coordination in JS.
 *
 * Because this NodeView builds its own DOM imperatively, the `indent` attr
 * and `--list-start` custom property have to be applied here too (the
 * schema's `toDOM` never runs on NodeView-managed nodes).
 *
 * On a `listType` swap the layout is rebuilt (checkbox added/removed); on a
 * `checked` swap only the checkbox state is mirrored. Read-only viewers get a
 * disabled checkbox.
 */
export class ListRowView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly editable: boolean;
  private checkbox: HTMLInputElement | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.editable = editable;

    this.dom = document.createElement("div");
    this.contentDOM = document.createElement("span");
    this.contentDOM.className = "list-row-content";

    // Lock the outer row out of the browser's contenteditable area: it
    // contains a CE=false checkbox sibling (for `task` rows) and a CE=true
    // content span, so without this the browser would happily park a caret
    // in the gap between them. Typing there would land an orphan text node
    // in the outer div, which `ignoreMutation` would silently drop — and the
    // next drag-reorder would discard the row's DOM, taking that orphan
    // text with it. The contentDOM is re-opted-in to editing immediately
    // below so PM keeps working as normal.
    this.dom.contentEditable = "false";
    this.contentDOM.contentEditable = "true";

    this.applyAttrs(node);
    this.buildLayout();

    // Click in the outer chrome (the checkbox edge, the row's padding, the
    // gap between the checkbox and content) → project the click into the
    // content span and resolve the nearest caret position there. Same
    // pattern `NoteEntryView` uses for its ref column.
    this.dom.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof globalThis.Node)) return;
      if (this.contentDOM.contains(event.target)) return;
      if (this.checkbox?.contains(event.target)) return;
      event.preventDefault();
      const myPos = this.getPos();
      placeCaretInRect(
        this.view,
        this.contentDOM,
        event.clientX,
        event.clientY,
        (clickedAbove) => {
          if (myPos == null) return null;
          return clickedAbove ? myPos + 1 : myPos + this.node.nodeSize - 1;
        },
      );
    });
  }

  /** Sync the row's DOM attributes (class/data/style) with the node's attrs. */
  private applyAttrs(node: Node): void {
    const listType = String(node.attrs.listType);
    const indent = clampIndent(node.attrs.indent);
    const checked = node.attrs.checked === true;
    const listStart = node.attrs.listStart as number | null;

    this.dom.className = `list-row list-row-${listType}`;
    this.dom.setAttribute("data-list-row", "true");
    this.dom.setAttribute("data-list-type", listType);
    if (listType === "task") {
      this.dom.setAttribute("data-checked", String(checked));
    } else {
      this.dom.removeAttribute("data-checked");
    }
    if (typeof listStart === "number" && Number.isFinite(listStart)) {
      this.dom.setAttribute("data-list-start", String(listStart));
      this.dom.style.setProperty("--list-start", String(listStart));
    } else {
      this.dom.removeAttribute("data-list-start");
      this.dom.style.removeProperty("--list-start");
    }
    if (indent > 0) {
      this.dom.setAttribute("data-indent", String(indent));
      this.dom.style.marginInlineStart = `${String(indent * INDENT_STEP_REM)}rem`;
    } else {
      this.dom.removeAttribute("data-indent");
      this.dom.style.marginInlineStart = "";
    }
  }

  /** (Re)assemble the DOM children: optional checkbox + contentDOM. */
  private buildLayout(): void {
    while (this.dom.firstChild) this.dom.removeChild(this.dom.firstChild);
    if (String(this.node.attrs.listType) === "task") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "list-row-checkbox";
      checkbox.contentEditable = "false";
      checkbox.disabled = !this.editable;
      checkbox.checked = this.node.attrs.checked === true;
      // Don't let clicking the checkbox move the selection into the row.
      checkbox.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      checkbox.addEventListener("change", () => {
        const pos = this.getPos();
        if (pos == null) return;
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            checked: checkbox.checked,
          }),
        );
      });
      this.dom.appendChild(checkbox);
      this.checkbox = checkbox;
    } else {
      this.checkbox = null;
    }
    this.dom.appendChild(this.contentDOM);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    const previousType = String(this.node.attrs.listType);
    const nextType = String(node.attrs.listType);
    this.node = node;
    this.applyAttrs(node);
    if (previousType !== nextType) {
      this.buildLayout();
    } else if (this.checkbox) {
      this.checkbox.checked = node.attrs.checked === true;
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof globalThis.Node)) return false;
    if (this.checkbox?.contains(target)) return true;
    // Mousedown anywhere in the outer chrome (the row padding, the gap
    // between the checkbox and the content span) is owned by the gutter
    // redirect attached in the constructor — don't let PM also run its
    // default selection placement against the same coords.
    if (event.type === "mousedown" && !this.contentDOM.contains(target)) {
      return true;
    }
    return false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
