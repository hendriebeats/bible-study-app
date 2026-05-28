"use client";

import { use, useEffect } from "react";

import { useStudyWorkspace } from "@/components/studies/study-workspace-context";
import type { DocumentHistory } from "@/lib/db/types";

/**
 * Resolves the section's per-document undo history Promises and patches it
 * into the active workspace payload that `SectionBridge` already published.
 *
 * The section page renders this inside a `<Suspense>` boundary, so the
 * suspended `use()` calls below don't block the section text from painting:
 *
 * ```tsx
 * <SectionBridge payload={core} focus={focus} />
 * <Suspense fallback={null}>
 *   <SectionHistoryBridge
 *     sectionId={section.id}
 *     notesPromise={notesHistoryPromise}
 *     blocksPromise={blocksHistoryPromise}
 *   />
 * </Suspense>
 * ```
 *
 * Until the Promises resolve, the editor sees `notesHistory: null` and
 * `study-dockview.tsx` renders the read-only `DocumentViewer`. Once they
 * resolve, the editor upgrades in place to `DocumentEditor` (with undo).
 *
 * For non-owner viewers the Promises resolve to `null` immediately, so this
 * bridge is a no-op from their perspective.
 *
 * Guarded inside the workspace context by `sectionId`: a stale history
 * arriving after the user navigated away (rare but possible if the new
 * section's history is already cached) is dropped.
 */
export function SectionHistoryBridge({
  sectionId,
  notesPromise,
  blocksPromise,
}: {
  sectionId: string;
  notesPromise: Promise<DocumentHistory | null>;
  blocksPromise: Promise<DocumentHistory | null>;
}) {
  const notes = use(notesPromise);
  const blocks = use(blocksPromise);
  const { publishHistory } = useStudyWorkspace();

  useEffect(() => {
    publishHistory(sectionId, notes, blocks);
  }, [sectionId, notes, blocks, publishHistory]);

  return null;
}
