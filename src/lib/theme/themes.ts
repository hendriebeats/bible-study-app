/**
 * Theme registry. Adding a new theme is two coordinated changes:
 *
 *   1. Add an entry here. `id` is the slug written to `<html data-theme=…>`
 *      by next-themes; `label` is the human-readable string shown in the
 *      theme picker.
 *   2. Add a `[data-theme="<id>"]` block in `src/app/globals.css` overriding
 *      the Tier 2 (semantic) tokens — and any Tier 3 component tokens whose
 *      default `var(--surface)` etc. doesn't fit the new theme.
 *
 * Custom-color marks (highlight + text colour) carry one OKLCH literal each;
 * the per-theme variant is derived at render time by {@link resolveColor} —
 * adding a theme here costs nothing on the document side.
 *
 * Kept colocated with the next-themes provider config (`src/app/layout.tsx`)
 * via the {@link THEME_IDS} export so both lists stay in sync.
 */

export interface Theme {
  /** Slug written to `<html data-theme="…">`. */
  id: string;
  /** Human-readable label for the theme picker. */
  label: string;
}

/**
 * The canonical theme list. Order is the order they appear in the picker.
 * `light` ships as the default at SSR (matches `:root`); `dark` is the
 * baked-in second variant. Future themes (sepia, high-contrast, …) get
 * appended here AND get their own `[data-theme="<id>"]` block in globals.css.
 */
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const satisfies readonly Theme[];

/** Union of the registered theme ids (e.g. "light" | "dark"). */
export type ThemeId = (typeof THEMES)[number]["id"];

/** Bare id list — passed to next-themes' `themes` prop. */
export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

/** Type guard: is `value` a registered theme id? */
export function isThemeId(value: string | null | undefined): value is ThemeId {
  if (value == null) return false;
  return THEME_IDS.includes(value);
}
