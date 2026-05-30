"use client";

import { Copy, LogOut, Mail, MoreVertical, UserMinus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  leaveGroup,
  removeMember,
  revokeInvitation,
  setMemberRole,
  type ActionResult,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GroupMember, Invitation } from "@/lib/db/types";

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase() || "?";
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  member: "Member",
};

/**
 * One uniform row shape per person: avatar + name + role + ⋮. Owners see the
 * role as an interactive `<select>` (including on their own row — the
 * `enforce_group_has_owner` trigger guards the last-owner case via PT409, which
 * surfaces through the existing toast). The ⋮ menu carries "Leave group" on
 * your row and "Remove from group" on others' rows when you're an owner; it's
 * hidden otherwise. Keeping the shape identical fixes the previous
 * "me / the owner / other members" feel where each row rendered differently.
 *
 * Pending invitations render as rows in the same list (after the members) so
 * the dialog reads as one unified "people in this group" list — confirmed +
 * not-yet-confirmed in a single scan. Invite rows expose copy-link + revoke
 * controls instead of role-change/leave.
 */
export function MemberRoster({
  groupId,
  members,
  pendingInvitations,
  onPendingInvitationsChange,
  isOwner,
  meId,
  compareStudyId,
  compareSectionId,
}: {
  groupId: string;
  members: GroupMember[];
  /** Optional. When present (typically only for owners), pending invite rows
   * are appended to the same list with copy-link + revoke actions. */
  pendingInvitations?: Invitation[];
  /** Called when an invite is revoked, so the parent can drop it from the
   * unified list without a refetch. */
  onPendingInvitationsChange?: (next: Invitation[]) => void;
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
  // One shared confirm for each destructive action. `pendingRemove` holds the
  // target row when an owner removes someone; `confirmLeave` is the self-leave
  // version. Triggered from the ⋮ menu on the matching row.
  const [pendingRemove, setPendingRemove] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Revoking an invite is destructive (the link stops working) so the action
  // gates through the same confirm pattern as remove/leave instead of firing
  // on a single click.
  const [pendingRevoke, setPendingRevoke] = useState<{
    invitationId: string;
    label: string;
  } | null>(null);

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

        // The kebab is only worth rendering when it has something to offer:
        // your own row always gets "Leave"; other rows get "Remove" only when
        // you're an owner. Non-owners viewing others get no menu.
        const hasMenu = isMe || (isOwner && !isMe);

        return (
          <li
            key={member.user_id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-ui font-medium text-muted-foreground">
              {initials(name)}
            </span>
            {compareHref ? (
              <Link
                href={compareHref}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {name}
                {isMe ? " (you)" : ""}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {name}
                {isMe ? " (you)" : ""}
              </span>
            )}

            {isOwner ? (
              <select
                aria-label={`Role for ${name}`}
                value={member.role}
                disabled={pending}
                onChange={(event) => {
                  const next = event.target.value as "owner" | "member";
                  if (next === member.role) {
                    return;
                  }
                  run(() => setMemberRole(groupId, member.user_id, next));
                }}
                className="h-7 shrink-0 rounded-md border bg-background px-2 text-ui"
              >
                <option value="owner">Owner</option>
                <option value="member">Member</option>
              </select>
            ) : (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
                {ROLE_LABEL[member.role] ?? member.role}
              </span>
            )}

            {hasMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Actions for ${name}`}
                    disabled={pending}
                    className="size-7 text-muted-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isMe ? (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        // Keep the menu out of the confirm dialog's way so
                        // focus doesn't fight Radix's auto-close.
                        event.preventDefault();
                        setConfirmLeave(true);
                      }}
                    >
                      <LogOut className="size-4" />
                      <span className="flex-1">Leave group</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setPendingRemove({ userId: member.user_id, name });
                      }}
                    >
                      <UserMinus className="size-4" />
                      <span className="flex-1">Remove from group</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}

      {(pendingInvitations ?? []).map((invite) => {
        const label = invite.email?.trim();
        const displayLabel =
          label === undefined || label === "" ? "Link invite" : label;
        const isLinkInvite = label === undefined || label === "";
        return (
          <li
            key={`invite-${invite.id}`}
            className="flex items-center gap-3 rounded-lg border border-dashed bg-card p-3 text-muted-foreground"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Mail className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate" title={displayLabel}>
              {displayLabel}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption font-medium">
                  Invited
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isLinkInvite
                  ? "This invite link hasn't been used yet."
                  : "We've sent an invite — they haven't joined yet."}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Copy invite link for ${displayLabel}`}
                  className="size-7"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        `${window.location.origin}/groups/accept?token=${invite.token}`,
                      )
                      .then(
                        () => {
                          toast.success("Invite link copied.");
                        },
                        () => {
                          toast.error(
                            "Couldn't copy — select and copy manually.",
                          );
                        },
                      );
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Copy the invite link to send manually.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setPendingRevoke({
                      invitationId: invite.id,
                      label: displayLabel,
                    });
                  }}
                >
                  Revoke
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Cancel this invitation. The link will stop working.
              </TooltipContent>
            </Tooltip>
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

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingRevoke(null);
          }
        }}
        title="Revoke this invitation?"
        description={
          <>
            The invite link for{" "}
            <span className="font-medium text-foreground">
              {pendingRevoke?.label ?? "this invitee"}
            </span>{" "}
            will stop working. You can always send a new invite later.
          </>
        }
        confirmLabel="Revoke invite"
        destructive
        pending={pending}
        onConfirm={() => {
          if (pendingRevoke) {
            const target = pendingRevoke;
            setPendingRevoke(null);
            startTransition(() => {
              void revokeInvitation(target.invitationId, groupId).then(() => {
                onPendingInvitationsChange?.(
                  (pendingInvitations ?? []).filter(
                    (i) => i.id !== target.invitationId,
                  ),
                );
              });
            });
          }
        }}
      />
    </ul>
  );
}
