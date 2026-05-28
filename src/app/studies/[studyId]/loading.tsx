import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed inside the studies chrome while the study index page resolves
 * `listSections` (and redirects to the first section). Users usually never
 * see this — they're redirected away within a single round trip — but Next 16
 * with `cacheComponents` requires every uncached `await` to sit behind a
 * Suspense boundary, which `loading.tsx` provides implicitly.
 *
 * Falls back to the same shape as `[sectionId]/loading.tsx` since the redirect
 * lands the user inside the chrome's body.
 */
export default function Loading() {
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="grid gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
      </div>
    </div>
  );
}
