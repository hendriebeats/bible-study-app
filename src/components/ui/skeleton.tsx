import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A neutral pulsing block used to reserve space for content that's loading.
 *
 * Per-route loading.tsx files compose these into the same outer wrapper, max-width,
 * and heading sizes as the real page so the swap is zero-CLS. Pulse uses
 * `tw-animate-css`'s `animate-pulse`, the same idiom shadcn-style libraries use.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
