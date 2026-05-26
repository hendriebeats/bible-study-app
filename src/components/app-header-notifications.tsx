"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  acceptInvitation,
  attachStudyToGroup,
  declineInvitation,
} from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { MyInvitation } from "@/lib/db/groups";
import type { Study } from "@/lib/db/types";

/** Shared "use an existing study or seed a new one from the template" picker. */
function AttachChooser({
  studies,
  pending,
  confirmLabel,
  onConfirm,
}: {
  studies: Study[];
  pending: boolean;
  confirmLabel: string;
  onConfirm: (studyId: string | null) => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");

  return (
    <div className="mt-2 grid gap-2">
      <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
        <input
          type="radio"
          checked={mode === "new"}
          onChange={() => {
            setMode("new");
          }}
          className="mt-1"
        />
        <span>Start a new study from the group&rsquo;s template</span>
      </label>

      {studies.length > 0 ? (
        <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <input
            type="radio"
            checked={mode === "existing"}
            onChange={() => {
              setMode("existing");
            }}
            className="mt-1"
          />
          <span className="min-w-0 flex-1">
            <span className="block">Use one of my existing studies</span>
            <select
              aria-label="Choose a study"
              value={studyId}
              onChange={(event) => {
                setStudyId(event.target.value);
                setMode("existing");
              }}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
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

      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          onConfirm(mode === "existing" && studyId !== "" ? studyId : null);
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

function LooseGroupItem({
  group,
  studies,
}: {
  group: { id: string; name: string };
  studies: Study[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function attach(studyId: string | null) {
    startTransition(() => {
      void attachStudyToGroup(group.id, studyId).then((result) => {
        if (result.ok) {
          toast.success(`Study attached to ${group.name}.`);
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm">
        <span className="font-medium">{group.name}</span> has no study attached
        yet.
      </p>
      {open ? (
        <AttachChooser
          studies={studies}
          pending={pending}
          confirmLabel="Attach study"
          onConfirm={attach}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            setOpen(true);
          }}
        >
          Attach a study
        </Button>
      )}
    </div>
  );
}

function InvitationItem({
  invitation,
  studies,
}: {
  invitation: MyInvitation;
  studies: Study[];
}) {
  const [accepting, setAccepting] = useState(false);
  const [pending, startTransition] = useTransition();

  function accept(studyId: string | null) {
    startTransition(() => {
      // acceptInvitation only returns a value on failure; success redirects.
      void acceptInvitation(invitation.token, studyId).then((result) => {
        if (result) {
          toast.error(result.error);
        }
      });
    });
  }

  function decline() {
    startTransition(() => {
      void declineInvitation(invitation.token).then((result) => {
        if (result.ok) {
          toast("Invitation declined.");
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm">
        You&rsquo;re invited to join{" "}
        <span className="font-medium">{invitation.groupName}</span>.
      </p>
      {accepting ? (
        <AttachChooser
          studies={studies}
          pending={pending}
          confirmLabel="Join group"
          onConfirm={accept}
        />
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              setAccepting(true);
            }}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={decline}
          >
            Decline
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Top-bar notifications: a bell that only badges when there's something to act
 * on — group studies with no study attached, and pending invitations to join.
 */
export function AppHeaderNotifications({
  looseGroups,
  invitations,
  myStudies,
}: {
  looseGroups: { id: string; name: string }[];
  invitations: MyInvitation[];
  myStudies: Study[];
}) {
  const [open, setOpen] = useState(false);
  const count = looseGroups.length + invitations.length;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative rounded-full"
        aria-label={
          count > 0 ? `Notifications (${String(count)})` : "Notifications"
        }
        onClick={() => {
          setOpen(true);
        }}
      >
        <Bell className="size-4" />
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground">
            {count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 bg-foreground/20 motion-safe:animate-in motion-safe:fade-in"
            onClick={() => {
              setOpen(false);
            }}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-lg motion-safe:animate-in motion-safe:slide-in-from-right sm:w-96">
            <header className="flex items-center justify-between p-4">
              <span className="font-semibold">Notifications</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Close"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X className="size-4" />
              </Button>
            </header>
            <Separator />
            <div className="flex-1 space-y-3 overflow-auto p-3">
              {count === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  You&rsquo;re all caught up.
                </p>
              ) : (
                <>
                  {invitations.map((invitation) => (
                    <InvitationItem
                      key={invitation.token}
                      invitation={invitation}
                      studies={myStudies}
                    />
                  ))}
                  {looseGroups.map((group) => (
                    <LooseGroupItem
                      key={group.id}
                      group={group}
                      studies={myStudies}
                    />
                  ))}
                </>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
