"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The one drag handle used by every React reorderable row. Renders the shared
 * `.drag-handle` chrome from globals.css (a dense 2×3 grid of filled dots,
 * muted on rest / opaque on hover, grab cursor). Callers wire it up by passing
 * the ref from `useReorderHandle` and mark up `[data-reorder-group]` /
 * `[data-reorder-item]` on the surrounding list as usual.
 *
 * The DOM-side handles (block-handle.ts, notes-index-view.ts) construct their
 * own buttons but share the same `.drag-handle` class and inline an identical
 * SVG, so editing the class in globals.css restyles every handle in the app.
 */
export const DragHandle = forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type">
>(function DragHandle({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Reorder (drag, or focus and press up/down)"
      title="Drag to reorder (or focus and press ↑/↓)"
      className={cn("drag-handle touch-none", className)}
      {...props}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="6" cy="3" r="1.3" />
        <circle cx="10" cy="3" r="1.3" />
        <circle cx="6" cy="8" r="1.3" />
        <circle cx="10" cy="8" r="1.3" />
        <circle cx="6" cy="13" r="1.3" />
        <circle cx="10" cy="13" r="1.3" />
      </svg>
    </button>
  );
});
