import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/**
 * Streamed while `/admin` resolves its server fetches. Uses the shared
 * `PageListSkeleton`. Note: until the admin layout's auth+is_admin awaits
 * are moved into a `<Suspense>` boundary, Next won't actually surface this
 * fallback — the file is in place so it works as soon as that lands.
 */
export default function Loading() {
  return <PageListSkeleton headingWidth="w-32" />;
}
