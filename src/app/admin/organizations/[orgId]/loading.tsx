import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/** Streamed while the admin org review detail resolves. */
export default function Loading() {
  return <PageListSkeleton headingWidth="w-64" rows={2} />;
}
