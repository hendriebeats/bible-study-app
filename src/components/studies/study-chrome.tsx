"use client";

import { ChevronRight, Columns2, Layers, PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { StudySidebar } from "@/components/studies/study-sidebar";
import { StudyChromeContext } from "@/components/studies/study-chrome-context";
import type { StudyChromeValue } from "@/components/studies/study-chrome-context";
import { Button } from "@/components/ui/button";
import type { Genre, SectionSummary, Study, TrashItem } from "@/lib/db/types";
import { cn } from "@/lib/utils";

/**
 * The studies-page chrome: a slim Google-Docs-style top bar (sidebar toggle +
 * "Study › Section" breadcrumb on the left, the shared header actions on the
 * right), a full-width formatting toolbar row directly beneath it, and a
 * collapsible sidebar beside the full-bleed document content.
 *
 * The sidebar lives here (not in the page) so it survives section-to-section
 * navigation. The editable section title and the editor toolbar are page-level
 * (they need section data + the editor context), so the page bridges them up
 * via the `titleSlot` / `toolbarSlot` portal targets and `setCompareHref`.
 *
 * On the compare route there is no section to edit: the chrome renders in a
 * "bare" mode — no sidebar, no toolbar row, a static "Compare" crumb.
 */
export function StudyChrome({
  study,
  sections,
  isOwner,
  trashedSections,
  genres,
  isTemplate,
  templateBackHref,
  actions,
  children,
}: {
  study: Study;
  sections: SectionSummary[];
  isOwner: boolean;
  trashedSections: TrashItem[];
  genres: Genre[];
  isTemplate: boolean;
  templateBackHref: string;
  /** Server-rendered top-bar right cluster (theme, notifications, account). */
  actions: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isCompare = pathname.includes("/compare/");

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [compareHref, setCompareHref] = useState<string | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  const value = useMemo<StudyChromeValue>(
    () => ({
      sidebarOpen,
      toggleSidebar,
      titleSlot,
      toolbarSlot,
      compareHref,
      setCompareHref,
    }),
    [sidebarOpen, toggleSidebar, titleSlot, toolbarSlot, compareHref],
  );

  return (
    <StudyChromeContext.Provider value={value}>
      <div className="flex h-svh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
          {!isCompare ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={sidebarOpen ? "Hide sections" : "Show sections"}
              aria-pressed={sidebarOpen}
              onClick={toggleSidebar}
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}

          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <span className="min-w-0 truncate font-medium text-muted-foreground">
              {study.title}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
            {isCompare ? (
              <span className="truncate text-muted-foreground">Compare</span>
            ) : (
              <div ref={setTitleSlot} className="min-w-0 flex-1" />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {compareHref && !isCompare ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={compareHref}>
                  <Columns2 className="size-4" />
                  Compare
                </Link>
              </Button>
            ) : null}
            {actions}
          </div>
        </header>

        {!isCompare ? (
          <div
            ref={setToolbarSlot}
            className="shrink-0 border-b border-border/60 bg-background empty:hidden"
          />
        ) : null}

        {isTemplate ? (
          <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
            <Layers className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              You&rsquo;re editing the{" "}
              {study.is_app_template ? "app default" : "organization"} template{" "}
              <span className="font-medium">{study.title}</span>. Changes apply
              to future studies only.
            </span>
            <Link
              href={templateBackHref}
              className="shrink-0 font-medium text-primary hover:underline"
            >
              ← Back to templates
            </Link>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {!isCompare ? (
            <div
              className={cn(
                "shrink-0 overflow-hidden transition-all duration-200 ease-out",
                sidebarOpen ? "w-64" : "w-0",
              )}
            >
              <StudySidebar
                study={study}
                sections={sections}
                isOwner={isOwner}
                trashedSections={trashedSections}
                genres={genres}
              />
            </div>
          ) : null}
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </StudyChromeContext.Provider>
  );
}
