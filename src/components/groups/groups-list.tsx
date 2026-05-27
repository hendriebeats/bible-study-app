"use client";

import { Users } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadGroupInfo } from "@/app/groups/actions";
import { GroupInfoDialog } from "@/components/groups/group-info-dialog";
import type { StudyGroupInfo } from "@/lib/db/types";

/**
 * The "my groups" list: selecting a group opens the shared group-info popup in
 * place (roster, invites, template) rather than navigating to a detail page —
 * the popup fully replaces the retired group detail route. `initialGroupId`
 * (from a `?group=` param, e.g. right after creating a group) auto-opens it.
 * The full info is fetched on demand so the list itself stays cheap.
 */
export function GroupsList({
  groups,
  meId,
  initialGroupId,
}: {
  groups: { id: string; name: string }[];
  meId: string;
  initialGroupId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<StudyGroupInfo | null>(null);
  const [open, setOpen] = useState(false);

  const select = useCallback((groupId: string) => {
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
  }, []);

  // Auto-open the popup for a `?group=` deep link (e.g. just after creating a
  // group) once on mount.
  useEffect(() => {
    if (initialGroupId) {
      select(initialGroupId);
    }
  }, [initialGroupId, select]);

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
