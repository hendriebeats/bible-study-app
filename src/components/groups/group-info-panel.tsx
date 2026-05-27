"use client";

import { FileText, Plus, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";

import { seedMyGroupStudy } from "@/app/groups/actions";
import { InvitePanel } from "@/components/groups/invite-panel";
import { MemberRoster } from "@/components/groups/member-roster";
import type { GroupMember, Invitation } from "@/lib/db/types";

const actionClass =
  "inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50";

/**
 * The reusable body of a group study's "info" surface: the caller's own-study
 * action (open / start / restore), the editable/viewable template link, the
 * member roster (with owner controls), and — for owners — the invite panel.
 * Presentational over a single group; the container supplies the heading.
 * Shared by the in-study group-info popup and the groups-list popup so both
 * stay in lockstep (this fully replaces the retired group detail page).
 */
export function GroupInfoPanel({
  groupId,
  role,
  templateStudyId,
  members,
  invitations,
  meId,
  myStudyId,
  myStudyActive,
  compareStudyId,
  compareSectionId,
}: {
  groupId: string;
  role: string;
  templateStudyId: string | null;
  members: GroupMember[];
  invitations: Invitation[];
  meId: string;
  /** The caller's own contributed study in this group (drives the study action). */
  myStudyId: string | null;
  myStudyActive: boolean;
  /** Forwarded to the roster so member names link into compare (when anchored). */
  compareStudyId?: string | null;
  compareSectionId?: string | null;
}) {
  const isOwner = role === "owner";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        {myStudyId && myStudyActive ? (
          <Link href={`/studies/${myStudyId}`} className={actionClass}>
            <SquarePen className="size-4 text-muted-foreground" />
            Open my study
          </Link>
        ) : myStudyId ? (
          <Link
            href="/dashboard"
            className={`${actionClass} border-dashed text-muted-foreground`}
          >
            <Trash2 className="size-4" />
            Your study is in the Trash — restore it
          </Link>
        ) : templateStudyId ? (
          <form action={seedMyGroupStudy.bind(null, groupId)}>
            <button type="submit" className={actionClass}>
              <Plus className="size-4 text-muted-foreground" />
              Start my own study
            </button>
          </form>
        ) : null}

        {templateStudyId ? (
          <Link href={`/studies/${templateStudyId}`} className={actionClass}>
            <FileText className="size-4 text-muted-foreground" />
            {isOwner ? "Edit the group template" : "View the group template"}
          </Link>
        ) : null}
      </div>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Members</h3>
        <MemberRoster
          groupId={groupId}
          members={members}
          isOwner={isOwner}
          meId={meId}
          compareStudyId={compareStudyId}
          compareSectionId={compareSectionId}
        />
      </section>

      {isOwner ? (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Invite people
          </h3>
          <InvitePanel groupId={groupId} invitations={invitations} />
        </section>
      ) : null}
    </div>
  );
}
