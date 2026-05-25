"use client";

import { RotateCcw, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";

import { restoreSection, restoreStudy } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { TrashItem } from "@/lib/db/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: string): number {
  const remaining = new Date(deletedAt).getTime() + 30 * DAY_MS - Date.now();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

/**
 * Opens a drawer listing trashed studies (dashboard) or sections (a study),
 * each restorable until it's auto-archived after 30 days. Nothing is ever
 * permanently deleted from here.
 */
export function TrashButton({
  kind,
  items,
  studyId,
}: {
  kind: "study" | "section";
  items: TrashItem[];
  studyId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function restore(id: string) {
    startTransition(() => {
      if (kind === "study") {
        void restoreStudy(id);
      } else if (studyId) {
        void restoreSection(id, studyId);
      }
    });
  }

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
        Trash{items.length > 0 ? ` (${String(items.length)})` : ""}
      </Button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close trash"
            className="fixed inset-0 z-40 bg-foreground/20"
            onClick={() => {
              setOpen(false);
            }}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col border-l bg-card shadow-lg">
            <header className="flex items-center justify-between p-4">
              <span className="font-semibold">Trash</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Close"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X className="size-4" />
              </Button>
            </header>
            <Separator />
            <div className="flex-1 overflow-auto p-2">
              {items.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  Trash is empty.
                </p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {daysLeft(item.deleted_at)} days left
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
      ) : null}
    </>
  );
}
