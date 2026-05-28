"use client";

import {
  Bold,
  Italic,
  MessageSquarePlus,
  RemoveFormatting,
  Strikethrough,
} from "lucide-react";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { ColorControl } from "@/components/studies/color-control";
import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { clearFormatting, isMarkActive } from "@/lib/editor/commands";
import type { FormatAction } from "@/lib/editor/format-actions";
import { colorName } from "@/lib/editor/format-colors";
import { marks } from "@/lib/editor/schema";

/** Gap (px) between the selection and the bubble. */
const GAP = 8;
/** How many recents the bubble shows (kept small so it stays minimal). */
const RECENTS_SHOWN = 3;
/** Stable empty fallback so effect deps don't change every render. */
const EMPTY_RECENTS: FormatAction[] = [];

interface Rect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * The selection's screen rectangle. Prefer the native selection rect (handles
 * multi-line cleanly); fall back to ProseMirror's `coordsAtPos` if the native
 * range is unavailable.
 */
function selectionRect(view: EditorView): Rect | null {
  const native = window.getSelection();
  if (native && native.rangeCount > 0 && !native.isCollapsed) {
    const r = native.getRangeAt(0).getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      return { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
    }
  }
  const { from, to } = view.state.selection;
  try {
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to, -1);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    return {
      left,
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      width: right - left,
    };
  } catch {
    return null;
  }
}

function actionLabel(action: FormatAction): string {
  switch (action.type) {
    case "highlight":
      return `Highlight ${colorName(action.color)}`;
    case "textColor":
      return `Text ${colorName(action.color)}`;
    case "bold":
      return "Bold";
    case "italic":
      return "Italic";
    case "strike":
      return "Strikethrough";
  }
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}

/** A small visual for a recent action: a colour swatch, or the mark's glyph. */
function ActionGlyph({ action }: { action: FormatAction }) {
  if (action.type === "highlight") {
    return (
      <span
        aria-hidden
        className="size-3.5 rounded-sm ring-1 ring-foreground/15"
        style={{ backgroundColor: action.color }}
      />
    );
  }
  if (action.type === "textColor") {
    return (
      <span
        aria-hidden
        className="text-sm leading-none font-semibold"
        style={{ color: action.color }}
      >
        A
      </span>
    );
  }
  const Icon =
    action.type === "bold"
      ? Bold
      : action.type === "italic"
        ? Italic
        : Strikethrough;
  return <Icon className="size-3.5" />;
}

/**
 * A minimal floating toolbar that appears above a non-empty text selection
 * (Medium/Notion style). It targets the focused editor via the shared editor
 * context — the same single `activeView` the top toolbar acts on — so one
 * instance serves a section's notes and study-blocks editors.
 *
 * Deliberately leaner than the top toolbar: recently-used quick actions plus
 * highlight/text colour (shared {@link ColorControl}s), the basic character
 * marks, and clear-formatting. All controls `preventDefault` their mousedown so
 * clicking them never blurs the editor or collapses the selection. Positioning
 * is done imperatively against the bubble ref (an "update an external system"
 * effect) rather than through state, so it doesn't churn renders.
 */
export function SelectionBubble() {
  const ctx = useEditorContext();
  const bubbleRef = useRef<HTMLDivElement>(null);

  const [dragging, setDragging] = useState(false);
  const [tick, setTick] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const activeView = ctx?.activeView ?? null;
  const activeState = ctx?.activeState ?? null;
  const formatRecents = ctx?.formatRecents;
  const selection = activeState?.selection ?? null;
  const isText = selection instanceof TextSelection;
  const selKey =
    selection && !selection.empty
      ? `${String(selection.from)}-${String(selection.to)}`
      : null;
  const focused = !!activeView && activeView.hasFocus();

  const visible =
    !!selection &&
    !selection.empty &&
    isText &&
    focused &&
    !dragging &&
    dismissedKey !== selKey;

  // Hide while a new selection is being dragged; reposition on scroll/resize;
  // re-render on focus changes so `visible` re-evaluates `activeView.hasFocus()`.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".ProseMirror")) {
        setDragging(true);
      }
    };
    const onMouseUp = () => {
      setDragging(false);
      requestAnimationFrame(() => {
        setTick((t) => t + 1);
      });
    };
    const reposition = () => {
      setTick((t) => t + 1);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("focusin", reposition);
    document.addEventListener("focusout", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("focusin", reposition);
      document.removeEventListener("focusout", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  // Escape dismisses the bubble for the current selection and refocuses the doc.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDismissedKey(selKey);
        activeView.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, selKey, activeView]);

  // Position the bubble imperatively: centred over the selection, above it
  // (flipping below when there's no room near the top), clamped to the viewport.
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) {
      return;
    }
    if (!visible) {
      el.style.visibility = "hidden";
      return;
    }
    const rect = selectionRect(activeView);
    if (!rect) {
      el.style.visibility = "hidden";
      return;
    }
    const half = el.offsetWidth / 2;
    const height = el.offsetHeight;
    const viewportWidth = window.innerWidth;
    let left = rect.left + rect.width / 2;
    left = Math.min(Math.max(left, half + 8), viewportWidth - half - 8);
    const above = rect.top - GAP - height >= 8;
    const top = above ? rect.top - GAP - height : rect.bottom + GAP;
    el.style.left = `${String(Math.round(left))}px`;
    el.style.top = `${String(Math.round(top))}px`;
    el.style.transform = "translateX(-50%)";
    el.style.visibility = "visible";
  }, [visible, selKey, tick, activeView, formatRecents]);

  if (!ctx || !visible || !activeState) {
    return null;
  }

  const { runCommand, runFormatAction, createNote, activeKind, editorTools } =
    ctx;
  const recents = formatRecents ?? EMPTY_RECENTS;
  // Notes anchor on the active editor's selection AND insert an entry into the
  // blocks doc's notes_index — neither concept exists for a dialog body editor
  // (its doc is standalone), so the button is hidden when a dialog is focused.
  const allowAddNote = activeKind !== "dialog";

  const handleAddNote = () => {
    const result = createNote();
    if (!result.ok) {
      toast.info(result.error ?? "Select some text to add a note.");
    }
  };

  const boldActive = isMarkActive(activeState, marks.strong);
  const italicActive = isMarkActive(activeState, marks.em);
  const strikeActive = isMarkActive(activeState, marks.strikethrough);

  // Filter the "recent formatting" row to actions whose underlying tool is
  // still enabled — e.g. if the user opts out of Strikethrough later, the
  // remembered strike chip shouldn't reappear here. Other recents (highlight /
  // textColor / bold / italic) are always available.
  const shownRecents = recents
    .filter((action) =>
      action.type === "strike" ? editorTools.strikethrough : true,
    )
    .slice(0, RECENTS_SHOWN);

  return createPortal(
    <div
      ref={bubbleRef}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      // Keep the editor focused (and its selection) when interacting.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      className="invisible fixed top-0 left-0 z-50 flex items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      // Sits above the blocks dialog's overlay (z-50) so the bubble is reachable
      // when the user selects text inside a dialog body editor.
      style={{ zIndex: 60 }}
    >
      {shownRecents.length > 0 ? (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="px-1 text-xs font-medium text-muted-foreground">
              Recent
            </span>
            <div className="flex items-center gap-0.5">
              {shownRecents.map((action) => (
                <Button
                  key={
                    action.type === "highlight" || action.type === "textColor"
                      ? `${action.type}:${action.color}`
                      : action.type
                  }
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${actionLabel(action)} (recent)`}
                  onClick={() => {
                    runFormatAction(action);
                  }}
                >
                  <ActionGlyph action={action} />
                </Button>
              ))}
            </div>
          </div>
          <span aria-hidden className="mx-0.5 w-px self-stretch bg-border" />
        </>
      ) : null}

      <div className="flex items-center gap-0.5 self-end">
        <ColorControl kind="highlight" />
        <ColorControl kind="text" />

        <Divider />

        <Button
          type="button"
          size="icon-sm"
          variant={boldActive ? "secondary" : "ghost"}
          aria-label="Bold"
          aria-pressed={boldActive}
          onClick={() => {
            runFormatAction({ type: "bold" });
          }}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant={italicActive ? "secondary" : "ghost"}
          aria-label="Italic"
          aria-pressed={italicActive}
          onClick={() => {
            runFormatAction({ type: "italic" });
          }}
        >
          <Italic className="size-4" />
        </Button>
        {editorTools.strikethrough ? (
          <Button
            type="button"
            size="icon-sm"
            variant={strikeActive ? "secondary" : "ghost"}
            aria-label="Strikethrough"
            aria-pressed={strikeActive}
            onClick={() => {
              runFormatAction({ type: "strike" });
            }}
          >
            <Strikethrough className="size-4" />
          </Button>
        ) : null}

        <Divider />

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Clear formatting"
          onClick={() => {
            runCommand(clearFormatting);
          }}
        >
          <RemoveFormatting className="size-4" />
        </Button>

        {allowAddNote ? (
          <>
            <Divider />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Add note"
              onClick={handleAddNote}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
