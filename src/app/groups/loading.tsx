import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while `/groups` resolves `listMyGroups`. Mirrors the page's outer
 * wrapper (max-width, padding) and renders a "back to dashboard" placeholder
 * row + a header + a single-row groups list so the swap is zero-CLS.
 *
 * No `<AppHeader />` skeleton here because the groups page renders inline
 * navigation rather than the app header.
 */
export default function GroupsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-8 w-48" />

      <div className="mt-6 mb-8">
        <Skeleton className="h-10 w-full max-w-md" />
      </div>

      <ul className="grid gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
          >
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </li>
        ))}
      </ul>
    </div>
  );
}
