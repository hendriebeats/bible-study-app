"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { acceptInvitation } from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { Study } from "@/lib/db/types";

/**
 * The invitation accept surface. Tuned for Persona A — the invitee who has
 * no existing study to attach (the vast majority): a single dominant "Join
 * group" button seeds from the group's template and lands them on it.
 *
 * Power users with an existing study they'd rather contribute reveal the
 * picker via a small text link below the primary button. Once the picker is
 * open, the primary CTA switches to "Join with this study" and they can also
 * back out via "Use the template instead". Hidden entirely when the invitee
 * has no owned studies — no point teasing an option they can't act on.
 */
export function AcceptForm({
  token,
  groupName,
  studies,
}: {
  token: string;
  groupName: string;
  studies: Study[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  function accept(mode: "seed" | "existing") {
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
        You&rsquo;ve been invited to join{" "}
        <span className="font-medium text-foreground">{groupName}</span>.
      </p>

      {pickerOpen ? (
        <>
          <div className="grid gap-1.5">
            <p className="text-ui font-medium text-muted-foreground">
              Pick a study to attach
            </p>
            <ul className="grid max-h-72 gap-1.5 overflow-y-auto">
              {studies.map((study) => {
                const checked = studyId === study.id;
                return (
                  <li key={study.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-ui transition-colors",
                        checked
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="attach-study"
                        checked={checked}
                        onChange={() => {
                          setStudyId(study.id);
                        }}
                        disabled={pending}
                        className="size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{study.title}</span>
                        <span
                          className="block text-caption text-muted-foreground"
                          suppressHydrationWarning
                        >
                          Edited {relativeTime(study.updated_at)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <Button
            type="button"
            disabled={pending || studyId === ""}
            onClick={() => {
              accept("existing");
            }}
            className="w-full"
          >
            Join with this study
          </Button>
          <button
            type="button"
            onClick={() => {
              setPickerOpen(false);
            }}
            className="self-center text-ui text-muted-foreground underline hover:text-foreground"
          >
            Use the template instead
          </button>
        </>
      ) : (
        <>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              accept("seed");
            }}
            className="w-full"
          >
            Join group
          </Button>
          {studies.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setPickerOpen(true);
              }}
              className="self-center text-ui text-muted-foreground underline hover:text-foreground"
            >
              Already have a study you&rsquo;d rather use? Pick from your
              studies
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
