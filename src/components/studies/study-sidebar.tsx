"use client";

import {
  History,
  MoreVertical,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createSection,
  deleteSection,
  restoreSection,
  setStudyGenre,
} from "@/app/studies/actions";
import { SectionTrashPanel } from "@/components/studies/section-trash-panel";
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Genre, SectionSummary, Study, TrashItem } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export function StudySidebar({
  study,
  sections,
  isOwner,
  trashedSections,
  genres,
  onCollapse,
}: {
  study: Study;
  sections: SectionSummary[];
  isOwner: boolean;
  trashedSections: TrashItem[];
  genres: Genre[];
  /** Collapse the sidebar (the re-open control then floats over the body). */
  onCollapse: () => void;
}) {
  const [trashOpen, setTrashOpen] = useState(false);
  const trashedCount = trashedSections.length;
  const pathname = usePathname();
  const router = useRouter();
  const chrome = useStudyChrome();
  const [pending, startTransition] = useTransition();
  // One shared confirm dialog for the whole list — `pendingDelete` holds the
  // section id whose row triggered it (null = closed). Cheaper than mounting a
  // confirm-dialog per row and avoids stale-row state on rapid menu reopens.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  function performDelete(id: string) {
    startTransition(() => {
      void deleteSection(id, study.id);
    });
    // deleteSection redirects, so fire the toast now; Undo restores it.
    toast("Section moved to trash.", {
      action: {
        label: "Undo",
        onClick: () => {
          startTransition(() => {
            void restoreSection(id, study.id);
          });
        },
      },
    });
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex items-center border-b p-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Hide sections"
          onClick={onCollapse}
        >
          <PanelLeft className="size-4" />
        </Button>
      </div>

      {isOwner ? (
        <div className="border-b px-4 py-3">
          <label
            htmlFor="study-genre"
            className="text-caption font-medium text-muted-foreground"
          >
            Genre
          </label>
          <select
            id="study-genre"
            value={study.genre_id ?? ""}
            disabled={pending}
            onChange={(event) => {
              const value =
                event.target.value === "" ? null : event.target.value;
              startTransition(() => {
                void setStudyGenre(study.id, value);
              });
            }}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-ui"
          >
            <option value="">No genre</option>
            {genres.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <nav className="flex-1 overflow-auto p-2">
        <ul className="grid gap-1">
          {sections.map((section) => {
            const href = `/studies/${study.id}/${section.id}`;
            const active = pathname === href;
            // Prefer the live title published while editing the section, so a
            // rename shows here as you type; fall back to the server title.
            // Blank titles render as a muted-italic "New Section" placeholder
            // (see below) so newly-created or cleared sections are still
            // identifiable in the TOC.
            const rawTitle =
              chrome?.sectionTitleOverrides[section.id] ?? section.title;
            const hasTitle = rawTitle.trim() !== "";
            // Hover/focus triggers a full RSC prefetch (including the page's
            // dynamic content), so by the time the user clicks the data is
            // usually already in the router cache and the click feels instant.
            // `<Link>`'s built-in prefetch only covers the static shell; under
            // `cacheComponents` we need this explicit call to warm dynamics.
            const prefetch = () => {
              router.prefetch(href);
            };
            return (
              <li key={section.id} className="group flex items-center gap-1">
                <Link
                  href={href}
                  onPointerEnter={prefetch}
                  onFocus={prefetch}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-3 py-2 text-ui",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50",
                  )}
                >
                  {hasTitle ? (
                    rawTitle
                  ) : (
                    <span className="italic opacity-70">New Section</span>
                  )}
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
                    {/* w-auto + min-w-fit so labels like "Version History"
                        never wrap — the popover sizes to its longest item. */}
                    <DropdownMenuContent
                      align="end"
                      className="w-auto min-w-fit"
                    >
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={() => {
                          // Set the pending action FIRST so the mine panel
                          // sees it on mount (or on the next render if we're
                          // already on this section and no nav happens).
                          chrome?.requestSectionAction(section.id, "history");
                          if (!active) {
                            router.push(href);
                          }
                        }}
                      >
                        <History className="size-4" />
                        Version History
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={() => {
                          chrome?.requestSectionAction(section.id, "rename");
                          if (!active) {
                            router.push(href);
                          }
                        }}
                      >
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={pending}
                        className="whitespace-nowrap"
                        onClick={() => {
                          // Use the display title for the confirm-dialog copy
                          // so an empty title reads as "New Section" rather
                          // than a bare quoted empty string.
                          setPendingDelete({
                            id: section.id,
                            title: hasTitle ? rawTitle : "New Section",
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                        Delete section
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
          {/* New sections are intentionally created blank — the in-section
              empty-state callout (DocumentEditor) is where the owner picks
              between Use Template / Copy from Last Section / manual. Removing
              the chooser dropdown that used to live here keeps the two paths
              from diverging. */}
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
          {/* Always rendered for owners so the restore path is discoverable.
              Disabled when the trash is empty; a Radix tooltip explains both
              what the control is and why it's currently inert. The button is
              wrapped in a span trigger because Radix tooltips don't receive
              pointer events from a natively-disabled <button>. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={trashedCount === 0}
                  onClick={() => {
                    setTrashOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                  <span className="flex-1 text-left">
                    Recently deleted sections
                  </span>
                  {trashedCount > 0 ? (
                    <span className="text-caption text-muted-foreground">
                      {String(trashedCount)}
                    </span>
                  ) : null}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              {trashedCount === 0
                ? "Sections you delete go here for 30 days, so you can restore them. Nothing's been deleted yet."
                : "Restore sections deleted in the last 30 days."}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {trashOpen ? (
        <SectionTrashPanel
          studyId={study.id}
          items={trashedSections}
          onClose={() => {
            setTrashOpen(false);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingDelete(null);
          }
        }}
        title="Delete this section?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.title ?? "This section"}
            </span>{" "}
            will move to the trash. You can restore it from &ldquo;Recently
            deleted sections&rdquo; in the sidebar.
          </>
        }
        confirmLabel="Delete section"
        destructive
        pending={pending}
        onConfirm={() => {
          if (pendingDelete) {
            performDelete(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}
