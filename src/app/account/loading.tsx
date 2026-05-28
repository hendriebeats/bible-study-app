import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while any `/account/*` sub-page resolves its async work (profile
 * fetch, editor-tools fetch, etc.). The layout already owns the slim top bar
 * and the sidebar (both synchronous), so this fallback only fills the body
 * region — preventing the sidebar from flashing on every sub-route swap.
 */
export default function AccountLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-20">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-8 space-y-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
