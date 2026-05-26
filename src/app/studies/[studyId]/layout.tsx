import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { StudySidebar } from "@/components/studies/study-sidebar";
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex h-svh">
      <StudySidebar
        study={study}
        sections={sections}
        isOwner={isOwner}
        trashedSections={trashedSections}
        genres={genres}
        user={{
          displayName: profile?.display_name ?? "",
          email: user.email ?? "",
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
