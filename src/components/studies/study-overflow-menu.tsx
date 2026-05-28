"use client";

import { MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";

import { TrashDrawer } from "@/components/studies/trash-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TrashItem } from "@/lib/db/types";

/**
 * Study-wide overflow ⋮ menu in the chrome's top bar — to the left of the
 * global HeaderActions (theme/notifications/account). Today it only hosts
 * "Recently deleted sections" (owner-only); future study-wide actions (export,
 * archive whole study, etc.) belong here too.
 */
export function StudyOverflowMenu({
  isOwner,
  trashedSections,
  studyId,
}: {
  isOwner: boolean;
  trashedSections: TrashItem[];
  studyId: string;
}) {
  const [trashOpen, setTrashOpen] = useState(false);

  // Non-owners have no entries yet, so the trigger would be a dead end.
  if (!isOwner) {
    return null;
  }

  const trashedCount = trashedSections.length;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Study menu"
            className="text-muted-foreground"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              // Keep the menu out of the way so the right-side drawer can
              // render on top without focus fighting Radix's auto-close.
              event.preventDefault();
              setTrashOpen(true);
            }}
          >
            <Trash2 className="size-4" />
            <span className="flex-1">Recently deleted sections</span>
            {trashedCount > 0 ? (
              <span className="text-xs text-muted-foreground">
                {String(trashedCount)}
              </span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TrashDrawer
        open={trashOpen}
        onOpenChange={setTrashOpen}
        kind="section"
        items={trashedSections}
        studyId={studyId}
      />
    </>
  );
}
