"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { EditorToolbar } from "@/components/studies/editor-toolbar";
import { useStudyChrome } from "@/components/studies/study-chrome-context";

/**
 * Renders the shared `EditorToolbar` into the studies chrome's full-width
 * toolbar row. It must be mounted inside `EditorProvider` (the toolbar reads the
 * active editor from context) but visually lives above the sidebar — the portal
 * bridges that gap. Render only for owners; viewers get no toolbar.
 *
 * `trailing` is forwarded to the toolbar's end slot (e.g. the group members menu).
 */
export function StudyToolbarPortal({ trailing }: { trailing?: ReactNode }) {
  const chrome = useStudyChrome();
  if (!chrome?.toolbarSlot) {
    return null;
  }
  return createPortal(
    <EditorToolbar variant="bar" className="w-full" trailing={trailing} />,
    chrome.toolbarSlot,
  );
}
