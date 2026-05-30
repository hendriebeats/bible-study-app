"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveOrgVerification,
  rejectOrgVerification,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function OrgReviewPanel({ orgId }: { orgId: string }) {
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(() => {
              void approveOrgVerification(orgId).then((result) => {
                if (result.ok) {
                  toast.success("Organization verified.");
                  router.push("/admin/organizations");
                } else {
                  toast.error(result.error);
                }
              });
            });
          }}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            setShowReject((v) => !v);
          }}
        >
          Reject
        </Button>
      </div>

      {showReject ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => {
              void rejectOrgVerification(orgId, reason).then((result) => {
                if (result.ok) {
                  toast.success("Organization rejected.");
                  router.push("/admin/organizations");
                } else {
                  toast.error(result.error);
                }
              });
            });
          }}
        >
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder="Reason for rejection (shown to the organization)"
            rows={3}
            maxLength={500}
            className="min-h-20 rounded-md border bg-background px-3 py-2 text-ui outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div>
            <Button type="submit" variant="destructive" disabled={pending}>
              Confirm rejection
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
