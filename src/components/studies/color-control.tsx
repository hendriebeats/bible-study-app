"use client";

import { Baseline, Highlighter } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { markColorActive } from "@/lib/editor/commands";
import {
  colorName,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "@/lib/editor/format-colors";
import { marks } from "@/lib/editor/schema";
import { cn } from "@/lib/utils";

type Kind = "highlight" | "text";

/**
 * A highlight / text-colour control shared by the top toolbar and the selection
 * bubble. The icon's underline reflects the colour ACTIVE on the current
 * selection (falling back to the last-used colour as a hint), and the button is
 * "pressed" when the selection carries that colour. Clicking the icon opens a
 * swatch palette — no separate dropdown arrow.
 *
 * The palette is a self-positioned popover (not Radix) that `preventDefault`s
 * mousedown, so opening it and picking a colour never blurs the editor or
 * collapses the selection — which also keeps the bubble (whose visibility is
 * gated on editor focus) from disappearing out from under it.
 */
export function ColorControl({
  kind,
  size = "icon-sm",
}: {
  kind: Kind;
  size?: "icon" | "icon-sm";
}) {
  const ctx = useEditorContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on a click outside the control or on Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef.current &&
        target instanceof Node &&
        !rootRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!ctx) {
    return null;
  }

  const { activeState, runFormatAction } = ctx;
  const isHighlight = kind === "highlight";
  const markType = isHighlight ? marks.highlight : marks.textColor;
  const palette = isHighlight ? HIGHLIGHT_COLORS : TEXT_COLORS;
  const Icon = isHighlight ? Highlighter : Baseline;
  const label = isHighlight ? "Highlight" : "Text colour";
  const fallback = isHighlight ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_TEXT_COLOR;

  // Literal discriminants here let TS narrow `.find` to the colour-bearing
  // variant (inferred type predicate), so `.color` is well-typed.
  const lastColor =
    (isHighlight
      ? ctx.formatRecents.find((a) => a.type === "highlight")?.color
      : ctx.formatRecents.find((a) => a.type === "textColor")?.color) ??
    fallback;
  const activeColor = activeState
    ? markColorActive(activeState, markType)
    : null;
  // Underline shows the active selection colour when present, else the last
  // colour as a hint of what a recent re-apply would use.
  const indicator = activeColor ?? lastColor;

  const select = (color: string) => {
    runFormatAction(
      isHighlight ? { type: "highlight", color } : { type: "textColor", color },
    );
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={size}
            variant={activeColor ? "secondary" : "ghost"}
            aria-label={
              activeColor ? `${label} (${colorName(activeColor)})` : label
            }
            aria-pressed={Boolean(activeColor)}
            aria-haspopup="true"
            aria-expanded={open}
            disabled={!activeState}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            <span className="relative flex items-center justify-center">
              <Icon className="size-4" />
              <span
                aria-hidden
                className="absolute -bottom-1 h-1 w-3.5 rounded-full"
                style={{ backgroundColor: indicator }}
              />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {open ? (
        <div
          role="group"
          aria-label={`${label} colours`}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          className="absolute top-full left-1/2 z-50 mt-1 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-popover p-1 shadow-md ring-1 ring-foreground/10"
        >
          {palette.map((color) => {
            const isActive = activeColor === color.value;
            return (
              <button
                key={color.value}
                type="button"
                aria-label={`${label} ${color.name}`}
                aria-pressed={isActive}
                title={color.name}
                onClick={() => {
                  select(color.value);
                }}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md ring-1 ring-foreground/10 transition-transform hover:scale-110",
                  isActive && "ring-2 ring-ring",
                )}
                style={
                  kind === "highlight"
                    ? { backgroundColor: color.value }
                    : undefined
                }
              >
                {kind === "text" ? (
                  <span
                    className="text-sm leading-none font-semibold"
                    style={{ color: color.value }}
                  >
                    A
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
