import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { HeaderActions } from "@/components/header-actions";
import { StudyChrome } from "@/components/studies/study-chrome";
import { StudyShareMenu } from "@/components/studies/study-share-menu";
import { StudyWorkspace } from "@/components/studies/study-workspace";
import { listCompareTargets } from "@/lib/db/compare";
import { listGenres } from "@/lib/db/genres";
import {
  getStudyGroupContext,
  listAttachableGroupsForUser,
} from "@/lib/db/groups";
import {
  getStudy,
  isStudyOwner,
  listSections,
  listTrashedSections,
} from "@/lib/db/studies";
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
  // shaves one round trip off every entry. Both calls go through React's
  // `cache()` so the per-section page reuses the result (saving another two
  // round trips per section navigation).
  const [study, isOwner] = await Promise.all([
    getStudy(studyId),
    isStudyOwner(studyId),
  ]);
  if (!study) {
    notFound();
  }
  // Ownership covers personal owner AND group owners of a group's template.
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
    attachableGroups,
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
    // Feeds the Share button's "Add to a group" submenu. Cheap (one row per
    // loose membership) so unconditional here even though most users have 0.
    listAttachableGroupsForUser(studyId),
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
      actions={
        <>
          <StudyShareMenu
            studyId={study.id}
            isOwner={isOwner}
            isOrgTemplate={study.is_app_template || study.owner_org_id !== null}
            groupContext={groupContext}
            attachableGroups={attachableGroups}
            meId={user.id}
          />
          <HeaderActions />
        </>
      }
    >
      <StudyWorkspace
        studyId={studyId}
        me={me}
        hasSections={sections.length > 0}
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
