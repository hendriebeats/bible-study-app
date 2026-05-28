"use client";

import { PanelLeft, Settings2, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AccountNavItem {
  href: string;
  label: string;
  icon: typeof UserRound;
}

/** The fixed account-area nav. Order is the visual order in the sidebar. */
const NAV_ITEMS: readonly AccountNavItem[] = [
  { href: "/account/profile", label: "Profile", icon: UserRound },
  { href: "/account/preferences", label: "Preferences", icon: Settings2 },
  { href: "/account/security", label: "Security", icon: ShieldCheck },
] as const;

/**
 * Static account-area sidebar: three top-level pages (Profile / Preferences /
 * Security), each its own route. Mirrors the `<StudySidebar>` idiom — w-64
 * shell, `pathname === href` active state, collapse button up top — but with
 * no data fetching or actions since the items are hard-coded.
 */
export function AccountSidebar({ onCollapse }: { onCollapse: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex items-center border-b p-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Hide sidebar"
          onClick={onCollapse}
        >
          <PanelLeft className="size-4" />
        </Button>
      </div>

      <nav className="flex-1 overflow-auto p-2">
        <ul className="grid gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            // Warm the router cache on hover/focus so the click feels instant
            // under `cacheComponents` (where `<Link>`'s built-in prefetch only
            // covers the static shell). Same trick the study sidebar uses.
            const prefetch = () => {
              router.prefetch(href);
            };
            return (
              <li key={href}>
                <Link
                  href={href}
                  onPointerEnter={prefetch}
                  onFocus={prefetch}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
