import type { PMDocJSON, PMNodeJSON } from "./types";

/**
 * A study block's identity, independent of ProseMirror. `lineageId` is the
 * cross-study "slot" (seeded from a genre/group template) so the same block
 * lines up across members' studies; `templateId` records the source template.
 */
export interface BlockSpec {
  label: string;
  prompt?: string | null;
  lineageId?: string | null;
  templateId?: string | null;
}

/** A single `study_block` node (with an empty paragraph body to satisfy `block+`). */
export function studyBlockJSON(spec: BlockSpec): PMNodeJSON {
  return {
    type: "study_block",
    attrs: {
      label: spec.label,
      prompt: spec.prompt ?? "",
      lineageId: spec.lineageId ?? null,
      templateId: spec.templateId ?? null,
    },
    content: [{ type: "paragraph" }],
  };
}

/**
 * A blocks document from an ordered list of specs. Falls back to a single empty
 * paragraph when there are no blocks (the doc node needs ≥1 block child).
 */
export function blocksDocFromSpecs(specs: BlockSpec[]): PMDocJSON {
  if (specs.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return { type: "doc", content: specs.map(studyBlockJSON) };
}

/**
 * Extract block specs from an existing blocks doc — used for the "sticky" copy
 * of the previous section's block setup (lineage/template carried so blocks
 * still line up across members).
 */
export function specsFromBlocksDoc(doc: PMDocJSON): BlockSpec[] {
  const specs: BlockSpec[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== "study_block") {
      continue;
    }
    const attrs = node.attrs ?? {};
    specs.push({
      label: typeof attrs.label === "string" ? attrs.label : "Block",
      prompt: typeof attrs.prompt === "string" ? attrs.prompt : "",
      lineageId: typeof attrs.lineageId === "string" ? attrs.lineageId : null,
      templateId:
        typeof attrs.templateId === "string" ? attrs.templateId : null,
    });
  }
  return specs;
}
