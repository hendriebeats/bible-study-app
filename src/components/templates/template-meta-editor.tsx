"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateAppTemplateMeta } from "@/app/admin/actions";
import { updateOrgTemplateMeta } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Inline name + description editor for a template (app or org scope).
 *
 * The editor owns the displayed name/description in local state, so once the
 * save succeeds the new meta stays visible without any page refetch. The
 * server action calls `revalidatePath` so the next navigation picks up the
 * change; `onSaved` is invoked so a containing list can mirror it in its own
 * cache if it shows the name elsewhere.
 */
export function TemplateMetaEditor({
  templateId,
  templateStudyId,
  name: initialName,
  description: initialDescription,
  scope,
  onSaved,
}: {
  templateId: string;
  templateStudyId: string;
  name: string;
  description: string | null;
  scope: "app" | "org";
  onSaved?: (patch: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [pending, startTransition] = useTransition();

  const dirty =
    name.trim() !== initialName.trim() ||
    description.trim() !== (initialDescription ?? "").trim();

  function save() {
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (cleanName === "") {
      toast.error("Name is required.");
      return;
    }
    startTransition(() => {
      const run =
        scope === "app"
          ? updateAppTemplateMeta(
              templateId,
              templateStudyId,
              cleanName,
              cleanDescription,
            )
          : updateOrgTemplateMeta(
              templateId,
              templateStudyId,
              cleanName,
              cleanDescription,
            );
      void run.then((result) => {
        if (result.ok) {
          toast.success("Saved.");
          onSaved?.({ name: cleanName, description: cleanDescription });
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        aria-label="Template name"
        maxLength={120}
        className="sm:flex-1"
      />
      <Input
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        placeholder="Description (optional)"
        aria-label="Template description"
        maxLength={200}
        className="sm:flex-1"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || !dirty}
        onClick={save}
      >
        Save
      </Button>
    </div>
  );
}
