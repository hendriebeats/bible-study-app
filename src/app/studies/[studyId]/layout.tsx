import { Layers } from "lucide-react";
import Link from "next/link";
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
  const isTemplate = study.is_app_template || study.owner_org_id !== null;
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
      <div className="flex-1 overflow-auto">
        {isTemplate ? (
          <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-6 py-2.5 text-sm">
            <Layers className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              You&rsquo;re editing the{" "}
              {study.is_app_template ? "app default" : "organization"} template{" "}
              <span className="font-medium">{study.title}</span>. Changes apply
              to future studies only.
            </span>
            <Link
              href={
                study.is_app_template
                  ? "/admin/templates"
                  : "/organizations/templates"
              }
              className="shrink-0 font-medium text-primary hover:underline"
            >
              ← Back to templates
            </Link>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
