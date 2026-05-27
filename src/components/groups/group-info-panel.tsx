"use client";

import { FileText } from "lucide-react";
import Link from "next/link";

import { InvitePanel } from "@/components/groups/invite-panel";
import { MemberRoster } from "@/components/groups/member-roster";
import type { GroupMember, Invitation } from "@/lib/db/types";

/**
 * The reusable body of a group study's "info" surface: the editable/viewable
 * template link, the member roster (with owner controls), and — for owners —
 * the invite panel. Presentational over a single group; the container supplies
 * the heading (a page <h1> or a dialog title). Shared by the group detail page
 * and the in-study group-info popup so both stay in lockstep.
 */
export function GroupInfoPanel({
  groupId,
  role,
  templateStudyId,
  members,
  invitations,
  meId,
  compareStudyId,
  compareSectionId,
}: {
  groupId: string;
  role: string;
  templateStudyId: string | null;
  members: GroupMember[];
  invitations: Invitation[];
  meId: string;
  /** Forwarded to the roster so member names link into compare (when anchored). */
  compareStudyId?: string | null;
  compareSectionId?: string | null;
}) {
  const isOwner = role === "owner";

  return (
    <div className="grid gap-6">
      {templateStudyId ? (
        <Link
          href={`/studies/${templateStudyId}`}
          className="inline-flex items-center gap-2 self-start rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent/50"
        >
          <FileText className="size-4 text-muted-foreground" />
          {isOwner ? "Edit the group template" : "View the group template"}
        </Link>
      ) : null}

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
