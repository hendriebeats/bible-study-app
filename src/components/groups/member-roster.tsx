"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  leaveGroup,
  removeMember,
  setMemberRole,
  type ActionResult,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { GroupMember } from "@/lib/db/types";

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase() || "?";
}

export function MemberRoster({
  groupId,
  members,
  isOwner,
  meId,
  compareStudyId,
  compareSectionId,
}: {
  groupId: string;
  members: GroupMember[];
  isOwner: boolean;
  meId: string;
  /**
   * When the viewer has their own study + section in this group, member names
   * become links into the compare workspace focused on that member's study.
   */
  compareStudyId?: string | null;
  compareSectionId?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // One shared confirm — `pendingRemove` holds the target row when an owner has
  // clicked Remove on a member. `confirmLeave` is the self-leave version.
  const [pendingRemove, setPendingRemove] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    startTransition(() => {
      void action().then((result) => {
        if (result.ok) {
          onOk?.();
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <ul className="grid gap-2">
      {members.map((member) => {
        const trimmed = member.display_name?.trim() ?? "";
        const name = trimmed === "" ? "Member" : trimmed;
        const isMe = member.user_id === meId;
        // Other members with a live study become a link into compare — but only
        // when the viewer has their own study + section here to anchor it.
        const compareHref =
          !isMe &&
          member.study_active &&
          member.study_id !== null &&
          compareStudyId &&
          compareSectionId
            ? `/studies/${compareStudyId}/${compareSectionId}?focus=${member.study_id}`
            : null;
        return (
          <li
            key={member.user_id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {initials(name)}
            </span>
            {compareHref ? (
              <Link
                href={compareHref}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {name}
                {isMe ? " (you)" : ""}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
              {member.role}
            </span>
            {isOwner && !isMe ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    run(() =>
                      setMemberRole(
                        groupId,
                        member.user_id,
                        member.role === "owner" ? "member" : "owner",
                      ),
                    );
                  }}
                >
                  {member.role === "owner" ? "Demote" : "Make owner"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setPendingRemove({ userId: member.user_id, name });
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : null}
            {isMe ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setConfirmLeave(true);
                }}
              >
                Leave
              </Button>
            ) : null}
          </li>
        );
      })}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingRemove(null);
          }
        }}
        title="Remove this member?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingRemove?.name ?? "This member"}
            </span>{" "}
            will lose access to the group&apos;s studies. They can be invited
            back later.
          </>
        }
        confirmLabel="Remove member"
        destructive
        pending={pending}
        onConfirm={() => {
          if (pendingRemove) {
            const target = pendingRemove;
            setPendingRemove(null);
            run(() => removeMember(groupId, target.userId));
          }
        }}
      />

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this group?"
        description="You will lose access to the group's studies. An owner can invite you back later."
        confirmLabel="Leave group"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirmLeave(false);
          run(
            () => leaveGroup(groupId),
            () => {
              router.push("/groups");
            },
          );
        }}
      />
    </ul>
  );
}
