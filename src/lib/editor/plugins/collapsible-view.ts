import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

/**
 * Renders a `collapsible` as a foldable section: a header (toggle triangle +
 * editable title) over the body (`contentDOM`). The toggle flips the `open`
 * attr and the title commits the `summary` attr — both as `setNodeMarkup` steps
 * (mirrors {@link StudyBlockView}). The body is hidden by CSS when closed.
 * Read-only viewers get a disabled toggle + read-only title.
 */
export class CollapsibleView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly header: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly titleInput: HTMLInputElement;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const open = node.attrs.open !== false;
    const summary =
      typeof node.attrs.summary === "string" ? node.attrs.summary : "";

    const wrapper = document.createElement("div");
    wrapper.className = "collapsible";
    wrapper.setAttribute("data-collapsible", "true");
    wrapper.setAttribute("data-open", String(open));
    wrapper.setAttribute("data-summary", summary);

    const header = document.createElement("div");
    header.className = "collapsible-header";
    header.contentEditable = "false";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "collapsible-toggle";
    toggle.setAttribute("aria-label", "Toggle section");
    toggle.textContent = open ? "▾" : "▸";
    toggle.disabled = !editable;
    toggle.addEventListener("click", () => {
      this.toggleOpen();
    });

    const titleInput = document.createElement("input");
    titleInput.className = "collapsible-title";
    titleInput.value = summary;
    titleInput.placeholder = "Section title";
    titleInput.readOnly = !editable;
    titleInput.addEventListener("blur", () => {
      this.commitSummary();
    });
    titleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        titleInput.blur();
      }
    });

    header.appendChild(toggle);
    header.appendChild(titleInput);

    const body = document.createElement("div");
    body.className = "collapsible-body";

    wrapper.appendChild(header);
    wrapper.appendChild(body);

    this.dom = wrapper;
    this.contentDOM = body;
    this.header = header;
    this.toggle = toggle;
    this.titleInput = titleInput;
  }

  private toggleOpen(): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        open: this.node.attrs.open === false,
      }),
    );
  }

  private commitSummary(): void {
    const pos = this.getPos();
    if (pos == null || this.titleInput.value === this.node.attrs.summary) {
      return;
    }
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        summary: this.titleInput.value,
      }),
    );
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const open = node.attrs.open !== false;
    this.dom.setAttribute("data-open", String(open));
    this.toggle.textContent = open ? "▾" : "▸";
    const summary =
      typeof node.attrs.summary === "string" ? node.attrs.summary : "";
    this.dom.setAttribute("data-summary", summary);
    if (document.activeElement !== this.titleInput) {
      this.titleInput.value = summary;
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLElement && this.header.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
