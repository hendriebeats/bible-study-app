"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { clearCustomColors, removeCustomColor } from "@/app/account/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { parseOklch } from "@/lib/editor/oklch";
import { styleBackgroundColor, styleColor } from "@/lib/theme/style-color";
import { cn } from "@/lib/utils";

type SwatchKind = "highlight" | "text";

interface PendingTarget {
  kind: SwatchKind;
  color: string;
}

/**
 * The "your custom colours" card on Account → Preferences. Renders a read-only
 * preview of the two MRU lists the selection-bubble accumulates as the user
 * picks custom colours during writing, plus a confirm-gated Clear button and
 * a per-swatch hover-✕ for pruning individual entries.
 *
 * Server-rendered initial values are passed in so the card mirrors what the
 * editor would see; subsequent local edits don't matter — picking happens on
 * the study page, not here. (No add/edit UI on purpose: the picker on the
 * selection bubble is the canonical place to curate, and a duplicate manager
 * here would split the mental model.)
 */
export function CustomColorsPreview({
  initialHighlights,
  initialTextColors,
}: {
  initialHighlights: readonly string[];
  initialTextColors: readonly string[];
}) {
  const [highlights, setHighlights] =
    useState<readonly string[]>(initialHighlights);
  const [textColors, setTextColors] =
    useState<readonly string[]>(initialTextColors);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const empty = highlights.length === 0 && textColors.length === 0;

  const onClear = () => {
    startTransition(async () => {
      const result = await clearCustomColors();
      if (result.ok) {
        setHighlights([]);
        setTextColors([]);
        toast.success("Custom colours cleared.");
      } else {
        toast.error(result.error || "Couldn't clear your custom colours.");
      }
      setConfirmClearOpen(false);
    });
  };

  const onRemoveConfirm = () => {
    const target = pendingTarget;
    if (!target) return;
    startTransition(async () => {
      const result = await removeCustomColor(target.kind, target.color);
      if (result.ok) {
        if (target.kind === "highlight") {
          setHighlights((prev) => prev.filter((c) => c !== target.color));
        } else {
          setTextColors((prev) => prev.filter((c) => c !== target.color));
        }
      } else {
        toast.error(result.error || "Couldn't remove that colour.");
      }
      setPendingTarget(null);
    });
  };

  return (
    <section className="space-y-4 border-t border-border/60 pt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-subheading font-semibold">Your custom colours</h2>
          <p className="text-ui text-muted-foreground">
            Picked from the selection menu while you write. They auto-roll off
            after the eight most-recent of each kind.
          </p>
        </div>
        {!empty ? (
          <button
            type="button"
            onClick={() => {
              setConfirmClearOpen(true);
            }}
            disabled={pending}
            className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-ui transition-colors hover:bg-muted disabled:opacity-60"
          >
            Clear
          </button>
        ) : null}
      </div>
      {empty ? (
        <p className="rounded-md border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-caption text-muted-foreground">
          Pick a custom colour from the selection menu in a study to see it
          here.
        </p>
      ) : (
        <div className="grid gap-4">
          <SwatchRow
            label="Custom highlights"
            colors={highlights}
            kind="highlight"
            onRemove={(color) => {
              setPendingTarget({ kind: "highlight", color });
            }}
            pendingColor={
              pendingTarget?.kind === "highlight" ? pendingTarget.color : null
            }
            pending={pending}
          />
          <SwatchRow
            label="Custom text colours"
            colors={textColors}
            kind="text"
            onRemove={(color) => {
              setPendingTarget({ kind: "text", color });
            }}
            pendingColor={
              pendingTarget?.kind === "text" ? pendingTarget.color : null
            }
            pending={pending}
          />
        </div>
      )}
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear your custom colours?"
        description="This empties the custom highlight and text-colour rows in the selection menu. Colours already applied to your studies stay as they are."
        confirmLabel={pending ? "Clearing…" : "Clear"}
        pending={pending}
        destructive
        onConfirm={onClear}
      />
      <ConfirmDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setPendingTarget(null);
        }}
        title="Remove this colour?"
        description="Removes it from this row in the selection menu. Colours already applied to your studies stay as they are."
        confirmLabel={pending ? "Removing…" : "Remove"}
        pending={pending}
        destructive
        onConfirm={onRemoveConfirm}
      />
    </section>
  );
}

function SwatchRow({
  label,
  colors,
  kind,
  onRemove,
  pendingColor,
  pending,
}: {
  label: string;
  colors: readonly string[];
  kind: SwatchKind;
  onRemove: (color: string) => void;
  pendingColor: string | null;
  pending: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {colors.length === 0 ? (
        <span className="text-caption text-muted-foreground">None yet.</span>
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5">
          {colors.map((color) => {
            const isPending = pending && pendingColor === color;
            // Persisted recents are plain strings — validate at the
            // boundary so a malformed entry can't reach an inline style.
            const parsed = parseOklch(color);
            return (
              <li key={color} className="group relative">
                <span
                  title={color}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md ring-1 ring-foreground/10 transition-opacity",
                    isPending && "opacity-50",
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
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onRemove(color);
                  }}
                  disabled={pending}
                  aria-label={`Remove ${color}`}
                  className={cn(
                    "absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground shadow-sm transition-opacity",
                    "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
                    "hover:bg-muted hover:text-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  <X className="size-2.5" strokeWidth={2.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
