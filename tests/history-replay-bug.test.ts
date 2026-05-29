/**
 * Pinpoint the blocks-doc history-reconstruction failure the user is hitting
 * on every past moment of section 8568a731-0e98-494a-bf82-e6961d9b15a1.
 *
 * Hypothesis: the v0 blocks-doc checkpoint was captured BEFORE the editor's
 * `ensureNotesIndex` injection ran, so it stores 5 study_blocks (content.size
 * 20) — but step v1 was authored against the in-memory post-injection doc
 * (size 22), with `to: 22`. Replaying the persisted step against the
 * persisted checkpoint trips "Position 22 out of range" before any preview
 * can render.
 */
import { Transform } from "prosemirror-transform";
import { describe, expect, it } from "vitest";

import { nodes } from "../src/lib/editor/schema";
import { jsonToDoc, jsonToStep } from "../src/lib/editor/serialize";
import type { PMDocJSON, SerializedStep } from "../src/lib/editor/types";

// Verbatim from supabase: section_checkpoints row for blocks doc, version 0.
const V0_BLOCKS_CHECKPOINT: PMDocJSON = {
  type: "doc",
  content: [
    {
      type: "study_block",
      attrs: {
        title: "Context",
        subtitle: "",
        lineageId: "df6ba4de-527f-4e04-a325-06353f79a495",
        templateId: "a38dc7cb-556f-408e-acde-16b80c12b218",
        placeholder: "Who is writing, to whom, and why?",
      },
      content: [{ type: "paragraph" }],
    },
    {
      type: "study_block",
      attrs: {
        title: "Argument",
        subtitle: "",
        lineageId: "412875a7-caa0-49ea-9520-1b58c7e6b6e9",
        templateId: "0ae55201-650d-4cea-a398-56c1e4142183",
        placeholder: "Trace the flow of the argument.",
      },
      content: [{ type: "paragraph" }],
    },
    {
      type: "study_block",
      attrs: {
        title: "Key truths",
        subtitle: "",
        lineageId: "8e874bdc-e12e-45fb-ac7b-ffccfa78fa63",
        templateId: "ad1c6fd9-9428-4061-82fc-104c3756760f",
        placeholder: "What core truths are taught here?",
      },
      content: [{ type: "paragraph" }],
    },
    {
      type: "study_block",
      attrs: {
        title: "Application",
        subtitle: "",
        lineageId: "64a22354-0e7b-45ef-819d-69702cc650ad",
        templateId: "a8d556b8-7f20-4cae-af1d-49ce412f4845",
        placeholder: "How should this change how I live?",
      },
      content: [{ type: "paragraph" }],
    },
    {
      type: "study_block",
      attrs: {
        title: "Prayer",
        subtitle: "",
        lineageId: "fa486515-c3c1-47d2-bc85-868290ab93bf",
        templateId: "f8ab3856-1f64-4da4-90aa-06f026ad7c8c",
        placeholder: "Respond to God in prayer.",
      },
      content: [{ type: "paragraph" }],
    },
  ],
};

// Verbatim from supabase: section_steps row for blocks doc, version 1.
const STEP_V1: SerializedStep = {
  to: 22,
  from: 2,
  slice: {
    content: [
      {
        type: "study_block",
        attrs: {
          tone: "sky",
          title: "Prayer",
          variant: "action",
          subtitle: "Meet with God.",
          lineageId: "c9507a5c-1aa7-4804-b379-e5f6c54f679a",
          templateId: null,
          placeholder: "",
        },
        content: [{ type: "paragraph", attrs: { indent: 0 } }],
      },
      {
        type: "study_block",
        attrs: {
          tone: "default",
          title: "Context",
          variant: "standard",
          subtitle: "",
          lineageId: "df6ba4de-527f-4e04-a325-06353f79a495",
          templateId: "a38dc7cb-556f-408e-acde-16b80c12b218",
          placeholder: "Who is writing, to whom, and why?",
        },
        content: [{ type: "paragraph", attrs: { indent: 0 } }],
      },
      {
        type: "study_block",
        attrs: {
          tone: "default",
          title: "Argument",
          variant: "standard",
          subtitle: "",
          lineageId: "412875a7-caa0-49ea-9520-1b58c7e6b6e9",
          templateId: "0ae55201-650d-4cea-a398-56c1e4142183",
          placeholder: "Trace the flow of the argument.",
        },
        content: [{ type: "paragraph", attrs: { indent: 0 } }],
      },
      {
        type: "study_block",
        attrs: {
          tone: "default",
          title: "Key truths",
          variant: "standard",
          subtitle: "",
          lineageId: "8e874bdc-e12e-45fb-ac7b-ffccfa78fa63",
          templateId: "ad1c6fd9-9428-4061-82fc-104c3756760f",
          placeholder: "What core truths are taught here?",
        },
        content: [{ type: "paragraph", attrs: { indent: 0 } }],
      },
      {
        type: "study_block",
        attrs: {
          tone: "default",
          title: "Application",
          variant: "standard",
          subtitle: "",
          lineageId: "64a22354-0e7b-45ef-819d-69702cc650ad",
          templateId: "a8d556b8-7f20-4cae-af1d-49ce412f4845",
          placeholder: "How should this change how I live?",
        },
        content: [{ type: "paragraph", attrs: { indent: 0 } }],
      },
    ],
  },
  stepType: "replace",
};

describe("history reconstruction bug: blocks v0 checkpoint missing notes_index", () => {
  it("v0 checkpoint as stored has content.size = 20", () => {
    const baseDoc = jsonToDoc(V0_BLOCKS_CHECKPOINT);
    expect(baseDoc.content.size).toBe(20);
  });

  it("step v1 references position 22 which is past the end of the stored v0 checkpoint", () => {
    const baseDoc = jsonToDoc(V0_BLOCKS_CHECKPOINT);
    const transform = new Transform(baseDoc);
    const replayStep = () => {
      transform.step(jsonToStep(STEP_V1));
    };
    // This is the exact failure the user sees in the preview area.
    expect(replayStep).toThrow(/Position 22 out of range/);
  });

  it("prepending an empty notes_index makes the doc size 22 and the step applies cleanly", () => {
    const indexedJson: PMDocJSON = {
      ...V0_BLOCKS_CHECKPOINT,
      content: [
        { type: "notes_index", content: [] },
        ...(V0_BLOCKS_CHECKPOINT.content ?? []),
      ],
    };
    const baseDoc = jsonToDoc(indexedJson);
    expect(baseDoc.content.size).toBe(22);
    expect(baseDoc.firstChild?.type).toBe(nodes.notesIndex);
    const transform = new Transform(baseDoc);
    transform.step(jsonToStep(STEP_V1));
    // After replay, the lead notes_index survives and the 5 new study_blocks
    // follow — matching what the editor actually saw at v1.
    expect(transform.doc.firstChild?.type).toBe(nodes.notesIndex);
    expect(transform.doc.childCount).toBe(6); // notes_index + 5 study_blocks
  });

  // Locks in the exact heuristic shipped in `reconstructDocumentVersion`:
  // detect by shape (no leading notes_index + at least one study_block),
  // prepend an empty notes_index. Idempotent + no-op for docs that don't
  // look like blocks docs.
  function ensureNotesIndexInBlocksDoc(doc: PMDocJSON): PMDocJSON {
    const children = (doc as { content?: { type?: string }[] }).content ?? [];
    if (children[0]?.type === "notes_index") return doc;
    const looksLikeBlocksDoc = children.some(
      (child) => child.type === "study_block",
    );
    if (!looksLikeBlocksDoc) return doc;
    return {
      ...doc,
      content: [{ type: "notes_index", content: [] }, ...children],
    } as PMDocJSON;
  }

  it("ensureNotesIndexInBlocksDoc is a no-op when the doc already leads with notes_index", () => {
    const alreadyIndexed: PMDocJSON = {
      type: "doc",
      content: [
        { type: "notes_index", content: [] },
        { type: "study_block", attrs: {}, content: [{ type: "paragraph" }] },
      ],
    };
    expect(ensureNotesIndexInBlocksDoc(alreadyIndexed)).toBe(alreadyIndexed);
  });

  it("ensureNotesIndexInBlocksDoc is a no-op for notes docs (no study_block at top)", () => {
    const notesDoc: PMDocJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    expect(ensureNotesIndexInBlocksDoc(notesDoc)).toBe(notesDoc);
  });

  it("ensureNotesIndexInBlocksDoc heals the v0 blocks checkpoint", () => {
    const healed = ensureNotesIndexInBlocksDoc(V0_BLOCKS_CHECKPOINT);
    expect(healed).not.toBe(V0_BLOCKS_CHECKPOINT);
    const baseDoc = jsonToDoc(healed);
    expect(baseDoc.content.size).toBe(22);
    expect(baseDoc.firstChild?.type).toBe(nodes.notesIndex);
    // And the v1 step now applies cleanly against the healed base.
    const transform = new Transform(baseDoc);
    transform.step(jsonToStep(STEP_V1));
    expect(transform.doc.childCount).toBe(6);
  });
});
