"use client";

import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createOrgTemplate,
  deleteOrgTemplate,
  moveOrgTemplate,
  updateOrgTemplateMeta,
} from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Genre, StudyTemplate } from "@/lib/db/types";

function CustomRow({
  template,
  isFirst,
  isLast,
}: {
  template: StudyTemplate;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (name.trim() === "") {
      toast.error("Name is required.");
      return;
    }
    startTransition(() => {
      void updateOrgTemplateMeta(
        template.id,
        template.template_study_id,
        name.trim(),
        description.trim(),
      ).then((r) => {
        if (r.ok) {
          toast.success("Saved.");
          setEditing(false);
          router.refresh();
        } else {
          toast.error(r.error);
        }
      });
    });
  }

  function move(direction: "up" | "down") {
    startTransition(() => {
      void moveOrgTemplate(template.id, direction).then((r) => {
        if (r.ok) {
          router.refresh();
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
          router.refresh();
        } else {
          toast.error(r.error);
        }
      });
    });
  }

  if (editing) {
    return (
      <li className="grid gap-2 rounded-md border p-3">
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
    <li className="flex items-center gap-2 rounded-md border p-3">
      <div className="flex shrink-0 flex-col">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Move up"
          disabled={pending || isFirst}
          onClick={() => {
            move("up");
          }}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Move down"
          disabled={pending || isLast}
          onClick={() => {
            move("down");
          }}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{template.name}</p>
        {template.description ? (
          <p className="truncate text-sm text-muted-foreground">
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
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom templates yet.
        </p>
      ) : (
        <ul className="grid gap-2">
          {templates.map((t, i) => (
            <CustomRow
              key={t.id}
              template={t}
              isFirst={i === 0}
              isLast={i === templates.length - 1}
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
