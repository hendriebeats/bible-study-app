"use client";

import { Plus } from "lucide-react";
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
 * study (the toolbar members menu, the top-bar Share button) or the groups
 * list. When the subject belongs to more than one group, a chip selector
 * switches between them. When the caller supplies `onAddAnother`, the same
 * chip row exposes a "+ Add to another group" button — letting the in-study
 * Share flow surface attach-to-another-group without a separate dropdown step.
 */
export function GroupInfoDialog({
  open,
  onOpenChange,
  groups,
  meId,
  compareStudyId,
  compareSectionId,
  initialGroupId,
  onAddAnother,
  hideOwnStudyAction = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: StudyGroupInfo[];
  meId: string;
  compareStudyId?: string | null;
  compareSectionId?: string | null;
  /** Which group to focus on open. Falls back to `groups[0]` when omitted or
   * stale (e.g. the group was removed). */
  initialGroupId?: string;
  /** When provided, the chip row shows a "+ Add to another group" button.
   * Called when the user clicks it. */
  onAddAnother?: () => void;
  /** Forwarded to {@link GroupInfoPanel}: hides the Open/Start/Restore
   * own-study action when the dialog is opened from an in-study context. */
  hideOwnStudyAction?: boolean;
}) {
  const [activeGroupId, setActiveGroupId] = useState(
    initialGroupId ?? groups[0]?.groupId ?? "",
  );
  // Re-focus when the caller changes which group to land on — e.g. right
  // after a successful create/attach we want to land the user inside the
  // newly-created group. The React-recommended "derive state from changing
  // props" pattern (compare-during-render) avoids the cascading-render
  // pitfall of doing this in an effect.
  const [seenInitialId, setSeenInitialId] = useState(initialGroupId);
  if (initialGroupId !== seenInitialId) {
    setSeenInitialId(initialGroupId);
    if (initialGroupId !== undefined) {
      setActiveGroupId(initialGroupId);
    }
  }
  const active =
    groups.find((g) => g.groupId === activeGroupId) ?? groups[0] ?? null;

  if (!active) {
    return null;
  }

  const isOwner = active.role === "owner";

  // In-study popups pass an explicit anchor (current study + section); the
  // groups-list popup has none, so fall back to the caller's own study in this
  // group so roster names can still link into compare.
  const anchorStudyId =
    compareStudyId ?? (active.myStudyActive ? active.myStudyId : null);
  const anchorSectionId = compareSectionId ?? active.myFirstSectionId;

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

        {groups.length > 1 || onAddAnother !== undefined ? (
          // Segmented-control treatment: connected pills inside a single
          // muted container, the active one filled. Sits beside an outboard
          // "+ Add group" pill so the switcher reads as one decision and
          // adding-a-group reads as a separate action. Single-group state
          // hides the switcher entirely (the dialog title already names the
          // group) and shows just the add pill.
          <div className="flex flex-wrap items-center gap-2">
            {groups.length > 1 ? (
              <div
                role="tablist"
                aria-label="Switch group"
                className="inline-flex rounded-md bg-muted p-0.5"
              >
                {groups.map((g) => {
                  const isActive = g.groupId === active.groupId;
                  return (
                    <button
                      key={g.groupId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveGroupId(g.groupId);
                      }}
                      className={cn(
                        "rounded-sm px-2.5 py-1 text-ui font-medium transition-colors",
                        isActive
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g.groupName}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {onAddAnother !== undefined ? (
              <button
                type="button"
                onClick={onAddAnother}
                className="inline-flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-ui text-muted-foreground hover:bg-muted"
              >
                <Plus className="size-3.5" />
                Add group
              </button>
            ) : null}
          </div>
        ) : null}

        <GroupInfoPanel
          groupId={active.groupId}
          role={active.role}
          templateStudyId={active.templateStudyId}
          members={active.members}
          invitations={active.invitations}
          meId={meId}
          myStudyId={active.myStudyId}
          myStudyActive={active.myStudyActive}
          compareStudyId={anchorStudyId}
          compareSectionId={anchorSectionId}
          hideOwnStudyAction={hideOwnStudyAction}
        />
      </DialogContent>
    </Dialog>
  );
}
