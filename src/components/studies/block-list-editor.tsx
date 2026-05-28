"use client";

import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { DefaultContentEditor } from "@/components/admin/default-content-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DragHandle } from "@/components/ui/drag-handle";
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
import { cn } from "@/lib/utils";

/** Body is empty when the row holds only a single empty paragraph (or nothing). */
function blockHasBody(block: BlockDraft): boolean {
  if (block.body === null || block.body.length === 0) {
    return false;
  }
  if (block.body.length === 1) {
    const only = block.body[0];
    if (only?.type === "paragraph" && (only.content?.length ?? 0) === 0) {
      return false;
    }
  }
  return true;
}

/**
 * A controlled, draft-driven editor for a list of study blocks — all four
 * fields (title, subtitle, placeholder, body) plus add / remove / drag-reorder.
 * Rows are conjoined (no inter-row gap, only the first/last corners rounded,
 * shared internal dividers) so the stack reads as one continuous shape, just
 * like the live blocks on the page. Each row visually mirrors the live
 * `.study-block` card. The per-card "⋮" menu owns "Edit placeholder" (the
 * placeholder only renders when the body is empty, so it needs its own
 * affordance) and "Remove block".
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
    <div className="flex flex-col gap-3">
      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No blocks yet. Add the first one below.
        </p>
      ) : (
        <div data-reorder-group className="flex flex-col">
          {blocks.map((block, index) => (
            <BlockRow
              key={block.key}
              block={block}
              isFirst={index === 0}
              isLast={index === blocks.length - 1}
              onReorder={reorder}
              onPatch={(patch) => {
                patchAt(index, patch);
              }}
              onRemove={() => {
                removeAt(index);
              }}
            />
          ))}
        </div>
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
  isFirst,
  isLast,
  onReorder,
  onPatch,
  onRemove,
}: {
  block: BlockDraft;
  isFirst: boolean;
  isLast: boolean;
  onReorder: (from: number, to: number) => void;
  onPatch: (patch: Partial<BlockDraft>) => void;
  onRemove: () => void;
}) {
  const setDragHandle = useReorderHandle(onReorder);
  const [editingPlaceholder, setEditingPlaceholder] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Confirm only matters when there's body content worth losing — the placeholder
  // and title alone aren't an "edit" the user is invested in protecting.
  const needsConfirm = blockHasBody(block);

  return (
    <div data-reorder-item className="flex items-start gap-2">
      <DragHandle
        ref={setDragHandle}
        aria-label="Reorder block (drag, or focus and press up/down)"
        className="mt-3"
      />

      <section
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden border bg-card",
          // Conjoin: only outer corners rounded, shared interior border (no
          // doubled-up line between rows).
          isFirst ? "rounded-t-lg" : "border-t-0",
          isLast ? "rounded-b-lg" : "",
        )}
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
              <textarea
                className="study-block-title placeholder:font-normal placeholder:text-muted-foreground/60"
                rows={1}
                wrap="soft"
                value={block.title}
                onChange={(event) => {
                  onPatch({ title: event.target.value });
                }}
                onKeyDown={(event) => {
                  // Enter commits (blurs) instead of inserting a newline —
                  // matches the live block's title input behavior.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Block title (e.g. Observation)"
                aria-label="Block title"
              />
            </div>
            <textarea
              className="study-block-subtitle w-full min-w-0 border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground/60"
              rows={1}
              wrap="soft"
              value={block.subtitle}
              onChange={(event) => {
                onPatch({ subtitle: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
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
              // Register with the shared EditorContext so the page-level
              // toolbar + selection bubble act on whichever card body is
              // focused — and so the editor gets the full plugin set
              // (slash menu, input rules incl. `[ ] ` checklist, etc.).
              editorRole="dialog"
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
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                // Skip the prompt when there's nothing meaningful to lose —
                // an untouched block is one click to add back via "Add block".
                if (needsConfirm) {
                  setConfirmRemove(true);
                } else {
                  onRemove();
                }
              }}
            >
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
              className="mt-1 field-sizing-content min-h-14 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove this block?"
        description="The block's content will be discarded. You can add a new block from the “Add block” button at the bottom."
        confirmLabel="Remove block"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove();
        }}
      />
    </div>
  );
}
