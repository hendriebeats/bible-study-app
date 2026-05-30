"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  type LucideIcon,
  Minus,
  PanelTop,
  Trash2,
} from "lucide-react";
import type { Command } from "prosemirror-state";
import { useEffect, useState } from "react";

import { useEditorContext } from "@/components/studies/editor-context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PopoverContent, VirtualAnchorPopover } from "@/components/ui/popover";
import {
  TABLE_HANDLE_EVENT,
  type TableHandleEventDetail,
} from "@/lib/editor/plugins/table-handle-events";
import {
  addColumnAfterSafe,
  addColumnBeforeSafe,
  addRowAfterSafe,
  addRowBeforeSafe,
  deleteColumnSafe,
  deleteRowSafe,
  deleteTableSafe,
  moveColumn,
  moveRow,
  setColumnAlign,
  toggleHeaderRowSafe,
} from "@/lib/editor/table-commands";

const POPOVER_WIDTH = 220;

/**
 * Top-level mount that listens for `TABLE_HANDLE_EVENT` (fired by
 * `TableViewWithHandles` when the user clicks a row/column ⋮⋮ handle) and
 * renders a Notion-style action menu near the handle.
 *
 * Mirrors {@link CalloutColorPopover}'s shape: one mount lives next to it in
 * `study-workspace.tsx` and serves every editor that's part of the same React
 * tree (body editor + blocks dialog). Dispatches commands through the active
 * editor view via `runCommand` so it works regardless of which surface is
 * focused.
 *
 * Built on {@link VirtualAnchorPopover}: Radix handles flip / shift /
 * shrink-to-fit-viewport plus outside-click + Escape dismissal, so this
 * component only worries about the event plumbing and the menu body.
 */
export function TableHandlePopover() {
  const ctx = useEditorContext();
  const [detail, setDetail] = useState<TableHandleEventDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const e = event as CustomEvent<TableHandleEventDetail>;
      setDetail(e.detail);
    };
    window.addEventListener(TABLE_HANDLE_EVENT, onOpen);
    return () => {
      window.removeEventListener(TABLE_HANDLE_EVENT, onOpen);
    };
  }, []);

  if (!detail || !ctx) {
    return null;
  }

  // Dispatching a command may change document size (insert/delete row/column)
  // — close the popover after the action so the next click on a handle opens
  // a fresh one with refreshed indices.
  const run = (command: Command) => {
    ctx.runCommand(command);
    setDetail(null);
  };

  const anchor = detail.anchorRect;
  const rect = {
    x: anchor.left,
    y: anchor.top,
    width: anchor.right - anchor.left,
    height: anchor.bottom - anchor.top,
  };

  return (
    <>
      <VirtualAnchorPopover
        rect={rect}
        open
        onOpenChange={(next) => {
          // Don't let an outside-click / Escape dismiss while the confirm
          // dialog is open — the dialog owns those interactions.
          if (!next && !confirmDelete) {
            setDetail(null);
          }
        }}
      >
        <PopoverContent
          role="menu"
          aria-label={detail.kind === "row" ? "Row options" : "Column options"}
          side="bottom"
          align="start"
          sideOffset={6}
          // Match BlockMenu: width is fixed at `POPOVER_WIDTH` so the menu's
          // layout is stable; the wrapper's
          // max-h-(--radix-popover-content-available-height) caps height and
          // scrolls inside on cramped viewports.
          className="p-1"
          style={{ width: POPOVER_WIDTH }}
          // Keep ProseMirror selection alive when clicking a menu item —
          // without this the editor loses focus before `runCommand` fires.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (confirmDelete) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (confirmDelete) {
              event.preventDefault();
              setConfirmDelete(false);
            }
          }}
        >
          {detail.kind === "row" ? (
            <RowMenu
              detail={detail}
              run={run}
              onDeleteTable={() => {
                setConfirmDelete(true);
              }}
            />
          ) : (
            <ColMenu
              detail={detail}
              run={run}
              onDeleteTable={() => {
                setConfirmDelete(true);
              }}
            />
          )}
        </PopoverContent>
      </VirtualAnchorPopover>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete table?"
        description="The whole table and everything in it will be removed. You can undo this with Cmd-Z."
        confirmLabel="Delete table"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          run(deleteTableSafe);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Row / Column menu bodies
// ---------------------------------------------------------------------------

function RowMenu({
  detail,
  run,
  onDeleteTable,
}: {
  detail: TableHandleEventDetail;
  run: (command: Command) => void;
  onDeleteTable: () => void;
}) {
  const canMoveUp = detail.index > 0;
  const canMoveDown = detail.index < detail.total - 1;
  return (
    <>
      <SectionLabel>Row {detail.index + 1}</SectionLabel>
      <MenuItem
        icon={BetweenHorizontalStart}
        label="Insert row above"
        onClick={() => {
          run(addRowBeforeSafe);
        }}
      />
      <MenuItem
        icon={BetweenHorizontalEnd}
        label="Insert row below"
        onClick={() => {
          run(addRowAfterSafe);
        }}
      />
      <MenuItem
        icon={ArrowUp}
        label="Move row up"
        onClick={() => {
          run(moveRow(-1));
        }}
        disabled={!canMoveUp}
      />
      <MenuItem
        icon={ArrowDown}
        label="Move row down"
        onClick={() => {
          run(moveRow(1));
        }}
        disabled={!canMoveDown}
      />
      {detail.index === 0 ? (
        <MenuItem
          icon={PanelTop}
          label={detail.isHeaderRow ? "Remove header row" : "Make header row"}
          onClick={() => {
            run(toggleHeaderRowSafe);
          }}
        />
      ) : null}
      <Divider />
      <MenuItem
        icon={Minus}
        label="Delete row"
        onClick={() => {
          run(deleteRowSafe);
        }}
        destructive
      />
      <MenuItem
        icon={Trash2}
        label="Delete table"
        onClick={onDeleteTable}
        destructive
      />
    </>
  );
}

function ColMenu({
  detail,
  run,
  onDeleteTable,
}: {
  detail: TableHandleEventDetail;
  run: (command: Command) => void;
  onDeleteTable: () => void;
}) {
  const canMoveLeft = detail.index > 0;
  const canMoveRight = detail.index < detail.total - 1;
  return (
    <>
      <SectionLabel>Column {detail.index + 1}</SectionLabel>
      <MenuItem
        icon={BetweenVerticalStart}
        label="Insert column left"
        onClick={() => {
          run(addColumnBeforeSafe);
        }}
      />
      <MenuItem
        icon={BetweenVerticalEnd}
        label="Insert column right"
        onClick={() => {
          run(addColumnAfterSafe);
        }}
      />
      <MenuItem
        icon={ArrowLeft}
        label="Move column left"
        onClick={() => {
          run(moveColumn(-1));
        }}
        disabled={!canMoveLeft}
      />
      <MenuItem
        icon={ArrowRight}
        label="Move column right"
        onClick={() => {
          run(moveColumn(1));
        }}
        disabled={!canMoveRight}
      />
      <AlignSegmented
        current={detail.currentAlign}
        onPick={(value) => {
          run(setColumnAlign(value));
        }}
      />
      <Divider />
      <MenuItem
        icon={Minus}
        label="Delete column"
        onClick={() => {
          run(deleteColumnSafe);
        }}
        destructive
      />
      <MenuItem
        icon={Trash2}
        label="Delete table"
        onClick={onDeleteTable}
        destructive
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-1 text-caption font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-1 border-t border-border/60" />;
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const baseClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  const tone = destructive
    ? "text-destructive hover:bg-destructive/10"
    : "text-foreground/80 hover:bg-muted hover:text-foreground";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${tone}`}
    >
      <Icon
        className={
          destructive
            ? "size-4 shrink-0"
            : "size-4 shrink-0 text-muted-foreground"
        }
      />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * Three-button alignment row (Left / Center / Right). The currently-active
 * value renders in `secondary` styling; clicking the same swatch a second
 * time clears alignment (`null`) so the user can revert without juggling a
 * separate "default" item.
 */
function AlignSegmented({
  current,
  onPick,
}: {
  current: "left" | "center" | "right" | null;
  onPick: (value: "left" | "center" | "right" | null) => void;
}) {
  const items: {
    value: "left" | "center" | "right";
    icon: LucideIcon;
    label: string;
  }[] = [
    { value: "left", icon: AlignLeft, label: "Align left" },
    { value: "center", icon: AlignCenter, label: "Align center" },
    { value: "right", icon: AlignRight, label: "Align right" },
  ];
  return (
    <div className="mt-1 flex items-center gap-1 px-2 py-1">
      <span className="mr-auto text-caption text-muted-foreground">Align</span>
      {items.map(({ value, icon: Icon, label }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => {
              onPick(active ? null : value);
            }}
            className={`flex size-7 items-center justify-center rounded-md text-foreground/80 hover:bg-muted ${
              active ? "bg-secondary text-foreground" : ""
            }`}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
