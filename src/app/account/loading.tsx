import { AppHeaderSkeleton } from "@/components/app-header-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while `/account` resolves the parallel profile + editor-tools
 * fetches. The page renders its own header (no /account layout), so this
 * fallback owns the full chrome and mirrors the page's wrapper exactly.
 */
export default function AccountLoading() {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeaderSkeleton />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <Skeleton className="h-8 w-56" />

        <div className="mt-8 grid gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-card py-4 ring-1 ring-foreground/10"
            >
              <div className="px-4 pb-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-3 w-48" />
              </div>
              <div className="px-4">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
