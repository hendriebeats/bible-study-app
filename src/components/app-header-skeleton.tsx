import { BookOpen } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { siteConfig } from "@/lib/site";

/**
 * Static (non-async) header that mirrors `<AppHeader />`'s outer chrome
 * exactly: same height, same border, same brand block on the left, same right-
 * side actions slot dimensions. Used in route-level `loading.tsx` fallbacks
 * so the swap to the real header is zero-CLS.
 *
 * The brand link is rendered as static text (not a `Link`) because the
 * surrounding fallback isn't interactive yet; this avoids users clicking a
 * link to a page that's still resolving.
 */
export function AppHeaderSkeleton() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border/60 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex items-center gap-2 font-semibold text-muted-foreground"
        >
          <BookOpen className="size-6 text-primary/40" />
          <span className="text-subheading">{siteConfig.name}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </header>
  );
}
