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

/**
 * Async server component that owns all of the studies layout's data fetching.
 *
 * Lives outside `layout.tsx` so the layout file itself can be synchronous —
 * required by `cacheComponents: true` for the route's `loading.tsx` (and the
 * pages' Suspense boundaries) to actually stream. The layout wraps this in a
 * `<Suspense>` boundary with a `StudyLayoutSkeleton` fallback.
 *
 * Everything that depends only on `(studyId, user, isOwner)` is fetched in a
 * single `Promise.all`.
 */
export async function StudyLayoutInner({
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

  // Study existence and ownership are independent; running them in parallel
  // shaves one round trip off every entry. The notFound() and isOwner
  // branching both happen below after this resolves.
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

  const [
    sections,
    trashedSections,
    genres,
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
