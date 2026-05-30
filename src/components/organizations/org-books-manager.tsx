"use client";

import { MoreHorizontal, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  customizeOrgBook,
  resetOrgBook,
  setOrgBookDisabled,
  setOrgUseDefaultLibrary,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  NEW_TESTAMENT_BOOKS,
  OLD_TESTAMENT_BOOKS,
  type BibleBook,
} from "@/lib/scripture/books";
import { cn } from "@/lib/utils";

interface BookOverride {
  ordinal: number;
  templateStudyId: string;
}

type BookState = "override" | "disabled" | "default";

export function OrgBooksManager({
  orgId,
  usesDefaults,
  overrides,
  disabledOrdinals,
}: {
  orgId: string;
  usesDefaults: boolean;
  overrides: BookOverride[];
  disabledOrdinals: number[];
}) {
  const router = useRouter();
  const [uses, setUses] = useState(usesDefaults);
  const [disabled, setDisabled] = useState<Set<number>>(
    new Set(disabledOrdinals),
  );
  // Local overrides state so `reset()` can drop a row in place without an RSC
  // refetch + blank-then-fill flash. Re-syncs when the server prop changes
  // (render-time reset, the same idiom used for `items` order below).
  const [localOverrides, setLocalOverrides] = useState(overrides);
  const [prevOverrides, setPrevOverrides] = useState(overrides);
  if (overrides !== prevOverrides) {
    setPrevOverrides(overrides);
    setLocalOverrides(overrides);
  }
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const overrideMap = useMemo(
    () => new Map(localOverrides.map((o) => [o.ordinal, o.templateStudyId])),
    [localOverrides],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (list: readonly BibleBook[]) =>
      q === "" ? list : list.filter((b) => b.name.toLowerCase().includes(q));
    return [
      { label: "New Testament", books: match(NEW_TESTAMENT_BOOKS) },
      { label: "Old Testament", books: match(OLD_TESTAMENT_BOOKS) },
    ];
  }, [query]);

  function stateOf(ordinal: number): BookState {
    if (overrideMap.has(ordinal)) return "override";
    if (!uses || disabled.has(ordinal)) return "disabled";
    return "default";
  }

  function toggleMaster() {
    const next = !uses;
    setUses(next);
    startTransition(() => {
      void setOrgUseDefaultLibrary(orgId, next).then((r) => {
        if (!r.ok) {
          setUses(!next);
          toast.error(r.error);
        }
      });
    });
  }

  function setBookDisabled(ordinal: number, value: boolean) {
    setDisabled((prev) => {
      const s = new Set(prev);
      if (value) {
        s.add(ordinal);
      } else {
        s.delete(ordinal);
      }
      return s;
    });
    startTransition(() => {
      void setOrgBookDisabled(orgId, ordinal, value).then((r) => {
        if (!r.ok) {
          toast.error(r.error);
        }
      });
    });
  }

  function customize(ordinal: number) {
    startTransition(() => {
      void customizeOrgBook(orgId, ordinal).then((result) => {
        if (result.ok) {
          router.push(result.path);
        } else {
          toast.error(result.error);
        }
      });
    });
  }

  function reset(ordinal: number) {
    const previous = localOverrides;
    setLocalOverrides((current) =>
      current.filter((o) => o.ordinal !== ordinal),
    );
    startTransition(() => {
      void resetOrgBook(orgId, ordinal).then((r) => {
        if (!r.ok) {
          setLocalOverrides(previous);
          toast.error(r.error);
        }
      });
    });
  }

  return (
    <div className="grid gap-4">
      <label className="flex items-start gap-3 rounded-lg border p-3">
        <input
          type="checkbox"
          checked={uses}
          disabled={pending}
          onChange={toggleMaster}
          className="mt-1"
        />
        <span className="text-ui">
          <span className="block font-medium">
            Use the default template library
          </span>
          <span className="block text-muted-foreground">
            When off, members get a plain genre starter for any book you
            haven&rsquo;t customized.
          </span>
        </span>
      </label>

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

      <div className="max-h-96 overflow-auto rounded-md border">
        {groups.map((group) =>
          group.books.length === 0 ? null : (
            <div key={group.label}>
              <p className="sticky top-0 bg-muted/80 px-3 py-1 text-caption font-medium text-muted-foreground backdrop-blur-sm">
                {group.label}
              </p>
              {group.books.map((book) => {
                const st = stateOf(book.ordinal);
                const overrideStudyId = overrideMap.get(book.ordinal);
                return (
                  <div
                    key={book.ordinal}
                    className="flex items-center gap-2 px-3 py-1.5 text-ui"
                  >
                    <span className="min-w-0 flex-1 truncate">{book.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-caption",
                        st === "override"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {st === "override"
                        ? "Override"
                        : st === "disabled"
                          ? "Disabled"
                          : "Default"}
                    </span>
                    {st === "override" && overrideStudyId ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/studies/${overrideStudyId}`}>Edit</Link>
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Actions for ${book.name}`}
                          disabled={pending}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {st === "override" ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              reset(book.ordinal);
                            }}
                          >
                            Reset to default
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onSelect={() => {
                                customize(book.ordinal);
                              }}
                            >
                              Customize…
                            </DropdownMenuItem>
                            {uses && st === "default" ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setBookDisabled(book.ordinal, true);
                                }}
                              >
                                Turn off (use starter)
                              </DropdownMenuItem>
                            ) : null}
                            {uses && st === "disabled" ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setBookDisabled(book.ordinal, false);
                                }}
                              >
                                Use default
                              </DropdownMenuItem>
                            ) : null}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
