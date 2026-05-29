import type { Node } from "prosemirror-model";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";

import { type BlockTone, normalizeTone } from "../block-tones";

interface StudyBlockAttrs {
  title: string;
  subtitle: string;
  placeholder: string;
  lineageId: string | null;
  templateId: string | null;
  variant: "standard" | "action";
  tone: BlockTone;
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
    variant: a.variant === "action" ? "action" : "standard",
    tone: normalizeTone(a.tone),
  };
}

/** Keep the wrapper element's data-* attributes in sync with the node attrs. */
function syncDataAttrs(el: HTMLElement, attrs: StudyBlockAttrs): void {
  el.setAttribute("data-study-block", "true");
  el.setAttribute("data-title", attrs.title);
  el.setAttribute("data-subtitle", attrs.subtitle);
  el.setAttribute("data-placeholder", attrs.placeholder);
  el.setAttribute("data-variant", attrs.variant);
  el.setAttribute("data-tone", attrs.tone);
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

/** Apply the variant modifier class without disturbing the base classes. */
function applyVariantClass(
  el: HTMLElement,
  variant: "standard" | "action",
): void {
  el.classList.remove("study-block--standard", "study-block--action");
  el.classList.add(`study-block--${variant}`);
}

/** Swap the tone modifier class (matches a `.study-block--tone-*` rule). */
function applyToneClass(el: HTMLElement, tone: BlockTone): void {
  // Strip any prior tone-* class — classList.remove with a name that isn't
  // present is a no-op, so we don't need to scan first.
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith("study-block--tone-")) {
      el.classList.remove(cls);
    }
  }
  el.classList.add(`study-block--tone-${tone}`);
}

/**
 * Renders a `study_block` as a titled card: a (rename-able) title + an optional
 * subtitle as non-editable chrome, with the user's editable content in the body
 * (`contentDOM`). The body's empty-state placeholder is rendered by the
 * placeholder plugin (a decoration), not here. Owners get an inline-editable
 * title (read-only viewers don't); adding, removing, and reordering blocks live
 * in the study-blocks dialog. Title edits commit on blur as a single
 * `setNodeMarkup` step (so they flow through the normal persist/broadcast path).
 *
 * The `"action"` variant renders a high-contrast reminder bar: header (left) +
 * subheader (right) only. Both fields are editable for owners and commit on
 * blur via the same `setNodeMarkup` path; the structural body still exists
 * (`block+` content rule unchanged) but its contentDOM is mounted inside a
 * `display:none` wrapper so it's never visible or interactive.
 */
export class StudyBlockView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly titleInput: HTMLTextAreaElement;
  // Non-null for variant === "standard"; the read-only subtitle paragraph in
  // the header column.
  private readonly subtitleEl: HTMLParagraphElement | null;
  // Non-null for variant === "action"; lets us mirror subtitle attr changes
  // back into the textarea on remote updates.
  private readonly subtitleInput: HTMLTextAreaElement | null;
  // Wraps every interactive control we own (header column for standard, the
  // full action bar for action). `stopEvent` defers to this so events inside
  // our chrome don't bubble to ProseMirror's editable surface.
  private readonly chrome: HTMLElement;

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
    applyVariantClass(section, attrs.variant);
    applyToneClass(section, attrs.tone);
    // Mirror the schema's parseDOM attributes so that if ProseMirror ever
    // reconciles this NodeView's DOM back into the model, the study_block
    // round-trips losslessly (without these, a re-parse drops the attrs).
    syncDataAttrs(section, attrs);

    if (attrs.variant === "action") {
      // High-contrast reminder bar: title left, subtitle right, no body.
      const bar = document.createElement("div");
      bar.className = "study-block-action";
      bar.contentEditable = "false";

      const titleInput = this.buildActionField(
        "study-block-action-title",
        attrs.title,
        "Step",
        editable,
      );
      const subtitleInput = this.buildActionField(
        "study-block-action-subtitle",
        attrs.subtitle,
        "What to do",
        editable,
      );

      titleInput.addEventListener("blur", () => {
        this.commitField("title", titleInput.value);
      });
      subtitleInput.addEventListener("blur", () => {
        this.commitField("subtitle", subtitleInput.value);
      });

      bar.appendChild(titleInput);
      bar.appendChild(subtitleInput);
      section.appendChild(bar);

      // Structural body still exists but is hidden — ProseMirror needs a real
      // mount point for the contentDOM or it will refuse to render the node.
      const bodyShell = document.createElement("div");
      // Carry `pm-block-host` for consistency with the standard variant even
      // though `--hidden` keeps the shell out of layout — keeps the contract
      // "every study-block body is a block host" uniform across variants.
      bodyShell.className =
        "study-block-body study-block-body--hidden pm-block-host";
      bodyShell.setAttribute("aria-hidden", "true");
      section.appendChild(bodyShell);

      this.dom = section;
      this.contentDOM = bodyShell;
      this.titleInput = titleInput;
      this.subtitleEl = null;
      this.subtitleInput = subtitleInput;
      this.chrome = bar;
      return;
    }

    // Standard variant — the existing titled-card layout.
    // A container-query layout: header (title + subtitle) beside the body when
    // the block is wide, stacked above it when narrow (see globals.css).
    const layout = document.createElement("div");
    layout.className = "study-block-layout";

    const header = document.createElement("div");
    header.className = "study-block-header";
    header.contentEditable = "false";

    const titleRow = document.createElement("div");
    titleRow.className = "study-block-titlerow";

    // Textarea (not input) so long titles wrap and the field grows vertically
    // — `field-sizing: content` on `.study-block-title` (globals.css) does the
    // growing. Enter still commits via the keydown handler below.
    const titleInput = document.createElement("textarea");
    titleInput.className = "study-block-title";
    titleInput.rows = 1;
    titleInput.wrap = "soft";
    titleInput.value = attrs.title;
    titleInput.placeholder = "Block title";
    titleInput.readOnly = !editable;
    titleInput.addEventListener("blur", () => {
      this.commitField("title", titleInput.value);
    });
    titleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        titleInput.blur();
      }
    });
    titleRow.appendChild(titleInput);

    const subtitleEl = document.createElement("p");
    subtitleEl.className = "study-block-subtitle";
    subtitleEl.textContent = attrs.subtitle;
    subtitleEl.style.display = attrs.subtitle ? "" : "none";

    header.appendChild(titleRow);
    header.appendChild(subtitleEl);

    const body = document.createElement("div");
    // `pm-block-host` declares this element as a draggable-block container
    // (see globals.css's --block-gutter rule and `hostRect` in block-drag.ts):
    // it reserves the inline-start gutter that the `.block-handle` lives in,
    // and `block-drag.ts` sizes the drop-line indicator to this element's
    // bounds instead of the outer editor's.
    body.className = "study-block-body pm-block-host";

    layout.appendChild(header);
    layout.appendChild(body);
    section.appendChild(layout);

    this.dom = section;
    this.contentDOM = body;
    this.titleInput = titleInput;
    this.subtitleEl = subtitleEl;
    this.subtitleInput = null;
    this.chrome = header;
  }

  /**
   * Build one of the action-variant's editable fields. Both share the same
   * shape: a one-row borderless textarea that grows with content, commits on
   * Enter, and is read-only for non-owners.
   */
  private buildActionField(
    className: string,
    value: string,
    placeholder: string,
    editable: boolean,
  ): HTMLTextAreaElement {
    const el = document.createElement("textarea");
    el.className = className;
    el.rows = 1;
    el.wrap = "soft";
    el.value = value;
    el.placeholder = placeholder;
    el.readOnly = !editable;
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        el.blur();
      }
    });
    return el;
  }

  /** Commit a title/subtitle edit as a single setNodeMarkup step. */
  private commitField(field: "title" | "subtitle", value: string): void {
    const pos = this.getPos();
    if (pos == null) {
      return;
    }
    const current = this.node.attrs as Record<string, unknown>;
    if (current[field] === value) {
      return;
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      [field]: value,
    });
    this.view.dispatch(tr);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    const prev = readAttrs(this.node);
    const next = readAttrs(node);
    // Variant changes require a brand-new DOM tree — the two layouts share no
    // structure. Bail so ProseMirror tears this view down and constructs a
    // fresh one.
    if (prev.variant !== next.variant) {
      return false;
    }
    this.node = node;
    syncDataAttrs(this.dom, next);
    applyVariantClass(this.dom, next.variant);
    applyToneClass(this.dom, next.tone);
    if (document.activeElement !== this.titleInput) {
      this.titleInput.value = next.title;
    }
    if (next.variant === "action") {
      if (
        this.subtitleInput !== null &&
        document.activeElement !== this.subtitleInput
      ) {
        this.subtitleInput.value = next.subtitle;
      }
    } else if (this.subtitleEl !== null) {
      this.subtitleEl.textContent = next.subtitle;
      this.subtitleEl.style.display = next.subtitle ? "" : "none";
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof HTMLElement && this.chrome.contains(target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
