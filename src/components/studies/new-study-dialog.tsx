"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { createStudy } from "@/app/studies/actions";
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
import type { Genre } from "@/lib/db/types";

export function NewStudyDialog({ genres }: { genres: Genre[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [genreId, setGenreId] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedGenre = genres.find((genre) => genre.id === genreId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="size-4" />
          New study
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New study</DialogTitle>
          <DialogDescription>
            Name your study and pick a study type to start with the right
            prompts.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => {
              void createStudy(name, genreId === "" ? null : genreId);
            });
          }}
          className="grid gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="new-study-name">Name</Label>
            <Input
              id="new-study-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="e.g. Gospel of John"
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-study-type">Study type</Label>
            <select
              id="new-study-type"
              value={genreId}
              onChange={(event) => {
                setGenreId(event.target.value);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Blank (no template)</option>
              {genres.map((genre) => (
                <option key={genre.id} value={genre.id}>
                  {genre.name}
                </option>
              ))}
            </select>
            {selectedGenre?.description ? (
              <p className="text-xs text-muted-foreground">
                {selectedGenre.description}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              Create study
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
