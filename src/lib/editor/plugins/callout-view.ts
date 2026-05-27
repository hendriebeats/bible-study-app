import type { Node } from "prosemirror-model";
import type { NodeView, ViewMutationRecord } from "prosemirror-view";

interface VariantMeta {
  label: string;
  icon: string;
}

const NOTE: VariantMeta = { label: "Note", icon: "ℹ️" };

const VARIANTS: Record<string, VariantMeta> = {
  note: NOTE,
  insight: { label: "Key insight", icon: "💡" },
  warning: { label: "Warning", icon: "⚠️" },
  prayer: { label: "Prayer", icon: "🙏" },
  application: { label: "Application", icon: "✅" },
};

function metaFor(variant: unknown): { key: string; meta: VariantMeta } {
  const key =
    typeof variant === "string" && variant in VARIANTS ? variant : "note";
  return { key, meta: VARIANTS[key] ?? NOTE };
}

/**
 * Renders a `callout` as a colored box with a non-editable variant header
 * (icon + label) above the editable content (`contentDOM`). The color comes
 * from the `callout callout-{variant}` classes (see globals.css tokens).
 */
export class CalloutView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;

  private node: Node;

  constructor(node: Node) {
    this.node = node;
    const { key, meta } = metaFor(node.attrs.variant);

    const aside = document.createElement("aside");
    aside.className = `callout callout-${key}`;
    aside.setAttribute("data-callout", "true");
    aside.setAttribute("data-variant", key);

    const header = document.createElement("div");
    header.className = "callout-header";
    header.contentEditable = "false";
    header.textContent = `${meta.icon} ${meta.label}`;

    const body = document.createElement("div");
    body.className = "callout-body";

    aside.appendChild(header);
    aside.appendChild(body);

    this.dom = aside;
    this.contentDOM = body;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    // Variant drives the header + classes; let PM rebuild the view if it changes.
    if (node.attrs.variant !== this.node.attrs.variant) {
      return false;
    }
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}
