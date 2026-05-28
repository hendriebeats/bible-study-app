"use client";

import { createContext, useContext } from "react";

export interface StudyChromeValue {
  /** Whether the section sidebar is expanded. */
  sidebarOpen: boolean;
  /** Toggle the sidebar open/closed (session-only; not persisted). */
  toggleSidebar: () => void;
  /** Full-width row beneath the top bar the editor toolbar portals into. */
  toolbarSlot: HTMLElement | null;
  /**
   * Live section titles by section id, published as the user types in the
   * editable "mine" panel so the left TOC + dock tab update in real time —
   * before the renamed title is persisted/revalidated. Consumers fall back to
   * the server-rendered `section.title` when a section has no override.
   */
  sectionTitleOverrides: Record<string, string>;
  /** Publish the current text of a section's title field (session-only). */
  setSectionTitle: (sectionId: string, title: string) => void;
  /**
   * Cross-component request for a section-scoped action triggered from the
   * sidebar's ⋯ menu (Version History, Rename). The sidebar sets this and
   * navigates to the section; the mine panel reads it on mount/when it
   * matches the active section and runs the action, then clears it. Survives
   * the route transition so the action fires once the section is loaded.
   */
  pendingSectionAction: {
    sectionId: string;
    kind: "rename" | "history";
  } | null;
  /** Sidebar: request a section action; will fire when the mine panel mounts. */
  requestSectionAction: (sectionId: string, kind: "rename" | "history") => void;
  /** Mine panel: clear after consuming the pending action. */
  clearPendingSectionAction: () => void;
}

export const StudyChromeContext = createContext<StudyChromeValue | null>(null);

/**
 * Access the studies-page chrome (sidebar state + the toolbar portal slot).
 * Returns null outside `StudyChrome`.
 */
export function useStudyChrome(): StudyChromeValue | null {
  return useContext(StudyChromeContext);
}
