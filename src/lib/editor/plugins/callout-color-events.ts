import type { BlockTone } from "../block-tones";

/**
 * Custom-event channel between `CalloutView` (vanilla DOM NodeView) and the
 * React `CalloutColorPopover` mount point. The chip click in the NodeView
 * fires this event with the chip's screen coords + a callback bound to the
 * specific callout; the React popover renders the shared tone-swatch picker
 * and routes the user's pick back through the callback.
 *
 * Mirrors `BLOCK_MENU_EVENT` in shape (custom event on window, detail
 * carries coords + a closure that mutates the editor state).
 */
export const CALLOUT_COLOR_EVENT = "pm-callout-color";

export interface CalloutColorEventDetail {
  /** Screen X of the popover's preferred top-left anchor (the chip rect). */
  x: number;
  /** Screen Y of the popover's preferred top-left anchor (just below the chip). */
  y: number;
  /** The callout's current tone, used to highlight the active swatch. */
  currentTone: string;
  /** Callback the React popover invokes with the user's pick. */
  onPick: (tone: BlockTone) => void;
}
