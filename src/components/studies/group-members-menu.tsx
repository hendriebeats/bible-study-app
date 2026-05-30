"use client";

import { Check, Info, RotateCcw, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { GroupInfoDialog } from "@/components/groups/group-info-dialog";
import { useStudyWorkspace } from "@/components/studies/study-workspace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CompareTarget } from "@/lib/db/compare";
import type { StudyGroupInfo } from "@/lib/db/types";

/**
 * The in-study group control that lives in the rich-text toolbar: a dropdown of
 * the other members in this study's group(s). Each row carries a left-side
 * checkbox that reflects whether that member's study is currently open as a
 * dock panel — clicking toggles it (open → close, close → open) and dismisses
 * the dropdown either way. A footer "Hide all members" action closes every
 * open member panel at once; a "Group info" entry opens the roster / invite /
 * template popup. Renders nothing when the study isn't in a group.
 */
export function GroupMembersMenu({
  studyId,
  sectionId,
  targets,
  groupContext,
  meId,
}: {
  studyId: string;
  sectionId: string;
  targets: CompareTarget[];
  groupContext: StudyGroupInfo[];
  meId: string;
}) {
  const workspace = useStudyWorkspace();
  const [infoOpen, setInfoOpen] = useState(false);

  // userId -> the openable study (only members with a live contributed study).
  const targetByUser = useMemo(
    () => new Map(targets.map((t) => [t.userId, t])),
    [targets],
  );

  if (groupContext.length === 0) {
    return null;
  }

  const multiGroup = groupContext.length > 1;
  const { openMemberIds, openPerson, closePerson, resetMembers } = workspace;
  const anyOpen = openMemberIds.size > 0;

  function toggleMember(target: CompareTarget, currentlyOpen: boolean) {
    if (currentlyOpen) {
      closePerson(target.studyId);
    } else {
      openPerson(target.studyId);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Group members"
          >
            <Users className="size-4" />
            Group
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {groupContext.map((group) => {
            const others = group.members.filter((m) => m.user_id !== meId);
            return (
              <div key={group.groupId}>
                {multiGroup ? (
                  <DropdownMenuLabel>{group.groupName}</DropdownMenuLabel>
                ) : (
                  <DropdownMenuLabel>
                    View someone&rsquo;s study
                  </DropdownMenuLabel>
                )}
                {others.length === 0 ? (
                  <DropdownMenuItem disabled>
                    No other members yet
                  </DropdownMenuItem>
                ) : (
                  others.map((member) => {
                    const trimmed = member.display_name?.trim();
                    const name =
                      trimmed === undefined || trimmed === ""
                        ? "Member"
                        : trimmed;
                    const target = targetByUser.get(member.user_id);
                    if (!target) {
                      // No live study to view yet — leave a disabled,
                      // checkbox-less row so the alignment still reads as
                      // "list of teammates" rather than missing data.
                      return (
                        <DropdownMenuItem
                          key={member.user_id}
                          disabled
                          className="justify-between pl-7"
                        >
                          <span className="truncate">{name}</span>
                          <span className="text-caption text-muted-foreground">
                            no study yet
                          </span>
                        </DropdownMenuItem>
                      );
                    }
                    const open = openMemberIds.has(target.studyId);
                    return (
                      <DropdownMenuItem
                        key={member.user_id}
                        // role=menuitemcheckbox + aria-checked communicates the
                        // toggle semantics to a screen reader even though we
                        // use a plain MenuItem (so the indicator can live on
                        // the LEFT — shadcn's CheckboxItem floats it right).
                        role="menuitemcheckbox"
                        aria-checked={open}
                        onSelect={() => {
                          toggleMember(target, open);
                        }}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                            open
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background",
                          )}
                          aria-hidden="true"
                        >
                          {open ? <Check className="size-3" /> : null}
                        </span>
                        <span className="truncate">{name}</span>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </div>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!anyOpen}
            onSelect={() => {
              resetMembers();
            }}
          >
            <RotateCcw className="size-4 text-muted-foreground" />
            Hide all members
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setInfoOpen(true);
            }}
          >
            <Info className="size-4 text-muted-foreground" />
            Group info &amp; members
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GroupInfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        groups={groupContext}
        meId={meId}
        compareStudyId={studyId}
        compareSectionId={sectionId}
        hideOwnStudyAction
      />
    </>
  );
}
