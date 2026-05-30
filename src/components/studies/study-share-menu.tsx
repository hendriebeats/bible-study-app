"use client";

import { Share2, Users } from "lucide-react";
import { useState } from "react";

import { GroupInfoDialog } from "@/components/groups/group-info-dialog";
import { StudyShareDialog } from "@/components/studies/study-share-dialog";
import { Button } from "@/components/ui/button";
import type { StudyGroupInfo } from "@/lib/db/types";

type ShareDialogState =
  | { open: false }
  | { open: true; tab: "new" | "existing" };

/**
 * The study top-bar's share/group entry point — replaces the dashboard "Group
 * studies" button. One click straight to the relevant popup, no intermediate
 * dropdown step:
 *
 *   • Ungrouped study  → click opens {@link StudyShareDialog} on the "New
 *     group" tab. The dialog also exposes an "Add to existing" tab when the
 *     user has attachable groups to choose from.
 *   • In-group study   → click opens {@link GroupInfoDialog} scoped to the
 *     study's groups. Multi-group switching uses the chip selector that
 *     dialog already provides; the "+ Add to another group" chip on that
 *     same row opens `StudyShareDialog` for attach-or-create.
 *
 * Sister control: the rich-text toolbar's `GroupMembersMenu` handles per-
 * section live dock toggles (open/close a member's panel). This one handles
 * membership, invites, and sharing — different concerns, same domain.
 */
export function StudyShareMenu({
  studyId,
  isOwner,
  isOrgTemplate,
  groupContext,
  attachableGroups,
  meId,
}: {
  studyId: string;
  /** Owner-of-this-study (study-level), not group role. Includes group owners
   * when the study IS a group template. */
  isOwner: boolean;
  /** App/org templates are managed elsewhere — Share doesn't apply. */
  isOrgTemplate: boolean;
  /** Groups this study is currently attached to (or whose template it is). */
  groupContext: StudyGroupInfo[];
  /** Groups the user can attach this study to (loose memberships, minus ones
   * this study is already in). */
  attachableGroups: { id: string; name: string }[];
  meId: string;
}) {
  // Mutations are applied locally so the dropdown reflects the new state
  // immediately. Server actions still revalidatePath() so a future navigation
  // sees the same shape we computed here — no `router.refresh()` needed (the
  // project bans it for the blank-then-fill flash it causes).
  const [groups, setGroups] = useState<StudyGroupInfo[]>(groupContext);
  const [attachable, setAttachable] =
    useState<{ id: string; name: string }[]>(attachableGroups);
  const [shareDialog, setShareDialog] = useState<ShareDialogState>({
    open: false,
  });
  const [infoOpen, setInfoOpen] = useState(false);
  // Which group GroupInfoDialog should land on when (re)opened. Tracks the
  // most recently affected group so after a create/attach the user lands on
  // the right tab inside the dialog without having to scan chips.
  const [infoGroupId, setInfoGroupId] = useState<string | null>(null);

  // Hide on read-only views and on app/org templates (those flow through the
  // admin templates UI, not this button).
  if (isOrgTemplate || !isOwner) {
    return null;
  }

  // When the study IS a group's canonical template (not just attached as a
  // member's contribution), attaching to other groups doesn't make sense —
  // templates can't be a member's personal study. Share opens GroupInfoDialog
  // for the owning group but doesn't offer attach/create.
  const isGroupTemplate = groups.some((g) => g.templateStudyId === studyId);

  const grouped = groups.length > 0;
  const TriggerIcon = grouped ? Users : Share2;
  const badge = groups.length > 1 ? groups.length : null;

  function applyAttached(fresh: StudyGroupInfo) {
    setGroups((prev) => {
      const filtered = prev.filter((g) => g.groupId !== fresh.groupId);
      return [...filtered, fresh];
    });
    setAttachable((prev) => prev.filter((g) => g.id !== fresh.groupId));
  }

  function handleTriggerClick() {
    if (grouped) {
      setInfoGroupId((current) => current ?? groups[0]?.groupId ?? null);
      setInfoOpen(true);
    } else {
      // Ungrouped: straight to the share dialog on its "New group" tab.
      setShareDialog({ open: true, tab: "new" });
    }
  }

  function openAddAnother() {
    // Coming from inside GroupInfoDialog. Close it so it doesn't sit behind
    // the share dialog — we'll reopen after a successful create/attach.
    setInfoOpen(false);
    // Prefer the "existing" tab when the user has attachable groups,
    // otherwise the new tab; the dialog itself also coerces this if needed.
    setShareDialog({
      open: true,
      tab: attachable.length > 0 ? "existing" : "new",
    });
  }

  function handleShareSuccess(fresh: StudyGroupInfo) {
    applyAttached(fresh);
    setShareDialog({ open: false });
    setInfoGroupId(fresh.groupId);
    setInfoOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={grouped ? "Manage group sharing" : "Share this study"}
        onClick={handleTriggerClick}
      >
        <TriggerIcon className="size-4" />
        Share
        {badge !== null ? (
          <span className="ml-1 rounded-full bg-muted px-1.5 text-caption text-muted-foreground tabular-nums">
            {badge}
          </span>
        ) : null}
      </Button>

      <StudyShareDialog
        open={shareDialog.open}
        onOpenChange={(next) => {
          if (!next) {
            setShareDialog({ open: false });
          }
        }}
        studyId={studyId}
        initialTab={shareDialog.open ? shareDialog.tab : "new"}
        attachableGroups={attachable}
        onCreated={handleShareSuccess}
        onAttached={handleShareSuccess}
      />

      {grouped ? (
        <GroupInfoDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          groups={groups}
          meId={meId}
          compareStudyId={studyId}
          compareSectionId={null}
          initialGroupId={infoGroupId ?? undefined}
          onAddAnother={isGroupTemplate ? undefined : openAddAnother}
          hideOwnStudyAction
        />
      ) : null}
    </>
  );
}
