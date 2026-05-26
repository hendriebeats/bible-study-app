"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  leaveGroup,
  removeMember,
  setMemberRole,
  type ActionResult,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import type { GroupMember } from "@/lib/db/types";

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase() || "?";
}

export function MemberRoster({
  groupId,
  members,
  isOwner,
  meId,
}: {
  groupId: string;
  members: GroupMember[];
  isOwner: boolean;
  meId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

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
        return (
          <li
            key={member.user_id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {initials(name)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {name}
              {isMe ? " (you)" : ""}
            </span>
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
                    run(() => removeMember(groupId, member.user_id));
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
                  run(
                    () => leaveGroup(groupId),
                    () => {
                      router.push("/groups");
                    },
                  );
                }}
              >
                Leave
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
