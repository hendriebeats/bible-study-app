"use client";

import { Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { loadGroupInfo } from "@/app/groups/actions";
import { GroupInfoDialog } from "@/components/groups/group-info-dialog";
import type { StudyGroupInfo } from "@/lib/db/types";

/**
 * The "my groups" list: selecting a group opens the shared group-info popup in
 * place (roster, invites, template) rather than navigating to a detail page.
 * The full info is fetched on demand so the list itself stays cheap.
 */
export function GroupsList({
  groups,
  meId,
}: {
  groups: { id: string; name: string }[];
  meId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<StudyGroupInfo | null>(null);
  const [open, setOpen] = useState(false);

  function select(groupId: string) {
    startTransition(() => {
      void loadGroupInfo(groupId).then(
        (info) => {
          if (info) {
            setActive(info);
            setOpen(true);
          } else {
            toast.error("Couldn't open that group.");
          }
        },
        () => {
          toast.error("Couldn't open that group.");
        },
      );
    });
  }

  return (
    <>
      <ul className="grid gap-3">
        {groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                select(group.id);
              }}
              className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left hover:bg-accent/50 disabled:opacity-60"
            >
              <Users className="size-5 text-muted-foreground" />
              <span className="font-medium">{group.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <GroupInfoDialog
          key={active.groupId}
          open={open}
          onOpenChange={setOpen}
          groups={[active]}
          meId={meId}
        />
      ) : null}
    </>
  );
}
