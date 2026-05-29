import { Fragment, type Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { type BlockTone, normalizeTone } from "../block-tones";
import { nodes } from "../schema";
import {
  CALLOUT_COLOR_EVENT,
  type CalloutColorEventDetail,
} from "./callout-color-events";

/**
 * Map legacy named-variant values (pre-redesign — `note` / `insight` /
 * `warning` / `prayer` / `application`) to the unified {@link BlockTone}
 * palette. New callouts store the tone key directly; saved docs with the
 * old strings normalize on read.
 */
const LEGACY_VARIANT_TO_TONE: Record<string, BlockTone> = {
  note: "sky",
  insight: "amber",
  warning: "coral",
  prayer: "plum",
  application: "sage",
};

function readTone(value: unknown): BlockTone {
  if (typeof value === "string" && value in LEGACY_VARIANT_TO_TONE) {
    const mapped = LEGACY_VARIANT_TO_TONE[value];
    if (mapped) return mapped;
  }
  return normalizeTone(value);
}

/**
 * "Empty body" = the callout has no body content beyond its header (index 0).
 * True when childCount ≤ 1 (header only) or when the only body child (index 1)
 * is an empty default paragraph. Drives the `[data-empty-body]` CSS rule that
 * paints the body placeholder.
 */
function isEmptyBody(node: PMNode): boolean {
  if (node.childCount <= 1) return true;
  if (node.childCount > 2) return false;
  const second = node.maybeChild(1);
  return second?.isTextblock === true && second.content.size === 0;
}

/**
 * Renders a `callout` as a colored, bordered wrapper around its editable
 * contentDOM. The first child IS the editable header (no separate non-
 * editable chrome), styled distinctly by CSS. A floating color chip lets the
 * user re-pick the variant inline without leaving the editor — click the
 * chip to open a small popover, click a swatch to recolor.
 *
 * The variant attribute is interpreted strictly as a color key; the wrapper
 * carries `.callout-{variant}` for the CSS color tokens to take effect, and
 * the labels / emoji that older versions rendered as chrome are gone (per
 * the user's request to drop named variants).
 */
export class CalloutView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly chip: HTMLButtonElement;
  private readonly emptyHint: HTMLElement;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const tone = readTone(node.attrs.variant);

    const aside = document.createElement("aside");
    aside.className = `callout callout-${tone}`;
    aside.setAttribute("data-callout", "true");
    aside.setAttribute("data-variant", tone);
    aside.setAttribute("data-empty-body", String(isEmptyBody(node)));

    const body = document.createElement("div");
    // `pm-block-host` declares this element as a draggable-block container
    // (see globals.css's --block-gutter rule and `hostRect` in block-drag.ts):
    // it reserves the inline-start gutter the `.block-handle` lives in, and
    // `block-drag.ts` sizes the drop-line indicator to this element's bounds
    // instead of the outer editor's.
    body.className = "callout-body pm-block-host";

    // Color chip — non-editable button at the top-right of the wrapper.
    // Click dispatches a window event picked up by the React-mounted
    // CalloutColorPopover, which renders the SHARED ToneSwatchPicker (the
    // same swatch grid used by the Edit-Study-Blocks dialog's Color menu).
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "callout-color-chip";
    chip.contentEditable = "false";
    chip.setAttribute("aria-label", "Change callout color");
    chip.title = "Change callout color";
    chip.disabled = !editable;
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!editable) return;
      this.openColorPopover();
    });

    const emptyHint = document.createElement("div");
    emptyHint.className = "callout-empty-hint";
    emptyHint.contentEditable = "false";
    emptyHint.textContent = "Empty callout. Click or drop blocks inside.";
    emptyHint.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    emptyHint.addEventListener("click", () => {
      if (!editable) return;
      this.addBodyParagraph();
    });

    aside.appendChild(body);
    aside.appendChild(emptyHint);
    aside.appendChild(chip);

    this.dom = aside;
    this.contentDOM = body;
    this.chip = chip;
    this.emptyHint = emptyHint;
  }

  /**
   * Insert an empty paragraph at the end of the callout's content and seat
   * the caret inside it. Used by the empty-body hint's click handler;
   * identical pattern to `CollapsibleView.addBodyParagraph`.
   */
  private addBodyParagraph(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const paragraph = nodes.paragraph.createAndFill();
    if (!paragraph) return;
    const insertAt = pos + this.node.nodeSize - 1;
    const tr = this.view.state.tr.insert(insertAt, Fragment.from(paragraph));
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  /**
   * Fire the `CALLOUT_COLOR_EVENT` so the React-mounted popover renders the
   * shared `ToneSwatchPicker` at the chip's screen position. The popover
   * sends the user's pick back via the `onPick` callback.
   */
  private openColorPopover(): void {
    const rect = this.chip.getBoundingClientRect();
    const detail: CalloutColorEventDetail = {
      x: rect.right,
      y: rect.bottom + 4,
      currentTone: readTone(this.node.attrs.variant),
      onPick: (tone) => {
        this.applyTone(tone);
      },
    };
    window.dispatchEvent(
      new CustomEvent<CalloutColorEventDetail>(CALLOUT_COLOR_EVENT, { detail }),
    );
  }

  private applyTone(next: BlockTone): void {
    const pos = this.getPos();
    if (pos == null) return;
    if (next === readTone(this.node.attrs.variant)) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      variant: next,
    });
    // Cosmetic edit — keep it out of undo history.
    tr.setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    const tone = readTone(node.attrs.variant);
    this.dom.className = `callout callout-${tone}`;
    this.dom.setAttribute("data-variant", tone);
    this.dom.setAttribute("data-empty-body", String(isEmptyBody(node)));
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Node)) return false;
    return this.chip.contains(target) || this.emptyHint.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
