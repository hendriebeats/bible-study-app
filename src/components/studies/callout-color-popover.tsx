"use client";

import { useEffect, useState } from "react";

import { ToneSwatchPicker } from "@/components/studies/tone-swatch-picker";
import { PopoverContent, VirtualAnchorPopover } from "@/components/ui/popover";
import { type BlockTone, normalizeTone } from "@/lib/editor/block-tones";
import {
  CALLOUT_COLOR_EVENT,
  type CalloutColorEventDetail,
} from "@/lib/editor/plugins/callout-color-events";

/**
 * Top-level mount that listens for `CALLOUT_COLOR_EVENT` (fired by the
 * callout's color chip click in `CalloutView`) and renders the shared
 * {@link ToneSwatchPicker} as a positioned popover. Picking a swatch calls
 * the event-supplied `onPick` callback which the NodeView wires to a
 * `setNodeMarkup` transaction.
 *
 * Uses {@link VirtualAnchorPopover} so the popover gets the same flip /
 * shift / shrink-to-fit-viewport behaviour as every other popover in the
 * app — no hand-rolled clamping or outside-click handling.
 */
export function CalloutColorPopover() {
  const [detail, setDetail] = useState<CalloutColorEventDetail | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const e = event as CustomEvent<CalloutColorEventDetail>;
      setDetail(e.detail);
    };
    window.addEventListener(CALLOUT_COLOR_EVENT, onOpen);
    return () => {
      window.removeEventListener(CALLOUT_COLOR_EVENT, onOpen);
    };
  }, []);

  if (!detail) return null;

  const handlePick = (tone: BlockTone): void => {
    detail.onPick(tone);
    setDetail(null);
  };

  return (
    <VirtualAnchorPopover
      rect={{ x: detail.x, y: detail.y }}
      open
      onOpenChange={(next) => {
        if (!next) setDetail(null);
      }}
    >
      <PopoverContent
        role="menu"
        aria-label="Pick callout color"
        side="bottom"
        align="start"
        sideOffset={4}
        className="p-2"
        // Keep ProseMirror selection alive when clicking a swatch — without
        // this the editor loses focus before the swatch's onPick runs.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
      >
        <ToneSwatchPicker
          value={normalizeTone(detail.currentTone)}
          onChange={handlePick}
        />
      </PopoverContent>
    </VirtualAnchorPopover>
  );
}
