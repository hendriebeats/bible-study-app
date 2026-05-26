"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateAppTemplateMeta } from "@/app/admin/actions";
import { updateOrgTemplateMeta } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Inline name + description editor for a template (app or org scope). */
export function TemplateMetaEditor({
  templateId,
  templateStudyId,
  name: initialName,
  description: initialDescription,
  scope,
}: {
  templateId: string;
  templateStudyId: string;
  name: string;
  description: string | null;
  scope: "app" | "org";
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const dirty =
    name.trim() !== initialName.trim() ||
    description.trim() !== (initialDescription ?? "").trim();

  function save() {
    if (name.trim() === "") {
      toast.error("Name is required.");
      return;
    }
    startTransition(() => {
      const run =
        scope === "app"
          ? updateAppTemplateMeta(
              templateId,
              templateStudyId,
              name.trim(),
              description.trim(),
            )
          : updateOrgTemplateMeta(
              templateId,
              templateStudyId,
              name.trim(),
              description.trim(),
            );
      void run.then((result) => {
        if (result.ok) {
          toast.success("Saved.");
          router.refresh();
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
