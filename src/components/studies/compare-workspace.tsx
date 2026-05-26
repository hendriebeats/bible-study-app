"use client";

import dynamic from "next/dynamic";

import type { CompareDockviewProps } from "@/components/studies/compare-dockview";

// dockview needs the DOM (no SSR). `ssr: false` is only valid inside a Client
// Component (Next 16), which is why this thin wrapper exists.
const CompareDockview = dynamic(
  () =>
    import("@/components/studies/compare-dockview").then(
      (m) => m.CompareDockview,
    ),
  {
    ssr: false,
    loading: () => (
      <p className="p-4 text-sm text-muted-foreground">Loading workspace…</p>
    ),
  },
);

export function CompareWorkspace(props: CompareDockviewProps) {
  return <CompareDockview {...props} />;
}
