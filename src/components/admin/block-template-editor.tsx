"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addBlockTemplate,
  deleteBlockTemplate,
  moveBlockTemplate,
  updateBlockTemplate,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GenreBlockTemplate } from "@/lib/db/types";

export function BlockTemplateEditor({
  genreId,
  templates,
}: {
  genreId: string;
  templates: GenreBlockTemplate[];
}) {
  const [adding, startAdd] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {templates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No blocks yet. Add the first default block for this genre.
        </p>
      ) : (
        templates.map((template, index) => (
          <BlockTemplateRow
            key={template.id}
            genreId={genreId}
            template={template}
            isFirst={index === 0}
            isLast={index === templates.length - 1}
          />
        ))
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={adding}
          onClick={() => {
            startAdd(async () => {
              try {
                await addBlockTemplate(genreId);
              } catch {
                toast.error("Couldn't add a block.");
              }
            });
          }}
        >
          <Plus className="size-4" />
          Add block
        </Button>
      </div>
    </div>
  );
}

function BlockTemplateRow({
  genreId,
  template,
  isFirst,
  isLast,
}: {
  genreId: string;
  template: GenreBlockTemplate;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [label, setLabel] = useState(template.label);
  const [prompt, setPrompt] = useState(template.prompt ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if (label === template.label && prompt === (template.prompt ?? "")) {
      return;
    }
    void updateBlockTemplate(template.id, genreId, label, prompt).catch(() => {
      toast.error("Couldn't save this block.");
    });
  }

  function move(direction: "up" | "down") {
    startTransition(async () => {
      try {
        await moveBlockTemplate(template.id, genreId, direction);
      } catch {
        toast.error("Couldn't reorder blocks.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        await deleteBlockTemplate(template.id, genreId);
      } catch {
        toast.error("Couldn't remove this block.");
      }
    });
  }

  return (
    <div className="flex gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-col gap-1 pt-1">
        <button
          type="button"
          aria-label="Move up"
          disabled={isFirst || pending}
          onClick={() => {
            move("up");
          }}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={isLast || pending}
          onClick={() => {
            move("down");
          }}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Input
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          onBlur={save}
          aria-label="Block label"
          placeholder="Block label (e.g. Observation)"
          className="font-medium"
        />
        <textarea
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onBlur={save}
          aria-label="Block prompt"
          placeholder="Prompt or guiding question (optional)…"
          className="min-h-14 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <button
        type="button"
        aria-label="Remove block"
        disabled={pending}
        onClick={remove}
        className="h-fit rounded-sm p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
