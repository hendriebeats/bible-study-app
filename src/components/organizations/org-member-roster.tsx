"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  leaveOrganization,
  removeOrgMember,
  setOrgMemberRole,
  type ActionResult,
} from "@/app/organizations/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/avatar";
import type { OrgMember, OrgRole } from "@/lib/db/types";

const ROLE_LABEL: Record<OrgRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  member: "Member",
};

export function OrgMemberRoster({
  orgId,
  members,
  myRole,
  meId,
}: {
  orgId: string;
  members: OrgMember[];
  myRole: OrgRole;
  meId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const isSuperAdmin = myRole === "super_admin";
  const isAdmin = myRole === "admin" || myRole === "super_admin";

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
        // Super admins manage everyone's role; admins may remove only members.
        const canRemove =
          !isMe && (isSuperAdmin || (isAdmin && member.role === "member"));

        return (
          <li
            key={member.user_id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <Avatar className="size-8 shrink-0">
              {member.avatar_url ? (
                <AvatarImage src={member.avatar_url} alt={name} />
              ) : null}
              <AvatarFallback>{getInitials(name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate">
              {name}
              {isMe ? " (you)" : ""}
            </span>

            {isSuperAdmin && !isMe ? (
              <select
                aria-label={`Role for ${name}`}
                value={member.role}
                disabled={pending}
                onChange={(event) => {
                  run(() =>
                    setOrgMemberRole(
                      orgId,
                      member.user_id,
                      event.target.value as OrgRole,
                    ),
                  );
                }}
                className="h-7 shrink-0 rounded-md border bg-background px-2 text-xs"
              >
                <option value="super_admin">Super admin</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            ) : (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {ROLE_LABEL[member.role]}
              </span>
            )}

            {canRemove ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  run(() => removeOrgMember(orgId, member.user_id));
                }}
              >
                Remove
              </Button>
            ) : null}

            {isMe ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  run(
                    () => leaveOrganization(),
                    () => {
                      router.push("/organizations");
                      router.refresh();
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
