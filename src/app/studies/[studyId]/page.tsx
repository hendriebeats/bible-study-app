import { redirect } from "next/navigation";

import { listSections } from "@/lib/db/studies";

export default async function StudyIndexPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const sections = await listSections(studyId);

  const first = sections[0];
  if (first) {
    redirect(`/studies/${studyId}/${first.id}`);
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <p className="text-muted-foreground">This study has no sections yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use “Add section” in the sidebar to begin.
        </p>
      </div>
    </div>
  );
}
