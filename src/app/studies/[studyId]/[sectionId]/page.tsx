import { notFound } from "next/navigation";

import { SectionSurface } from "@/components/studies/section-surface";
import { listCompareTargets } from "@/lib/db/compare";
import { getDocumentHistory } from "@/lib/db/history";
import { getSection, getSectionDocuments } from "@/lib/db/studies";
import { getScriptureOptions } from "@/lib/db/user-settings";
import { createClient } from "@/lib/supabase/server";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
}) {
  const { studyId, sectionId } = await params;
  const section = await getSection(sectionId);
  if (!section) {
    notFound();
  }
  const documents = await getSectionDocuments(sectionId);
  if (!documents) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: ownerFlag } = await supabase.rpc("is_study_owner", {
    _study_id: studyId,
  });
  const isOwner = ownerFlag ?? false;

  // Whether the editor's "Copy from previous section" option has a source.
  const { count: otherSectionCount } = await supabase
    .from("sections")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .is("deleted_at", null)
    .neq("id", sectionId);
  const hasPreviousSection = (otherSectionCount ?? 0) > 0;

  // Identity for live presence + a labeled remote cursor (read-along).
  let me: { id: string; name: string } | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    const name =
      [profile?.display_name?.trim(), user.email?.split("@")[0]].find(
        (value) => value !== undefined && value !== "",
      ) ?? "Someone";
    me = { id: user.id, name };
  }

  // The owner edits (and needs each document's history for refresh-surviving
  // undo); co-members get the read-only live viewer.
  const notesHistory = isOwner
    ? await getDocumentHistory(
        documents.notes.id,
        documents.notes.current_version,
        documents.notes.content,
      )
    : null;
  const blocksHistory = isOwner
    ? await getDocumentHistory(
        documents.blocks.id,
        documents.blocks.current_version,
        documents.blocks.content,
      )
    : null;

  // Show the Compare entry point only when there's actually someone to compare
  // against (a co-member in one of this study's groups who has a study).
  const canCompare = (await listCompareTargets(studyId)).length > 0;

  // The user's remembered scripture-insertion defaults (seed the insert panel).
  const scriptureOptions = await getScriptureOptions();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      {/* key forces a fresh surface when switching sections */}
      <SectionSurface
        key={section.id}
        section={section}
        documents={documents}
        notesHistory={notesHistory}
        blocksHistory={blocksHistory}
        hasPreviousSection={hasPreviousSection}
        isOwner={isOwner}
        canCompare={canCompare}
        me={me}
        scriptureOptions={scriptureOptions}
      />
    </div>
  );
}
