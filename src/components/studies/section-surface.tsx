import { SectionEditor } from "@/components/studies/section-editor";
import { SectionViewer } from "@/components/studies/section-viewer";
import type { Section, SectionHistory } from "@/lib/db/types";

/**
 * Renders the editable editor for the study owner, or the read-only live
 * viewer for group co-members. (RLS enforces that only the owner can write.)
 */
export function SectionSurface({
  section,
  history,
  isOwner,
}: {
  section: Section;
  history: SectionHistory | null;
  isOwner: boolean;
}) {
  if (isOwner && history) {
    return <SectionEditor section={section} history={history} />;
  }
  return <SectionViewer section={section} />;
}
