"use client";

import { Check } from "lucide-react";

import { BLOCK_TONES, type BlockTone } from "@/lib/editor/block-tones";
import { cn } from "@/lib/utils";

/**
 * Shared tone-swatch grid used by:
 *   - the Edit-Study-Blocks dialog's per-action color submenu (action bars)
 *   - the callout's inline color popover
 *
 * Two horizontal rows — grayscale (default / stone / slate) on top, accents
 * (sky / amber / coral / plum / sage) below — built from {@link BLOCK_TONES}
 * so adding a tone is a one-file change. Swatches show the actual on-page
 * background color via `--tone-{id}-bg`, so picking is WYSIWYG. The active
 * tone gets a check overlay.
 */
export function ToneSwatchPicker({
  value,
  onChange,
}: {
  value: BlockTone;
  onChange: (tone: BlockTone) => void;
}) {
  const grays = BLOCK_TONES.filter((t) => t.group === "gray");
  const accents = BLOCK_TONES.filter((t) => t.group === "accent");
  return (
    <div className="flex flex-col gap-1.5">
      <ToneSwatchRow tones={grays} value={value} onChange={onChange} />
      <ToneSwatchRow tones={accents} value={value} onChange={onChange} />
    </div>
  );
}

function ToneSwatchRow({
  tones,
  value,
  onChange,
}: {
  tones: readonly { id: BlockTone; label: string }[];
  value: BlockTone;
  onChange: (tone: BlockTone) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {tones.map((tone) => (
        <button
          key={tone.id}
          type="button"
          aria-label={tone.label}
          aria-pressed={tone.id === value}
          title={tone.label}
          onClick={() => {
            onChange(tone.id);
          }}
          className={cn(
            "relative size-7 rounded-md border transition-colors",
            tone.id === value
              ? "border-ring ring-2 ring-ring/30"
              : "border-border hover:border-ring/60",
          )}
          style={{ background: `var(--tone-${tone.id}-bg)` }}
        >
          {tone.id === value ? (
            <Check
              aria-hidden
              className="absolute inset-0 m-auto size-4 text-foreground"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
