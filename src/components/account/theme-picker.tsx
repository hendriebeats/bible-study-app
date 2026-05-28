"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

// Server renders `false`, client renders `true` after hydration — without
// triggering the set-state-in-effect lint rule the way a `useEffect` +
// `useState(false)` mount-detect would. The empty subscribe is intentional:
// the value only flips once (during hydration), so React never needs to
// re-subscribe.
// The value only flips once (during hydration), so React never needs to
// re-subscribe — `subscribe` returns an unsubscribe that does nothing. Both
// arrows must have a body to satisfy `no-empty-function`.
const noopUnsubscribe = () => {
  /* nothing to clean up */
};
const subscribe = () => noopUnsubscribe;
const useIsHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

interface ThemeOption {
  value: "light" | "dark" | "system";
  label: string;
  icon: typeof Sun;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Account → Preferences theme picker: a labelled three-up segmented control,
 * shown alongside the setting label so users can see and pick the option
 * directly. (The global `<ThemeToggle>` in the top bar stays an icon dropdown
 * since space there is tight.)
 *
 * Reads/writes `next-themes` like the global toggle. The selected pill is
 * driven off `theme` rather than `resolvedTheme` so "System" is recoverable
 * — `resolvedTheme` would always show Light or Dark and never reflect that
 * the user chose System.
 */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  // Avoid a hydration mismatch: `theme` is undefined on the server (no
  // localStorage) but resolves on mount. Render the neutral "System" pill as
  // the active one until then.
  const hydrated = useIsHydrated();
  const active = hydrated ? (theme ?? "system") : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-md border border-border/60 bg-muted/40 p-1"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = active === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setTheme(value);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
