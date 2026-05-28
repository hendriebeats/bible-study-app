"use client";

import { ChevronLeft, PanelLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";

import { AccountSidebar } from "@/components/account/account-sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The /account chrome: slim Google-Docs-style top bar ("All studies" back link
 * + "Account settings" title + shared header actions on the right), with a
 * collapsible left sidebar and full-bleed body. Modeled on `<StudyChrome>`,
 * minus the editor toolbar row and the per-section state — the account area
 * has no editor and no dynamic items.
 *
 * The chrome lives in the `/account` layout (not in each page) so the sidebar
 * survives sub-route navigation. `actions` is rendered by the layout as a
 * server-component slot so the right cluster's data fetches don't get pulled
 * into this client component.
 */
export function AccountChrome({
  actions,
  children,
}: {
  /** Server-rendered top-bar right cluster (theme, notifications, account). */
  actions: ReactNode;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
        >
          <Link href="/dashboard">
            <ChevronLeft className="size-4" />
            All studies
          </Link>
        </Button>

        <div className="flex min-w-0 flex-1 items-center">
          <span className="truncate text-sm font-medium">Account settings</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "shrink-0 overflow-hidden transition-all duration-200 ease-out",
            sidebarOpen ? "w-64" : "w-0",
          )}
        >
          <AccountSidebar onCollapse={toggleSidebar} />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 overflow-auto">
          {children}
        </main>

        {/* Sidebar collapsed: a floating re-open button at the body's top-left. */}
        {!sidebarOpen ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Show sidebar"
            onClick={toggleSidebar}
            className="absolute top-3 left-3 z-20 shadow-sm"
          >
            <PanelLeft className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
