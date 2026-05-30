import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOutEverywhere } from "@/app/account/actions";
import { DangerZone } from "@/components/account/danger-zone";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account · Security" };

export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const email = user.email ?? "";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-16">
      <h1 className="text-title font-bold tracking-tight">Security</h1>
      <p className="mt-1 text-ui text-muted-foreground">
        Manage active sessions and account deletion.
      </p>

      <div className="mt-8 space-y-10">
        <section className="space-y-3">
          <h2 className="text-subheading font-semibold">Sessions</h2>
          <p className="text-ui text-muted-foreground">
            Sign yourself out everywhere — useful if you forgot to sign out on a
            shared device.
          </p>
          <form action={signOutEverywhere}>
            <Button type="submit" variant="outline">
              Sign out of all devices
            </Button>
          </form>
        </section>

        <section className="space-y-3 border-t border-destructive/40 pt-8">
          <h2 className="text-subheading font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="text-ui text-muted-foreground">
            Permanently delete your account and all its data. This cannot be
            undone.
          </p>
          <DangerZone email={email} />
        </section>
      </div>
    </div>
  );
}
