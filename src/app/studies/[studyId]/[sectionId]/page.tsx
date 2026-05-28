import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  getPreviousSectionBlockSpecs,
  getStudyTemplateBlocksDoc,
} from "@/app/studies/actions";
import { SectionBridge } from "@/components/studies/section-bridge";
import { SectionHistoryBridge } from "@/components/studies/section-history-bridge";
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

  // Phase 1: only the truly-section-scoped fetches block — `getSection` and
  // `getSectionDocuments`. `getStudy` and `isStudyOwner` are wrapped in
  // React's `cache()` and already resolved by the studies layout in this
  // request, so they're free cache hits here.
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

  // Phase 2 (owners only): empty-state precheck — does this study have a
  // template doc or an earlier section to copy blocks from? Depends on
  // `section.position` so it can't join the batch above. The template
  // precheck must use the SAME source of truth as the seed action
  // (`getStudyTemplateBlocksDoc`, which prioritizes the user-edited
  // `template_blocks_doc`) — checking only the spec source missed studies
  // where the user has customized the template via the blocks dialog.
  let emptyStateHasTemplate = false;
  let emptyStateHasPrevious = false;
  if (isOwner) {
    const [templateDoc, previousSpecs] = await Promise.all([
      getStudyTemplateBlocksDoc(studyId),
      getPreviousSectionBlockSpecs(studyId, section.position),
    ]);
    emptyStateHasTemplate = specsFromBlocksDoc(templateDoc).length > 0;
    emptyStateHasPrevious = previousSpecs.length > 0;
  }

  // Two-phase publish (2A):
  //   1. `<SectionBridge>` publishes the section + documents + flags immediately,
  //      with null history. The dock's editor falls back to the read-only viewer
  //      for owners, and the read-only viewer is what co-members see anyway.
  //   2. `<SectionHistoryBridge>` resolves the (potentially slow) per-document
  //      history Promises inside its own Suspense boundary, then patches the
  //      active payload via `publishHistory`. Owners' editor upgrades in place
  //      (notes/blocks remount with undo enabled) once history arrives.
  //
  // For viewers, both history Promises resolve to `null` immediately — they
  // never see the upgrade.
  const notesHistoryPromise: Promise<Awaited<
    ReturnType<typeof getDocumentHistory>
  > | null> = isOwner
    ? getDocumentHistory(
        documents.notes.id,
        documents.notes.current_version,
        documents.notes.content,
      )
    : Promise.resolve(null);
  const blocksHistoryPromise: Promise<Awaited<
    ReturnType<typeof getDocumentHistory>
  > | null> = isOwner
    ? getDocumentHistory(
        documents.blocks.id,
        documents.blocks.current_version,
        documents.blocks.content,
      )
    : Promise.resolve(null);

  return (
    <>
      <SectionBridge
        focus={focus ?? null}
        payload={{
          section,
          documents,
          notesHistory: null,
          blocksHistory: null,
          isOwner,
          isTemplate,
          emptyStateHasTemplate,
          emptyStateHasPrevious,
        }}
      />
      <Suspense fallback={null}>
        <SectionHistoryBridge
          sectionId={section.id}
          notesPromise={notesHistoryPromise}
          blocksPromise={blocksHistoryPromise}
        />
      </Suspense>
    </>
  );
}
