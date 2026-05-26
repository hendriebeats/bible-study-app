"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  approveJoinRequest,
  denyJoinRequest,
} from "@/app/organizations/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/avatar";
import type { OrgJoinRequest } from "@/lib/db/types";

export function JoinRequestList({ requests }: { requests: OrgJoinRequest[] }) {
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No pending requests.</p>
    );
  }

  return (
    <ul className="grid gap-2">
      {requests.map((req) => {
        const trimmed = req.display_name?.trim() ?? "";
        const name = trimmed === "" ? "Someone" : trimmed;
        return (
          <li
            key={req.id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
          >
            <Avatar className="size-8 shrink-0">
              {req.avatar_url ? (
                <AvatarImage src={req.avatar_url} alt={name} />
              ) : null}
              <AvatarFallback>{getInitials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{name}</p>
              {req.note ? (
                <p className="truncate text-sm text-muted-foreground">
                  {req.note}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void approveJoinRequest(req.id).then((result) => {
                    if (!result.ok) {
                      toast.error(result.error);
                    }
                  });
                });
              }}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void denyJoinRequest(req.id).then((result) => {
                    if (!result.ok) {
                      toast.error(result.error);
                    }
                  });
                });
              }}
            >
              Deny
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
