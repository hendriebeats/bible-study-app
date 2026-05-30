/**
 * Theme-aware colour resolution. Used by:
 *
 *   - The custom-colour mark plugin (`src/lib/editor/plugins/themed-colors.ts`)
 *     — paints theme-resolved inline-style decorations over `[data-color]`
 *     marks via PM's transaction loop (NOT via direct DOM mutation, which
 *     re-enters PM's own MutationObserver and freezes the tab).
 *   - The presence cursor palette ({@link cursorColor}) — keeps each user's
 *     stable hue while picking a lightness/chroma that reads in the active
 *     theme.
 *   - {@link pickReadableText} — chooses `--foreground` / `--background` for
 *     text overlaid on a dynamic background colour (presence avatars).
 *
 * Pure functions over the existing OKLCH math in `@/lib/editor/oklch`. No
 * React, no DOM. Memoized so a tight ProseMirror loop walking every mark
 * doesn't recompute the same answer per node.
 */

import {
  colorPair,
  contrastRatio,
  oklchParts,
  oklchToSrgb,
  parseOklch,
  type OklchColor,
} from "@/lib/editor/oklch";
import {
  INK_COLOR_DARK,
  INK_COLOR_LIGHT,
  PAGE_BG_DARK,
  PAGE_BG_LIGHT,
} from "@/lib/editor/format-colors";

import { CURSOR_PALETTE } from "./cursor-palette";
import { type ThemeId } from "./themes";

// ---------------------------------------------------------------------------
// Per-theme surface targets — what `resolveColor` aims to clear 4.5:1 against.
// ---------------------------------------------------------------------------

/**
 * Per-theme contrast targets. Each theme records the page background and
 * default ink colour the picker enforces 4.5:1 against. Mirrors the literals
 * in `globals.css` (and the comment on PAGE_BG_LIGHT / INK_COLOR_LIGHT in
 * format-colors.ts about why they're pinned here).
 *
 * Adding a theme means appending an entry here. Until then, the resolver
 * falls back to the light-mode targets for unknown ids.
 */
const THEME_TARGETS: Record<ThemeId, { bg: OklchColor; ink: OklchColor }> = {
  light: { bg: PAGE_BG_LIGHT, ink: INK_COLOR_LIGHT },
  dark: { bg: PAGE_BG_DARK, ink: INK_COLOR_DARK },
};

function targetsFor(theme: ThemeId): { bg: OklchColor; ink: OklchColor } {
  // `Record<ThemeId, ...>` makes the lookup total for every registered id.
  return THEME_TARGETS[theme];
}

// ---------------------------------------------------------------------------
// resolveColor — the per-theme variant of a stored colour.
// ---------------------------------------------------------------------------

const resolveCache = new Map<string, OklchColor>();

/**
 * Given a stored OKLCH colour and the active theme, return the variant that
 * clears 4.5:1 contrast against the theme's surface (ink for highlights, bg
 * for text colour). The picker enforces contrast at pick-time, so for the
 * theme the colour was picked in this is a no-op; for the other theme the
 * lightness is flipped and nudged via {@link colorPair}.
 *
 * Memoized by `(stored, theme, surface)` — the same mark walked across a long
 * document only computes once.
 */
export function resolveColor(
  stored: OklchColor,
  theme: ThemeId,
  surface: "highlight" | "textColor",
): OklchColor {
  const key = `${theme}|${surface}|${stored}`;
  const hit = resolveCache.get(key);
  if (hit !== undefined) return hit;

  // colorPair derives a {light, dark} pair off whichever theme it currently
  // knows about. Until we generalise it to N themes, fall back to the LIGHT
  // half for any non-dark theme — the targets in THEME_TARGETS still drive
  // which surface counts as the contrast goal, so a future sepia theme just
  // needs its targets recorded above to read correctly.
  const pair = colorPair(stored, surface, {
    lightBg: THEME_TARGETS.light.bg,
    lightInk: THEME_TARGETS.light.ink,
    darkBg: targetsFor(theme === "dark" ? "dark" : theme).bg,
    darkInk: targetsFor(theme === "dark" ? "dark" : theme).ink,
  });
  const resolved: OklchColor =
    pair === null ? stored : theme === "light" ? pair.light : pair.dark;
  resolveCache.set(key, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Cursor palette — stable per-user hue, theme-aware lightness/chroma.
// ---------------------------------------------------------------------------

/**
 * Deterministic, theme-aware cursor colour for a user id. Hue is locked per
 * user (same person → same hue across themes); lightness is nudged via
 * {@link resolveColor} so the cursor reads against the theme's background.
 *
 * The palette itself ({@link CURSOR_PALETTE}) is a non-empty tuple, so the
 * index lookup is total — no fallback / assertion needed.
 */
export function cursorColor(id: string, theme: ThemeId): OklchColor {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const slot = hash % CURSOR_PALETTE.length;
  // `CURSOR_PALETTE` is typed as `readonly [OklchColor, OklchColor, ...]`, so
  // index 0 is statically known to exist; the `slot < length` modulo
  // guarantees the rest. Wrap the lookup in the always-defined slot 0 for
  // the type checker (under noUncheckedIndexedAccess, the indexed access
  // would otherwise narrow to `OklchColor | undefined`).
  const base = CURSOR_PALETTE[slot] ?? CURSOR_PALETTE[0];
  if (theme === "light") return base;
  // Defer to resolveColor for any non-light theme — keeps the contrast logic
  // in one place and means a future sepia theme just needs its entry in
  // THEME_TARGETS, not a new conditional here.
  return resolveColor(base, theme, "textColor");
}

// ---------------------------------------------------------------------------
// pickReadableText — chooses ink vs. paper for arbitrary backgrounds.
// ---------------------------------------------------------------------------

/**
 * Given a background colour (e.g. a presence-avatar swatch), return whichever
 * of the theme's ink / paper colours has higher contrast against it. Lets
 * dynamic backgrounds always get readable text without hand-tuning per-
 * background.
 */
export function pickReadableText(
  background: OklchColor,
  theme: ThemeId,
): OklchColor {
  const t = targetsFor(theme);
  const bgParts = oklchParts(background);
  if (!bgParts) return t.ink;
  const bgSrgb = oklchToSrgb(bgParts);
  const inkParts = oklchParts(t.ink);
  const paperParts = oklchParts(t.bg);
  if (!inkParts || !paperParts) return t.ink;
  const inkContrast = contrastRatio(bgSrgb, oklchToSrgb(inkParts));
  const paperContrast = contrastRatio(bgSrgb, oklchToSrgb(paperParts));
  return inkContrast >= paperContrast ? t.ink : t.bg;
}

// ---------------------------------------------------------------------------
// Free-form colour helpers (for callers that hold an arbitrary string).
// ---------------------------------------------------------------------------

/**
 * Resolve a stored colour string (untrusted shape: persisted JSON, a server
 * payload) to a theme-aware {@link OklchColor}. Returns `null` if the string
 * isn't a valid OKLCH literal — caller should treat that as "leave the
 * stored value alone".
 */
export function tryResolveStored(
  stored: string,
  theme: ThemeId,
  surface: "highlight" | "textColor",
): OklchColor | null {
  const parsed = parseOklch(stored);
  if (parsed === null) return null;
  return resolveColor(parsed, theme, surface);
}
