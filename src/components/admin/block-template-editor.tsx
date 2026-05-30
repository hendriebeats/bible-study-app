"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addBlockTemplate,
  deleteBlockTemplate,
  reorderGenreBlockTemplates,
  updateBlockTemplate,
} from "@/app/admin/actions";
import { DefaultContentEditor } from "@/components/admin/default-content-editor";
import { Button } from "@/components/ui/button";
import { DragHandle } from "@/components/ui/drag-handle";
import { Input } from "@/components/ui/input";
import { arrayMove } from "@/lib/dnd/pointer-reorder";
import { useReorderHandle } from "@/lib/dnd/use-reorder-handle";
import type { GenreBlockTemplate } from "@/lib/db/types";
import type { PMNodeJSON } from "@/lib/editor/types";

export function BlockTemplateEditor({
  genreId,
  templates,
}: {
  genreId: string;
  templates: GenreBlockTemplate[];
}) {
  const [adding, startAdd] = useTransition();
  // Optimistic order for drag/keyboard reorder; reverts on a failed write.
  // Re-syncs to server order whenever the templates prop changes (render-time
  // reset — the recommended alternative to a prop→state effect).
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
    void reorderGenreBlockTemplates(
      genreId,
      next.map((t) => t.id),
    ).catch(() => {
      toast.error("Couldn't reorder blocks.");
      setItems(previous);
    });
  }

  return (
    <div data-reorder-group className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-ui text-muted-foreground">
          No blocks yet. Add the first default block for this genre.
        </p>
      ) : (
        items.map((template) => (
          <BlockTemplateRow
            key={template.id}
            genreId={genreId}
            template={template}
            onReorder={handleReorder}
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
  onReorder,
}: {
  genreId: string;
  template: GenreBlockTemplate;
  onReorder: (from: number, to: number) => void;
}) {
  const [title, setTitle] = useState(template.title);
  const [subtitle, setSubtitle] = useState(template.subtitle ?? "");
  const [placeholder, setPlaceholder] = useState(template.placeholder ?? "");
  const defaultContentRef = useRef<PMNodeJSON[] | null>(
    template.default_content,
  );
  const [pending, startTransition] = useTransition();
  const setDragHandle = useReorderHandle(onReorder);

  function persist() {
    void updateBlockTemplate(
      template.id,
      genreId,
      title,
      subtitle,
      placeholder,
      defaultContentRef.current,
    ).catch(() => {
      toast.error("Couldn't save this block.");
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
    <div data-reorder-item className="flex gap-2 rounded-lg border bg-card p-3">
      <DragHandle
        ref={setDragHandle}
        aria-label="Reorder block (drag, or focus and press up/down)"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onBlur={persist}
          aria-label="Block title"
          placeholder="Block title (e.g. Observation)"
          className="font-medium"
        />
        <Input
          value={subtitle}
          onChange={(event) => {
            setSubtitle(event.target.value);
          }}
          onBlur={persist}
          aria-label="Block subtitle"
          placeholder="Subtitle (optional)"
          className="text-ui"
        />
        <textarea
          value={placeholder}
          onChange={(event) => {
            setPlaceholder(event.target.value);
          }}
          onBlur={persist}
          aria-label="Body placeholder"
          placeholder="Body placeholder — suggested text shown until the writer types (optional)…"
          className="min-h-14 w-full rounded-md border bg-transparent px-3 py-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">
            Default content (optional) — pre-fills the block body
          </span>
          <DefaultContentEditor
            value={template.default_content}
            onChange={(content) => {
              defaultContentRef.current = content;
              persist();
            }}
          />
        </div>
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
