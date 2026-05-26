"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { StudyRow } from "@/components/studies/study-row";
import { Input } from "@/components/ui/input";
import type { StudyListItem } from "@/lib/db/studies";
import type { Genre } from "@/lib/db/types";

export function StudiesList({
  items,
  genres,
}: {
  items: StudyListItem[];
  genres: Genre[];
}) {
  const [query, setQuery] = useState("");
  const [genreId, setGenreId] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery = q === "" || item.title.toLowerCase().includes(q);
      const matchesGenre = genreId === "all" || item.genre_id === genreId;
      return matchesQuery && matchesGenre;
    });
  }, [items, query, genreId]);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search studies…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="pl-8"
          />
        </div>
        <select
          aria-label="Filter by study type"
          value={genreId}
          onChange={(event) => {
            setGenreId(event.target.value);
          }}
          className="h-9 rounded-md border bg-background px-2 text-sm sm:w-48"
        >
          <option value="all">All types</option>
          {genres.map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No studies match your search.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => (
            <li key={item.id}>
              <StudyRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
