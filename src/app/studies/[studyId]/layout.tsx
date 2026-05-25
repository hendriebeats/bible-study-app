import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { StudySidebar } from "@/components/studies/study-sidebar";
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

  const isOwner = study.owner_id === user.id;
  const sections = await listSections(studyId);
  const trashedSections = isOwner ? await listTrashedSections(studyId) : [];
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
