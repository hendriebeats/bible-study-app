"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Command } from "prosemirror-state";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useEditorContext } from "@/components/studies/editor-context";
import {
  deleteCurrentBlock,
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

  const run = (command: Command) => {
    ctx.runCommand(command);
    setPos(null);
  };

  const left = Math.min(pos.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(pos.y, window.innerHeight - 320);

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground";

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
      <p className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Turn into
      </p>
      {turnInto.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            onClick={() => {
              run(entry.command);
            }}
            className={itemClass}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{entry.label}</span>
          </button>
        );
      })}
      <div className="my-1 border-t border-border/60" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          run(moveBlockUp);
        }}
        className={itemClass}
      >
        <ArrowUp className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Move up</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          run(moveBlockDown);
        }}
        className={itemClass}
      >
        <ArrowDown className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Move down</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          run(deleteCurrentBlock);
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="size-4 shrink-0" />
        <span className="flex-1">Delete</span>
      </button>
    </div>,
    document.body,
  );
}
