import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

interface StudyBlockAttrs {
  label: string;
  prompt: string;
  lineageId: string | null;
  templateId: string | null;
}

function readAttrs(node: Node): StudyBlockAttrs {
  const a = node.attrs as Partial<StudyBlockAttrs>;
  return {
    label: typeof a.label === "string" ? a.label : "",
    prompt: typeof a.prompt === "string" ? a.prompt : "",
    lineageId: typeof a.lineageId === "string" ? a.lineageId : null,
    templateId: typeof a.templateId === "string" ? a.templateId : null,
  };
}

/** Keep the wrapper element's data-* attributes in sync with the node attrs. */
function syncDataAttrs(el: HTMLElement, attrs: StudyBlockAttrs): void {
  el.setAttribute("data-study-block", "true");
  el.setAttribute("data-label", attrs.label);
  el.setAttribute("data-prompt", attrs.prompt);
  if (attrs.lineageId === null) {
    el.removeAttribute("data-lineage-id");
  } else {
    el.setAttribute("data-lineage-id", attrs.lineageId);
  }
  if (attrs.templateId === null) {
    el.removeAttribute("data-template-id");
  } else {
    el.setAttribute("data-template-id", attrs.templateId);
  }
}

/**
 * Renders a `study_block` as a labeled card: a (rename-able) label + optional
 * prompt as non-editable chrome, with the user's editable content in the body
 * (`contentDOM`). Owners get an inline-editable label and a remove button;
 * read-only viewers get neither. Label edits commit on blur as a single
 * `setNodeMarkup` step (so they flow through the normal persist/broadcast path).
 */
export class StudyBlockView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly header: HTMLElement;
  private readonly labelInput: HTMLInputElement;
  private readonly promptEl: HTMLParagraphElement;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const attrs = readAttrs(node);

    const section = document.createElement("section");
    section.className = "study-block";
    // Mirror the schema's parseDOM attributes so that if ProseMirror ever
    // reconciles this NodeView's DOM back into the model, the study_block
    // round-trips losslessly (without these, a re-parse drops the attrs).
    syncDataAttrs(section, attrs);

    const header = document.createElement("div");
    header.className = "study-block-header";
    header.contentEditable = "false";

    const titleRow = document.createElement("div");
    titleRow.className = "study-block-titlerow";

    const labelInput = document.createElement("input");
    labelInput.className = "study-block-label";
    labelInput.value = attrs.label;
    labelInput.placeholder = "Block label";
    labelInput.readOnly = !editable;
    labelInput.addEventListener("blur", () => {
      this.commitLabel();
    });
    labelInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        labelInput.blur();
      }
    });
    titleRow.appendChild(labelInput);

    if (editable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "study-block-remove";
      remove.setAttribute("aria-label", "Remove block");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        this.remove();
      });
      titleRow.appendChild(remove);
    }

    const promptEl = document.createElement("p");
    promptEl.className = "study-block-prompt";
    promptEl.textContent = attrs.prompt;
    promptEl.style.display = attrs.prompt ? "" : "none";

    header.appendChild(titleRow);
    header.appendChild(promptEl);

    const body = document.createElement("div");
    body.className = "study-block-body";

    section.appendChild(header);
    section.appendChild(body);

    this.dom = section;
    this.contentDOM = body;
    this.header = header;
    this.labelInput = labelInput;
    this.promptEl = promptEl;
  }

  private commitLabel(): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const attrs = readAttrs(this.node);
    if (this.labelInput.value === attrs.label) {
      return;
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      label: this.labelInput.value,
    });
    this.view.dispatch(tr);
  }

  private remove(): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    this.view.dispatch(
      this.view.state.tr.delete(pos, pos + this.node.nodeSize),
    );
    this.view.focus();
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const attrs = readAttrs(node);
    syncDataAttrs(this.dom, attrs);
    if (document.activeElement !== this.labelInput) {
      this.labelInput.value = attrs.label;
    }
    this.promptEl.textContent = attrs.prompt;
    this.promptEl.style.display = attrs.prompt ? "" : "none";
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
