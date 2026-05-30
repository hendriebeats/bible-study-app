"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { Measurable } from "@radix-ui/rect";

import { cn } from "@/lib/utils";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverPortal({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Portal>) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

function PopoverClose({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

/**
 * Standard popover content. Defaults are tuned so popovers never grow page
 * scroll on small viewports:
 *
 *  - Portaled, so they escape any ancestor with `overflow:hidden` /
 *    `relative` that would otherwise extend the document's scroll height.
 *  - `avoidCollisions` (default `true`) flips to the opposite side when the
 *    preferred side overflows, and shifts perpendicular to keep content
 *    visible.
 *  - `max-h-(--radix-popover-content-available-height)` +
 *    `max-w-(--radix-popover-content-available-width)` cap content to the
 *    final placement's available space, and `overflow-y-auto` lets it scroll
 *    inside when neither side has enough room. So "neither flip side fits"
 *    becomes "popover shrinks and scrolls" rather than "page grows scroll
 *    height".
 *
 * Mirrors `dropdown-menu.tsx`'s styling (bg-popover, ring, shadow, slide-in
 * animations) so popover and dropdown read as the same family.
 *
 * Consumers can override `side`, `align`, `sideOffset`, etc. via props.
 */
function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * Rect in viewport coordinates. `width`/`height` default to 0 — pass `{x, y}`
 * alone to anchor to a point.
 */
export interface VirtualRect {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function rectToDOMRect(rect: VirtualRect): DOMRect {
  const w = rect.width ?? 0;
  const h = rect.height ?? 0;
  return {
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    width: w,
    height: h,
    right: rect.x + w,
    bottom: rect.y + h,
    toJSON() {
      return this;
    },
  };
}

/**
 * A `<Popover>` whose anchor is a virtual rect in viewport coordinates rather
 * than a DOM element. Use this for popovers that are anchored to a computed
 * position — selection rects, click points, editor coordinates — instead of a
 * trigger element.
 *
 * Radix Popper's flip / shift / size middleware runs against the virtual
 * anchor exactly as it would against a real element, so the rendered
 * `<PopoverContent>` gets the same automatic viewport-collision behaviour as
 * a trigger-anchored popover.
 *
 * @example
 * ```tsx
 * <VirtualAnchorPopover
 *   rect={{ x: clickX, y: clickY }}
 *   open
 *   onOpenChange={(o) => { if (!o) close(); }}
 * >
 *   <PopoverContent side="bottom" align="start">…</PopoverContent>
 * </VirtualAnchorPopover>
 * ```
 *
 * The popover stays open as long as `open` is `true`; `onOpenChange(false)`
 * fires when the user clicks outside or presses Escape, so the caller is
 * responsible for resetting its "what to anchor to" state in that handler.
 */
function VirtualAnchorPopover({
  rect,
  open,
  onOpenChange,
  children,
}: {
  rect: VirtualRect;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  // Radix watches the ref's identity, not the rect closure. Keep the ref
  // stable and mutate its `getBoundingClientRect` on every rect change so
  // Floating UI re-reads the latest coordinates on its next measure (scroll,
  // resize, anchor-position update).
  const virtualRef = React.useRef<Measurable>({
    getBoundingClientRect: () => rectToDOMRect(rect),
  });
  React.useEffect(() => {
    virtualRef.current = {
      getBoundingClientRect: () => rectToDOMRect(rect),
    };
  }, [rect]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      {children}
    </Popover>
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
  VirtualAnchorPopover,
};
