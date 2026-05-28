import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { MAX_INDENT } from "../schema";

/** Clamp an untrusted indent value to a whole number in [0, MAX_INDENT]. */
function clampIndent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(value)));
}

/** Inline left margin for an `indent` level — matches what `list_item`'s
 *  `toDOM` writes (kept in lockstep with `INDENT_STEP_REM` in schema.ts).  */
const INDENT_STEP_REM = 1.75;

/**
 * Renders a `task_item` as a checkbox + its editable content (`contentDOM`).
 * Toggling the checkbox commits the `checked` attr as a `setNodeMarkup` step
 * (so it flows through the normal persist/broadcast path). Read-only viewers
 * get a disabled checkbox.
 *
 * Because this NodeView builds its own DOM imperatively, the `indent` attr
 * has to be applied here too (the schema's `toDOM` never runs on
 * NodeView-managed nodes). Tab on the first task in a list bumps the indent
 * attr; without this wiring it'd be a no-op visually.
 */
export class TaskItemView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly checkbox: HTMLInputElement;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const checked = node.attrs.checked === true;
    const indent = clampIndent(node.attrs.indent);

    const li = document.createElement("li");
    li.className = "task-item";
    li.setAttribute("data-task-item", "true");
    li.setAttribute("data-checked", String(checked));
    if (indent > 0) {
      li.setAttribute("data-indent", String(indent));
      li.style.marginInlineStart = `${String(indent * INDENT_STEP_REM)}rem`;
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = checked;
    checkbox.contentEditable = "false";
    checkbox.disabled = !editable;
    // Don't let clicking the checkbox move the selection into the item.
    checkbox.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    checkbox.addEventListener("change", () => {
      const pos = this.getPos();
      if (pos == null) {
        return;
      }
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          checked: checkbox.checked,
        }),
      );
    });

    const content = document.createElement("div");
    content.className = "task-item-content";

    li.appendChild(checkbox);
    li.appendChild(content);

    this.dom = li;
    this.contentDOM = content;
    this.checkbox = checkbox;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const checked = node.attrs.checked === true;
    this.checkbox.checked = checked;
    this.dom.setAttribute("data-checked", String(checked));
    const indent = clampIndent(node.attrs.indent);
    if (indent > 0) {
      this.dom.setAttribute("data-indent", String(indent));
      this.dom.style.marginInlineStart = `${String(
        indent * INDENT_STEP_REM,
      )}rem`;
    } else {
      this.dom.removeAttribute("data-indent");
      this.dom.style.marginInlineStart = "";
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.checkbox;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
