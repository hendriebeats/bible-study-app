import { BookOpen, Plus, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { seedMyGroupStudy } from "@/app/groups/actions";
import { GroupInfoPanel } from "@/components/groups/group-info-panel";
import {
  getGroup,
  isGroupOwner,
  listInvitations,
  listMembers,
} from "@/lib/db/groups";
import { listSections } from "@/lib/db/studies";
import { createClient } from "@/lib/supabase/server";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await getGroup(groupId);
  if (!group) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const [owner, members] = await Promise.all([
    isGroupOwner(groupId),
    listMembers(groupId),
  ]);
  const invitations = owner ? await listInvitations(groupId) : [];

  // The caller's own contributed study in this group (owners start without one).
  // A trashed study still occupies the membership slot but isn't openable.
  const myMembership = members.find((m) => m.user_id === user.id) ?? null;
  const myStudyId = myMembership?.study_id ?? null;
  const myStudyActive = myMembership?.study_active ?? false;

  // First section of my own study, so the roster can link member names into the
  // compare workspace anchored on it.
  let myFirstSectionId: string | null = null;
  if (myStudyId && myStudyActive) {
    const sections = await listSections(myStudyId);
    myFirstSectionId = sections[0]?.id ?? null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Link
        href="/groups"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <BookOpen className="size-4" />
        Group studies
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{group.name}</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        {myStudyId && myStudyActive ? (
          <Link
            href={`/studies/${myStudyId}`}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50"
          >
            <SquarePen className="size-4 text-muted-foreground" />
            Open my study
          </Link>
        ) : myStudyId ? (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50"
          >
            <Trash2 className="size-4" />
            Your study is in the Trash — restore it
          </Link>
        ) : group.template_study_id ? (
          <form action={seedMyGroupStudy.bind(null, groupId)}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50"
            >
              <Plus className="size-4 text-muted-foreground" />
              Start my own study
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-8">
        <GroupInfoPanel
          groupId={groupId}
          role={owner ? "owner" : "member"}
          templateStudyId={group.template_study_id}
          members={members}
          invitations={invitations}
          meId={user.id}
          compareStudyId={myStudyActive ? myStudyId : null}
          compareSectionId={myFirstSectionId}
        />
      </div>
    </div>
  );
}
