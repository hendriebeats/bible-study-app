import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

/**
 * Renders a `task_item` as a checkbox + its editable content (`contentDOM`).
 * Toggling the checkbox commits the `checked` attr as a `setNodeMarkup` step
 * (so it flows through the normal persist/broadcast path). Read-only viewers
 * get a disabled checkbox.
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

    const li = document.createElement("li");
    li.className = "task-item";
    li.setAttribute("data-task-item", "true");
    li.setAttribute("data-checked", String(checked));

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
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.checkbox;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
