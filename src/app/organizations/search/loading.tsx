import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/** Streamed while the org-search page resolves. */
export default function Loading() {
  return <PageListSkeleton headingWidth="w-48" rows={4} />;
}
