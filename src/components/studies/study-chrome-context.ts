"use client";

import { createContext, useContext } from "react";

export interface StudyChromeValue {
  /** Whether the section sidebar is expanded. */
  sidebarOpen: boolean;
  /** Toggle the sidebar open/closed (session-only; not persisted). */
  toggleSidebar: () => void;
  /** Top-bar breadcrumb slot the section page portals its title control into. */
  titleSlot: HTMLElement | null;
  /** Full-width row beneath the top bar the editor toolbar portals into. */
  toolbarSlot: HTMLElement | null;
  /** Compare link target for the current section, or null when unavailable. */
  compareHref: string | null;
  /** Publish the current section's Compare target up to the top bar. */
  setCompareHref: (href: string | null) => void;
}

export const StudyChromeContext = createContext<StudyChromeValue | null>(null);

/**
 * Access the studies-page chrome (sidebar state + the top-bar/toolbar portal
 * slots). Returns null outside `StudyChrome`.
 */
export function useStudyChrome(): StudyChromeValue | null {
  return useContext(StudyChromeContext);
}
