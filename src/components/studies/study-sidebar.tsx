"use client";

import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";

import { createSection } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import type { SectionSummary, Study } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export function StudySidebar({
  study,
  sections,
  user,
}: {
  study: Study;
  sections: SectionSummary[];
  user: { displayName: string; email: string; avatarUrl: string | null };
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
              <li key={section.id}>
                <Link
                  href={href}
                  className={cn(
                    "block truncate rounded-md px-3 py-2 text-sm",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50",
                  )}
                >
                  {section.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t p-2">
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
      </div>

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
