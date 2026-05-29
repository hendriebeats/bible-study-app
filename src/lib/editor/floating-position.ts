/**
 * Shared helper for floating popups (selection bubble, note popover) that need
 * to sit next to an editor-relative anchor — usually a selection rect or a
 * caret — while staying inside the viewport.
 *
 * Returns a top-left corner so callers don't need to combine `style.left` with
 * a `transform: translateX(-50%)` to fake centering. Pass `align: "center"` for
 * the centred case and we'll do the math.
 */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export interface PlacementOptions {
  /** Pixels of gap between the anchor and the popup. Default 8. */
  gap?: number;
  /** Minimum distance from any viewport edge. Default 8. */
  margin?: number;
  /** Try this side first; flip when there isn't enough room. Default "below". */
  preferred?: "above" | "below";
  /**
   * Horizontal alignment over the anchor. "center" centres the popup over the
   * anchor (selection-bubble style); "start" aligns left edges (note-popover
   * style). Both are clamped to the viewport.
   */
  align?: "center" | "start";
  /** Override the viewport for testing. */
  viewport?: { width: number; height: number };
}

export interface Placement {
  /** Top-left X of the popup, viewport-clamped. */
  left: number;
  /** Top-left Y of the popup, viewport-clamped. */
  top: number;
  /** Which side it ended up on — useful for arrow / shadow direction. */
  side: "above" | "below";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Position a popup of {@link PopupSize} next to {@link AnchorRect}. The result
 * is the top-left corner the caller should write to `style.left` / `style.top`
 * (or equivalent).
 */
export function placeNearAnchor(
  anchor: AnchorRect,
  size: PopupSize,
  options: PlacementOptions = {},
): Placement {
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const preferred = options.preferred ?? "below";
  const align = options.align ?? "start";
  const viewport = options.viewport ?? {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // Horizontal: centre over the anchor or left-align with it, then clamp.
  let left: number;
  if (align === "center") {
    left = (anchor.left + anchor.right) / 2 - size.width / 2;
  } else {
    left = anchor.left;
  }
  // `Math.max(margin, …)` keeps the clamp range valid when the popup is wider
  // than the viewport (no negative max) — we still pin to the left margin.
  left = clamp(
    left,
    margin,
    Math.max(margin, viewport.width - size.width - margin),
  );

  // Vertical: try the preferred side; flip when it doesn't fit and the other
  // side does. When neither fits, keep the preferred side (the final clamp
  // pulls it inside the viewport, accepting overlap with the anchor).
  const fitsAbove = anchor.top - gap - size.height >= margin;
  const fitsBelow =
    anchor.bottom + gap + size.height <= viewport.height - margin;
  let side: "above" | "below";
  if (preferred === "above") {
    side = fitsAbove || !fitsBelow ? "above" : "below";
  } else {
    side = fitsBelow || !fitsAbove ? "below" : "above";
  }
  let top =
    side === "above" ? anchor.top - gap - size.height : anchor.bottom + gap;
  top = clamp(
    top,
    margin,
    Math.max(margin, viewport.height - size.height - margin),
  );

  return { left, top, side };
}
