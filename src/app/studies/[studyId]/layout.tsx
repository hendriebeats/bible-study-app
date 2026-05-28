import { Suspense, type ReactNode } from "react";

import { StudyLayoutInner } from "@/components/studies/study-layout-inner";
import { StudyLayoutSkeleton } from "@/components/studies/study-layout-skeleton";

/**
 * Studies layout — intentionally synchronous so the `[sectionId]/loading.tsx`
 * fallback (and any other child Suspense) can stream immediately on
 * navigation. Under `cacheComponents: true`, any `await` at this layer would
 * block child fallbacks; all of the actual data fetching (study, sections,
 * workspace data, etc.) lives in `<StudyLayoutInner>` underneath the Suspense
 * boundary below.
 *
 * The `StudyLayoutSkeleton` matches `<StudyChrome>`'s shell exactly so the
 * swap to the real chrome is zero-CLS. While that's resolving the user sees
 * placeholders for the sidebar + top bar; once the layout finishes, the page
 * mounts with its own editor skeleton until the section data arrives.
 */
export default function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  return (
    <Suspense fallback={<StudyLayoutSkeleton />}>
      <StudyLayoutInner params={params}>{children}</StudyLayoutInner>
    </Suspense>
  );
}
