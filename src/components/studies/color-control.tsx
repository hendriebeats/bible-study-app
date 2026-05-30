"use client";

import { Baseline, Highlighter, Palette, X } from "lucide-react";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import { CustomColorPicker } from "@/components/studies/custom-color-picker";
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
import { type OklchColor, parseOklch } from "@/lib/editor/oklch";
import { marks } from "@/lib/editor/schema";
import { styleBackgroundColor, styleColor } from "@/lib/theme/style-color";
import { cn } from "@/lib/utils";

/**
 * The ProseMirror selection range captured at the moment the user opened the
 * custom-colour picker. We restore it on apply so the mark lands on the
 * originally-selected text even though react-colorful's pointer-capture
 * machinery calls `el.focus()` on mousedown — that focus theft would
 * otherwise have collapsed the live selection by the time the user clicks
 * Apply, leaving `setColorMark` to fall through the `empty` branch and add
 * only a `storedMark` (visible on the next typed character, not on the
 * already-highlighted text).
 */
interface CapturedRange {
  view: EditorView;
  from: number;
  to: number;
}

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
 *
 * When the user has opted into custom colours (Account → Preferences → Editor
 * tools → Custom colours), the popover grows a second row of their custom MRU
 * swatches plus a "+ Custom" chip that swaps the palette grid for the inline
 * picker. The picker enforces 4.5:1 contrast at the UI level so it isn't
 * possible to apply an unreadable colour. See [[selection-bubble-and-color-
 * marks]] for the wider design.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const capturedRangeRef = useRef<CapturedRange | null>(null);

  // Close on a click outside the control or on Escape. The popover always
  // re-opens onto the preset grid, so picker-state is reset wherever we set
  // `open` to false (no useEffect needed to mirror open → !pickerOpen).
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
        setPickerOpen(false);
        capturedRangeRef.current = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pickerOpen) {
          // Esc inside the picker closes the picker first, leaving the
          // popover open so the user can pick from presets/recents.
          setPickerOpen(false);
          capturedRangeRef.current = null;
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, pickerOpen]);

  if (!ctx) {
    return null;
  }

  const {
    activeState,
    runFormatAction,
    editorTools,
    customHighlights,
    customTextColors,
    applyCustomColor,
    forgetCustomColor,
  } = ctx;
  const isHighlight = kind === "highlight";
  const markType = isHighlight ? marks.highlight : marks.textColor;
  const palette = isHighlight ? HIGHLIGHT_COLORS : TEXT_COLORS;
  const customRecents = isHighlight ? customHighlights : customTextColors;
  const surface: "highlight" | "textColor" = isHighlight
    ? "highlight"
    : "textColor";
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
  // colour as a hint of what a recent re-apply would use. Validate through
  // `parseOklch` so a malformed persisted value can't reach the inline style
  // — falls back to the surface's default colour (always a valid OklchColor).
  const rawIndicator = activeColor ?? lastColor;
  const indicator: OklchColor =
    typeof rawIndicator === "string"
      ? (parseOklch(rawIndicator) ?? fallback)
      : fallback;

  const select = (color: string) => {
    runFormatAction(
      isHighlight ? { type: "highlight", color } : { type: "textColor", color },
    );
    setOpen(false);
  };

  const selectCustom = (color: string) => {
    applyCustomColor(surface, color);
    setOpen(false);
  };

  /**
   * Restore the selection we captured when "+ Custom" was opened. Without
   * this, react-colorful's focus-stealing leaves `state.selection` collapsed
   * by the time Apply fires — the doc receives a stored mark instead of a
   * range mark, so the highlight only "sticks" while the bubble's residual
   * selection paints it and vanishes when the user clicks away.
   */
  const restoreCapturedSelection = () => {
    const captured = capturedRangeRef.current;
    if (!captured) return;
    const { view, from, to } = captured;
    const docSize = view.state.doc.content.size;
    if (from < 0 || to > docSize || from === to) return;
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, from, to),
    );
    view.dispatch(tr);
  };

  const handlePickerApply = (color: string) => {
    restoreCapturedSelection();
    applyCustomColor(surface, color);
    capturedRangeRef.current = null;
    setPickerOpen(false);
    setOpen(false);
  };

  /**
   * Open the picker. Snapshot the active editor's current selection range so
   * we can restore it on apply (see {@link restoreCapturedSelection}).
   */
  const openPicker = () => {
    const view = ctx.activeView;
    if (view) {
      const { from, to } = view.state.selection;
      if (from !== to) {
        capturedRangeRef.current = { view, from, to };
      }
    }
    setPickerOpen(true);
  };

  const customEnabled = editorTools.customColor;

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
              setOpen((o) => {
                // Re-opening the popover always lands on the preset grid.
                if (!o) setPickerOpen(false);
                return !o;
              });
            }}
          >
            <span className="relative flex items-center justify-center">
              <Icon className="size-4" />
              <span
                aria-hidden
                className="absolute -bottom-1 h-1 w-3.5 rounded-full"
                style={styleBackgroundColor(indicator)}
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
          className={cn(
            "absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-lg border bg-popover shadow-md ring-1 ring-foreground/10",
            pickerOpen ? "p-0" : "p-1",
          )}
        >
          {pickerOpen ? (
            <CustomColorPicker
              surface={surface}
              initial={activeColor ?? lastColor}
              onApply={handlePickerApply}
              onCancel={() => {
                setPickerOpen(false);
                capturedRangeRef.current = null;
              }}
            />
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
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
                          ? styleBackgroundColor(color.value)
                          : undefined
                      }
                    >
                      {kind === "text" ? (
                        <span
                          className="text-ui leading-none font-semibold"
                          style={styleColor(color.value)}
                        >
                          A
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {customEnabled ? (
                <div className="flex items-center gap-1 border-t border-border/60 pt-1">
                  {customRecents.map((color) => {
                    const isActive = activeColor === color;
                    return (
                      <CustomSwatch
                        key={color}
                        kind={kind}
                        color={color}
                        label={label}
                        active={isActive}
                        onPick={() => {
                          selectCustom(color);
                        }}
                        onForget={() => {
                          forgetCustomColor(surface, color);
                        }}
                      />
                    );
                  })}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Custom ${label.toLowerCase()}`}
                        onClick={openPicker}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Palette className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Custom colour</TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One custom-recent swatch. Hover surfaces a tiny × that removes the colour
 * from the user's MRU list without applying it — matches Notion / Figma's
 * lightweight "right-click to remove" affordance via a visible target so
 * touch users (no right-click) can still reach it.
 */
function CustomSwatch({
  kind,
  color,
  label,
  active,
  onPick,
  onForget,
}: {
  kind: Kind;
  color: string;
  label: string;
  active: boolean;
  onPick: () => void;
  onForget: () => void;
}) {
  // Custom-recents are persisted as plain strings — validate at the boundary
  // so a malformed entry can't reach an inline style.
  const parsed = parseOklch(color);
  return (
    <span className="group relative">
      <button
        type="button"
        aria-label={`${label} custom colour`}
        aria-pressed={active}
        title={color}
        onClick={onPick}
        onContextMenu={(event) => {
          // Right-click also removes (matches Notion). Suppress the native
          // context menu so the gesture lands cleanly.
          event.preventDefault();
          onForget();
        }}
        className={cn(
          "flex size-6 items-center justify-center rounded-md ring-1 ring-foreground/10 transition-transform hover:scale-110",
          active && "ring-2 ring-ring",
        )}
        style={
          kind === "highlight" && parsed
            ? styleBackgroundColor(parsed)
            : undefined
        }
      >
        {kind === "text" && parsed ? (
          <span
            className="text-ui leading-none font-semibold"
            style={styleColor(parsed)}
          >
            A
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label="Remove this colour"
        onClick={(event) => {
          event.stopPropagation();
          onForget();
        }}
        className="absolute -top-1.5 -right-1.5 hidden size-3.5 items-center justify-center rounded-full bg-foreground text-background ring-1 ring-popover group-hover:flex"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}
