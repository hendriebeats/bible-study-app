"use client";

import { Check, ChevronDown } from "lucide-react";

import { useStudyChrome } from "@/components/studies/study-chrome-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Zoom presets, in the order they appear in the dropdown. 1 = 100%. */
const ZOOM_LEVELS: readonly number[] = [
  0.5, 0.75, 0.9, 1, 1.25, 1.5, 2,
] as const;

/** Format a multiplier as a percent label (no trailing decimals). */
function formatZoom(level: number): string {
  return `${Math.round(level * 100).toString()}%`;
}

/**
 * Editor-zoom dropdown, sitting next to Undo/Redo in the toolbar's first
 * group. Reads/writes the session-only zoom on `StudyChromeContext`, which
 * publishes it as `--editor-zoom` on `<html>` so every `.ProseMirror` scales
 * (see `globals.css` `.ProseMirror { font-size: calc(1rem * var(--editor-zoom)) }`).
 *
 * Session-only by design: no migration, no per-study persistence — Google Docs
 * resets on reload too. If we revisit that, the seam is the chrome context.
 */
export function ZoomControl() {
  const chrome = useStudyChrome();
  if (!chrome) {
    return null;
  }
  const { editorZoom, setEditorZoom } = chrome;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Zoom (currently ${formatZoom(editorZoom)})`}
              // Keep the editor focused/selection intact when opening the menu.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              // Tabular-nums prevents the trigger from jiggling as the % digit-width
              // changes between 50% / 100% / 125%.
              className="gap-1 tabular-nums"
            >
              {formatZoom(editorZoom)}
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Zoom</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-28">
        {ZOOM_LEVELS.map((level) => {
          const active = level === editorZoom;
          return (
            <DropdownMenuItem
              key={level}
              onSelect={() => {
                setEditorZoom(level);
              }}
              className="justify-between tabular-nums"
            >
              <span>{formatZoom(level)}</span>
              {active ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
