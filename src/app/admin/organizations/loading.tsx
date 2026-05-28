import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/** Streamed while the admin org verification queue resolves. */
export default function Loading() {
  return <PageListSkeleton headingWidth="w-56" rows={3} />;
}
