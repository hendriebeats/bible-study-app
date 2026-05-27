import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { HeaderActions } from "@/components/header-actions";
import { StudyChrome } from "@/components/studies/study-chrome";
import { StudyWorkspace } from "@/components/studies/study-workspace";
import { listCompareTargets } from "@/lib/db/compare";
import { listGenres } from "@/lib/db/genres";
import { getStudyGroupContext } from "@/lib/db/groups";
import { getStudy, listSections, listTrashedSections } from "@/lib/db/studies";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const study = await getStudy(studyId);
  if (!study) {
    notFound();
  }

  // Ownership covers personal owner AND group owners of a group's template.
  const { data: ownerFlag } = await supabase.rpc("is_study_owner", {
    _study_id: studyId,
  });
  const isOwner = ownerFlag ?? false;
  const sections = await listSections(studyId);
  const trashedSections = isOwner ? await listTrashedSections(studyId) : [];
  const genres = isOwner ? await listGenres() : [];
  const isTemplate = study.is_app_template || study.owner_org_id !== null;
  const templateBackHref = study.is_app_template
    ? "/admin/templates"
    : "/organizations/templates";

  // Identity for live presence + a labeled remote cursor (read-along).
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const meName =
    [profile?.display_name?.trim(), user.email?.split("@")[0]].find(
      (value) => value !== undefined && value !== "",
    ) ?? "Someone";
  const me = { id: user.id, name: meName };

  // Study-scoped workspace data (stable across sections, so it's fetched once
  // here rather than on every section page): who I can compare against, my
  // saved dock layout, and my editor settings.
  const [
    compareTargets,
    groupContext,
    savedLayout,
    scriptureOptions,
    formatRecents,
    editorTools,
  ] = await Promise.all([
    listCompareTargets(studyId),
    getStudyGroupContext(studyId),
    getWorkspaceLayout(studyId),
    getScriptureOptions(),
    getFormatRecents(),
    getEditorTools(),
  ]);

  return (
    <StudyChrome
      study={study}
      sections={sections}
      isOwner={isOwner}
      trashedSections={trashedSections}
      genres={genres}
      isTemplate={isTemplate}
      templateBackHref={templateBackHref}
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
