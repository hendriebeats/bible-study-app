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
  /** Null unless a user owns it; exactly one owner axis is set. */
  owner_id: string | null;
  owner_group_id: string | null;
  /** Set when the study is an organization-owned template scaffold. */
  owner_org_id: string | null;
  /** True when the study is an app-default template scaffold (super-admin owned). */
  is_app_template: boolean;
  /** The study_templates row this study was instantiated from, if any. */
  source_template_id: string | null;
  title: string;
  genre_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A study-template registry entry (app or org scope; book or custom). */
export interface StudyTemplate {
  id: string;
  scope: "app" | "org";
  organization_id: string | null;
  type: "book" | "custom";
  book_ordinal: number | null;
  genre_id: string | null;
  name: string;
  description: string | null;
  template_study_id: string;
  enabled: boolean;
  position: number;
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
  /** True when study_id points at a live study (not trashed/archived). */
  study_active: boolean;
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

/**
 * A group a study belongs to, with everything the in-study members dropdown and
 * group-info popup need: the caller's role, the editable template, the roster,
 * and (for owners) the pending invitations. A study can belong to more than one
 * group, so callers get a list.
 */
export interface StudyGroupInfo {
  groupId: string;
  groupName: string;
  /** The caller's role in this group ("owner" | "member"). */
  role: string;
  templateStudyId: string | null;
  members: GroupMember[];
  /** Pending invitations — populated for owners only, else empty. */
  invitations: Invitation[];
  /** The caller's own contributed study in this group, if any. */
  myStudyId: string | null;
  /** True when `myStudyId` is a live (non-trashed) study. */
  myStudyActive: boolean;
  /** First section of the caller's own study (anchors roster→compare links). */
  myFirstSectionId: string | null;
}

/** A user's role within an organization (super_admin > admin > member). */
export type OrgRole = "super_admin" | "admin" | "member";
export type OrgVisibility = "public" | "unlisted";
export type OrgJoinPolicy = "request" | "open";
export type OrgVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";

/** An organization: a church/ministry that gathers members and brands them. */
export interface Organization {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  contact_email: string | null;
  visibility: OrgVisibility;
  join_policy: OrgJoinPolicy;
  verification_status: OrgVerificationStatus;
  verification_note: string | null;
  verification_reviewed_at: string | null;
  verification_reject_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A member of an org, with their profile. */
export interface OrgMember {
  user_id: string;
  role: OrgRole;
  display_name: string | null;
  avatar_url: string | null;
  joined_at: string;
}

/** A pending/used invitation to an org. */
export interface OrgInvitation {
  id: string;
  email: string | null;
  token: string;
  role: OrgRole;
  status: string;
  expires_at: string;
  created_at: string;
}

/** A pending request to join an org, with the requester's profile. */
export interface OrgJoinRequest {
  id: string;
  user_id: string;
  note: string | null;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** An org announcement (plain text, admin-posted). */
export interface OrgAnnouncement {
  id: string;
  organization_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

/** A bell notification for the current user. */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
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
  /** Visual variant — "standard" (titled card with body) or "action"
   * (high-contrast reminder bar, header+subheader only, no body). */
  variant: "standard" | "action";
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

/** Lightweight step metadata (no step payload) for building a history scrubber
 * without transferring the whole step log. */
export interface DocumentStepMeta {
  version: number;
  created_at: string;
}
