import { notFound } from "next/navigation";

import { SectionEditor } from "@/components/studies/section-editor";
import { getSectionHistory } from "@/lib/db/history";
import { getSection } from "@/lib/db/studies";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
}) {
  const { sectionId } = await params;
  const section = await getSection(sectionId);
  if (!section) {
    notFound();
  }

  // History needed to mount the editor with refresh-surviving undo.
  const history = await getSectionHistory(
    sectionId,
    section.current_version,
    section.content,
  );

  return (
    <div className="mx-auto h-full w-full max-w-3xl px-6 py-8">
      {/* key forces a fresh editor instance when switching sections */}
      <SectionEditor key={section.id} section={section} history={history} />
    </div>
  );
}
