import { Suspense, type ReactNode } from "react";

import { StudyLayoutInner } from "@/components/studies/study-layout-inner";
import { StudyLayoutSkeleton } from "@/components/studies/study-layout-skeleton";
import { StudiesLoadingOverlay } from "@/components/studies/studies-loading-overlay";

/**
 * Studies layout — intentionally synchronous so the `[sectionId]/loading.tsx`
 * fallback (and any other child Suspense) can stream immediately on
 * navigation. Under `cacheComponents: true`, any `await` at this layer would
 * block child fallbacks; all of the actual data fetching (study, sections,
 * workspace data, etc.) lives in `<StudyLayoutInner>` underneath the Suspense
 * boundary below.
 *
 * `<StudiesLoadingOverlay>` is a SIBLING of the Suspense — that's deliberate.
 * It renders the cold-load body + toolbar skeletons as a single persistent
 * element that doesn't unmount when the chrome takes over from
 * `<StudyLayoutSkeleton>`, so the skeleton's `animate-pulse` doesn't restart
 * at the handoff. `<WorkspaceInner>` toggles
 * `body[data-studies-body-ready]` once the editor view registers, fading
 * the overlay out via the CSS rule in `globals.css`. `<StudyLayoutSkeleton>`
 * intentionally leaves its toolbar slot + main empty — the overlay sits on
 * top of those regions.
 */
export default function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  return (
    <>
      <Suspense fallback={<StudyLayoutSkeleton />}>
        <StudyLayoutInner params={params}>{children}</StudyLayoutInner>
      </Suspense>
      <StudiesLoadingOverlay />
    </>
  );
}
