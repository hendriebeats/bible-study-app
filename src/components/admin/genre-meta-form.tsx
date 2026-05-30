"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteGenre, updateGenre } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Genre } from "@/lib/db/types";

export function GenreMetaForm({ genre }: { genre: Genre }) {
  const [name, setName] = useState(genre.name);
  const [description, setDescription] = useState(genre.description ?? "");
  const [deleting, startDelete] = useTransition();

  function save() {
    if (name === genre.name && description === (genre.description ?? "")) {
      return;
    }
    void updateGenre(genre.id, name, description).catch(() => {
      toast.error("Couldn't save this genre.");
    });
  }

  function handleDelete() {
    if (
      !window.confirm(
        `Delete the "${genre.name}" genre and its block templates?`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const result = await deleteGenre(genre.id);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onBlur={save}
          aria-label="Genre name"
          className="h-auto flex-1 border-0 bg-transparent px-0 text-title font-bold shadow-none focus-visible:ring-0"
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>
      <textarea
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        onBlur={save}
        aria-label="Genre description"
        placeholder="Describe this genre (optional)…"
        className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
