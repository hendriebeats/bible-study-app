"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { submitOrgVerification } from "@/app/organizations/actions";
import { OrgStatusBadge } from "@/components/organizations/org-status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Organization } from "@/lib/db/types";

export function VerificationForm({ org }: { org: Organization }) {
  const [note, setNote] = useState(org.verification_note ?? "");
  const [pending, startTransition] = useTransition();

  const isPending = org.verification_status === "pending";
  const isVerified = org.verification_status === "verified";
  const missingContact = !org.contact_email?.trim();

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <OrgStatusBadge status={org.verification_status} />
      </div>

      {org.verification_status === "rejected" &&
      org.verification_reject_reason ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-ui text-destructive">
          Rejected: {org.verification_reject_reason}
        </p>
      ) : null}

      {isVerified ? (
        <p className="text-ui text-muted-foreground">
          Your organization is verified. You can list it publicly above.
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => {
              void submitOrgVerification(note).then((result) => {
                if (result.ok) {
                  toast.success("Submitted for review.");
                } else {
                  toast.error(result.error);
                }
              });
            });
          }}
        >
          <p className="text-ui text-muted-foreground">
            We&rsquo;ll submit your profile — name, address, website, and
            contact email — for review.
            {isPending
              ? " Your submission is being reviewed; you can add a note and resubmit."
              : " Make sure those are filled in the Profile section above."}
          </p>
          {missingContact ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-ui text-muted-foreground">
              Tip: add a contact email to your profile so reviewers can reach
              you.
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="v-note">Anything else? (optional)</Label>
            <textarea
              id="v-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              rows={3}
              maxLength={1000}
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-ui outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending
                ? "Submitting…"
                : isPending
                  ? "Resubmit"
                  : "Submit for verification"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
