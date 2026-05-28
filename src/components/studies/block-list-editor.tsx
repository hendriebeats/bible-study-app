"use client";

import { GripVertical, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { DefaultContentEditor } from "@/components/admin/default-content-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { arrayMove } from "@/lib/dnd/pointer-reorder";
import { useReorderHandle } from "@/lib/dnd/use-reorder-handle";
import { type BlockDraft, emptyBlockDraft } from "@/lib/editor/blocks";
import type { PMNodeJSON } from "@/lib/editor/types";

/**
 * A controlled, draft-driven editor for a list of study blocks — all four
 * fields (title, subtitle, placeholder, body) plus add / remove / drag-reorder.
 * Each row visually mirrors the live `.study-block` card on the page (header
 * column with title + subtitle, body area with the rich-text editor and ghost
 * placeholder when empty) so the experience feels like editing in place. The
 * per-card "⋮" menu owns "Edit placeholder" (the placeholder only renders when
 * the body is empty, so it needs its own affordance) and "Remove block".
 *
 * The parent owns the `blocks` array and applies it where it belongs (a live
 * section doc, or the per-study template). Rows are keyed by `BlockDraft.key`
 * so each body editor instance stays stable across edits and reorders.
 */
export function BlockListEditor({
  blocks,
  onChange,
}: {
  blocks: BlockDraft[];
  onChange: (next: BlockDraft[]) => void;
}) {
  function patchAt(index: number, patch: Partial<BlockDraft>) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }
  function removeAt(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }
  function reorder(from: number, to: number) {
    onChange(arrayMove(blocks, from, to));
  }

  return (
    <div data-reorder-group className="flex flex-col gap-3">
      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No blocks yet. Add the first one below.
        </p>
      ) : (
        blocks.map((block, index) => (
          <BlockRow
            key={block.key}
            block={block}
            onReorder={reorder}
            onPatch={(patch) => {
              patchAt(index, patch);
            }}
            onRemove={() => {
              removeAt(index);
            }}
          />
        ))
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange([...blocks, emptyBlockDraft()]);
          }}
        >
          <Plus className="size-4" />
          Add block
        </Button>
      </div>
    </div>
  );
}

function BlockRow({
  block,
  onReorder,
  onPatch,
  onRemove,
}: {
  block: BlockDraft;
  onReorder: (from: number, to: number) => void;
  onPatch: (patch: Partial<BlockDraft>) => void;
  onRemove: () => void;
}) {
  const setDragHandle = useReorderHandle(onReorder);
  const [editingPlaceholder, setEditingPlaceholder] = useState(false);

  return (
    <div data-reorder-item className="flex items-start gap-2">
      <button
        ref={setDragHandle}
        type="button"
        aria-label="Reorder block (drag, or focus and press up/down)"
        title="Drag to reorder (or focus and press ↑/↓)"
        className="mt-3 h-fit cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <GripVertical className="size-4" />
      </button>

      <section
        className="relative min-w-0 flex-1 overflow-hidden rounded-lg border bg-card"
        // Enables `.study-block-layout`'s container query so the header sits to
        // the left of the body when the card is wide (matches the live block).
        style={{ containerType: "inline-size" }}
      >
        {/* Reuses the live block's design-system classes from globals.css so the
            dialog visually matches the on-page block (header/body container
            query, title chrome, subtitle treatment). */}
        {/* eslint-disable better-tailwindcss/no-unknown-classes */}
        <div className="study-block-layout">
          <div className="study-block-header">
            <div className="study-block-titlerow">
              <input
                className="study-block-title placeholder:font-normal placeholder:text-muted-foreground/60"
                value={block.title}
                onChange={(event) => {
                  onPatch({ title: event.target.value });
                }}
                placeholder="Block title (e.g. Observation)"
                aria-label="Block title"
              />
            </div>
            <input
              className="study-block-subtitle w-full min-w-0 border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground/60"
              value={block.subtitle}
              onChange={(event) => {
                onPatch({ subtitle: event.target.value });
              }}
              placeholder="Subtitle (optional)"
              aria-label="Block subtitle"
            />
          </div>
          <div className="study-block-body">
            <DefaultContentEditor
              // Re-key on placeholder change so the ghost text refreshes (the
              // placeholder plugin captures text at mount; startEditingPlaceholder
              // blurs first so the body's pending edit commits before remount).
              key={`${block.key}::${block.placeholder}`}
              value={block.body}
              placeholder={block.placeholder}
              bare
              onChange={(content: PMNodeJSON[] | null) => {
                onPatch({ body: content });
              }}
            />
          </div>
        </div>
        {/* eslint-enable better-tailwindcss/no-unknown-classes */}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Block actions"
              className="absolute top-2 right-2 size-7 text-muted-foreground"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setEditingPlaceholder(true);
              }}
            >
              <Pencil className="size-4" />
              Edit placeholder
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 className="size-4" />
              Remove block
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {editingPlaceholder ? (
          <div className="border-t bg-muted/30 p-3">
            <label
              htmlFor={`placeholder-${block.key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Placeholder (shown in the body when empty)
            </label>
            <textarea
              id={`placeholder-${block.key}`}
              className="mt-1 min-h-14 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={block.placeholder}
              autoFocus
              onChange={(event) => {
                onPatch({ placeholder: event.target.value });
              }}
              onBlur={() => {
                setEditingPlaceholder(false);
              }}
              placeholder="Suggested text shown until the writer types…"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
