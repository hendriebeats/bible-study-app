"use client";

import { createContext, useContext } from "react";

import type {
  DocumentHistory,
  Section,
  SectionDocuments,
} from "@/lib/db/types";

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
  /** Publish the section the page just rendered (called from `SectionBridge`). */
  publish: (payload: ActiveSectionPayload) => void;
  /**
   * Patch the active payload's history when the (separately-streamed) history
   * fetch resolves — called from `SectionHistoryBridge` after its Suspense
   * boundary settles. Guarded by `sectionId` so a late arrival from a
   * previous section can't overwrite the current one's history.
   *
   * Until this fires, the editor renders against `notesHistory: null` (the
   * read-only viewer fallback in `study-dockview.tsx`); once it fires the
   * editor upgrades in place.
   */
  publishHistory: (
    sectionId: string,
    notesHistory: DocumentHistory | null,
    blocksHistory: DocumentHistory | null,
  ) => void;
  /**
   * Clear the active payload when a section page unmounts — guarded so a stale
   * unmount (the section we just navigated AWAY from) can't wipe the section we
   * just navigated TO.
   */
  clear: (sectionId: string) => void;
  /** Open (or focus) a co-member's study as a read-only panel in the dock. */
  openPerson: (studyId: string) => void;
  /**
   * The dock registers its panel-opener here once it's ready; a `null` clears it
   * on unmount. Calls to {@link openPerson} before registration are queued.
   */
  registerOpenPerson: (open: ((studyId: string) => void) | null) => void;
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
