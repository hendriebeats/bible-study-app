import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";

/**
 * Layout for the /organizations area. Intentionally synchronous so the route's
 * `loading.tsx` fallback streams immediately on navigation — an `await` here
 * (even just for auth) would suspend the layout and suppress the fallback.
 *
 * Unauthenticated visitors never reach this layout: `src/proxy.ts` →
 * `updateSession` redirects them to `/login` before the layout renders.
 * `<AppHeader />` is itself an async server component, but it sits inside the
 * implicit `<Suspense>` boundary that `loading.tsx` introduces and so streams
 * in alongside the page content.
 */
export default function OrganizationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
