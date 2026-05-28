"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder rendered inside the chrome's toolbar slot until the client-side
 * `<StudyToolbarPortal>` mounts the real `<EditorToolbar>`. Reserves the
 * toolbar row's height (and roughly matches its grouped icon-button layout) so
 * the body content beneath doesn't jump downward when the real toolbar swaps in
 * — addressing the "page glitches down" reflow on fresh study loads.
 *
 * Marked `data-toolbar-skeleton` so the slot's contents are inspectable in
 * DevTools and easy to target from tests.
 */
export function ToolbarSkeleton() {
  return (
    <div
      data-toolbar-skeleton
      // Mirrors `<EditorToolbar variant="bar">`'s outer paddings + flex layout
      // so the swap in is zero-CLS.
      className="flex flex-wrap items-center gap-1 px-2 py-1.5"
      aria-hidden
    >
      {/* Four icon-button groups separated by thin dividers, matching the real
          toolbar's bold/italic/underline/strike · H1/H2/H3 · list/list/quote ·
          undo/redo grouping. */}
      {[4, 3, 3, 2].map((count, groupIndex) => (
        <div key={groupIndex} className="flex items-center gap-1">
          {groupIndex > 0 ? (
            <span className="mx-1 inline-block h-6 w-px bg-border" />
          ) : null}
          {Array.from({ length: count }).map((_, i) => (
            <Skeleton key={i} className="size-8 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Fallback for the lazy-loaded version-history side panel. Mirrors the panel's
 * narrow column shape with a stacked list of timeline rows.
 */
export function HistoryPanelSkeleton() {
  return (
    <div className="grid gap-3 p-3">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}
