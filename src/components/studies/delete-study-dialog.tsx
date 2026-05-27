"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deleteStudy,
  getStudyGroupLinks,
  restoreStudy,
  type DeleteStudyMode,
} from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StudyGroupLink } from "@/lib/db/groups";
import { cn } from "@/lib/utils";

/** "A", "A and B", or "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  const last = names[names.length - 1] ?? "";
  const rest = names.slice(0, -1);
  if (rest.length === 1) {
    return `${rest[0] ?? ""} and ${last}`;
  }
  return `${rest.join(", ")}, and ${last}`;
}

/**
 * Confirmation for trashing a study that's attached to one or more groups. Names
 * the group(s) and lets the owner choose what happens to their membership:
 * keep it (restore re-attaches), unlink the study, or leave the group(s) too.
 * "Leave" is disabled for any group where they're the last owner.
 */
export function DeleteStudyDialog({
  studyId,
  studyTitle,
  open,
  onOpenChange,
}: {
  studyId: string;
  studyTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [links, setLinks] = useState<StudyGroupLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void getStudyGroupLinks(studyId).then((result) => {
      if (!cancelled) {
        setLinks(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, studyId]);

  // Reset on close (in the event handler, not the effect) so the next open
  // re-fetches from a clean loading state.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setLinks(null);
      setError(null);
      setPending(false);
    }
    onOpenChange(next);
  }

  const groupNames = (links ?? []).map((l) => l.groupName);
  const soleOwnerGroups = (links ?? []).filter((l) => l.soleOwner);
  const canLeave = (links?.length ?? 0) > 0 && soleOwnerGroups.length === 0;
  const names = joinNames(groupNames);

  async function run(mode: DeleteStudyMode) {
    setError(null);
    setPending(true);
    const result = await deleteStudy(studyId, mode);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    handleOpenChange(false);
    if (mode === "keep") {
      toast("Study moved to trash.", {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreStudy(studyId);
          },
        },
      });
    } else if (mode === "detach") {
      toast(`Study moved to trash. You're still in ${names}.`);
    } else {
      toast(`Study moved to trash. You left ${names}.`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{studyTitle}” to trash?</DialogTitle>
          <DialogDescription>
            {links === null
              ? "Checking where this study is shared…"
              : links.length === 0
                ? "This study isn’t shared with any group."
                : `Shared with ${names}. Choose what happens to your place ${
                    links.length > 1 ? "in those groups" : "in the group"
                  }.`}
          </DialogDescription>
        </DialogHeader>

        {links !== null && links.length > 0 ? (
          <div className="grid gap-2">
            <ChoiceButton
              label="Keep my place in the group"
              hint="The study goes to Trash. Restoring it puts it right back here."
              variant="outline"
              className="border-primary/50 bg-primary/5 hover:bg-primary/10"
              disabled={pending}
              onClick={() => {
                void run("keep");
              }}
            />
            <ChoiceButton
              label="Unlink the study, stay a member"
              hint="You stay in the group with no study attached — start a fresh one anytime."
              variant="outline"
              disabled={pending}
              onClick={() => {
                void run("detach");
              }}
            />
            <ChoiceButton
              label={
                links.length > 1
                  ? "Leave the groups too"
                  : "Leave the group too"
              }
              hint={
                canLeave
                  ? `Also removes you from ${names}.`
                  : `You’re the only owner of ${joinNames(
                      soleOwnerGroups.map((l) => l.groupName),
                    )} — make someone else an owner first.`
              }
              variant="destructive"
              disabled={pending || !canLeave}
              onClick={() => {
                void run("leave");
              }}
            />
          </div>
        ) : null}

        {links !== null && links.length === 0 ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              void run("keep");
            }}
          >
            Move to trash
          </Button>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({
  label,
  hint,
  variant,
  className,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  variant: "default" | "outline" | "destructive";
  className?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-auto flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal",
        className,
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs font-normal opacity-80">{hint}</span>
    </Button>
  );
}
