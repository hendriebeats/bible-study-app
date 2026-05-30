"use client";

import { MoreVertical, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { DefaultContentEditor } from "@/components/admin/default-content-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DragHandle } from "@/components/ui/drag-handle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { arrayMove } from "@/lib/dnd/pointer-reorder";
import { useReorderHandle } from "@/lib/dnd/use-reorder-handle";
import { type BlockTone } from "@/lib/editor/block-tones";
import {
  type BlockDraft,
  type DialogItem,
  emptyBlockDraft,
} from "@/lib/editor/blocks";
import type { PMNodeJSON } from "@/lib/editor/types";
import { cn } from "@/lib/utils";

import { useEditorContext } from "./editor-context";
import { ToneSwatchPicker } from "./tone-swatch-picker";

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
 * A controlled, items-driven editor for the dialog's block list. Items are a
 * discriminated union ({@link DialogItem}): `kind: "study"` rows are full
 * study-block cards (title, subtitle, placeholder, body, tone) with add /
 * remove / drag-reorder; `kind: "notes"` rows are a read-only "Notes" label
 * with a drag handle (no editing, no removing — deletion is blocked by
 * `notes-index-guard` regardless). Rows are conjoined (no inter-row gap, only
 * outer corners rounded, shared interior dividers) so the stack reads as one
 * continuous shape, mirroring the live blocks on the page.
 *
 * The parent owns the `items` array and applies it where it belongs (the
 * section's live blocks doc, or a per-study template — the latter never
 * contains a notes item, but the component handles both shapes uniformly).
 * Rows are keyed by `DialogItem.key` so each body editor instance stays
 * stable across edits and reorders.
 */
export function BlockListEditor({
  items,
  onChange,
}: {
  items: DialogItem[];
  onChange: (next: DialogItem[]) => void;
}) {
  const editor = useEditorContext();

  function patchStudyAt(index: number, patch: Partial<BlockDraft>) {
    onChange(
      items.map((item, i) =>
        i === index && item.kind === "study"
          ? { ...item, draft: { ...item.draft, ...patch } }
          : item,
      ),
    );
  }
  function removeAt(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function reorder(from: number, to: number) {
    onChange(arrayMove(items, from, to));
  }
  function appendDraft(draft: BlockDraft) {
    onChange([...items, { kind: "study", key: draft.key, draft }]);
  }

  /**
   * Dialog toolbar gating: clear the EditorContext's "active editor" whenever
   * focus moves to anything that ISN'T a ProseMirror body (title/subtitle
   * textareas, the per-card ⋮ trigger, the Color swatch picker, the drag
   * handle, the "Add block" trigger). One capturing listener covers every
   * current and future non-body surface; the body editors' own focus handler
   * re-asserts setActive when the user clicks back into a body. Children
   * inside a `.ProseMirror` surface — including portaled toolbar buttons that
   * land back inside ProseMirror — are skipped.
   */
  function handleFocusCapture(event: React.FocusEvent<HTMLDivElement>) {
    if (!editor) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".ProseMirror")) {
      return;
    }
    editor.clearActive();
  }

  return (
    <div className="flex flex-col gap-3" onFocusCapture={handleFocusCapture}>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-ui text-muted-foreground">
          No blocks yet. Add the first one below.
        </p>
      ) : (
        <div data-reorder-group className="flex flex-col">
          {items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            if (item.kind === "notes") {
              return (
                <NotesRow
                  key={item.key}
                  isFirst={isFirst}
                  isLast={isLast}
                  onReorder={reorder}
                />
              );
            }
            return (
              <BlockRow
                key={item.key}
                block={item.draft}
                isFirst={isFirst}
                isLast={isLast}
                onReorder={reorder}
                onPatch={(patch) => {
                  patchStudyAt(index, patch);
                }}
                onRemove={() => {
                  removeAt(index);
                }}
              />
            );
          })}
        </div>
      )}

      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="size-4" />
              Add block
            </Button>
          </DropdownMenuTrigger>
          {/* `w-auto` overrides the shadcn default that pins the popover to
              the trigger's width (combined with the primitive's
              `overflow-x-hidden`, that default was clipping the gray
              descriptor on the right). With nowrap items inside, the menu
              now grows to fit the widest item. */}
          <DropdownMenuContent align="start" className="w-auto">
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                appendDraft(emptyBlockDraft({ variant: "standard" }));
              }}
            >
              Standard block
              <span className="ml-2 text-caption text-muted-foreground">
                Title + body
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                appendDraft(emptyBlockDraft({ variant: "action" }));
              }}
            >
              Action reminder
              <span className="ml-2 text-caption text-muted-foreground">
                Header + subheader bar
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
  // and title alone aren't an "edit" the user is invested in protecting. Action-
  // variant blocks have no body, so removing one is always cheap to undo.
  const needsConfirm = block.variant !== "action" && blockHasBody(block);
  const isAction = block.variant === "action";

  return (
    <div data-reorder-item className="flex items-start gap-2">
      <DragHandle
        ref={setDragHandle}
        aria-label="Reorder block (drag, or focus and press up/down)"
        className="mt-3"
      />

      <section
        className={cn(
          // The dialog preview reuses the live block's tone class so the
          // background swatch matches the on-page bar byte-for-byte. Standard
          // cards stay on bg-card (no tint). These are design-system classes
          // from globals.css (not Tailwind utilities), so they're disabled
          // against the unknown-class rule.
          // eslint-disable-next-line better-tailwindcss/no-unknown-classes
          "study-block",
          isAction
            ? // eslint-disable-next-line better-tailwindcss/no-unknown-classes
              `study-block--action study-block--tone-${block.tone}`
            : "bg-card",
          "relative min-w-0 flex-1 overflow-hidden border",
          // Conjoin: only outer corners rounded, shared interior border (no
          // doubled-up line between rows).
          isFirst ? "rounded-t-lg" : "border-t-0",
          isLast ? "rounded-b-lg" : "",
        )}
        // Enables `.study-block-layout`'s container query (standard cards) so
        // the header sits to the left of the body when the card is wide; the
        // action card uses a flex row inline and doesn't depend on it.
        style={{ containerType: "inline-size" }}
      >
        {isAction ? <ActionRowBody block={block} onPatch={onPatch} /> : null}
        {!isAction ? <StandardRowBody block={block} onPatch={onPatch} /> : null}

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
            {/* Action blocks have no body, so "Edit placeholder" is meaningless
                — only standard cards expose it. */}
            {!isAction ? (
              <DropdownMenuItem
                onClick={() => {
                  setEditingPlaceholder(true);
                }}
              >
                <Pencil className="size-4" />
                Edit placeholder
              </DropdownMenuItem>
            ) : null}
            {isAction ? (
              <ColorSubmenu
                value={block.tone}
                onChange={(tone) => {
                  onPatch({ tone });
                }}
              />
            ) : null}
            {/* At least one item always sits above the destructive action
                (Color for action variants, Edit placeholder for standard), so
                the separator is unconditional. */}
            <DropdownMenuSeparator />

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

        {editingPlaceholder && !isAction ? (
          <div className="border-t bg-muted/30 p-3">
            <label
              htmlFor={`placeholder-${block.key}`}
              className="text-caption font-medium text-muted-foreground"
            >
              Placeholder (shown in the body when empty)
            </label>
            <textarea
              id={`placeholder-${block.key}`}
              className="mt-1 field-sizing-content min-h-14 w-full resize-none rounded-md border bg-background px-3 py-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/**
 * Read-only "Notes" card representing the section's notes_index — drag handle
 * + label + helper line, no editable fields, no ⋮ menu. Reorder is the only
 * gesture: the underlying notes_index node still holds every note's body and
 * is materialized on save in `applySectionDrafts`. Deletion is blocked by
 * `notes-index-guard` regardless, so there's no Remove button to surface.
 */
function NotesRow({
  isFirst,
  isLast,
  onReorder,
}: {
  isFirst: boolean;
  isLast: boolean;
  onReorder: (from: number, to: number) => void;
}) {
  const setDragHandle = useReorderHandle(onReorder);
  return (
    <div data-reorder-item className="flex items-start gap-2">
      <DragHandle
        ref={setDragHandle}
        aria-label="Reorder notes (drag, or focus and press up/down)"
        className="mt-3"
      />
      <section
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden border bg-muted/40 px-4 py-3",
          // Same conjoin treatment as study cards — only outer corners rounded
          // when adjacent to non-stack siblings.
          isFirst ? "rounded-t-lg" : "border-t-0",
          isLast ? "rounded-b-lg" : "",
        )}
      >
        <p className="text-ui font-semibold">Notes</p>
        <p className="text-caption text-muted-foreground">
          Shared annotations for this section. Always present — drag to
          reposition.
        </p>
      </section>
    </div>
  );
}

/**
 * Standard-variant card body: title + subtitle + full rich-text body editor,
 * laid out via the live block's `.study-block-layout` so the dialog mirrors
 * the on-page rendering (header column on the left when wide, stacked on top
 * when narrow).
 */
function StandardRowBody({
  block,
  onPatch,
}: {
  block: BlockDraft;
  onPatch: (patch: Partial<BlockDraft>) => void;
}) {
  return (
    // Reuses the live block's design-system classes from globals.css so the
    // dialog visually matches the on-page block (header/body container
    // query, title chrome, subtitle treatment).
    // eslint-disable-next-line better-tailwindcss/no-unknown-classes
    <div className="study-block-layout">
      {/* eslint-disable better-tailwindcss/no-unknown-classes */}
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
      {/* eslint-enable better-tailwindcss/no-unknown-classes */}
    </div>
  );
}

/**
 * Action-variant card body: a single tinted bar with header + subheader
 * centered together — no body editor, no placeholder field. Mirrors the live
 * `.study-block-action` so the dialog preview matches the on-page chrome.
 */
function ActionRowBody({
  block,
  onPatch,
}: {
  block: BlockDraft;
  onPatch: (patch: Partial<BlockDraft>) => void;
}) {
  return (
    // eslint-disable-next-line better-tailwindcss/no-unknown-classes
    <div className="study-block-action">
      <textarea
        // eslint-disable-next-line better-tailwindcss/no-unknown-classes
        className="study-block-action-title"
        rows={1}
        wrap="soft"
        value={block.title}
        onChange={(event) => {
          onPatch({ title: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        placeholder="Step (e.g. Prayer)"
        aria-label="Action step"
      />
      <textarea
        // eslint-disable-next-line better-tailwindcss/no-unknown-classes
        className="study-block-action-subtitle"
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
        placeholder="What to do (e.g. Meet with God.)"
        aria-label="Action reminder"
      />
    </div>
  );
}

/**
 * "Color" submenu for action-variant cards. Two rows — grayscale shades on
 * top, accents below — built from {@link BLOCK_TONES} so adding a tone is a
 * one-file change. Each swatch shows the actual on-page background color via
 * the same `--tone-{id}-bg` CSS variable the live bar uses, so picking is
 * WYSIWYG. The currently-applied tone gets a check overlay.
 */
function ColorSubmenu({
  value,
  onChange,
}: {
  value: BlockTone;
  onChange: (tone: BlockTone) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="size-4" />
        Color
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="p-2">
        <ToneSwatchPicker value={value} onChange={onChange} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
