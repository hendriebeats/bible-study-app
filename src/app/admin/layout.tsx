import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";

/** Global admin area — super-admins only. Gated server-side via is_admin(). */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  // lint-allow-await-in-layout: TODO(3C cacheComponents) auth check stays in the layout until
  // the cacheComponents migration (3C) wraps auth-gated content in <Suspense>;
  // routing to /login here is the simplest way to keep the entire admin tree
  // off the wire for non-admins.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  // lint-allow-await-in-layout: TODO(3C cacheComponents) admin-gate check; co-located with the
  // auth check above so we 404 instead of revealing the admin area exists.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    // Don't reveal the admin area exists to non-admins.
    notFound();
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
