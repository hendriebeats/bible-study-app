import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { Decoration, EditorView, NodeView } from "prosemirror-view";

import { bibleHubUrl } from "@/lib/scripture/biblehub";

import type { VerseNumberAttrs } from "../schema";
import type { VerseLabelSpec } from "./verse-label";

/** The contextual label (e.g. `3:20`) the verse-label plugin attached to this
 * marker via node decorations, or null when the plugin isn't running. */
function labelFromDecorations(
  decorations: readonly Decoration[],
): string | null {
  for (const deco of decorations) {
    const spec = deco.spec as Partial<VerseLabelSpec>;
    if (typeof spec.verseLabel === "string") {
      return spec.verseLabel;
    }
  }
  return null;
}

/** Fallback label from the node's own attrs (older markers without a contextual
 * decoration): the stored `n`, else the bare verse number. */
function fallbackLabel(attrs: VerseNumberAttrs): string {
  if (attrs.n !== "") {
    return attrs.n;
  }
  return attrs.verse != null ? String(attrs.verse) : "";
}

/**
 * Inline NodeView for `verse_number`. Renders a non-editable `<sup>` whose text
 * is the contextual label from the verse-label plugin (falling back to the
 * stored `n`). Beyond plain rendering it adds two affordances:
 *   - single click places the caret immediately to the marker's right, so a
 *     click "lands" naturally (editable views only); and
 *   - double click opens the verse's BibleHub page in a new tab (when the marker
 *     carries a structured book/chapter/verse — i.e. inserted after this shipped).
 */
export class VerseNumberView implements NodeView {
  readonly dom: HTMLElement;
  private node: Node;

  constructor(
    node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    decorations: readonly Decoration[],
    editable: boolean,
  ) {
    this.node = node;
    const dom = document.createElement("sup");
    dom.className = "scripture-verse";
    dom.contentEditable = "false";
    this.dom = dom;
    this.render(decorations);

    if (editable) {
      dom.addEventListener("mousedown", this.onMouseDown);
    }
    dom.addEventListener("dblclick", this.onDoubleClick);
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.render(decorations);
    return true;
  }

  private render(decorations: readonly Decoration[]): void {
    const attrs = this.node.attrs as VerseNumberAttrs;
    const label = labelFromDecorations(decorations) ?? fallbackLabel(attrs);
    this.dom.textContent = label;
    this.dom.setAttribute("data-verse", label);
  }

  /** Place the caret just to the right of the marker. */
  private readonly onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const after = pos + this.node.nodeSize;
    const { state } = this.view;
    this.view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, after))
        .scrollIntoView(),
    );
    this.view.focus();
  };

  /** Open the verse on BibleHub in a new tab. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const attrs = this.node.attrs as VerseNumberAttrs;
    if (attrs.book == null || attrs.chapter == null || attrs.verse == null) {
      return;
    }
    const url = bibleHubUrl(attrs.book, attrs.chapter, attrs.verse);
    if (!url) {
      return;
    }
    event.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.dom.removeEventListener("mousedown", this.onMouseDown);
    this.dom.removeEventListener("dblclick", this.onDoubleClick);
  }
}
