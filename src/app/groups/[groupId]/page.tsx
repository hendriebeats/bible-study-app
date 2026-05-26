import { BookOpen, FileText, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { seedMyGroupStudy } from "@/app/groups/actions";
import { InvitePanel } from "@/components/groups/invite-panel";
import { MemberRoster } from "@/components/groups/member-roster";
import {
  getGroup,
  isGroupOwner,
  listInvitations,
  listMembers,
} from "@/lib/db/groups";
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
  const myStudyId =
    members.find((m) => m.user_id === user.id)?.study_id ?? null;

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
        {group.template_study_id ? (
          <Link
            href={`/studies/${group.template_study_id}`}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50"
          >
            <FileText className="size-4 text-muted-foreground" />
            {owner ? "Edit the group template" : "View the group template"}
          </Link>
        ) : null}

        {myStudyId ? (
          <Link
            href={`/studies/${myStudyId}`}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50"
          >
            <SquarePen className="size-4 text-muted-foreground" />
            Open my study
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

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Members
        </h2>
        <MemberRoster
          groupId={groupId}
          members={members}
          isOwner={owner}
          meId={user.id}
        />
      </section>

      {owner ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Invite people
          </h2>
          <InvitePanel groupId={groupId} invitations={invitations} />
        </section>
      ) : null}
    </div>
  );
}
