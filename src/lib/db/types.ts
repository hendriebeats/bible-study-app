import type { PMDocJSON, PMNodeJSON, SerializedStep } from "@/lib/editor/types";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Study {
  id: string;
  /** Null for a group-owned template study (then `owner_group_id` is set). */
  owner_id: string | null;
  owner_group_id: string | null;
  title: string;
  genre_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A group study: a named container with a canonical template + members. */
export interface GroupStudy {
  id: string;
  name: string;
  created_by: string | null;
  template_study_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A member of a group (with their profile + contributed study, if any). */
export interface GroupMember {
  user_id: string;
  role: string;
  study_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** A pending/used invitation to a group. */
export interface Invitation {
  id: string;
  email: string | null;
  token: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
}

/** A literary genre; drives a study's default study-block template. */
export interface Genre {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
}

/** One block in a genre's default template (admin-authored). */
export interface GenreBlockTemplate {
  id: string;
  genre_id: string;
  title: string;
  subtitle: string | null;
  /** Suggested body text shown while the block body is empty. */
  placeholder: string | null;
  /** Optional rich-text body (ProseMirror block nodes) seeded into new blocks. */
  default_content: PMNodeJSON[] | null;
  position: number;
  lineage_id: string;
}

/** Lightweight section shape for the sidebar (no document content). */
export interface SectionSummary {
  id: string;
  study_id: string;
  title: string;
  position: number;
}

/** A trashed (soft-deleted, not yet archived) study or section. */
export interface TrashItem {
  id: string;
  title: string;
  deleted_at: string;
}

/**
 * Full section row. `content`/`current_version` are a frozen pre-`documents`
 * snapshot kept as a rollback hatch — the live content now lives in the
 * section's {@link StudyDocument}s, not here.
 */
export interface Section extends SectionSummary {
  content: PMDocJSON;
  current_version: number;
  created_at: string;
  updated_at: string;
}

/** The two content streams a section owns. Extensible (more kinds later). */
export type DocumentKind = "notes" | "blocks";

/**
 * A document: one independently-versioned, real-time, dockable ProseMirror
 * content stream belonging to a section. A section has a `notes` doc and a
 * `blocks` doc. This is the unit the version-history/read-along engine is
 * keyed on (named `StudyDocument` to avoid shadowing the DOM `Document`).
 */
export interface StudyDocument {
  id: string;
  section_id: string;
  kind: DocumentKind;
  content: PMDocJSON;
  /** Monotonic head version: the number of steps applied to this document. */
  current_version: number;
}

/** A section's documents, addressed by kind. */
export interface SectionDocuments {
  notes: StudyDocument;
  blocks: StudyDocument;
}

/** An empty ProseMirror document (a single empty paragraph — the schema needs a block). */
export const EMPTY_DOC: PMDocJSON = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** One persisted ProseMirror step (a row of `section_steps`). */
export interface DocumentStepRow {
  version: number;
  step: SerializedStep;
  created_at: string;
}

/**
 * Everything the editor needs to rebuild a document with persistent undo:
 * a base doc (latest checkpoint ≤ head, or the head doc when there's no
 * history yet) plus the steps from `baseVersion` up to `headVersion`.
 */
export interface DocumentHistory {
  baseDoc: PMDocJSON;
  baseVersion: number;
  headVersion: number;
  steps: DocumentStepRow[];
}

/** A full-doc checkpoint = a user-facing "version" of a document. */
export interface DocumentCheckpointRow {
  version: number;
  label: string | null;
  created_at: string;
  doc: PMDocJSON;
}

/**
 * The complete history of a document (all checkpoints + all steps), enough to
 * reconstruct it at any version on the client for the history panel.
 */
export interface DocumentTimeline {
  checkpoints: DocumentCheckpointRow[];
  steps: DocumentStepRow[];
}
