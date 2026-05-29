"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ToneSwatchPicker } from "@/components/studies/tone-swatch-picker";
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
 * Same event/portal pattern the BlockMenu uses; one tone-swatch component
 * across the action-block dialog AND the callout (per user request: "I
 * literally want to use the same popover component of the color selector").
 */
export function CalloutColorPopover() {
  const [detail, setDetail] = useState<CalloutColorEventDetail | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!detail) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target;
      if (
        rootRef.current &&
        t instanceof Node &&
        !rootRef.current.contains(t)
      ) {
        setDetail(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [detail]);

  if (!detail) return null;

  const handlePick = (tone: BlockTone): void => {
    detail.onPick(tone);
    setDetail(null);
  };

  const left = Math.min(detail.x, window.innerWidth - 260);
  const top = Math.min(detail.y, window.innerHeight - 120);

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label="Pick callout color"
      className="fixed z-50 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
      style={{ left, top }}
    >
      <ToneSwatchPicker
        value={normalizeTone(detail.currentTone)}
        onChange={handlePick}
      />
    </div>,
    document.body,
  );
}
