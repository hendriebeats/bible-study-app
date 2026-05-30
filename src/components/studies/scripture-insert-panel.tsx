"use client";

import { BookOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { saveScriptureOptions } from "@/app/account/actions";
import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_SCRIPTURE_OPTIONS,
  type ScriptureLayout,
  type ScriptureOptions,
} from "@/lib/scripture/options";
import { cn } from "@/lib/utils";

/** Boolean-valued keys of ScriptureOptions, for the include-section checkboxes. */
type BoolKey = {
  [K in keyof ScriptureOptions]: ScriptureOptions[K] extends boolean
    ? K
    : never;
}[keyof ScriptureOptions];

/**
 * Layout choices, ordered the way users tend to scan them — densest first
 * (one block), then verse-per-line, then translator paragraphs. Rendered as
 * a tab strip rather than discrete buttons because they're mutually
 * exclusive (one layout active at a time).
 */
const LAYOUTS: { value: ScriptureLayout; label: string }[] = [
  { value: "single-block", label: "One block" },
  { value: "verse-per-line", label: "Verse per line" },
  { value: "translator-paragraphs", label: "Paragraphs" },
];

const TOGGLES: { key: BoolKey; label: string }[] = [
  { key: "preservePoetry", label: "Poetry line breaks" },
  { key: "includeSelahs", label: "Selahs" },
  { key: "smallCaps", label: "Small caps (Lord)" },
];

/**
 * Combined toolbar button + popover for inserting scripture. Built on the
 * shared `<Popover>` primitive (Radix-backed) so it picks up the standard
 * viewport-collision behaviour every popover in the app should have: portaled
 * out of layout, flips above/below when there's no room, and shrinks to the
 * available viewport space (with scroll inside) when neither side fully fits.
 *
 * `scriptureOpen` still lives in the editor context so the empty-state Study
 * Body overlay (in DocumentEditor) can open the same popover by toggling
 * the context flag — no separate prop drilling.
 */
export function ScriptureControl({
  size = "icon",
  disabled = false,
}: {
  size?: "icon" | "sm";
  /** Render disabled (kept in place, not removed) — used by the toolbar when
   * the caret is inside a `note_entry`, where inserting scripture into the
   * notes editor while typing in a popover-relocated note body is incoherent. */
  disabled?: boolean;
}) {
  const ctx = useEditorContext();
  const open = ctx?.scriptureOpen ?? false;
  const setOpen = ctx?.setScriptureOpen;

  if (!ctx || !setOpen) return null;

  // When disabled, render just the button (no popover wiring) so a stale
  // `open === true` from a prior state can't pop the panel over the toolbar.
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={size}
            variant="ghost"
            aria-label="Insert scripture"
            disabled
          >
            <BookOpen className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Insert scripture</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size={size}
              variant={open ? "secondary" : "ghost"}
              aria-label="Insert scripture"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
            >
              <BookOpen className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Insert scripture</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        role="dialog"
        aria-label="Insert scripture"
        // `w-max` lets the popover size to its widest content (the
        // remember-defaults checkbox row is currently the long one, with its
        // no-wrap label), so it always has comfortable right padding rather
        // than crowding the text against the border. `min-w-80` keeps a sane
        // minimum when the content happens to be narrower; the wrapper's
        // `max-w-(--radix-popover-content-available-width)` clamps wider than
        // the viewport on tiny screens.
        className="w-max max-w-md min-w-80"
        // Let the Reference `<Input autoFocus>` keep initial focus. Without
        // this, Radix's focus scope sometimes races and parks focus on the
        // dialog wrapper.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <ScriptureForm
          onClose={() => {
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The form inside the popover: reference input, layout tabs, include
 * checkboxes, remember-default toggle, Add/Cancel. Reads prefill from the
 * editor context and dispatches `insertScripture` on submit.
 */
function ScriptureForm({ onClose }: { onClose: () => void }) {
  const ctx = useEditorContext();
  const [reference, setReference] = useState(() => ctx?.prefillReference ?? "");
  const [options, setOptions] = useState<ScriptureOptions>(
    () => ctx?.scriptureOptions ?? DEFAULT_SCRIPTURE_OPTIONS,
  );
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!ctx) return null;
  const { insertScripture } = ctx;

  function toggle(key: BoolKey) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setLayout(value: ScriptureLayout) {
    setOptions((prev) => ({ ...prev, layout: value }));
  }

  async function submit() {
    const trimmed = reference.trim();
    if (trimmed === "") return;
    setBusy(true);
    const result = await insertScripture(trimmed, options);
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error ?? "Couldn't add that passage.");
      return;
    }
    if (remember) {
      const saved = await saveScriptureOptions(options);
      if (!saved.ok) {
        toast.error("Passage added, but couldn't save your defaults.");
      }
    }
    setBusy(false);
    onClose();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="e.g. John 3:1-21"
          aria-label="Scripture reference"
          className="h-8 flex-1"
          autoFocus
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || reference.trim() === ""}
          onClick={() => {
            void submit();
          }}
        >
          Add
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
          Layout
        </span>
        {/*
          Tab-strip: a single bordered/rounded container with the three
          choices as segmented buttons. The active layout gets the solid
          background; inactive layouts read as their hover affordance.
        */}
        <div
          role="tablist"
          aria-label="Scripture layout"
          className="inline-flex w-full rounded-md border bg-muted/40 p-0.5"
        >
          {LAYOUTS.map((layout) => {
            const active = options.layout === layout.value;
            return (
              <button
                key={layout.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setLayout(layout.value);
                }}
                className={cn(
                  // `whitespace-nowrap` keeps each label on one line; the
                  // popover's width gives all three labels enough room in the
                  // common case. Falling back to a wrap only happens when the
                  // available width is genuinely insufficient (e.g. a very
                  // narrow editor pane), which is what the user wants.
                  "flex-1 rounded-sm px-2 py-1 text-caption font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {layout.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
          Include
        </span>
        <div className="flex flex-col gap-1">
          {TOGGLES.map(({ key, label }) => {
            // Poetry breaks are meaningless for a single continuous block.
            const disabled =
              key === "preservePoetry" && options.layout === "single-block";
            return (
              <Label
                key={key}
                className={cn(
                  "flex items-center gap-2 text-ui font-normal",
                  disabled ? "text-muted-foreground/60" : "text-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={options[key]}
                  disabled={disabled}
                  onChange={() => {
                    toggle(key);
                  }}
                  className="size-4 accent-primary"
                />
                {label}
              </Label>
            );
          })}
        </div>
      </div>

      {/*
        Separator visually segregates the "remember" preference from the
        per-insert options above — it's a different kind of choice (persisted
        defaults vs. one-shot adjustments).
      */}
      <Separator className="my-0" />

      <Label className="flex items-center gap-2 text-ui font-normal whitespace-nowrap text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
          }}
          className="size-4 shrink-0 accent-primary"
        />
        Remember these settings as my default
      </Label>
    </div>
  );
}
