import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { HeaderActions } from "@/components/header-actions";
import { StudyChrome } from "@/components/studies/study-chrome";
import { listGenres } from "@/lib/db/genres";
import { getStudy, listSections, listTrashedSections } from "@/lib/db/studies";
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
      {children}
    </StudyChrome>
  );
}
