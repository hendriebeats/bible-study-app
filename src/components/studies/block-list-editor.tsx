"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";

import { DefaultContentEditor } from "@/components/admin/default-content-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { arrayMove } from "@/lib/dnd/pointer-reorder";
import { useReorderHandle } from "@/lib/dnd/use-reorder-handle";
import { type BlockDraft, emptyBlockDraft } from "@/lib/editor/blocks";
import type { PMNodeJSON } from "@/lib/editor/types";

/**
 * A controlled, draft-driven editor for a list of study blocks — all four
 * fields (title, subtitle, placeholder, body) plus add / remove / drag-reorder.
 * The parent owns the `blocks` array and applies it where it belongs (a live
 * section doc, or the per-study template). Generalizes the admin
 * `BlockTemplateEditor`, but reports changes through `onChange` instead of
 * persisting each row itself. Rows are keyed by `BlockDraft.key` so each body
 * editor instance stays stable across edits and reorders.
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

  return (
    <div data-reorder-item className="flex gap-2 rounded-lg border bg-card p-3">
      <button
        ref={setDragHandle}
        type="button"
        aria-label="Reorder block (drag, or focus and press up/down)"
        title="Drag to reorder (or focus and press ↑/↓)"
        className="h-fit cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <GripVertical className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Input
          value={block.title}
          onChange={(event) => {
            onPatch({ title: event.target.value });
          }}
          aria-label="Block title"
          placeholder="Block title (e.g. Observation)"
          className="font-medium"
        />
        <Input
          value={block.subtitle}
          onChange={(event) => {
            onPatch({ subtitle: event.target.value });
          }}
          aria-label="Block subtitle"
          placeholder="Subtitle (optional)"
          className="text-sm"
        />
        <textarea
          value={block.placeholder}
          onChange={(event) => {
            onPatch({ placeholder: event.target.value });
          }}
          aria-label="Body placeholder"
          placeholder="Body placeholder — suggested text shown until the writer types (optional)…"
          className="min-h-14 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Body content (optional)
          </span>
          <DefaultContentEditor
            value={block.body}
            onChange={(content: PMNodeJSON[] | null) => {
              onPatch({ body: content });
            }}
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="Remove block"
        onClick={onRemove}
        className="h-fit rounded-sm p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
