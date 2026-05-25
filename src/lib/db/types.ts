import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Study {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Lightweight section shape for the sidebar (no document content). */
export interface SectionSummary {
  id: string;
  study_id: string;
  title: string;
  position: number;
}

/** Full section, including its ProseMirror document and head version. */
export interface Section extends SectionSummary {
  content: PMDocJSON;
  /** Monotonic head version: the number of steps applied to this section. */
  current_version: number;
  created_at: string;
  updated_at: string;
}

/** An empty ProseMirror document (a single empty paragraph — the schema needs a block). */
export const EMPTY_DOC: PMDocJSON = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** One persisted ProseMirror step (a row of `section_steps`). */
export interface SectionStepRow {
  version: number;
  step: SerializedStep;
  created_at: string;
}

/**
 * Everything the editor needs to rebuild a section with persistent undo:
 * a base doc (latest checkpoint ≤ head, or the head doc when there's no
 * history yet) plus the steps from `baseVersion` up to `headVersion`.
 */
export interface SectionHistory {
  baseDoc: PMDocJSON;
  baseVersion: number;
  headVersion: number;
  steps: SectionStepRow[];
}
