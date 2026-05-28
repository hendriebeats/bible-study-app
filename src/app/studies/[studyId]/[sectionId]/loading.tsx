import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed inside the studies chrome while a section page resolves its
 * fetches (section meta, documents, history). The chrome (`<StudyChrome>` +
 * `<StudyWorkspace>`) is rendered by the studies layout; this fallback only
 * fills the body area where the editor will mount.
 *
 * Mirrors the body's vertical rhythm (title row + paragraphs) so the swap to
 * the real editor doesn't shift surrounding content.
 */
export default function Loading() {
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="grid gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-9/12" />
        <Skeleton className="my-2 h-px w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-11/12" />
      </div>
    </div>
  );
}
