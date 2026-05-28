"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { deleteTemplate } from "@/app/admin/actions";
import { deleteOrgTemplate } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";

/**
 * Deletes a template's backing study (cascades the registry row). The button
 * is dumb — it dispatches the action and calls `onDeleted` on success so the
 * containing list can remove the row in place. The server action's
 * `revalidatePath` keeps the next navigation fresh.
 */
export function DeleteTemplateButton({
  templateStudyId,
  scope,
  onDeleted,
}: {
  templateStudyId: string;
  scope: "app" | "org";
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

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
              onDeleted();
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
