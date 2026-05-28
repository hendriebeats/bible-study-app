import type { PMDocJSON, PMNodeJSON } from "./types";

/**
 * A study block's identity, independent of ProseMirror. `title`/`subtitle` are
 * admin-authored chrome and `placeholder` is the suggested body text shown while
 * the body is empty. `defaultContent` optionally pre-fills the body with rich
 * text (used when seeding from a template). `lineageId` is the cross-study
 * "slot" (seeded from a genre/group template) so the same block lines up across
 * members' studies; `templateId` records the source template.
 */
export interface BlockSpec {
  title: string;
  subtitle?: string | null;
  placeholder?: string | null;
  /** Rich-text body to seed (ProseMirror block nodes); empty paragraph if absent. */
  defaultContent?: PMNodeJSON[] | null;
  lineageId?: string | null;
  templateId?: string | null;
}

/** The block body to seed: the template's default content, else one empty paragraph. */
function bodyContent(spec: BlockSpec): PMNodeJSON[] {
  const content = spec.defaultContent;
  if (Array.isArray(content) && content.length > 0) {
    return content;
  }
  return [{ type: "paragraph" }];
}

/** A single `study_block` node (body is the default content or an empty paragraph). */
export function studyBlockJSON(spec: BlockSpec): PMNodeJSON {
  return {
    type: "study_block",
    attrs: {
      title: spec.title,
      subtitle: spec.subtitle ?? "",
      placeholder: spec.placeholder ?? "",
      lineageId: spec.lineageId ?? null,
      templateId: spec.templateId ?? null,
    },
    content: bodyContent(spec),
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
 * A study block being edited in the blocks dialog — a `BlockSpec` plus a stable
 * client `key` for React lists / reordering (never persisted). Unlike `BlockSpec`
 * the body (`body`) is always carried so the dialog can round-trip existing
 * content; `null`/empty means a single empty paragraph (per `studyBlockJSON`).
 */
export interface BlockDraft {
  key: string;
  title: string;
  subtitle: string;
  placeholder: string;
  body: PMNodeJSON[] | null;
  lineageId: string | null;
  templateId: string | null;
}

/** A fresh, empty draft for the dialog's "Add block" action (new lineage slot). */
export function emptyBlockDraft(): BlockDraft {
  return {
    key: crypto.randomUUID(),
    title: "New block",
    subtitle: "",
    placeholder: "",
    body: null,
    lineageId: crypto.randomUUID(),
    templateId: null,
  };
}

/** The `BlockSpec` a draft serializes to (body → the block's seeded content). */
export function blockSpecFromDraft(draft: BlockDraft): BlockSpec {
  return {
    title: draft.title,
    subtitle: draft.subtitle,
    placeholder: draft.placeholder,
    defaultContent: draft.body,
    lineageId: draft.lineageId,
    templateId: draft.templateId,
  };
}

/**
 * Drafts from a blocks doc for the blocks dialog. Unlike `specsFromBlocksDoc`,
 * the body content is PRESERVED (the dialog edits it). Skips the pinned
 * `notes_index`. Falls back to legacy `label`/`prompt` attrs for old docs.
 */
export function blockDraftsFromDoc(doc: PMDocJSON): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== "study_block") {
      continue;
    }
    const attrs = node.attrs ?? {};
    const title =
      typeof attrs.title === "string" && attrs.title !== ""
        ? attrs.title
        : typeof attrs.label === "string"
          ? attrs.label
          : "Block";
    const placeholder =
      typeof attrs.placeholder === "string" && attrs.placeholder !== ""
        ? attrs.placeholder
        : typeof attrs.prompt === "string"
          ? attrs.prompt
          : "";
    const body =
      Array.isArray(node.content) && node.content.length > 0
        ? node.content
        : null;
    drafts.push({
      key: crypto.randomUUID(),
      title,
      subtitle: typeof attrs.subtitle === "string" ? attrs.subtitle : "",
      placeholder,
      body,
      lineageId: typeof attrs.lineageId === "string" ? attrs.lineageId : null,
      templateId:
        typeof attrs.templateId === "string" ? attrs.templateId : null,
    });
  }
  return drafts;
}

/**
 * Extract block specs from an existing blocks doc — used for the "sticky" copy
 * of the previous section's block setup (lineage/template carried so blocks
 * still line up across members). Only the block structure travels — not the
 * user's body content — so `defaultContent` is intentionally omitted. Falls back
 * to legacy `label`/`prompt` attrs for documents saved before this rework.
 */
export function specsFromBlocksDoc(doc: PMDocJSON): BlockSpec[] {
  const specs: BlockSpec[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== "study_block") {
      continue;
    }
    const attrs = node.attrs ?? {};
    const title =
      typeof attrs.title === "string" && attrs.title !== ""
        ? attrs.title
        : typeof attrs.label === "string"
          ? attrs.label
          : "Block";
    const placeholder =
      typeof attrs.placeholder === "string" && attrs.placeholder !== ""
        ? attrs.placeholder
        : typeof attrs.prompt === "string"
          ? attrs.prompt
          : "";
    specs.push({
      title,
      subtitle: typeof attrs.subtitle === "string" ? attrs.subtitle : "",
      placeholder,
      lineageId: typeof attrs.lineageId === "string" ? attrs.lineageId : null,
      templateId:
        typeof attrs.templateId === "string" ? attrs.templateId : null,
    });
  }
  return specs;
}
