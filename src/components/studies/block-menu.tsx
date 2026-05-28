"use client";

import {
  ArrowDown,
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
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  toggleHeaderRow,
} from "prosemirror-tables";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useEditorContext } from "@/components/studies/editor-context";
import {
  allowVerseEdit,
  moveBlockDown,
  moveBlockUp,
} from "@/lib/editor/commands";
import {
  BLOCK_MENU_EVENT,
  type BlockMenuEventDetail,
} from "@/lib/editor/plugins/block-handle";
import { filterTurnInto } from "@/lib/editor/slash-commands";

const MENU_WIDTH = 220;

/**
 * The block options menu opened by the gutter handle ({@link blockHandle} fires
 * a window event with the handle's screen position). "Turn into" reuses the
 * slash command registry (the handle already placed the caret in the block, so
 * the commands target it); plus Move up / Move down / Delete. Portals to body,
 * never steals editor focus.
 */
export function BlockMenu() {
  const ctx = useEditorContext();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<BlockMenuEventDetail>).detail;
      setPos({ x: detail.x, y: detail.y });
    };
    window.addEventListener(BLOCK_MENU_EVENT, onOpen);
    return () => {
      window.removeEventListener(BLOCK_MENU_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!pos) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef.current &&
        target instanceof Node &&
        !rootRef.current.contains(target)
      ) {
        setPos(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPos(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pos]);

  if (!pos || !ctx) {
    return null;
  }

  const turnInto = filterTurnInto(ctx.editorTools);
  // When the caret sits inside a table, swap "Turn into" for table row/column
  // ops (the gutter handle already placed the caret in the cell).
  const inTable = ctx.activeState ? isInTable(ctx.activeState) : false;

  const run = (command: Command) => {
    ctx.runCommand(command);
    setPos(null);
  };

  const left = Math.min(pos.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(pos.y, window.innerHeight - 320);

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground";
  const destructiveClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10";

  const item = (
    key: string,
    Icon: LucideIcon,
    text: string,
    command: Command,
    destructive = false,
  ) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={() => {
        run(command);
      }}
      className={destructive ? destructiveClass : itemClass}
    >
      <Icon
        className={
          destructive
            ? "size-4 shrink-0"
            : "size-4 shrink-0 text-muted-foreground"
        }
      />
      <span className="flex-1 truncate">{text}</span>
    </button>
  );

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label="Block options"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      style={{ position: "fixed", left, top, width: MENU_WIDTH }}
      className="z-50 max-h-80 overflow-auto rounded-lg border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
    >
      {inTable ? (
        <>
          <p className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Table
          </p>
          {item(
            "row-before",
            BetweenHorizontalStart,
            "Insert row above",
            allowVerseEdit(addRowBefore),
          )}
          {item(
            "row-after",
            BetweenHorizontalEnd,
            "Insert row below",
            allowVerseEdit(addRowAfter),
          )}
          {item(
            "col-before",
            BetweenVerticalStart,
            "Insert column left",
            allowVerseEdit(addColumnBefore),
          )}
          {item(
            "col-after",
            BetweenVerticalEnd,
            "Insert column right",
            allowVerseEdit(addColumnAfter),
          )}
          <div className="my-1 border-t border-border/60" />
          {item(
            "header-row",
            PanelTop,
            "Toggle header row",
            allowVerseEdit(toggleHeaderRow),
          )}
          {item(
            "del-row",
            Minus,
            "Delete row",
            allowVerseEdit(deleteRow),
            true,
          )}
          {item(
            "del-col",
            Minus,
            "Delete column",
            allowVerseEdit(deleteColumn),
            true,
          )}
          {item(
            "del-table",
            Trash2,
            "Delete table",
            allowVerseEdit(deleteTable),
            true,
          )}
        </>
      ) : (
        <>
          <p className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Turn into
          </p>
          {turnInto.map((entry) =>
            item(entry.id, entry.icon, entry.label, entry.command),
          )}
          <div className="my-1 border-t border-border/60" />
          {item("move-up", ArrowUp, "Move up", moveBlockUp)}
          {item("move-down", ArrowDown, "Move down", moveBlockDown)}
        </>
      )}
    </div>,
    document.body,
  );
}
