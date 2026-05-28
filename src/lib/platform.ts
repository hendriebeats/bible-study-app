import { useSyncExternalStore } from "react";

/** Stable, no-emit subscriber. The platform doesn't change at runtime. */
const noopSubscribe = () => () => undefined;

/**
 * Whether the user is on macOS (or iOS). Used to render the right modifier
 * glyph in keyboard-shortcut hints (⌘ vs Ctrl, ⌫ vs Backspace). The server
 * snapshot is `false` (Ctrl) so SSR'd hint text doesn't mismatch the
 * pre-hydration paint; the client re-reads on mount.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /mac|iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false,
  );
}

/** Modifier-key glyph for the current platform (⌘ on Mac, Ctrl elsewhere). */
export function modKey(isMac: boolean): string {
  return isMac ? "⌘" : "Ctrl";
}
