import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  getPreviousSectionBlockSpecs,
  getStudyTemplateBlocksDoc,
} from "@/app/studies/actions";
import { HeaderActions } from "@/components/header-actions";
import { StudyChrome } from "@/components/studies/study-chrome";
import type { AddSectionSources } from "@/components/studies/study-sidebar";
import { StudyWorkspace } from "@/components/studies/study-workspace";
import { listCompareTargets } from "@/lib/db/compare";
import { listGenres } from "@/lib/db/genres";
import { getStudyGroupContext } from "@/lib/db/groups";
import { getStudy, listSections, listTrashedSections } from "@/lib/db/studies";
import { specsFromBlocksDoc } from "@/lib/editor/blocks";
import {
  getEditorTools,
  getFormatRecents,
  getScriptureOptions,
} from "@/lib/db/user-settings";
import { getWorkspaceLayout } from "@/lib/db/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;

  const supabase = await createClient();
  // lint-allow-await-in-layout: TODO(3C cacheComponents) auth check stays in the layout until
  // cacheComponents (3C) wraps auth-gated content in <Suspense>. The rest of
  // this layout's data fetching is also pending the 1B refactor: move
  // study-scoped fetches into client components consuming Promise props with
  // React 19 `use()` under their own <Suspense> boundary.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Study existence and ownership are independent; running them in parallel
  // shaves one round trip off every entry. The notFound() and isOwner branching
  // both happen below after this resolves.
  const [study, ownerFlagResult] = await Promise.all([
    getStudy(studyId),
    supabase.rpc("is_study_owner", { _study_id: studyId }),
  ]);
  if (!study) {
    notFound();
  }
  // Ownership covers personal owner AND group owners of a group's template.
  const isOwner = ownerFlagResult.data ?? false;
  const isTemplate = study.is_app_template || study.owner_org_id !== null;
  const templateBackHref = study.is_app_template
    ? "/admin/templates"
    : "/organizations/templates";

  // Everything else this layout needs depends only on (studyId, user, isOwner)
  // — fetch it in a single parallel batch instead of the previous chain of
  // sequential awaits. Owner-only queries no-op (Promise.resolve) for non-owners
  // so we don't burn queries on the read-along path.
  const [
    sections,
    trashedSections,
    genres,
    templateDoc,
    profileResult,
    compareTargets,
    groupContext,
    savedLayout,
    scriptureOptions,
    formatRecents,
    editorTools,
  ] = await Promise.all([
    listSections(studyId),
    isOwner
      ? listTrashedSections(studyId)
      : Promise.resolve<Awaited<ReturnType<typeof listTrashedSections>>>([]),
    isOwner
      ? listGenres()
      : Promise.resolve<Awaited<ReturnType<typeof listGenres>>>([]),
    isOwner
      ? getStudyTemplateBlocksDoc(studyId)
      : Promise.resolve<Awaited<
          ReturnType<typeof getStudyTemplateBlocksDoc>
        > | null>(null),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
    listCompareTargets(studyId),
    getStudyGroupContext(studyId),
    getWorkspaceLayout(studyId),
    getScriptureOptions(),
    getFormatRecents(),
    getEditorTools(),
  ]);
  const profile = profileResult.data;

  // What the "Add section" sidebar control will offer. Specs-JSON compare (no
  // body) lets "structurally same" sources skip the chooser — copies are
  // functionally identical when chrome matches. Only owners see Add Section.
  // previousSpecs depends on `sections` (needs lastPosition), so it can't go
  // into the batch above — but it's the only follow-up await.
  let addSectionSources: AddSectionSources = {
    hasTemplate: false,
    hasPrevious: false,
    sourcesDiffer: false,
  };
  if (isOwner && templateDoc) {
    const lastPosition =
      sections.length > 0 ? Math.max(...sections.map((s) => s.position)) : -1;
    // lint-allow-await-in-layout: TODO(3C cacheComponents) addSectionSources computation moves
    // into a client <Suspense> boundary once the layout is thinned. Sequential
    // here is unavoidable today because the call depends on `sections.length`.
    const previousSpecs = await getPreviousSectionBlockSpecs(
      studyId,
      lastPosition + 1,
    );
    const templateSpecs = specsFromBlocksDoc(templateDoc);
    addSectionSources = {
      hasTemplate: templateSpecs.length > 0,
      hasPrevious: previousSpecs.length > 0,
      sourcesDiffer:
        JSON.stringify(templateSpecs) !== JSON.stringify(previousSpecs),
    };
  }

  // Identity for live presence + a labeled remote cursor (read-along).
  const meName =
    [profile?.display_name?.trim(), user.email?.split("@")[0]].find(
      (value) => value !== undefined && value !== "",
    ) ?? "Someone";
  const me = { id: user.id, name: meName };

  return (
    <StudyChrome
      study={study}
      sections={sections}
      isOwner={isOwner}
      trashedSections={trashedSections}
      genres={genres}
      isTemplate={isTemplate}
      templateBackHref={templateBackHref}
      addSectionSources={addSectionSources}
      actions={<HeaderActions />}
    >
      <StudyWorkspace
        studyId={studyId}
        me={me}
        compareTargets={compareTargets}
        groupContext={groupContext}
        savedLayout={savedLayout}
        scriptureOptions={scriptureOptions}
        formatRecents={formatRecents}
        editorTools={editorTools}
      >
        {children}
      </StudyWorkspace>
    </StudyChrome>
  );
}
