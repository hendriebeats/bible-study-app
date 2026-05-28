import { Suspense, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { AppHeaderSkeleton } from "@/components/app-header-skeleton";

/**
 * Layout for the /organizations area. Intentionally synchronous so the route's
 * `loading.tsx` fallback streams immediately on navigation. Unauthenticated
 * visitors never reach this layout: `src/proxy.ts` → `updateSession` redirects
 * them to `/login` before the layout renders.
 *
 * `<AppHeader />` is itself an async server component (it reads the current
 * user's org for the chrome). Under `cacheComponents: true`, any async work in
 * a layout must be wrapped in `<Suspense>` — otherwise it blocks the page's
 * loading.tsx from streaming. The skeleton header matches its real dimensions
 * exactly so the swap is zero-CLS.
 */
export default function OrganizationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <Suspense fallback={<AppHeaderSkeleton />}>
        <AppHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
