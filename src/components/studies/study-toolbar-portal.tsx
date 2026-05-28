"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useEditorContext } from "@/components/studies/editor-context";
import { EditorToolbar } from "@/components/studies/editor-toolbar";
import { useStudyChrome } from "@/components/studies/study-chrome-context";

/**
 * Renders the shared `EditorToolbar` into the studies chrome's full-width
 * toolbar slot. The toolbar reads the active editor's state from
 * `EditorProvider`, so it has to live inside it (not in the chrome above) —
 * the portal bridges that gap. Owners only; viewers get no toolbar.
 *
 * The chrome's slot is empty by default (just reserves height). While that's
 * happening `<StudiesLoadingOverlay>` covers the slot with a
 * `<ToolbarSkeleton />` — that overlay fades out via `body[data-studies-body-ready]`
 * which `<WorkspaceInner>` flips when the first editor view registers.
 *
 * Don't render the real toolbar until there's an editor state to act on —
 * `<EditorToolbar>` renders zero buttons while `activeState` is null, and an
 * empty bar would peek out from under the fading overlay during the swap.
 */
export function StudyToolbarPortal({ trailing }: { trailing?: ReactNode }) {
  const chrome = useStudyChrome();
  const editor = useEditorContext();
  if (!chrome?.toolbarSlot || editor?.activeState == null) {
    return null;
  }
  return createPortal(
    <EditorToolbar variant="bar" className="w-full" trailing={trailing} />,
    chrome.toolbarSlot,
  );
}
