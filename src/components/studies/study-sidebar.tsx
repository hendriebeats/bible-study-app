"use client";

import {
  ChevronDown,
  History,
  MoreVertical,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  createSection,
  deleteSection,
  type NewSectionSource,
  restoreSection,
  setStudyGenre,
} from "@/app/studies/actions";
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import { TrashButton } from "@/components/studies/trash-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Genre, SectionSummary, Study, TrashItem } from "@/lib/db/types";
import { cn } from "@/lib/utils";

/**
 * What the "Add section" sidebar control can seed a new section from. Computed
 * server-side in the study layout (template doc vs. the last existing section's
 * blocks). When both sources exist AND structurally differ, the trigger becomes
 * a chooser dropdown; otherwise it stays a plain button (defaults to template).
 */
export interface AddSectionSources {
  hasTemplate: boolean;
  hasPrevious: boolean;
  sourcesDiffer: boolean;
}

export function StudySidebar({
  study,
  sections,
  isOwner,
  trashedSections,
  genres,
  addSectionSources,
  onCollapse,
}: {
  study: Study;
  sections: SectionSummary[];
  isOwner: boolean;
  trashedSections: TrashItem[];
  genres: Genre[];
  addSectionSources: AddSectionSources;
  /** Collapse the sidebar (the re-open control then floats over the body). */
  onCollapse: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const chrome = useStudyChrome();
  const [pending, startTransition] = useTransition();

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
            className="text-xs font-medium text-muted-foreground"
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
            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
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
            const title =
              chrome?.sectionTitleOverrides[section.id] ?? section.title;
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
                  {title}
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
          <AddSectionTrigger
            studyId={study.id}
            sources={addSectionSources}
            pending={pending}
            onCreate={(source) => {
              startTransition(() => {
                void createSection(study.id, source);
              });
            }}
          />
          <TrashButton
            kind="section"
            items={trashedSections}
            studyId={study.id}
          />
        </div>
      ) : null}
    </aside>
  );
}

/**
 * The "Add section" sidebar control. Renders a plain button when there's only
 * one source (or both sources are structurally the same, or neither exists);
 * renders a small dropdown ("Add section ▾") only when the study template and
 * the previous section's blocks actually differ — so the user is only asked
 * to choose when the choice is meaningful.
 */
function AddSectionTrigger({
  studyId: _studyId,
  sources,
  pending,
  onCreate,
}: {
  studyId: string;
  sources: AddSectionSources;
  pending: boolean;
  onCreate: (source: NewSectionSource) => void;
}) {
  const showChooser =
    sources.hasTemplate && sources.hasPrevious && sources.sourcesDiffer;
  // Defaults when no chooser: template wins when available (today's behavior);
  // otherwise fall back to "previous" (which also no-ops if neither has blocks).
  const defaultSource: NewSectionSource = sources.hasTemplate
    ? "template"
    : "previous";

  if (!showChooser) {
    return (
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={pending}
        onClick={() => {
          onCreate(defaultSource);
        }}
      >
        <Plus className="size-4" />
        Add section
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start"
          disabled={pending}
        >
          <Plus className="size-4" />
          Add section
          <ChevronDown className="ml-auto size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => {
            onCreate("template");
          }}
        >
          From study template
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onCreate("previous");
          }}
        >
          Copy from previous section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
