import { notFound } from "next/navigation";

import { SectionBridge } from "@/components/studies/section-bridge";
import { getDocumentHistory } from "@/lib/db/history";
import { getSection, getSectionDocuments } from "@/lib/db/studies";
import { createClient } from "@/lib/supabase/server";

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { studyId, sectionId } = await params;
  const { focus } = await searchParams;
  const section = await getSection(sectionId);
  if (!section) {
    notFound();
  }
  const documents = await getSectionDocuments(sectionId);
  if (!documents) {
    notFound();
  }

  const supabase = await createClient();
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

  // Publish this section's data up into the persistent study workspace (the
  // dock + hoisted editor live at the layout level). Renders nothing itself.
  return (
    <SectionBridge
      focus={focus ?? null}
      payload={{
        section,
        documents,
        notesHistory,
        blocksHistory,
        hasPreviousSection,
        isOwner,
      }}
    />
  );
}
