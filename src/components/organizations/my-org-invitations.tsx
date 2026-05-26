"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  acceptOrgInvitation,
  declineOrgInvitation,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import type { MyOrgInvitation } from "@/lib/db/organizations";

export function MyOrgInvitations({
  invitations,
}: {
  invitations: MyOrgInvitation[];
}) {
  const [pending, startTransition] = useTransition();

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Invitations
      </h2>
      {invitations.map((invite) => (
        <div
          key={invite.token}
          className="flex items-center gap-3 rounded-lg border bg-card p-3"
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{invite.organizationName}</span>
            <span className="text-muted-foreground"> · {invite.role}</span>
          </span>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              startTransition(() => {
                void acceptOrgInvitation(invite.token).then((result) => {
                  // Only resolves (vs. redirecting) when it failed.
                  if (result) {
                    toast.error(result.error);
                  }
                });
              });
            }}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              startTransition(() => {
                void declineOrgInvitation(invite.token).then((result) => {
                  if (!result.ok) {
                    toast.error(result.error);
                  }
                });
              });
            }}
          >
            Decline
          </Button>
        </div>
      ))}
    </div>
  );
}
