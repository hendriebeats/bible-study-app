import { notFound } from "next/navigation";

import { SectionSurface } from "@/components/studies/section-surface";
import { listCompareTargets } from "@/lib/db/compare";
import { getGenreBlockTemplates } from "@/lib/db/genres";
import { getDocumentHistory } from "@/lib/db/history";
import { getSection, getSectionDocuments, getStudy } from "@/lib/db/studies";
import type { BlockSpec } from "@/lib/editor/blocks";
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
  const study = await getStudy(studyId);
  const { data: ownerFlag } = await supabase.rpc("is_study_owner", {
    _study_id: studyId,
  });
  const isOwner = ownerFlag ?? false;

  // The study's genre default blocks, for the blocks editor's "reset to default".
  const defaultBlocks: BlockSpec[] = study?.genre_id
    ? (await getGenreBlockTemplates(study.genre_id)).map((t) => ({
        title: t.title,
        subtitle: t.subtitle,
        placeholder: t.placeholder,
        defaultContent: t.default_content,
        lineageId: t.lineage_id,
        templateId: t.id,
      }))
    : [];

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

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      {/* key forces a fresh surface when switching sections */}
      <SectionSurface
        key={section.id}
        section={section}
        documents={documents}
        notesHistory={notesHistory}
        blocksHistory={blocksHistory}
        defaultBlocks={defaultBlocks}
        isOwner={isOwner}
        canCompare={canCompare}
        me={me}
      />
    </div>
  );
}
