"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { submitOrgVerification } from "@/app/organizations/actions";
import { OrgStatusBadge } from "@/components/organizations/org-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Organization } from "@/lib/db/types";

export function VerificationForm({ org }: { org: Organization }) {
  const [officialName, setOfficialName] = useState(
    org.verification_official_name ?? "",
  );
  const [website, setWebsite] = useState(org.verification_website ?? "");
  const [contactEmail, setContactEmail] = useState(
    org.verification_contact_email ?? "",
  );
  const [note, setNote] = useState(org.verification_note ?? "");
  const [pending, startTransition] = useTransition();

  const isPending = org.verification_status === "pending";
  const isVerified = org.verification_status === "verified";

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <OrgStatusBadge status={org.verification_status} />
      </div>

      {org.verification_status === "rejected" &&
      org.verification_reject_reason ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Rejected: {org.verification_reject_reason}
        </p>
      ) : null}

      {isVerified ? (
        <p className="text-sm text-muted-foreground">
          Your organization is verified. You can list it publicly in settings.
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (officialName.trim() === "" || contactEmail.trim() === "") {
              toast.error("Official name and contact email are required.");
              return;
            }
            startTransition(() => {
              void submitOrgVerification({
                officialName,
                website,
                contactEmail,
                note,
              }).then((result) => {
                if (result.ok) {
                  toast.success("Submitted for review.");
                } else {
                  toast.error(result.error);
                }
              });
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Submit your organization&apos;s details for review by our team.
            {isPending
              ? " Your submission is being reviewed — you can update and resubmit."
              : ""}
          </p>
          <div className="grid gap-2">
            <Label htmlFor="v-name">Official name</Label>
            <Input
              id="v-name"
              value={officialName}
              onChange={(event) => {
                setOfficialName(event.target.value);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v-website">Website</Label>
            <Input
              id="v-website"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v-email">Contact email</Label>
            <Input
              id="v-email"
              type="email"
              value={contactEmail}
              onChange={(event) => {
                setContactEmail(event.target.value);
              }}
            />
          </div>
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
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
