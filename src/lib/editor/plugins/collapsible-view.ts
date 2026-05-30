import { Fragment, type Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { MAX_INDENT, nodes } from "../schema";
import { placeCaretInRect } from "./node-view-utils";

/** Indent step in rem — kept in lockstep with `INDENT_STEP_REM` in schema.ts. */
const INDENT_STEP_REM = 1.75;

/** Clamp an arbitrary indent attr to a sane integer in `[0, MAX_INDENT]`. */
function readIndent(node: Node): number {
  const raw: unknown = node.attrs.indent;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(raw)));
}

/** Apply / clear the indent's left-margin on the collapsible wrapper. */
function applyIndent(dom: HTMLElement, indent: number): void {
  if (indent > 0) {
    dom.style.marginInlineStart = `${String(indent * INDENT_STEP_REM)}rem`;
    dom.setAttribute("data-indent", String(indent));
  } else {
    dom.style.marginInlineStart = "";
    dom.removeAttribute("data-indent");
  }
}

/**
 * Renders a `collapsible` as a Notion-style toggle: a chevron marker in a
 * narrow left gutter (▾ open / ▸ closed) sitting next to the first child
 * paragraph (the header). The remaining children are the body, hidden by CSS
 * when `data-open="false"`. Everything is one `contentDOM` so:
 *   - ArrowLeft / ArrowRight nav out of the header / between header and body
 *     works with the default ProseMirror behavior (no contentEditable=false
 *     barrier in the way).
 *   - Backspace at the start of the header dissolves the toggle via the
 *     `collapsibleBackspace` keybinding (similar to how `liftListItem` lifts a
 *     list_item).
 *   - The header carries marks/indent/etc. exactly like a normal paragraph.
 *
 * The chevron lives OUTSIDE `contentDOM` so clicking it never moves the
 * caret. Toggle transactions are tagged `addToHistory: false` — the open/close
 * state is a UI control, not a content edit, and it would otherwise flood the
 * undo stack with cosmetic flips.
 *
 * Read-only viewers still get a working chevron (toggle is local to the view;
 * no transaction reaches the persist/broadcast path because the read-only
 * view's dispatch is a no-op).
 */
export class CollapsibleView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly toggle: HTMLButtonElement;
  private readonly emptyHint: HTMLElement;

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
    // "Empty body" = the collapsible has only a header child (no following
    // blocks). The Notion-style "Empty toggle. Click or drop blocks inside."
    // hint is rendered by CSS keyed on this attribute.
    const emptyBody = node.childCount <= 1;

    const wrapper = document.createElement("div");
    wrapper.className = "collapsible";
    wrapper.setAttribute("data-collapsible", "true");
    wrapper.setAttribute("data-open", String(open));
    wrapper.setAttribute("data-empty-body", String(emptyBody));
    // Honor the `indent` attr so Tab / drag-to-child shifts the toggle's
    // whole box, consistent with how paragraphs and list_rows handle indent.
    applyIndent(wrapper, readIndent(node));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "collapsible-toggle";
    toggle.setAttribute("aria-label", "Toggle section");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.contentEditable = "false";
    toggle.textContent = open ? "▾" : "▸";
    toggle.disabled = !editable;
    // Don't let pressing the chevron steal the selection into the body — keep
    // the caret where the user left it (which we may then move ourselves on
    // collapse, see toggleOpen).
    toggle.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    toggle.addEventListener("click", () => {
      this.toggleOpen(editable);
    });

    const content = document.createElement("div");
    // `pm-block-host` marks this as a draggable-block container so
    // `block-drag.ts`'s `hostRect` sizes the drop indicator to the collapsible
    // body. The visual gutter is supplied by the grid's chevron column (1.25rem)
    // + column-gap (0.25rem); see the `.collapsible-content.pm-block-host`
    // override in globals.css that zeros the generic --block-gutter padding.
    content.className = "collapsible-content pm-block-host";

    // Notion-style empty-body affordance: a clickable hint rendered AFTER the
    // contentDOM. Click inserts a fresh paragraph at the end of the toggle's
    // content, giving the user a body paragraph to type into. The hint is
    // contentEditable=false so the caret never lands on the hint itself.
    // Visibility is driven by `[data-empty-body]` + `[data-open]` on the
    // wrapper (see globals.css), so the show/hide cost is zero JS.
    const emptyHint = document.createElement("div");
    emptyHint.className = "collapsible-empty-hint";
    emptyHint.contentEditable = "false";
    emptyHint.textContent = "Empty toggle. Click or drop blocks inside.";
    emptyHint.addEventListener("mousedown", (event) => {
      // Don't let the click move the caret into the contentDOM at the start
      // of the header. We'll position the caret ourselves after dispatching.
      event.preventDefault();
    });
    emptyHint.addEventListener("click", () => {
      if (!editable) return;
      this.addBodyParagraph();
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(content);
    wrapper.appendChild(emptyHint);

    // Lock the outer wrapper out of the browser's contenteditable area so a
    // caret can't park in the chevron column / hint strip / bleed gaps
    // around the body (orphan typed text would be silently dropped by
    // `ignoreMutation` and discarded on the next re-render). Content is
    // explicitly re-opted-in.
    wrapper.contentEditable = "false";
    content.contentEditable = "true";

    this.dom = wrapper;
    this.contentDOM = content;
    this.toggle = toggle;
    this.emptyHint = emptyHint;

    // Click in the outer chrome → project into the content's rect and
    // resolve the nearest caret position.
    wrapper.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof globalThis.Node)) return;
      if (this.contentDOM.contains(event.target)) return;
      if (this.toggle.contains(event.target)) return;
      if (this.emptyHint.contains(event.target)) return;
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

  /**
   * Insert an empty paragraph at the end of the collapsible's content and
   * drop the caret inside it. Used by the empty-body hint's click handler.
   */
  private addBodyParagraph(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const paragraph = nodes.paragraph.createAndFill();
    if (!paragraph) return;
    // Insertion point: just before the collapsible's closing token (i.e.,
    // after the last child). `pos + this.node.nodeSize - 1` lands inside the
    // collapsible, past every existing child.
    const insertAt = pos + this.node.nodeSize - 1;
    const tr = this.view.state.tr.insert(insertAt, Fragment.from(paragraph));
    // Caret goes one step inside the new paragraph (past its open tag).
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  private toggleOpen(editable: boolean): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const nextOpen = this.node.attrs.open === false;
    let tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      open: nextOpen,
    });

    // When collapsing, if the caret lives in body content that's about to
    // disappear, move it to the end of the header first so the user doesn't
    // end up typing into hidden territory.
    if (!nextOpen && editable) {
      const sel = this.view.state.selection;
      const collapsibleEnd = pos + this.node.nodeSize;
      const cursorInside = sel.from > pos && sel.to < collapsibleEnd;
      const header = this.node.firstChild;
      if (cursorInside && header) {
        // Header starts one position inside the collapsible (skip the open
        // tag); its inline content ends `header.content.size` later.
        const headerEnd = pos + 1 + header.content.size + 1; // +1 past last inline pos
        // Translate "inside header" into the doc by checking the cursor's
        // ancestor: if the cursor's $from has the collapsible at depth d, the
        // header sits at depth d+1; anything beyond is body.
        const $from = sel.$from;
        let inHeader = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d) === this.node) {
            inHeader = $from.index(d) === 0;
            break;
          }
        }
        if (!inHeader) {
          const target = Math.min(headerEnd - 1, tr.doc.content.size);
          tr = tr.setSelection(TextSelection.create(tr.doc, target));
        }
      }
    }

    // Open/close is a UI control — don't litter undo history with it. The
    // history plugin (and our word-undo coordinator) both honor this meta.
    tr.setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const open = node.attrs.open !== false;
    this.dom.setAttribute("data-open", String(open));
    this.dom.setAttribute("data-empty-body", String(node.childCount <= 1));
    this.toggle.textContent = open ? "▾" : "▸";
    this.toggle.setAttribute("aria-expanded", String(open));
    applyIndent(this.dom, readIndent(node));
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target === this.toggle || target === this.emptyHint) return true;
    if (!(target instanceof globalThis.Node)) return false;
    // Mousedown anywhere in the outer chrome is owned by the gutter redirect
    // attached in the constructor — keep PM out of it.
    if (event.type === "mousedown" && !this.contentDOM.contains(target)) {
      return true;
    }
    return false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
