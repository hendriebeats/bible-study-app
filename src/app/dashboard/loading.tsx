import { AppHeaderSkeleton } from "@/components/app-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while `/dashboard` resolves its 6 parallel server fetches. Mirrors
 * the real page's outer wrapper exactly (max-width, padding, header layout)
 * so the swap to real content is zero-CLS.
 *
 * Renders the studies grid as N placeholder cards matching `<StudiesList>`'s
 * row template; the actual list re-renders identical chrome when it arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeaderSkeleton />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        <ul className="mt-8 grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
            >
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
