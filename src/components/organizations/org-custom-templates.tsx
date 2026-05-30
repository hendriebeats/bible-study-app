"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createOrgTemplate,
  deleteOrgTemplate,
  reorderOrgTemplates,
  updateOrgTemplateMeta,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { DragHandle } from "@/components/ui/drag-handle";
import { Input } from "@/components/ui/input";
import { arrayMove } from "@/lib/dnd/pointer-reorder";
import { useReorderHandle } from "@/lib/dnd/use-reorder-handle";
import type { Genre, StudyTemplate } from "@/lib/db/types";

function CustomRow({
  template,
  onReorder,
  onSaved,
  onRemoved,
}: {
  template: StudyTemplate;
  onReorder: (from: number, to: number) => void;
  onSaved: (id: string, patch: { name: string; description: string }) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [pending, startTransition] = useTransition();
  const setDragHandle = useReorderHandle(onReorder);

  function save() {
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (cleanName === "") {
      toast.error("Name is required.");
      return;
    }
    startTransition(() => {
      void updateOrgTemplateMeta(
        template.id,
        template.template_study_id,
        cleanName,
        cleanDescription,
      ).then((r) => {
        if (r.ok) {
          toast.success("Saved.");
          setEditing(false);
          onSaved(template.id, {
            name: cleanName,
            description: cleanDescription,
          });
        } else {
          toast.error(r.error);
        }
      });
    });
  }

  function remove() {
    if (
      !window.confirm(
        "Delete this template? Studies already created from it are unaffected.",
      )
    ) {
      return;
    }
    startTransition(() => {
      void deleteOrgTemplate(template.template_study_id).then((r) => {
        if (r.ok) {
          onRemoved(template.id);
        } else {
          toast.error(r.error);
        }
      });
    });
  }

  if (editing) {
    return (
      <li data-reorder-item className="grid gap-2 rounded-md border p-3">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          aria-label="Template name"
          maxLength={120}
        />
        <Input
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          placeholder="Description (optional)"
          aria-label="Template description"
          maxLength={200}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(template.name);
              setDescription(template.description ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      data-reorder-item
      className="flex items-center gap-2 rounded-md border p-3"
    >
      <DragHandle
        ref={setDragHandle}
        aria-label="Reorder template (drag, or focus and press up/down)"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{template.name}</p>
        {template.description ? (
          <p className="truncate text-ui text-muted-foreground">
            {template.description}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setEditing(true);
        }}
      >
        Edit
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link href={`/studies/${template.template_study_id}`}>Open</Link>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={remove}
      >
        Delete
      </Button>
    </li>
  );
}

export function OrgCustomTemplates({
  templates,
  genres,
}: {
  templates: StudyTemplate[];
  genres: Genre[];
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [genreId, setGenreId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Optimistic order so a drag/keyboard reorder updates instantly; reverts if
  // the server write fails. Re-syncs to server order whenever the templates
  // prop changes (render-time reset — the recommended alternative to an effect).
  const [items, setItems] = useState(templates);
  const [prevTemplates, setPrevTemplates] = useState(templates);
  if (templates !== prevTemplates) {
    setPrevTemplates(templates);
    setItems(templates);
  }

  function handleReorder(from: number, to: number) {
    const previous = items;
    const next = arrayMove(items, from, to);
    setItems(next);
    void reorderOrgTemplates(next.map((t) => t.id)).then((r) => {
      if (!r.ok) {
        toast.error(r.error);
        setItems(previous);
      }
    });
  }

  function create() {
    const clean = name.trim();
    if (clean === "") {
      return;
    }
    startTransition(() => {
      void createOrgTemplate({
        type: "custom",
        name: clean,
        genreId: genreId === "" ? null : genreId,
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
    <div className="grid gap-3">
      {items.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          No custom templates yet.
        </p>
      ) : (
        <ul data-reorder-group className="grid gap-2">
          {items.map((t) => (
            <CustomRow
              key={t.id}
              template={t}
              onReorder={handleReorder}
              onSaved={(id, patch) => {
                setItems((current) =>
                  current.map((row) =>
                    row.id === id
                      ? {
                          ...row,
                          name: patch.name,
                          description:
                            patch.description === "" ? null : patch.description,
                        }
                      : row,
                  ),
                );
              }}
              onRemoved={(id) => {
                setItems((current) => current.filter((row) => row.id !== id));
              }}
            />
          ))}
        </ul>
      )}

      {creating ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="Template name"
            aria-label="New template name"
            className="max-w-xs"
          />
          <select
            aria-label="Starter blocks (genre)"
            value={genreId}
            onChange={(event) => {
              setGenreId(event.target.value);
            }}
            className="h-9 rounded-md border bg-background px-2 text-ui"
          >
            <option value="">No starter blocks</option>
            {genres.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.name} blocks
              </option>
            ))}
          </select>
          <Button type="submit" disabled={pending}>
            Create &amp; edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setName("");
              setGenreId("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus className="size-4" />
            New custom template
          </Button>
        </div>
      )}
    </div>
  );
}
