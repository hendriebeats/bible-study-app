"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import {
  type ActiveSectionPayload,
  useStudyWorkspace,
} from "@/components/studies/study-workspace-context";

// Publish before paint on the client so the dock's "mine" panel shows the new
// section without a flash of the empty state; `useEffect` on the server (where
// layout effects don't run and would warn).
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The `[sectionId]` page renders this (and nothing visible): it publishes the
 * server-fetched section payload up into the persistent {@link StudyWorkspace}
 * (which hosts the editable "mine" panel + the dock), and clears it on unmount.
 * The dock, editor provider, and any open co-member panels live at the layout
 * level, so switching sections only swaps this payload — they never remount.
 *
 * Phase 1 of the two-phase publish: the page hands this the section + documents
 * + flags with `notesHistory: null` / `blocksHistory: null`. The editor sees
 * a viewer-shaped payload and renders content immediately. {@link SectionHistoryBridge}
 * follows up under its own Suspense boundary to patch in the per-document undo
 * history once it resolves, at which point the editor upgrades in place.
 *
 * A `?focus=<studyId>` deep link (e.g. a roster name) opens that member's panel
 * once, then strips the param so a refresh doesn't reopen it.
 */
export function SectionBridge({
  payload,
  focus,
}: {
  payload: ActiveSectionPayload;
  focus: string | null;
}) {
  const { publish, clear, openPerson } = useStudyWorkspace();

  useIsomorphicLayoutEffect(() => {
    publish(payload);
    return () => {
      // Guarded inside the workspace: a no-op if a newer section already
      // published, so navigating away can't wipe the section we arrived at.
      clear(payload.section.id);
    };
  }, [payload, publish, clear]);

  const focusedRef = useRef(false);
  useEffect(() => {
    if (focus === null || focusedRef.current) {
      return;
    }
    focusedRef.current = true;
    openPerson(focus);
    // Drop the consumed `?focus=` from the URL without a navigation, so a
    // refresh doesn't reopen the panel.
    window.history.replaceState(
      null,
      "",
      `/studies/${payload.section.study_id}/${payload.section.id}`,
    );
  }, [focus, openPerson, payload.section.study_id, payload.section.id]);

  return null;
}
