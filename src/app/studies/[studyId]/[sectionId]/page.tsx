import { notFound } from "next/navigation";

import { SectionSurface } from "@/components/studies/section-surface";
import { getSectionHistory } from "@/lib/db/history";
import { getSection, getStudy } from "@/lib/db/studies";
import { createClient } from "@/lib/supabase/server";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ studyId: string; sectionId: string }>;
}) {
  const { studyId, sectionId } = await params;
  const section = await getSection(sectionId);
  if (!section) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const study = await getStudy(studyId);
  const isOwner = user != null && study?.owner_id === user.id;

  // Identity for live presence + a labeled remote cursor (read-along).
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

  // The owner edits (and needs history for refresh-surviving undo); co-members
  // get the read-only live viewer.
  const history = isOwner
    ? await getSectionHistory(
        sectionId,
        section.current_version,
        section.content,
      )
    : null;

  return (
    <div className="mx-auto h-full w-full max-w-3xl px-6 py-8">
      {/* key forces a fresh editor/viewer instance when switching sections */}
      <SectionSurface
        key={section.id}
        section={section}
        isOwner={isOwner}
        history={history}
        me={me}
      />
    </div>
  );
}
