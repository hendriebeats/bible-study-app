"use client";

import { FileText, Plus, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { createInvitations, seedMyGroupStudy } from "@/app/groups/actions";
import {
  InviteRowsForm,
  type InviteRowsFormHandle,
} from "@/components/groups/invite-rows-form";
import { MemberRoster } from "@/components/groups/member-roster";
import { Button } from "@/components/ui/button";
import type { GroupMember, Invitation } from "@/lib/db/types";

const actionClass =
  "inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-ui hover:bg-accent/50";

/**
 * The reusable body of a group study's "info" surface. Information hierarchy:
 *
 *   1. **Invite people** (owners only) — top of the panel, prominent. The
 *      input itself is bare on first appearance; role/✕/Send fade in once the
 *      user starts typing, so the dialog reads quietly when first opened.
 *   2. **People** — members AND pending invitations as a single list (rather
 *      than two side-by-side sections), so the dialog scans as "everyone in
 *      this group" at a glance.
 *   3. **Template link** — Edit (owner) or View (member) the group template.
 *
 * `hideOwnStudyAction` removes the "Open my study / Start my own / Restore"
 * action — passed by in-study contexts (the top-bar Share button and the
 * toolbar GroupMembersMenu) where you're already on a study, making those
 * actions redundant or confusing.
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
  hideOwnStudyAction = false,
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
  /** When true, suppress the Open/Start/Restore own-study action row. */
  hideOwnStudyAction?: boolean;
}) {
  const isOwner = role === "owner";
  // Pending invitations are kept in local state so submitting a new batch (or
  // revoking) reflects in the unified people list immediately, without a
  // server roundtrip or router.refresh.
  const [pending, setPending] = useState<Invitation[]>(invitations);
  const [submitting, startTransition] = useTransition();
  const inviteFormRef = useRef<InviteRowsFormHandle>(null);

  function sendInvites() {
    const rows = inviteFormRef.current?.collect() ?? [];
    if (rows.length === 0) {
      toast.error("Add at least one email to invite.");
      return;
    }
    startTransition(async () => {
      const result = await createInvitations(groupId, rows);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPending((prev) => [
        ...result.results.map((r) => r.invitation),
        ...prev,
      ]);
      const emailedCount = result.results.filter((r) => r.emailed).length;
      const linkOnlyCount = result.results.length - emailedCount;
      const parts: string[] = [];
      if (emailedCount > 0) {
        parts.push(`${String(emailedCount)} emailed`);
      }
      if (linkOnlyCount > 0) {
        parts.push(`${String(linkOnlyCount)} link-only`);
      }
      toast.success(`Invites ready (${parts.join(", ")}).`);
      inviteFormRef.current?.reset();
    });
  }

  // Whether to render the own-study action (Open/Start/Restore) at the
  // bottom. Hidden in in-study contexts via `hideOwnStudyAction`.
  const ownStudyAction = (() => {
    if (hideOwnStudyAction) {
      return null;
    }
    if (myStudyId && myStudyActive) {
      return (
        <Link href={`/studies/${myStudyId}`} className={actionClass}>
          <SquarePen className="size-4 text-muted-foreground" />
          Open my study
        </Link>
      );
    }
    if (myStudyId) {
      return (
        <Link
          href="/dashboard"
          className={`${actionClass} border-dashed text-muted-foreground`}
        >
          <Trash2 className="size-4" />
          Your study is in the Trash — restore it
        </Link>
      );
    }
    if (templateStudyId) {
      return (
        <form action={seedMyGroupStudy.bind(null, groupId)}>
          <button type="submit" className={actionClass}>
            <Plus className="size-4 text-muted-foreground" />
            Start my own study
          </button>
        </form>
      );
    }
    return null;
  })();

  return (
    <div className="grid gap-6">
      {isOwner ? (
        <section className="grid gap-2">
          <h3 className="text-ui font-semibold">Invite people</h3>
          <InviteRowsForm
            ref={inviteFormRef}
            disabled={submitting}
            placeholder="Email address"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={sendInvites}
            >
              Send invites
            </Button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        <h3 className="text-ui font-semibold text-muted-foreground">People</h3>
        <MemberRoster
          groupId={groupId}
          members={members}
          pendingInvitations={isOwner ? pending : undefined}
          onPendingInvitationsChange={isOwner ? setPending : undefined}
          isOwner={isOwner}
          meId={meId}
          compareStudyId={compareStudyId}
          compareSectionId={compareSectionId}
        />
      </section>

      {ownStudyAction !== null || templateStudyId !== null ? (
        <div className="flex flex-wrap gap-2">
          {ownStudyAction}
          {templateStudyId ? (
            <Link href={`/studies/${templateStudyId}`} className={actionClass}>
              <FileText className="size-4 text-muted-foreground" />
              {isOwner ? "Edit the group template" : "View the group template"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
