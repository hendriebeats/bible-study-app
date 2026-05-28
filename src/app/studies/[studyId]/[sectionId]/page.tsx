import { notFound } from "next/navigation";

import {
  getPreviousSectionBlockSpecs,
  getStudyTemplateBlocksDoc,
} from "@/app/studies/actions";
import { SectionBridge } from "@/components/studies/section-bridge";
import { specsFromBlocksDoc } from "@/lib/editor/blocks";
import { getDocumentHistory } from "@/lib/db/history";
import {
  getSection,
  getSectionDocuments,
  getStudy,
  isStudyOwner,
} from "@/lib/db/studies";

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { studyId, sectionId } = await params;
  const { focus } = await searchParams;

  // Single-phase publish: everything the dock needs is fetched here BEFORE the
  // `<SectionBridge>` renders, so the editor mounts once with full data — no
  // intermediate viewer→editor swap and none of the flickers that came with
  // it (right-side row width change, "Read-only" badge, editor remount). With
  // `cacheComponents`'s `<Activity>`, the previous section stays visible
  // during navigation while this resolves, so the wait is hidden.
  //
  // `getStudy`/`isStudyOwner`/`listSections` go through React's `cache()`, so
  // the layout's calls dedupe with these.
  const [section, documents, study, isOwner] = await Promise.all([
    getSection(sectionId),
    getSectionDocuments(sectionId),
    getStudy(studyId),
    isStudyOwner(studyId),
  ]);
  if (!section) {
    notFound();
  }
  if (!documents) {
    notFound();
  }
  // A template study (app default or org-owned) — the blocks dialog's Template
  // tab then edits the default that seeds studies created from this template.
  const isTemplate =
    Boolean(study?.is_app_template) || study?.owner_org_id != null;

  // Empty-state precheck (owners only). Depends on `section.position` so it
  // can't join the first batch. The template precheck must use the same
  // source of truth as the seed action (`getStudyTemplateBlocksDoc`, which
  // prioritizes the user-edited `template_blocks_doc`) — checking only the
  // spec source missed studies where the user customized via the dialog.
  //
  // History (`getDocumentHistory`) joins this same batch so the editor mounts
  // once with full undo replay; for non-owners they're left null.
  let emptyStateHasTemplate = false;
  let emptyStateHasPrevious = false;
  let notesHistory: Awaited<ReturnType<typeof getDocumentHistory>> | null =
    null;
  let blocksHistory: Awaited<ReturnType<typeof getDocumentHistory>> | null =
    null;
  if (isOwner) {
    const [templateDoc, previousSpecs, notes, blocks] = await Promise.all([
      getStudyTemplateBlocksDoc(studyId),
      getPreviousSectionBlockSpecs(studyId, section.position),
      getDocumentHistory(
        documents.notes.id,
        documents.notes.current_version,
        documents.notes.content,
      ),
      getDocumentHistory(
        documents.blocks.id,
        documents.blocks.current_version,
        documents.blocks.content,
      ),
    ]);
    emptyStateHasTemplate = specsFromBlocksDoc(templateDoc).length > 0;
    emptyStateHasPrevious = previousSpecs.length > 0;
    notesHistory = notes;
    blocksHistory = blocks;
  }

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
        emptyStateHasTemplate,
        emptyStateHasPrevious,
      }}
    />
  );
}
