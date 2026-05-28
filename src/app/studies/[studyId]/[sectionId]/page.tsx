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

  // A template study (app default or org-owned) — the blocks dialog's Template
  // tab then edits the default that seeds studies created from this template.
  const { data: studyMeta } = await supabase
    .from("studies")
    .select("is_app_template, owner_org_id")
    .eq("id", studyId)
    .maybeSingle();
  const isTemplate =
    Boolean(studyMeta?.is_app_template) || studyMeta?.owner_org_id != null;

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
        isOwner,
        isTemplate,
      }}
    />
  );
}
