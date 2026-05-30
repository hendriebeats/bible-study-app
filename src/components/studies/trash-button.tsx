"use client";

import { RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { restoreSection, restoreStudy } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { TrashItem } from "@/lib/db/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: string): number {
  const remaining = new Date(deletedAt).getTime() + 30 * DAY_MS - Date.now();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

/** Human label for the auto-archive countdown ("1 day left", not "1 days").
 * Exported so the full-screen `<SectionTrashPanel>` can reuse the same copy. */
export function daysLeftLabel(deletedAt: string): string {
  const days = daysLeft(deletedAt);
  if (days === 0) {
    return "Archiving soon";
  }
  return days === 1 ? "1 day left" : `${String(days)} days left`;
}

interface TrashCoreProps {
  kind: "study" | "section";
  items: TrashItem[];
  studyId?: string;
}

/**
 * Controlled right-side drawer listing trashed studies (dashboard) or sections
 * (a study). Each row is restorable until it's auto-archived after 30 days;
 * nothing is ever permanently deleted from here. Used by {@link TrashButton}
 * for legacy in-place launches, and by the study top-bar ⋮ menu in the chrome.
 */
export function TrashDrawer({
  open,
  onOpenChange,
  kind,
  items,
  studyId,
}: TrashCoreProps & {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  // Close the drawer on Escape while it's open.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  function restore(id: string) {
    startTransition(() => {
      if (kind === "study") {
        void restoreStudy(id);
      } else if (studyId) {
        void restoreSection(id, studyId);
      }
    });
    toast.success(kind === "study" ? "Study restored." : "Section restored.");
  }

  if (!open) {
    return null;
  }

  const title =
    kind === "study" ? "Recently deleted studies" : "Recently deleted sections";

  return (
    <>
      <button
        type="button"
        aria-label="Close trash"
        className="fixed inset-0 z-40 bg-foreground/20 motion-safe:animate-in motion-safe:fade-in"
        onClick={() => {
          onOpenChange(false);
        }}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-lg motion-safe:animate-in motion-safe:slide-in-from-right sm:w-96">
        <header className="flex items-center justify-between p-4">
          <span className="font-semibold">{title}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <X className="size-4" />
          </Button>
        </header>
        <Separator />
        <div className="flex-1 overflow-auto p-2">
          {items.length === 0 ? (
            <p className="p-2 text-caption text-muted-foreground">
              Nothing here. Deleted {kind === "study" ? "studies" : "sections"}{" "}
              stay restorable for 30 days.
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-ui font-medium">{item.title}</p>
                    <p className="text-caption text-muted-foreground">
                      {daysLeftLabel(item.deleted_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      restore(item.id);
                    }}
                  >
                    <RotateCcw className="size-4" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Self-contained Trash entry: a ghost button that opens {@link TrashDrawer}.
 * Used on the dashboard (kind="study"). Per-study trash launches directly from
 * the study sidebar footer instead — see `study-sidebar.tsx`.
 */
export function TrashButton(props: TrashCoreProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        Trash{props.items.length > 0 ? ` (${String(props.items.length)})` : ""}
      </Button>
      <TrashDrawer {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
