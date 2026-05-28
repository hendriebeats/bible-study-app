import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while the org-invitation accept page resolves its token lookup.
 * Mirrors the page's centered shell.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-md py-8">
      <Skeleton className="mb-4 h-8 w-64" />
      <div className="grid gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-3 h-10 w-32" />
      </div>
    </div>
  );
}
