"use client";

import dynamic from "next/dynamic";

import type { StudyDockviewProps } from "@/components/studies/study-dockview";

// dockview needs the DOM (no SSR). `ssr: false` is only valid inside a Client
// Component (Next 16), which is why this thin wrapper exists.
//
// `loading` is `null`: the persistent `<StudiesLoadingOverlay>` (rendered in
// the studies layout as a sibling of the Suspense boundary) covers the body
// region throughout the dockview chunk download → dock mount → editor mount
// sequence, so this dynamic's loading slot is never visible.
const StudyDockview = dynamic(
  () =>
    import("@/components/studies/study-dockview").then((m) => m.StudyDockview),
  {
    ssr: false,
    loading: () => null,
  },
);

export function StudyDock(props: StudyDockviewProps) {
  return <StudyDockview {...props} />;
}
