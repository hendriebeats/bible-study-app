"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useEditorContext } from "@/components/studies/editor-context";
import {
  getSlashState,
  runSlashCommand,
} from "@/lib/editor/plugins/slash-menu";
import { filterSlashCommands } from "@/lib/editor/slash-commands";
import { cn } from "@/lib/utils";

/** Approx popover width, used to keep it inside the viewport. */
const MENU_WIDTH = 256;

/**
 * The slash (`/`) command menu. Reads the active editor's slash state from the
 * editor context (the `slashMenu` plugin tracks it) and renders a popover of
 * matching commands at the caret. Owns keyboard nav (arrows / enter / tab /
 * escape) via a capture-phase listener so the editor doesn't also act on them.
 * Mirrors `SelectionBubble`: portals to `document.body`, never steals focus.
 *
 * The highlighted index is stamped with the current slash "key" (caret pos +
 * query) so it resets for free when the query changes — no reset effect needed.
 */
export function SlashMenu() {
  const ctx = useEditorContext();
  const [highlight, setHighlight] = useState<{
    key: string | null;
    index: number;
  }>({ key: null, index: 0 });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const activeState = ctx?.activeState ?? null;
  const activeView = ctx?.activeView ?? null;
  const tools = ctx?.editorTools ?? null;

  const slash = activeState ? getSlashState(activeState) : null;
  const slashActive = slash?.active ?? false;
  const slashQuery = slash?.query ?? "";
  const items =
    slashActive && tools ? filterSlashCommands(slashQuery, tools) : [];
  const stateKey = slash?.active
    ? `${String(slash.from)}:${slash.query}`
    : null;
  const open =
    Boolean(slash?.active) && items.length > 0 && dismissedKey !== stateKey;
  const index = highlight.key === stateKey ? highlight.index : 0;

  useEffect(() => {
    if (!open || !activeView || stateKey === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const list = tools ? filterSlashCommands(slashQuery, tools) : [];
      if (list.length === 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setHighlight({ key: stateKey, index: (index + 1) % list.length });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setHighlight({
          key: stateKey,
          index: (index - 1 + list.length) % list.length,
        });
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const entry = list[index];
        if (entry) {
          runSlashCommand(activeView, entry);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedKey(stateKey);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, activeView, tools, slashQuery, index, stateKey]);

  if (!open || !activeView || !slash) {
    return null;
  }

  const coords = activeView.coordsAtPos(slash.from);
  const left = Math.max(
    8,
    Math.min(coords.left, window.innerWidth - MENU_WIDTH - 8),
  );
  const top = coords.bottom + 4;

  return createPortal(
    <div
      role="listbox"
      aria-label="Insert block"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      // zIndex 60 puts the menu above the blocks-dialog overlay (z-50).
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 60 }}
      className="z-50 max-h-72 overflow-auto rounded-lg border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const active = i === index;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={active}
            onMouseEnter={() => {
              setHighlight({ key: stateKey, index: i });
            }}
            onClick={() => {
              runSlashCommand(activeView, item);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              active ? "bg-muted text-foreground" : "text-foreground/80",
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
