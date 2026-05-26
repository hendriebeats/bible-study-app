"use client";

import { Megaphone, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { dismissAnnouncement } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import type { OrgAnnouncement } from "@/lib/db/types";

export function AnnouncementFeed({
  announcements,
}: {
  announcements: OrgAnnouncement[];
}) {
  const [items, setItems] = useState(announcements);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return null;
  }

  function dismiss(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
    startTransition(() => {
      void dismissAnnouncement(id).then((result) => {
        if (!result.ok) {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <div className="mt-6 grid gap-2">
      {items.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
        >
          <Megaphone className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{a.body}</p>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss announcement"
            disabled={pending}
            onClick={() => {
              dismiss(a.id);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
