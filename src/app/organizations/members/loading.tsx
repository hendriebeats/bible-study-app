import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/** Streamed while the org members roster resolves. */
export default function Loading() {
  return <PageListSkeleton headingWidth="w-32" rows={5} />;
}
