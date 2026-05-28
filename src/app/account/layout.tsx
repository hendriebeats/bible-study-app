import { Suspense, type ReactNode } from "react";

import { AccountChrome } from "@/components/account/account-chrome";
import { HeaderActions } from "@/components/header-actions";

/**
 * Layout for the /account area. Intentionally synchronous so the route's
 * `loading.tsx` fallback streams immediately on navigation. Unauthenticated
 * visitors never reach this layout: `src/proxy.ts` → `updateSession` redirects
 * them to `/login` before the layout renders.
 *
 * `<HeaderActions />` is itself an async server component (it reads
 * notifications, invitations, etc.). Under `cacheComponents: true`, any async
 * work in a layout must be wrapped in `<Suspense>` — otherwise it blocks the
 * page's loading.tsx from streaming.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <AccountChrome
      actions={
        <Suspense fallback={null}>
          <HeaderActions />
        </Suspense>
      }
    >
      {children}
    </AccountChrome>
  );
}
