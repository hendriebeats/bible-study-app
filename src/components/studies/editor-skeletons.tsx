"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallback shown inside a dock panel while the lazy-loaded ProseMirror editor
 * chunk is downloading. Matches the editor's wrapper paddings + the first few
 * lines of typical document content so the swap into the real editor doesn't
 * shift the layout.
 *
 * Used by both the notes and blocks editors via the `dynamic(...)` boundary in
 * `study-dockview.tsx`.
 */
export function EditorChromeSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-10/12" />
      <Skeleton className="h-4 w-9/12" />
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
