import { Suspense, type ReactNode } from "react";

import { AdminGate } from "@/components/admin/admin-gate";
import { AppHeader } from "@/components/app-header";
import { AppHeaderSkeleton } from "@/components/app-header-skeleton";
import { PageListSkeleton } from "@/components/ui/page-list-skeleton";

/**
 * Global admin area — super-admins only. Gated server-side via `is_admin()`,
 * inside `<AdminGate>` which sits below a `<Suspense>` boundary so this layout
 * file itself stays synchronous (required by `cacheComponents: true` for child
 * loading.tsx fallbacks to stream).
 *
 * `<AppHeader />` is also async (reads the current user's org for the chrome)
 * and lives behind its own Suspense boundary with a matching skeleton.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <Suspense fallback={<AppHeaderSkeleton />}>
        <AppHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Suspense fallback={<PageListSkeleton headingWidth="w-32" rows={3} />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </div>
  );
}
