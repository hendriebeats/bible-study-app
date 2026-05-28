import { Skeleton } from "@/components/ui/skeleton";

/** Streamed while the create-organization page resolves. */
export default function Loading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-full" />
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
