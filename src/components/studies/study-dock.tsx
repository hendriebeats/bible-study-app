"use client";

import dynamic from "next/dynamic";

import type { StudyDockviewProps } from "@/components/studies/study-dockview";

// dockview needs the DOM (no SSR). `ssr: false` is only valid inside a Client
// Component (Next 16), which is why this thin wrapper exists.
const StudyDockview = dynamic(
  () =>
    import("@/components/studies/study-dockview").then((m) => m.StudyDockview),
  {
    ssr: false,
    loading: () => (
      <p className="p-4 text-sm text-muted-foreground">Loading workspace…</p>
    ),
  },
);

export function StudyDock(props: StudyDockviewProps) {
  return <StudyDockview {...props} />;
}
