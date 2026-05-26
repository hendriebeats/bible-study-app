"use client";

import { createPortal } from "react-dom";

import { EditorToolbar } from "@/components/studies/editor-toolbar";
import { useStudyChrome } from "@/components/studies/study-chrome-context";

/**
 * Renders the shared `EditorToolbar` into the studies chrome's full-width
 * toolbar row. It must be mounted inside `EditorProvider` (the toolbar reads the
 * active editor from context) but visually lives above the sidebar — the portal
 * bridges that gap. Render only for owners; viewers get no toolbar.
 */
export function StudyToolbarPortal() {
  const chrome = useStudyChrome();
  if (!chrome?.toolbarSlot) {
    return null;
  }
  return createPortal(
    <EditorToolbar variant="bar" className="w-full" />,
    chrome.toolbarSlot,
  );
}
