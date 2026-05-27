import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CompareWorkspace } from "@/components/studies/compare-workspace";
import {
  getLastViewedCompareTarget,
  listCompareTargets,
} from "@/lib/db/compare";
import { getSection, getSectionDocuments } from "@/lib/db/studies";
import { getWorkspaceLayout } from "@/lib/db/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { studyId, sectionId } = await params;
  const { focus } = await searchParams;
  const section = await getSection(sectionId);
  if (section?.study_id !== studyId) {
    notFound();
  }
  const documents = await getSectionDocuments(sectionId);
  if (!documents) {
    notFound();
  }

  const [targets, savedLayout, lastViewed] = await Promise.all([
    listCompareTargets(studyId),
    getWorkspaceLayout(studyId),
    getLastViewedCompareTarget(studyId),
  ]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let me: { id: string; name: string } | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    const name =
      [profile?.display_name?.trim(), user.email?.split("@")[0]].find(
        (value) => value !== undefined && value !== "",
      ) ?? "Someone";
    me = { id: user.id, name };
  }

  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <Link
          href={`/studies/${studyId}/${sectionId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to section
        </Link>
        <h1 className="text-lg font-semibold">Compare · {section.title}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <CompareWorkspace
          studyId={studyId}
          mySectionId={sectionId}
          myTitle={section.title}
          myDoc={documents.notes}
          targets={targets}
          me={me}
          savedLayout={savedLayout}
          focusTargetStudyId={focus ?? null}
          defaultTargetStudyId={lastViewed}
        />
      </div>
    </div>
  );
}
