"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shared full-screen review-panel shell used by `SectionHistoryPanel`
 * (Version History) and `SectionTrashPanel` (Recently deleted sections).
 *
 * Owns only the structural chrome — full-screen modal container, header bar
 * (title left, optional `action` button + close X right), and the two-column
 * body (fixed-width left aside + scrolling right pane). Each caller plugs in
 * its own list/timeline and preview content.
 *
 * Escape closes the dialog. Body-scroll is locked while the dialog is open so
 * the underlying study chrome doesn't scroll behind it.
 */
export function ReviewPanelShell({
  titleId,
  title,
  action,
  onClose,
  aside,
  children,
  emptyState,
}: {
  /** Used as `aria-labelledby` on the dialog and the header's `id`. */
  titleId: string;
  title: ReactNode;
  /** Primary action shown to the left of the close X (typically a Restore button). */
  action?: ReactNode;
  onClose: () => void;
  /** Left-rail content (fixed `w-80`, vertical flex). */
  aside: ReactNode;
  /** Right-pane content (scrolls). */
  children: ReactNode;
  /** When set, replaces the split body — for "no items yet" states. */
  emptyState?: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col bg-card motion-safe:animate-in motion-safe:fade-in"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 id={titleId} className="text-subheading font-semibold">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {action}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {emptyState ?? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 flex-col border-r">{aside}</aside>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-6">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Placeholder for a single doc preview while the right-pane content is
 * loading. Lives alongside the shell so both the version-history and
 * trash-review panels can render the same shimmer without cross-importing
 * each other (and tripping the heavy-modules registry on
 * `section-history-panel.tsx`).
 */
export function PreviewSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
