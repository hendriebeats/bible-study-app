"use client";

import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  setOrgBookDisabled,
  setOrgUseDefaultLibrary,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOOKS } from "@/lib/scripture/books";

export function TemplateLibraryControls({
  orgId,
  usesDefaults,
  disabledOrdinals,
  overriddenOrdinals,
}: {
  orgId: string;
  usesDefaults: boolean;
  disabledOrdinals: number[];
  overriddenOrdinals: number[];
}) {
  const [uses, setUses] = useState(usesDefaults);
  const [disabled, setDisabled] = useState<Set<number>>(
    new Set(disabledOrdinals),
  );
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const overridden = useMemo(
    () => new Set(overriddenOrdinals),
    [overriddenOrdinals],
  );

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === ""
      ? BOOKS
      : BOOKS.filter((b) => b.name.toLowerCase().includes(q));
  }, [query]);

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

  function toggleBook(ordinal: number) {
    const willDisable = !disabled.has(ordinal);
    setDisabled((prev) => {
      const s = new Set(prev);
      if (willDisable) {
        s.add(ordinal);
      } else {
        s.delete(ordinal);
      }
      return s;
    });
    startTransition(() => {
      void setOrgBookDisabled(orgId, ordinal, willDisable).then((r) => {
        if (!r.ok) {
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
        <span className="text-sm">
          <span className="block font-medium">Use the default library</span>
          <span className="block text-muted-foreground">
            When off, members only get your organization&rsquo;s templates;
            other books start from a genre starter.
          </span>
        </span>
      </label>

      <div className="grid gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Default book templates
        </p>
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
        <div className="max-h-72 overflow-auto rounded-md border">
          {books.map((book) => {
            const isOverridden = overridden.has(book.ordinal);
            const isDisabled = disabled.has(book.ordinal);
            return (
              <div
                key={book.ordinal}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <span className="flex-1">{book.name}</span>
                {isOverridden ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    Org override
                  </span>
                ) : !uses ? (
                  <span className="text-xs text-muted-foreground">
                    Genre starter
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      toggleBook(book.ordinal);
                    }}
                  >
                    {isDisabled ? "Enable" : "Disable"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
