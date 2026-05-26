import type { Metadata } from "next";
import { ChevronRight, Layers } from "lucide-react";
import Link from "next/link";

import { NewGenreForm } from "@/components/admin/new-genre-form";
import { countTemplatesByGenre, listGenres } from "@/lib/db/genres";

export const metadata: Metadata = { title: "Admin · Genres" };

export default async function AdminGenresPage() {
  const [genres, counts] = await Promise.all([
    listGenres(),
    countTemplatesByGenre(),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Layers className="size-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Genre templates</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        The default study-block sets new sections start from, organized by
        genre. Editing these changes the defaults for future studies.
      </p>

      <div className="mt-6">
        <NewGenreForm />
      </div>

      <ul className="mt-6 divide-y rounded-lg border">
        {genres.map((genre) => {
          const count = counts.get(genre.id) ?? 0;
          return (
            <li key={genre.id}>
              <Link
                href={`/admin/genres/${genre.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{genre.name}</p>
                  {genre.description ? (
                    <p className="truncate text-sm text-muted-foreground">
                      {genre.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {count} block{count === 1 ? "" : "s"}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
