"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { acceptInvitation } from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import type { Study } from "@/lib/db/types";

export function AcceptForm({
  token,
  groupName,
  studies,
}: {
  token: string;
  groupName: string;
  studies: Study[];
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  function accept() {
    const attach = mode === "existing" && studyId !== "" ? studyId : null;
    startTransition(() => {
      void acceptInvitation(token, attach).then((result) => {
        // A result is only returned on failure; success redirects.
        if (result) {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">
        You’ve been invited to join{" "}
        <span className="font-medium text-foreground">{groupName}</span>.
      </p>

      <fieldset className="grid gap-2">
        <label className="flex items-start gap-2 rounded-lg border p-3">
          <input
            type="radio"
            name="mode"
            checked={mode === "new"}
            onChange={() => {
              setMode("new");
            }}
            className="mt-1"
          />
          <span>
            <span className="block font-medium">
              Start from the group’s template
            </span>
            <span className="block text-sm text-muted-foreground">
              Creates your own study, pre-filled with the group’s sections,
              scripture, and study blocks.
            </span>
          </span>
        </label>

        {studies.length > 0 ? (
          <label className="flex items-start gap-2 rounded-lg border p-3">
            <input
              type="radio"
              name="mode"
              checked={mode === "existing"}
              onChange={() => {
                setMode("existing");
              }}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                Use one of my existing studies
              </span>
              <select
                value={studyId}
                onChange={(event) => {
                  setStudyId(event.target.value);
                  setMode("existing");
                }}
                className="mt-2 w-full rounded-md border bg-background px-2 py-1 text-sm"
              >
                {studies.map((study) => (
                  <option key={study.id} value={study.id}>
                    {study.title}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ) : null}
      </fieldset>

      <Button type="button" disabled={pending} onClick={accept}>
        Join group
      </Button>
    </div>
  );
}
