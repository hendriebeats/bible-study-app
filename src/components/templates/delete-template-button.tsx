"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteTemplate } from "@/app/admin/actions";
import { deleteOrgTemplate } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";

/** Deletes a template's backing study (cascades the registry row). */
export function DeleteTemplateButton({
  templateStudyId,
  scope,
}: {
  templateStudyId: string;
  scope: "app" | "org";
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            "Delete this template? Studies already created from it are unaffected.",
          )
        ) {
          return;
        }
        startTransition(() => {
          const run =
            scope === "app"
              ? deleteTemplate(templateStudyId)
              : deleteOrgTemplate(templateStudyId);
          void run.then((result) => {
            if (result.ok) {
              router.refresh();
            } else {
              toast.error(result.error);
            }
          });
        });
      }}
    >
      Delete
    </Button>
  );
}
