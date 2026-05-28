"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createStudyFromSelection,
  loadNewStudyOptions,
} from "@/app/studies/actions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrgBookContext } from "@/lib/db/templates";
import type { StudyTemplate } from "@/lib/db/types";
import {
  NEW_TESTAMENT_BOOKS,
  OLD_TESTAMENT_BOOKS,
  type BibleBook,
} from "@/lib/scripture/books";
import { cn } from "@/lib/utils";

type Tab = "book" | "custom" | "blank";

const EMPTY_ORG_CONTEXT: OrgBookContext = {
  inOrg: false,
  usesDefaults: true,
  disabledOrdinals: [],
  overriddenOrdinals: [],
};

/**
 * The dashboard doesn't fetch the dialog's data upfront — those two extra DB
 * queries (custom templates + org book context) would block every dashboard
 * render even though most visits never open the dialog. Instead we fetch on
 * first open (or first hover/focus of the trigger, as a prefetch), and render
 * a small skeleton in the data-dependent areas while it's in flight.
 */
export function NewStudyDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("book");
  const [name, setName] = useState("");
  const [bookOrdinal, setBookOrdinal] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Lazy options state. `null` = not yet requested; once requested we keep the
  // loaded data for the rest of the page's life (no need to re-fetch on
  // subsequent opens since the dashboard list itself is the source of truth
  // for changes during the session).
  const [options, setOptions] = useState<{
    customTemplates: StudyTemplate[];
    orgContext: OrgBookContext;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedRef = useRef(false);

  function ensureOptions() {
    if (requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    setLoading(true);
    void loadNewStudyOptions()
      .then((next) => {
        setOptions(next);
      })
      .catch(() => {
        // Reset so a future open can retry. The dialog still works against the
        // empty defaults — the user just won't see org badges or templates.
        requestedRef.current = false;
      })
      .finally(() => {
        setLoading(false);
      });
  }

  const orgContext = options?.orgContext ?? EMPTY_ORG_CONTEXT;
  const customTemplates = options?.customTemplates ?? [];

  const overridden = new Set(orgContext.overriddenOrdinals);
  const disabled = new Set(orgContext.disabledOrdinals);

  function bookBadge(ordinal: number): string | null {
    if (!orgContext.inOrg) {
      return null;
    }
    if (overridden.has(ordinal)) {
      return "Org template";
    }
    if (!orgContext.usesDefaults || disabled.has(ordinal)) {
      return "Starter";
    }
    return null;
  }

  const { nt, ot } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (list: readonly BibleBook[]) =>
      q === "" ? list : list.filter((b) => b.name.toLowerCase().includes(q));
    return {
      nt: match(NEW_TESTAMENT_BOOKS),
      ot: match(OLD_TESTAMENT_BOOKS),
    };
  }, [query]);

  const canCreate =
    name.trim() !== "" &&
    (tab === "blank" ||
      (tab === "book" && bookOrdinal !== null) ||
      (tab === "custom" && templateId !== null));

  function reset() {
    setTab("book");
    setName("");
    setBookOrdinal(null);
    setTemplateId(null);
    setQuery("");
  }

  function submit() {
    if (!canCreate) {
      return;
    }
    startTransition(() => {
      void createStudyFromSelection({
        kind: tab,
        title: name.trim(),
        bookOrdinal: tab === "book" ? (bookOrdinal ?? undefined) : undefined,
        templateId: tab === "custom" ? (templateId ?? undefined) : undefined,
      }).then((result) => {
        if (result.ok) {
          router.push(result.path);
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          ensureOptions();
        } else {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          // Prefetch on hover/focus so the dialog usually has its data ready by
          // the time the user actually clicks the trigger.
          onPointerEnter={ensureOptions}
          onFocus={ensureOptions}
        >
          <Plus className="size-4" />
          New study
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New study</DialogTitle>
          <DialogDescription>
            Start from a book of the Bible, a custom template, or a blank study.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["book", "custom", "blank"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                }}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-sm font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "book" ? "Book of the Bible" : t}
              </button>
            ))}
          </div>

          {tab === "book" ? (
            <div className="grid gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search books…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  className="pl-8"
                />
              </div>
              <div className="max-h-56 overflow-auto rounded-md border">
                {[
                  { label: "New Testament", books: nt },
                  { label: "Old Testament", books: ot },
                ].map((group) =>
                  group.books.length === 0 ? null : (
                    <div key={group.label}>
                      <p className="sticky top-0 bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                        {group.label}
                      </p>
                      {group.books.map((book) => {
                        const badge = bookBadge(book.ordinal);
                        return (
                          <button
                            key={book.ordinal}
                            type="button"
                            onClick={() => {
                              setBookOrdinal(book.ordinal);
                              setName(book.name);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50",
                              bookOrdinal === book.ordinal && "bg-accent/60",
                            )}
                          >
                            <span className="flex-1">{book.name}</span>
                            {badge ? (
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                {badge}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : null}

          {tab === "custom" ? (
            <div className="max-h-56 overflow-auto rounded-md border">
              {loading && options === null ? (
                <div className="grid gap-2 p-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : customTemplates.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No custom templates available.
                </p>
              ) : (
                customTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(tmpl.id);
                      setName(tmpl.name);
                    }}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-muted/50",
                      templateId === tmpl.id && "bg-accent/60",
                    )}
                  >
                    <span className="block font-medium">{tmpl.name}</span>
                    {tmpl.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {tmpl.description}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {tab === "blank" ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              A blank study with one empty section.
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="new-study-name">Name</Label>
            <Input
              id="new-study-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="e.g. Gospel of John"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !canCreate}
            onClick={submit}
          >
            {pending ? "Creating…" : "Create study"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
