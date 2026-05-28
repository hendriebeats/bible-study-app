import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Async server component that verifies the current user is an admin, rendered
 * inside a `<Suspense>` boundary in `app/admin/layout.tsx`. Lives outside the
 * layout file so the layout itself can be synchronous (required by
 * `cacheComponents: true` for streaming child loading.tsx fallbacks).
 *
 * Either renders the children (admin) or short-circuits via redirect/404.
 * The 404 path deliberately hides the admin tree's existence from non-admins.
 */
export async function AdminGate({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    notFound();
  }
  return <>{children}</>;
}
