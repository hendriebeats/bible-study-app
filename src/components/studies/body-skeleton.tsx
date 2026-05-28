import { Skeleton } from "@/components/ui/skeleton";

/**
 * Studies-route body loading skeleton — the `loading.tsx` fallback shown while
 * a section's server fetches resolve, and the placeholder the dock's panels
 * show directly when the workspace's published payload is behind the URL.
 *
 * The shape mirrors the editable "mine" panel that will replace it: a section
 * title row (optional), a stretch of notes-doc paragraph lines, and a stack of
 * study-block cards beneath. Rendering the same kind of bones the editor
 * eventually fills avoids the swap-in CLS — and matches the user's choice of
 * skeleton over a spinner so the body shows one consistent loading affordance,
 * not two.
 *
 * `showTitle` is `true` by default (the studies route's main body + MinePanel,
 * which renders an editable section title above the body). Pass `false` for
 * dock panels that don't render a section title above their body — the
 * detached blocks panel (blocks-only, no title) and a co-member's Person panel
 * (the "title" lives in the alignment-dropdown row above the body, not inside
 * it). Keeps the same component + animation while honestly representing each
 * panel's shape.
 */
export function BodySkeleton({
  showTitle = true,
}: {
  showTitle?: boolean;
} = {}) {
  return (
    <div
      // `w-full` is load-bearing: in `StudyLayoutSkeleton`'s `<main>` we sit
      // inside a `flex` row with `min-w-0`, so without an explicit width the
      // grid would collapse to content width and the inner `w-full` / `w-2/3`
      // percentages would resolve to ~0px (visible as a column of tiny bars
      // pinned to the left edge of the body).
      className="grid h-full w-full content-start gap-6 px-6 py-5"
      role="status"
      aria-label="Loading"
    >
      {showTitle ? <Skeleton className="h-7 w-2/3" /> : null}

      {/* Notes-doc paragraph lines */}
      <div className="grid gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-9/12" />
      </div>

      {/* Study-block cards */}
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-md border border-border/60 p-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
        </div>
        <div className="grid gap-2 rounded-md border border-border/60 p-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-10/12" />
        </div>
      </div>
    </div>
  );
}
