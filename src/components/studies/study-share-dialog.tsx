"use client";

import { Users } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  attachStudyToGroupNoRedirect,
  createGroupNoRedirect,
  createInvitations,
  loadGroupInfo,
} from "@/app/groups/actions";
import {
  InviteRowsForm,
  type InviteRowsFormHandle,
} from "@/components/groups/invite-rows-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StudyGroupInfo } from "@/lib/db/types";

type Tab = "new" | "existing";

/**
 * The polished "share this study" dialog: a tabbed surface that handles both
 * "start a new group from this study" (with optional batch invites) and "add
 * this study to a group I'm already in". Standardized action buttons live in
 * the dialog footer regardless of tab so the layout doesn't shift. The tabs
 * are hidden when only one path applies — a cold-start user with no existing
 * groups sees just the create form; a power user with attachable groups but
 * no desire to create new can stay on the "Add to existing" tab.
 *
 * Replaces the inline-form-in-dropdown UX with a dedicated dialog so creation
 * and management visually rhyme. Invite batching also reaches the in-group
 * manage flow via the shared {@link InviteRowsForm}.
 */
export function StudyShareDialog({
  open,
  onOpenChange,
  studyId,
  initialTab,
  attachableGroups,
  onCreated,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studyId: string;
  /** Which tab to open on. Falls back to whichever is available if the
   * requested tab has no content (e.g. "existing" with empty list). */
  initialTab: Tab;
  attachableGroups: { id: string; name: string }[];
  /** Fired with the freshly-loaded group info after a successful create. The
   * parent uses this to open the GroupInfoDialog scoped to that group. */
  onCreated: (group: StudyGroupInfo) => void;
  /** Fired after a successful attach-to-existing. Same purpose as `onCreated`. */
  onAttached: (group: StudyGroupInfo) => void;
}) {
  const hasExisting = attachableGroups.length > 0;
  // Coerce the initial tab to one that actually has content; if the caller
  // asks for "existing" but the list is empty, fall back to "new".
  const resolvedInitial: Tab =
    initialTab === "existing" && !hasExisting ? "new" : initialTab;
  const [tab, setTab] = useState<Tab>(resolvedInitial);
  const [name, setName] = useState("");
  const [selectedAttachId, setSelectedAttachId] = useState<string | null>(
    attachableGroups[0]?.id ?? null,
  );
  const inviteFormRef = useRef<InviteRowsFormHandle>(null);
  const [pending, startTransition] = useTransition();

  // Both tabs are shown only when both paths are available. When only one
  // applies the tab strip is hidden — the dialog reads as a single-purpose
  // form, which is the right framing.
  const showTabs = hasExisting;

  function close() {
    onOpenChange(false);
  }

  function reset() {
    setTab(resolvedInitial);
    setName("");
    setSelectedAttachId(attachableGroups[0]?.id ?? null);
    inviteFormRef.current?.reset();
  }

  function handleCreate() {
    const value = name.trim();
    if (value === "") {
      return;
    }
    const invites = inviteFormRef.current?.collect() ?? [];
    startTransition(async () => {
      const created = await createGroupNoRedirect(value);
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      const attach = await attachStudyToGroupNoRedirect(
        created.groupId,
        studyId,
      );
      if (!attach.ok) {
        toast.error(attach.error);
        return;
      }
      // Invites are best-effort: if the group is created and the study is
      // attached but a row fails to send, the user still has a working group
      // and we surface the partial failure as a toast instead of unwinding.
      if (invites.length > 0) {
        const inviteResult = await createInvitations(created.groupId, invites);
        if (!inviteResult.ok) {
          toast.error(
            `Group created, but invites failed: ${inviteResult.error}`,
          );
        } else {
          const emailedCount = inviteResult.results.filter(
            (r) => r.emailed,
          ).length;
          const linkOnlyCount = inviteResult.results.length - emailedCount;
          const parts: string[] = [];
          if (emailedCount > 0) {
            parts.push(`${String(emailedCount)} emailed`);
          }
          if (linkOnlyCount > 0) {
            parts.push(`${String(linkOnlyCount)} link-only`);
          }
          toast.success(
            parts.length > 0
              ? `Group created — invites ready (${parts.join(", ")}).`
              : "Group created.",
          );
        }
      } else {
        toast.success("Group created.");
      }
      const fresh = await loadGroupInfo(created.groupId);
      if (fresh) {
        onCreated(fresh);
      }
      reset();
      close();
    });
  }

  function handleAttach() {
    if (selectedAttachId === null) {
      return;
    }
    const targetId = selectedAttachId;
    startTransition(async () => {
      const result = await attachStudyToGroupNoRedirect(targetId, studyId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const fresh = await loadGroupInfo(targetId);
      if (fresh) {
        onAttached(fresh);
      }
      reset();
      close();
    });
  }

  const primaryDisabled =
    pending || (tab === "new" ? name.trim() === "" : selectedAttachId === null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tab === "new" ? "Start a new group" : "Add to a group"}
          </DialogTitle>
          <DialogDescription>
            {tab === "new"
              ? "Name the group and (optionally) invite people. You can add more later."
              : "Pick a group you're already in. This study will be attached to that group."}
          </DialogDescription>
        </DialogHeader>

        {showTabs ? (
          <div
            role="tablist"
            aria-label="Share options"
            className="flex gap-1 rounded-md bg-muted p-1 text-ui"
          >
            <TabButton
              active={tab === "new"}
              onClick={() => {
                setTab("new");
              }}
            >
              New group
            </TabButton>
            <TabButton
              active={tab === "existing"}
              onClick={() => {
                setTab("existing");
              }}
            >
              Add to existing
            </TabButton>
          </div>
        ) : null}

        {tab === "new" ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label
                htmlFor="share-group-name"
                className="text-ui font-medium text-muted-foreground"
              >
                Group name
              </label>
              <Input
                id="share-group-name"
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="e.g. Wednesday-night Bible study"
                disabled={pending}
              />
            </div>
            <div className="grid gap-1.5">
              <p className="text-ui font-medium text-muted-foreground">
                Invite people{" "}
                <span className="text-caption font-normal">(optional)</span>
              </p>
              <InviteRowsForm ref={inviteFormRef} disabled={pending} />
            </div>
          </div>
        ) : (
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto">
            {attachableGroups.map((group) => {
              const checked = selectedAttachId === group.id;
              return (
                <li key={group.id}>
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
                      name="attach-group"
                      checked={checked}
                      onChange={() => {
                        setSelectedAttachId(group.id);
                      }}
                      disabled={pending}
                      className="size-4 shrink-0"
                    />
                    <Users className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {group.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={primaryDisabled}
            onClick={tab === "new" ? handleCreate : handleAttach}
          >
            {tab === "new" ? "Create group" : "Add to group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-sm px-2.5 py-1 text-ui font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
