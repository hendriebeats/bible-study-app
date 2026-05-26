import type { Node } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

interface ScriptureAttrs {
  reference: string;
  text: string;
}

function readAttrs(node: Node): ScriptureAttrs {
  const a = node.attrs as Partial<ScriptureAttrs>;
  return {
    reference: typeof a.reference === "string" ? a.reference : "",
    text: typeof a.text === "string" ? a.text : "",
  };
}

// ESV verse markers look like `[1]` (or `[3:16]` across chapters).
const VERSE_MARKER = /\[(\d+(?::\d+)?)\]/g;

/**
 * Render the raw passage text into `container`, turning each `[n]` verse marker
 * into a <sup> superscript and preserving paragraph breaks.
 */
function renderBody(container: HTMLElement, text: string): void {
  container.textContent = "";
  for (const para of text.split(/\n{2,}/)) {
    if (para.trim() === "") {
      continue;
    }
    const p = document.createElement("p");
    p.className = "scripture-para";
    let lastIndex = 0;
    VERSE_MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VERSE_MARKER.exec(para)) !== null) {
      const before = para.slice(lastIndex, match.index);
      if (before !== "") {
        p.appendChild(document.createTextNode(before));
      }
      const sup = document.createElement("sup");
      sup.className = "scripture-verse";
      sup.textContent = match[1] ?? "";
      p.appendChild(sup);
      lastIndex = match.index + match[0].length;
    }
    const rest = para.slice(lastIndex);
    if (rest !== "") {
      p.appendChild(document.createTextNode(rest));
    }
    container.appendChild(p);
  }
}

/**
 * Renders a `scripture` atom: a reference header (+ a remove button for owners)
 * and the passage with superscript verse numbers. The node has no editable
 * content, so the text can't be corrupted — only the whole passage can be
 * selected/removed. Fully managed by this NodeView (so all mutations/events are
 * ignored except the remove button).
 */
export class ScriptureView implements NodeView {
  public readonly dom: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly refEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

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

    const root = document.createElement("div");
    root.className = "scripture";
    root.contentEditable = "false";

    const header = document.createElement("div");
    header.className = "scripture-ref";
    const refSpan = document.createElement("span");
    refSpan.textContent = attrs.reference;
    header.appendChild(refSpan);

    if (editable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "scripture-remove";
      remove.setAttribute("aria-label", "Remove passage");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        this.remove();
      });
      header.appendChild(remove);
    }

    const body = document.createElement("div");
    body.className = "scripture-text";
    renderBody(body, attrs.text);

    root.appendChild(header);
    root.appendChild(body);

    this.dom = root;
    this.refEl = refSpan;
    this.bodyEl = body;
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
    this.refEl.textContent = attrs.reference;
    renderBody(this.bodyEl, attrs.text);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return (
      target instanceof HTMLElement &&
      target.closest(".scripture-remove") !== null
    );
  }

  ignoreMutation(): boolean {
    return true;
  }
}
