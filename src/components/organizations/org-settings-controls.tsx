"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  setOrgJoinPolicy,
  setOrgVisibility,
} from "@/app/organizations/actions";
import { Label } from "@/components/ui/label";
import type { OrgJoinPolicy, OrgVisibility } from "@/lib/db/types";

export function OrgSettingsControls({
  orgId,
  visibility,
  joinPolicy,
  verified,
}: {
  orgId: string;
  visibility: OrgVisibility;
  joinPolicy: OrgJoinPolicy;
  verified: boolean;
}) {
  const [vis, setVis] = useState(visibility);
  const [policy, setPolicy] = useState(joinPolicy);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="visibility">Visibility</Label>
        <select
          id="visibility"
          value={vis}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value as OrgVisibility;
            const prev = vis;
            setVis(next);
            startTransition(() => {
              void setOrgVisibility(orgId, next).then((result) => {
                if (result.ok) {
                  toast.success("Visibility updated.");
                } else {
                  setVis(prev);
                  toast.error(result.error);
                }
              });
            });
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="unlisted">Unlisted — invite only</option>
          <option value="public" disabled={!verified}>
            Public — listed in search{verified ? "" : " (verify first)"}
          </option>
        </select>
        {!verified ? (
          <p className="text-xs text-muted-foreground">
            Only verified organizations can be listed publicly.
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="join-policy">Join policy</Label>
        <select
          id="join-policy"
          value={policy}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value as OrgJoinPolicy;
            const prev = policy;
            setPolicy(next);
            startTransition(() => {
              void setOrgJoinPolicy(orgId, next).then((result) => {
                if (result.ok) {
                  toast.success("Join policy updated.");
                } else {
                  setPolicy(prev);
                  toast.error(result.error);
                }
              });
            });
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="request">Request — an admin approves each join</option>
          <option value="open">Open — anyone can join instantly</option>
        </select>
      </div>
    </div>
  );
}
