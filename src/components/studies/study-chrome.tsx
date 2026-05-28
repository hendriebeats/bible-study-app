"use client";

import { ChevronLeft, Layers, PanelLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { StudySidebar } from "@/components/studies/study-sidebar";
import { StudyChromeContext } from "@/components/studies/study-chrome-context";
import { StudyOverflowMenu } from "@/components/studies/study-overflow-menu";
import type { StudyChromeValue } from "@/components/studies/study-chrome-context";
import { StudyTitleControl } from "@/components/studies/study-title-control";
import { Button } from "@/components/ui/button";
import type { Genre, SectionSummary, Study, TrashItem } from "@/lib/db/types";
import { cn } from "@/lib/utils";

/**
 * The studies-page chrome: a slim Google-Docs-style top bar ("All studies" +
 * the editable study title on the left, the shared header actions on the
 * right), a full-width formatting toolbar row beneath it, and a collapsible
 * sidebar beside the full-bleed document content. The sidebar's collapse toggle
 * lives inside the sidebar; once collapsed, a floating button at the body's
 * top-left re-opens it.
 *
 * The sidebar lives here (not in the page) so it survives section-to-section
 * navigation, alongside the persistent study workspace (the dock + editor) that
 * fills `<main>`. The editor toolbar is page-level (it needs the editor
 * context), so it bridges up via the `toolbarSlot` portal target. The section
 * title now lives inside the workspace's editable "mine" panel.
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [sectionTitleOverrides, setSectionTitleOverrides] = useState<
    Record<string, string>
  >({});
  const [pendingSectionAction, setPendingSectionAction] =
    useState<StudyChromeValue["pendingSectionAction"]>(null);
  const [editorZoom, setEditorZoom] = useState(1);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  const setSectionTitle = useCallback((sectionId: string, title: string) => {
    setSectionTitleOverrides((prev) => ({ ...prev, [sectionId]: title }));
  }, []);

  const requestSectionAction = useCallback(
    (sectionId: string, kind: "rename" | "history") => {
      setPendingSectionAction({ sectionId, kind });
    },
    [],
  );

  const clearPendingSectionAction = useCallback(() => {
    setPendingSectionAction(null);
  }, []);

  const value = useMemo<StudyChromeValue>(
    () => ({
      sidebarOpen,
      toggleSidebar,
      toolbarSlot,
      sectionTitleOverrides,
      setSectionTitle,
      pendingSectionAction,
      requestSectionAction,
      clearPendingSectionAction,
      editorZoom,
      setEditorZoom,
    }),
    [
      sidebarOpen,
      toggleSidebar,
      toolbarSlot,
      sectionTitleOverrides,
      setSectionTitle,
      pendingSectionAction,
      requestSectionAction,
      clearPendingSectionAction,
      editorZoom,
    ],
  );

  return (
    <StudyChromeContext.Provider value={value}>
      <div className="flex h-svh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
          >
            <Link href="/dashboard">
              <ChevronLeft className="size-4" />
              All studies
            </Link>
          </Button>

          <div className="flex min-w-0 flex-1 items-center">
            <StudyTitleControl
              key={study.title}
              studyId={study.id}
              title={study.title}
              canEdit={isOwner}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <StudyOverflowMenu
              isOwner={isOwner}
              trashedSections={trashedSections}
              studyId={study.id}
            />
            {actions}
          </div>
        </header>

        {/*
         * Toolbar slot. For owners we always reserve the toolbar row's height
         * with `min-h-12`; the slot is initially empty and `<StudyToolbarPortal>`
         * mounts the real toolbar into it once an editor view registers.
         * `<StudiesLoadingOverlay>` (a sibling of the studies-layout Suspense)
         * covers this row with a persistent `<ToolbarSkeleton />` until then,
         * so the user sees skeleton → real toolbar fade-out (not skeleton →
         * empty → toolbar). For non-owners the portal never mounts; the slot
         * stays empty and `empty:hidden` collapses the row entirely.
         */}
        <div
          ref={setToolbarSlot}
          className={cn(
            "shrink-0 border-b border-border/60 bg-background",
            isOwner ? "min-h-12" : "empty:hidden",
          )}
        />

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

        <div className="relative flex min-h-0 flex-1">
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
              genres={genres}
              onCollapse={toggleSidebar}
            />
          </div>

          {/* Definite-height flex parent (not overflow-auto) so the workspace
              dock can size itself; per-panel scrolling lives on the panels.
              `bg-white` matches the persistent `<StudiesLoadingOverlay>`'s
              body region so the fade-out reveals the same color underneath
              (no warm-cream-to-white snap when the overlay clears).

              The inner wrapper carries the editor zoom: CSS `zoom` is true
              browser-style magnification (reflows layout, scales everything
              including padding/borders/images/section title), unlike a
              `transform` which would only visually rescale and break click
              coords. The wrapper isolates the zoom to `<main>`'s content so
              the top bar, toolbar, and section sidebar stay native size and
              every panel in the dock — including read-along member panels —
              scales together. ProseMirror's coordinate APIs are zoom-aware
              (getBoundingClientRect), so the selection bubble + slash menu
              still position correctly. */}
          <main className="flex min-h-0 min-w-0 flex-1 bg-white">
            <div
              className="flex min-h-0 min-w-0 flex-1"
              style={{ zoom: editorZoom }}
            >
              {children}
            </div>
          </main>

          {/* Sidebar collapsed: a floating re-open button at the body's top-left. */}
          {!sidebarOpen ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Show sections"
              onClick={toggleSidebar}
              className="absolute top-3 left-3 z-20 shadow-sm"
            >
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </StudyChromeContext.Provider>
  );
}
