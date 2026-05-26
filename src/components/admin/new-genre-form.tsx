"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createGenre } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewGenreForm() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = name.trim();
        if (value === "") {
          return;
        }
        startTransition(async () => {
          try {
            await createGenre(value);
          } catch {
            toast.error("Couldn't create that genre.");
          }
        });
      }}
    >
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder="New genre name"
        aria-label="New genre name"
        className="max-w-xs"
      />
      <Button type="submit" disabled={pending}>
        <Plus className="size-4" />
        Add genre
      </Button>
    </form>
  );
}
