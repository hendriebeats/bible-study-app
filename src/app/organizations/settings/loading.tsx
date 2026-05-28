import { Skeleton } from "@/components/ui/skeleton";

/** Streamed while the org settings page resolves. */
export default function Loading() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-7 w-48" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
