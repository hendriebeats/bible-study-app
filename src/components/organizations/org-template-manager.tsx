"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { createOrgTemplate } from "@/app/organizations/actions";
import { DeleteTemplateButton } from "@/components/templates/delete-template-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOOKS } from "@/lib/scripture/books";
import type { Genre, StudyTemplate } from "@/lib/db/types";

export function OrgTemplateManager({
  templates,
  genres,
  overriddenOrdinals,
}: {
  templates: StudyTemplate[];
  genres: Genre[];
  overriddenOrdinals: number[];
}) {
  const [name, setName] = useState("");
  const [genreId, setGenreId] = useState("");
  const [overrideBook, setOverrideBook] = useState("");
  const [pending, startTransition] = useTransition();

  const availableBooks = useMemo(() => {
    const taken = new Set(overriddenOrdinals);
    return BOOKS.filter((b) => !taken.has(b.ordinal));
  }, [overriddenOrdinals]);

  function run(promise: Promise<void>) {
    startTransition(() => {
      void promise.catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      });
    });
  }

  return (
    <div className="grid gap-5">
      {templates.length > 0 ? (
        <ul className="grid gap-1">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <Link
                href={`/studies/${t.template_study_id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {t.name}
              </Link>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {t.type === "book" ? "Book override" : "Custom"}
              </span>
              <DeleteTemplateButton
                templateStudyId={t.template_study_id}
                scope="org"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const clean = name.trim();
          if (clean === "") {
            return;
          }
          run(
            createOrgTemplate({
              type: "custom",
              name: clean,
              genreId: genreId === "" ? null : genreId,
            }),
          );
        }}
      >
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="New custom template name"
          aria-label="Custom template name"
          className="max-w-xs"
        />
        <select
          aria-label="Starter blocks (genre)"
          value={genreId}
          onChange={(event) => {
            setGenreId(event.target.value);
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">No starter blocks</option>
          {genres.map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.name} blocks
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending}>
          Add custom
        </Button>
      </form>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (overrideBook === "") {
            return;
          }
          run(
            createOrgTemplate({
              type: "book",
              bookOrdinal: Number(overrideBook),
            }),
          );
        }}
      >
        <select
          aria-label="Override a book"
          value={overrideBook}
          onChange={(event) => {
            setOverrideBook(event.target.value);
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Override a book…</option>
          {availableBooks.map((book) => (
            <option key={book.ordinal} value={book.ordinal}>
              {book.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={pending}>
          Create override
        </Button>
      </form>
    </div>
  );
}
