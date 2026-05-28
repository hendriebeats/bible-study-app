"use client";

import { createContext, useContext } from "react";

import type {
  DocumentHistory,
  Section,
  SectionDocuments,
} from "@/lib/db/types";
// `DocumentHistory` is intentionally imported for the `notesHistory` /
// `blocksHistory` slots on `ActiveSectionPayload` even though no method on
// the context references it directly anymore — see `ActiveSectionPayload`.

/**
 * The currently-viewed section's data, published up from the section page into
 * the persistent study workspace (the dock + hoisted editor live at the layout
 * level, so they survive section-to-section navigation; only this payload
 * swaps). Mirrors what the old `SectionSurface` received as props.
 */
export interface ActiveSectionPayload {
  section: Section;
  documents: SectionDocuments;
  /** The owner's per-document undo history (null for read-only co-members). */
  notesHistory: DocumentHistory | null;
  blocksHistory: DocumentHistory | null;
  /** Whether the viewer owns this study (editable) vs. reads along (viewer). */
  isOwner: boolean;
  /** App/org template study — the blocks dialog's Template tab edits the default. */
  isTemplate: boolean;
  /** Whether the blocks empty-state can offer "Use this study's template". */
  emptyStateHasTemplate: boolean;
  /** Whether it can offer "Copy from previous section". */
  emptyStateHasPrevious: boolean;
}

export interface StudyWorkspaceValue {
  /** The section currently being edited/viewed in the pinned "mine" panel. */
  active: ActiveSectionPayload | null;
  /**
   * Whether the study has any sections at all — sourced from the layout's
   * already-fetched `listSections` so the dock's `MinePanel` can tell apart
   * "loading a section" (show spinner) from "study has no sections" (show
   * empty-state placeholder). Without this, the brief window between opening
   * `/studies/[id]` and the index page's redirect would flash the placeholder
   * because the URL has no section id and `active` hasn't been published yet.
   */
  hasSections: boolean;
  /** Publish the section the page just rendered (called from `SectionBridge`). */
  publish: (payload: ActiveSectionPayload) => void;
  /**
   * Clear the active payload when a section page unmounts — guarded so a stale
   * unmount (the section we just navigated AWAY from) can't wipe the section we
   * just navigated TO.
   */
  clear: (sectionId: string) => void;
  /** Open (or focus) a co-member's study as a read-only panel in the dock. */
  openPerson: (studyId: string) => void;
  /** Close a co-member's panel in the dock (no-op if it isn't open). */
  closePerson: (studyId: string) => void;
  /** Close every co-member panel — the dropdown's "Hide all members" action. */
  resetMembers: () => void;
  /** Study ids of every co-member panel currently open in the dock. */
  openMemberIds: ReadonlySet<string>;
  /**
   * The dock registers its panel handlers once ready; passing `null` clears the
   * registration on unmount. Calls to {@link openPerson} before registration
   * are queued and flushed at register time; close/reset before registration
   * are silently dropped (the panels those would target can't exist yet).
   */
  registerDockHandlers: (
    handlers: {
      open: (studyId: string) => void;
      close: (studyId: string) => void;
      reset: () => void;
    } | null,
  ) => void;
  /**
   * Called by the dock from its `syncPanels` whenever the set of open
   * co-member panels changes (panel added/removed, layout restored). Exposing
   * this as a stable context callback lets the dock push to workspace state
   * without ferrying a setter through props.
   */
  publishOpenMemberIds: (ids: ReadonlySet<string>) => void;
}

export const StudyWorkspaceContext = createContext<StudyWorkspaceValue | null>(
  null,
);

/**
 * Access the study workspace (the active section payload + the dock's
 * panel-opener). Throws outside `StudyWorkspace` — every consumer renders inside
 * it.
 */
export function useStudyWorkspace(): StudyWorkspaceValue {
  const value = useContext(StudyWorkspaceContext);
  if (!value) {
    throw new Error("useStudyWorkspace must be used within StudyWorkspace");
  }
  return value;
}
