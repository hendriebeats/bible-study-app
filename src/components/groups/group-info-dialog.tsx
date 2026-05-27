"use client";

import { useState } from "react";

import { GroupInfoPanel } from "@/components/groups/group-info-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StudyGroupInfo } from "@/lib/db/types";

/**
 * The group-info popup: wraps {@link GroupInfoPanel} in a dialog. Opened from a
 * study (the toolbar members menu) or anywhere a group study is selected. When
 * the subject belongs to more than one group, a selector switches between them.
 */
export function GroupInfoDialog({
  open,
  onOpenChange,
  groups,
  meId,
  compareStudyId,
  compareSectionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: StudyGroupInfo[];
  meId: string;
  compareStudyId?: string | null;
  compareSectionId?: string | null;
}) {
  const [activeGroupId, setActiveGroupId] = useState(groups[0]?.groupId ?? "");
  const active =
    groups.find((g) => g.groupId === activeGroupId) ?? groups[0] ?? null;

  if (!active) {
    return null;
  }

  const isOwner = active.role === "owner";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen w-full max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{active.groupName}</DialogTitle>
          <DialogDescription>
            {isOwner
              ? "Manage members, invite people, and edit the group template."
              : "See who's in this group and open the group template."}
          </DialogDescription>
        </DialogHeader>

        {groups.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <button
                key={g.groupId}
                type="button"
                onClick={() => {
                  setActiveGroupId(g.groupId);
                }}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  g.groupId === active.groupId
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {g.groupName}
              </button>
            ))}
          </div>
        ) : null}

        <GroupInfoPanel
          groupId={active.groupId}
          role={active.role}
          templateStudyId={active.templateStudyId}
          members={active.members}
          invitations={active.invitations}
          meId={meId}
          compareStudyId={compareStudyId}
          compareSectionId={compareSectionId}
        />
      </DialogContent>
    </Dialog>
  );
}
