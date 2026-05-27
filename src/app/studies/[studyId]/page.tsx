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

  // No sections: publish nothing — the persistent workspace dock (in the layout)
  // shows its own empty state in the "mine" panel.
  return null;
}
