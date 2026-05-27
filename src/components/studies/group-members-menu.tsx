"use client";

import { Info, Users } from "lucide-react";
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
import type { CompareTarget } from "@/lib/db/compare";
import type { StudyGroupInfo } from "@/lib/db/types";

/**
 * The in-study group control that lives in the rich-text toolbar: a dropdown of
 * the other members in this study's group(s). Picking a member opens their study
 * as a read-only panel in the dock on this page; a "Group info" entry opens the
 * roster / invite / template popup. Renders nothing when the study isn't in a
 * group.
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

  function openMember(target: CompareTarget) {
    workspace.openPerson(target.studyId);
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
                      return (
                        <DropdownMenuItem
                          key={member.user_id}
                          disabled
                          className="justify-between"
                        >
                          <span className="truncate">{name}</span>
                          <span className="text-xs text-muted-foreground">
                            no study yet
                          </span>
                        </DropdownMenuItem>
                      );
                    }
                    return (
                      <DropdownMenuItem
                        key={member.user_id}
                        onSelect={() => {
                          openMember(target);
                        }}
                      >
                        <Users className="size-4 text-muted-foreground" />
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
      />
    </>
  );
}
