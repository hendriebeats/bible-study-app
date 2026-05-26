"use client";

import { FileText, MoreVertical, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteStudy, restoreStudy } from "@/app/studies/actions";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/avatar";
import type { StudyCoMember, StudyListItem } from "@/lib/db/studies";
import { relativeTime } from "@/lib/relative-time";

const MAX_AVATARS = 3;

function CoMemberAvatars({ members }: { members: StudyCoMember[] }) {
  const shown = members.slice(0, MAX_AVATARS);
  const extra = members.length - shown.length;
  return (
    <AvatarGroup className="shrink-0" data-size="sm">
      {shown.map((member, index) => (
        <Avatar
          key={`${member.display_name ?? "?"}-${String(index)}`}
          size="sm"
        >
          {member.avatar_url ? (
            <AvatarImage
              src={member.avatar_url}
              alt={member.display_name ?? ""}
            />
          ) : null}
          <AvatarFallback>
            {getInitials(member.display_name ?? "?")}
          </AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 ? <AvatarGroupCount>+{extra}</AvatarGroupCount> : null}
    </AvatarGroup>
  );
}

export function StudyRow({ item }: { item: StudyListItem }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative">
      <Link
        href={`/studies/${item.id}`}
        className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 pr-12 transition-colors hover:border-primary/60 hover:bg-accent/40"
      >
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{item.title}</span>
            {item.genreName ? <Badge>{item.genreName}</Badge> : null}
            {item.group ? (
              <Badge variant="outline">
                <Users />
                {item.group.name}
              </Badge>
            ) : null}
          </div>
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            Edited {relativeTime(item.updated_at)}
          </p>
        </div>
        {item.coMembers.length > 0 ? (
          <CoMemberAvatars members={item.coMembers} />
        ) : null}
      </Link>

      <div className="absolute top-1/2 right-2 -translate-y-1/2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Study options"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void deleteStudy(item.id);
                });
                toast("Study moved to trash.", {
                  action: {
                    label: "Undo",
                    onClick: () => {
                      startTransition(() => {
                        void restoreStudy(item.id);
                      });
                    },
                  },
                });
              }}
            >
              <Trash2 className="size-4" />
              Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
