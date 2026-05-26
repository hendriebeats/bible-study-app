"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { acceptOrgInvitation } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import type { OrgRole } from "@/lib/db/types";

export function OrgAcceptForm({
  token,
  organizationName,
  role,
}: {
  token: string;
  organizationName: string;
  role: OrgRole;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">
        You&apos;ve been invited to join{" "}
        <span className="font-medium text-foreground">{organizationName}</span>{" "}
        as {role === "member" ? "a member" : `an ${role.replace("_", " ")}`}.
      </p>
      <p className="text-sm text-muted-foreground">
        You can belong to one organization at a time.
      </p>
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            void acceptOrgInvitation(token).then((result) => {
              // Only resolves (vs. redirecting) when it failed.
              if (result) {
                toast.error(result.error);
              }
            });
          });
        }}
      >
        {pending ? "Joining…" : "Join organization"}
      </Button>
    </div>
  );
}
