import { Skeleton } from "@/components/ui/skeleton";

/**
 * Reusable list-shaped fallback for `loading.tsx` files that share the
 * "page-of-rows" layout (admin & org subpages). Keeps individual route
 * loading skeletons trivial — three placeholder rows with a heading above.
 *
 * Per-route skeletons that need more specific shape (different chrome,
 * grids, forms) should not use this and instead render their own structure.
 */
export function PageListSkeleton({
  rows = 4,
  headingWidth = "w-48",
}: {
  rows?: number;
  headingWidth?: string;
}) {
  return (
    <div className="grid gap-6">
      <Skeleton className={`h-7 ${headingWidth}`} />
      <ul className="grid gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
          >
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
