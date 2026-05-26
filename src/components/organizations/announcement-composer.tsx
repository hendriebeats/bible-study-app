"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { postOrgAnnouncement } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";

export function AnnouncementComposer() {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const clean = body.trim();
        if (clean === "") {
          return;
        }
        startTransition(() => {
          void postOrgAnnouncement(clean).then((result) => {
            if (result.ok) {
              setBody("");
              toast.success("Announcement posted.");
            } else {
              toast.error(result.error);
            }
          });
        });
      }}
    >
      <textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        placeholder="Share an announcement with your members…"
        rows={2}
        maxLength={1000}
        className="min-h-16 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : "Post announcement"}
        </Button>
      </div>
    </form>
  );
}
