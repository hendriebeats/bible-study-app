"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createOrgInvitation,
  revokeOrgInvitation,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrgInvitation, OrgRole } from "@/lib/db/types";

export function OrgInvitePanel({
  orgId,
  invitations,
  canInviteAdmins,
}: {
  orgId: string;
  invitations: OrgInvitation[];
  canInviteAdmins: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(
      () => {
        toast.success("Invite link copied.");
      },
      () => {
        toast.error("Couldn't copy — select and copy manually.");
      },
    );
  }

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => {
            void createOrgInvitation(orgId, email, role)
              .then((result) => {
                setLink(result.link);
                setEmail("");
                toast.success(
                  result.emailed
                    ? "Invitation emailed — and here's a link too."
                    : "Invite link created.",
                );
              })
              .catch((error: unknown) => {
                toast.error(
                  error instanceof Error ? error.message : "Couldn't invite.",
                );
              });
          });
        }}
      >
        <Input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          placeholder="Email (optional)"
          aria-label="Invite email"
          className="max-w-xs"
        />
        {canInviteAdmins ? (
          <select
            aria-label="Invite role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as OrgRole);
            }}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        ) : null}
        <Button type="submit" disabled={pending}>
          Create invite
        </Button>
      </form>

      {link ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              copy(link);
            }}
          >
            <Copy className="size-4" />
            Copy
          </Button>
        </div>
      ) : null}

      {invitations.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            Pending invitations
          </p>
          {invitations.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {invite.email ?? "Link invite"}
                <span className="text-muted-foreground"> · {invite.role}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  copy(
                    `${window.location.origin}/organizations/accept?token=${invite.token}`,
                  );
                }}
              >
                <Copy className="size-4" />
                Link
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  startTransition(() => {
                    void revokeOrgInvitation(invite.id);
                  });
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
