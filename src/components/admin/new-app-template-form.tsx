"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createAppCustomTemplate } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Genre } from "@/lib/db/types";

export function NewAppTemplateForm({ genres }: { genres: Genre[] }) {
  const [name, setName] = useState("");
  const [genreId, setGenreId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const clean = name.trim();
        if (clean === "") {
          return;
        }
        startTransition(() => {
          void createAppCustomTemplate(
            clean,
            genreId === "" ? null : genreId,
          ).then((result) => {
            if (result.ok) {
              router.push(result.path);
            } else {
              toast.error(result.error);
            }
          });
        });
      }}
    >
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder="New custom template name"
        aria-label="Template name"
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
        Create template
      </Button>
    </form>
  );
}
