import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

interface StudyBlockAttrs {
  title: string;
  subtitle: string;
  placeholder: string;
  lineageId: string | null;
  templateId: string | null;
}

/** Read attrs with fallbacks for legacy blocks (label→title, prompt→placeholder). */
function readAttrs(node: Node): StudyBlockAttrs {
  const a = node.attrs as Partial<StudyBlockAttrs> & {
    label?: unknown;
    prompt?: unknown;
  };
  const title =
    typeof a.title === "string" && a.title !== ""
      ? a.title
      : typeof a.label === "string"
        ? a.label
        : "";
  const placeholder =
    typeof a.placeholder === "string" && a.placeholder !== ""
      ? a.placeholder
      : typeof a.prompt === "string"
        ? a.prompt
        : "";
  return {
    title,
    subtitle: typeof a.subtitle === "string" ? a.subtitle : "",
    placeholder,
    lineageId: typeof a.lineageId === "string" ? a.lineageId : null,
    templateId: typeof a.templateId === "string" ? a.templateId : null,
  };
}

/** Keep the wrapper element's data-* attributes in sync with the node attrs. */
function syncDataAttrs(el: HTMLElement, attrs: StudyBlockAttrs): void {
  el.setAttribute("data-study-block", "true");
  el.setAttribute("data-title", attrs.title);
  el.setAttribute("data-subtitle", attrs.subtitle);
  el.setAttribute("data-placeholder", attrs.placeholder);
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
 * Renders a `study_block` as a titled card: a (rename-able) title + an optional
 * subtitle as non-editable chrome, with the user's editable content in the body
 * (`contentDOM`). The body's empty-state placeholder is rendered by the
 * placeholder plugin (a decoration), not here. Owners get an inline-editable
 * title and a remove button; read-only viewers get neither. Title edits commit
 * on blur as a single `setNodeMarkup` step (so they flow through the normal
 * persist/broadcast path).
 */
export class StudyBlockView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly header: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly subtitleEl: HTMLParagraphElement;

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
    section.className = "study-block study-stack-item";
    // Mirror the schema's parseDOM attributes so that if ProseMirror ever
    // reconciles this NodeView's DOM back into the model, the study_block
    // round-trips losslessly (without these, a re-parse drops the attrs).
    syncDataAttrs(section, attrs);

    // A container-query layout: header (title + subtitle) beside the body when
    // the block is wide, stacked above it when narrow (see globals.css).
    const layout = document.createElement("div");
    layout.className = "study-block-layout";

    const header = document.createElement("div");
    header.className = "study-block-header";
    header.contentEditable = "false";

    const titleRow = document.createElement("div");
    titleRow.className = "study-block-titlerow";

    const titleInput = document.createElement("input");
    titleInput.className = "study-block-title";
    titleInput.value = attrs.title;
    titleInput.placeholder = "Block title";
    titleInput.readOnly = !editable;
    titleInput.addEventListener("blur", () => {
      this.commitTitle();
    });
    titleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        titleInput.blur();
      }
    });
    titleRow.appendChild(titleInput);

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

    const subtitleEl = document.createElement("p");
    subtitleEl.className = "study-block-subtitle";
    subtitleEl.textContent = attrs.subtitle;
    subtitleEl.style.display = attrs.subtitle ? "" : "none";

    header.appendChild(titleRow);
    header.appendChild(subtitleEl);

    const body = document.createElement("div");
    body.className = "study-block-body";

    layout.appendChild(header);
    layout.appendChild(body);
    section.appendChild(layout);

    this.dom = section;
    this.contentDOM = body;
    this.header = header;
    this.titleInput = titleInput;
    this.subtitleEl = subtitleEl;
  }

  private commitTitle(): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const attrs = readAttrs(this.node);
    if (this.titleInput.value === attrs.title) {
      return;
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      title: this.titleInput.value,
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
    if (document.activeElement !== this.titleInput) {
      this.titleInput.value = attrs.title;
    }
    this.subtitleEl.textContent = attrs.subtitle;
    this.subtitleEl.style.display = attrs.subtitle ? "" : "none";
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
