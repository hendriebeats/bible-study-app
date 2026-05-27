"use client";

import { createContext, useContext } from "react";

export interface StudyChromeValue {
  /** Whether the section sidebar is expanded. */
  sidebarOpen: boolean;
  /** Toggle the sidebar open/closed (session-only; not persisted). */
  toggleSidebar: () => void;
  /** Full-width row beneath the top bar the editor toolbar portals into. */
  toolbarSlot: HTMLElement | null;
}

export const StudyChromeContext = createContext<StudyChromeValue | null>(null);

/**
 * Access the studies-page chrome (sidebar state + the toolbar portal slot).
 * Returns null outside `StudyChrome`.
 */
export function useStudyChrome(): StudyChromeValue | null {
  return useContext(StudyChromeContext);
}
