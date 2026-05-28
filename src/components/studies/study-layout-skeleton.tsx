import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallback streamed while `<StudyLayoutInner>` resolves the study + sections +
 * workspace data. Mirrors `<StudyChrome>`'s shell: a slim top bar, a left
 * sidebar with placeholder section rows, and a body area that itself will hold
 * the section page's own loading.tsx (the editor skeleton).
 *
 * Keep dimensions in sync with `study-chrome.tsx` so the swap is zero-CLS.
 */
export function StudyLayoutSkeleton() {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Skeleton className="h-4 w-48" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border/60 p-3 md:block">
          <Skeleton className="h-4 w-24" />
          <ul className="mt-3 grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i}>
                <Skeleton className="h-8 w-full rounded-md" />
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto px-6 py-5">
          <div className="grid gap-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        </main>
      </div>
    </div>
  );
}
