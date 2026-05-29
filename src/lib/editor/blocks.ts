import { type BlockTone, normalizeTone } from "./block-tones";
import type { PMDocJSON, PMNodeJSON } from "./types";

/**
 * Variants of the study_block visual. `"standard"` is the titled card with an
 * editable body; `"action"` is a reminder bar (header + subheader centered,
 * no visible body) for "do this, don't write anything" steps like opening
 * prayer. See `study_block` in `src/lib/editor/schema.ts` for the schema
 * attr that backs this and the NodeView that renders each variant.
 */
export type BlockVariant = "standard" | "action";

/** Normalize an untrusted variant value (e.g. from JSON) to a known one. */
function normalizeVariant(value: unknown): BlockVariant {
  return value === "action" ? "action" : "standard";
}

/**
 * A study block's identity, independent of ProseMirror. `title`/`subtitle` are
 * admin-authored chrome and `placeholder` is the suggested body text shown while
 * the body is empty. `defaultContent` optionally pre-fills the body with rich
 * text (used when seeding from a template). `lineageId` is the cross-study
 * "slot" (seeded from a genre/group template) so the same block lines up across
 * members' studies; `templateId` records the source template. `variant` picks
 * the visual shape (see {@link BlockVariant}); action-variant specs ignore
 * `placeholder` / `defaultContent` since their body is hidden.
 */
export interface BlockSpec {
  title: string;
  subtitle?: string | null;
  placeholder?: string | null;
  /** Rich-text body to seed (ProseMirror block nodes); empty paragraph if absent. */
  defaultContent?: PMNodeJSON[] | null;
  lineageId?: string | null;
  templateId?: string | null;
  variant?: BlockVariant;
  /** Background tone for action-variant bars (see `block-tones.ts`). Ignored
   * by standard blocks today; the attr is always carried so a future tint
   * pass on standard blocks doesn't need a schema migration. */
  tone?: BlockTone;
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
  const variant = normalizeVariant(spec.variant);
  const tone = normalizeTone(spec.tone);
  return {
    type: "study_block",
    attrs: {
      title: spec.title,
      subtitle: spec.subtitle ?? "",
      placeholder: spec.placeholder ?? "",
      lineageId: spec.lineageId ?? null,
      templateId: spec.templateId ?? null,
      variant,
      tone,
    },
    // Action-variant bodies are hidden by the NodeView; we still seed a single
    // empty paragraph (via bodyContent's fallback) so the `block+` content
    // rule is satisfied and the structure guard accepts the node.
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
  variant: BlockVariant;
  tone: BlockTone;
}

/**
 * A fresh, empty draft for the dialog's "Add block" action (new lineage slot).
 * Callers pass `variant: "action"` to seed an action-reminder draft instead of
 * the default standard card; the title/subtitle defaults swap accordingly so
 * the dialog's two field labels match what the user actually sees.
 */
export function emptyBlockDraft(
  options: { variant?: BlockVariant } = {},
): BlockDraft {
  const variant = normalizeVariant(options.variant);
  const isAction = variant === "action";
  return {
    key: crypto.randomUUID(),
    title: isAction ? "Prayer" : "New block",
    subtitle: isAction ? "Meet with God." : "",
    placeholder: "",
    body: null,
    lineageId: crypto.randomUUID(),
    templateId: null,
    variant,
    tone: "default",
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
    variant: draft.variant,
    tone: draft.tone,
  };
}

/** One node-attr → BlockDraft step, factored so dialogItemsFromDoc and
 * blockDraftsFromDoc don't drift. Returns null when the node isn't a study_block. */
function draftFromBlockNode(node: PMNodeJSON): BlockDraft | null {
  if (node.type !== "study_block") {
    return null;
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
  return {
    key: crypto.randomUUID(),
    title,
    subtitle: typeof attrs.subtitle === "string" ? attrs.subtitle : "",
    placeholder,
    body,
    lineageId: typeof attrs.lineageId === "string" ? attrs.lineageId : null,
    templateId: typeof attrs.templateId === "string" ? attrs.templateId : null,
    variant: normalizeVariant(attrs.variant),
    tone: normalizeTone(attrs.tone),
  };
}

/**
 * Drafts from a blocks doc for the blocks dialog's TEMPLATE tab. Body content
 * is PRESERVED (the dialog edits it). Skips `notes_index` (templates don't
 * carry one). Falls back to legacy `label`/`prompt` attrs for old docs.
 *
 * Section-tab callers use {@link dialogItemsFromDoc} instead so they can also
 * surface the notes_index as a reorderable card.
 */
export function blockDraftsFromDoc(doc: PMDocJSON): BlockDraft[] {
  const drafts: BlockDraft[] = [];
  for (const node of doc.content ?? []) {
    const draft = draftFromBlockNode(node);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

/**
 * Discriminated row for the dialog's section tab. The user reorders a list of
 * these — `kind: "study"` cards interleaved with a single `kind: "notes"`
 * card representing the section's notes index. `content` on a notes row is
 * the existing `note_entry` children of the live notes_index (preserved
 * verbatim so a reorder doesn't wipe annotations); `null` means the live doc
 * has no notes_index yet and the dialog should materialize a fresh empty one
 * on save.
 */
export type DialogItem =
  | { kind: "study"; key: string; draft: BlockDraft }
  | { kind: "notes"; key: string; content: PMNodeJSON[] | null };

/**
 * Items for the dialog's section tab. Walks the doc's top-level children in
 * order, emits a study item per `study_block` and (at most) one notes item.
 * If the doc has no `notes_index`, append a synthetic notes item at the end
 * so the user can always see + reposition the Notes card; saving with the
 * synthetic item materializes an empty notes_index in the live doc at the
 * chosen position.
 */
export function dialogItemsFromDoc(doc: PMDocJSON): DialogItem[] {
  const items: DialogItem[] = [];
  let sawNotes = false;
  for (const node of doc.content ?? []) {
    if (node.type === "notes_index") {
      const content = Array.isArray(node.content) ? node.content : [];
      items.push({
        kind: "notes",
        key: crypto.randomUUID(),
        content: content.length > 0 ? content : null,
      });
      sawNotes = true;
      continue;
    }
    const draft = draftFromBlockNode(node);
    if (draft) {
      items.push({ kind: "study", key: draft.key, draft });
    }
  }
  if (!sawNotes) {
    items.push({ kind: "notes", key: crypto.randomUUID(), content: null });
  }
  return items;
}

/**
 * Serialize an ordered list of dialog items back into the top-level content
 * of a blocks doc. Study items round-trip through {@link studyBlockJSON};
 * notes items become a `notes_index` node carrying the preserved
 * `note_entry` children (or empty if `content === null`).
 */
export function dialogItemsToDocContent(items: DialogItem[]): PMNodeJSON[] {
  return items.map((item) => {
    if (item.kind === "study") {
      return studyBlockJSON(blockSpecFromDraft(item.draft));
    }
    return {
      type: "notes_index",
      content: item.content ?? [],
    };
  });
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
      variant: normalizeVariant(attrs.variant),
      tone: normalizeTone(attrs.tone),
    });
  }
  return specs;
}
