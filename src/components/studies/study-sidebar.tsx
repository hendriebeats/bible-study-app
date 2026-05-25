"use client";

import { BookOpen, MoreVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  createSection,
  deleteSection,
  restoreSection,
} from "@/app/studies/actions";
import { TrashButton } from "@/components/studies/trash-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserMenu } from "@/components/user-menu";
import type { SectionSummary, Study, TrashItem } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export function StudySidebar({
  study,
  sections,
  user,
  isOwner,
  trashedSections,
}: {
  study: Study;
  sections: SectionSummary[];
  user: { displayName: string; email: string; avatarUrl: string | null };
  isOwner: boolean;
  trashedSections: TrashItem[];
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="border-b p-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="size-4" />
          All studies
        </Link>
        <p className="mt-2 truncate font-semibold">{study.title}</p>
      </div>

      <nav className="flex-1 overflow-auto p-2">
        <ul className="grid gap-1">
          {sections.map((section) => {
            const href = `/studies/${study.id}/${section.id}`;
            const active = pathname === href;
            return (
              <li key={section.id} className="group flex items-center gap-1">
                <Link
                  href={href}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-3 py-2 text-sm",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50",
                  )}
                >
                  {section.title}
                </Link>
                {isOwner ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Section options"
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
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
                            void deleteSection(section.id, study.id);
                          });
                          // deleteSection redirects, so fire the toast now; Undo
                          // restores the section from the Trash.
                          toast("Section moved to trash.", {
                            action: {
                              label: "Undo",
                              onClick: () => {
                                startTransition(() => {
                                  void restoreSection(section.id, study.id);
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
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      {isOwner ? (
        <div className="grid gap-1 border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={pending}
            onClick={() => {
              startTransition(() => {
                void createSection(study.id);
              });
            }}
          >
            <Plus className="size-4" />
            Add section
          </Button>
          <TrashButton
            kind="section"
            items={trashedSections}
            studyId={study.id}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t p-3">
        <UserMenu
          displayName={user.displayName}
          email={user.email}
          avatarUrl={user.avatarUrl}
        />
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {user.displayName || user.email}
        </span>
      </div>
    </aside>
  );
}
