import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallback streamed while `<StudyLayoutInner>` resolves the study + sections +
 * workspace data. Mirrors `<StudyChrome>`'s structure CLASS-FOR-CLASS so the
 * handoff to the real chrome only swaps each region's INNER content.
 *
 * Body + toolbar regions are left EMPTY here — `<StudiesLoadingOverlay>`
 * (a sibling of the Suspense boundary in `[studyId]/layout.tsx`) covers them
 * with a persistent skeleton that doesn't unmount across this handoff,
 * keeping `animate-pulse` in phase from cold load through editor mount.
 *
 * What this still renders directly:
 *   - **Top bar**: skeleton bars for the "All studies" link + study title +
 *     header actions. The top bar's content swaps when the chrome takes over.
 *   - **Sidebar**: `<aside>` with the same `bg-sidebar` background the real
 *     `<StudySidebar>` uses, plus skeleton rows mimicking the section list.
 *
 * Keep these classes in sync with `study-chrome.tsx` — if it drifts, the
 * loading-to-real handoff starts showing visible shifts again.
 */
export function StudyLayoutSkeleton() {
  return (
    <div className="flex h-svh flex-col">
      {/* Top bar — matches `<header>` in study-chrome.tsx. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Skeleton className="h-7 w-28 rounded-md" />
        <Skeleton className="h-5 w-48" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </header>

      {/* Toolbar slot — empty here; the persistent overlay covers it. The
          wrapper still reserves height + bg so the layout matches the chrome. */}
      <div className="h-12 shrink-0 border-b border-border/60 bg-background" />

      {/* Body row wrapper — matches the chrome's `relative flex min-h-0 flex-1`. */}
      <div className="relative flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-hidden">
          <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar">
            <div className="flex items-center border-b p-2">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="ml-2 h-4 w-24" />
            </div>
            <div className="grid gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
          </aside>
        </div>

        {/* Main — empty white area; the persistent overlay's body skeleton
            covers it during cold load. `bg-white` matches the editor's body
            in the loaded state. */}
        <main className="flex min-h-0 min-w-0 flex-1 bg-white" />
      </div>
    </div>
  );
}
