import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AvatarUpload } from "@/components/account/avatar-upload";
import { ChangeEmailForm } from "@/components/account/change-email-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { getMyProfile } from "@/lib/db/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account · Profile" };

export default async function AccountProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getMyProfile();
  const displayName = profile?.display_name ?? "";
  const email = user.email ?? "";
  const avatarUrl = profile?.avatar_url ?? null;
  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        dateStyle: "long",
      })
    : null;
  const providers = user.app_metadata.providers ?? [];
  const isGoogle = providers.includes("google");
  const hasPassword = providers.includes("email");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-20">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your name, photo, and sign-in details.
      </p>

      <div className="mt-8 space-y-10">
        <section className="space-y-6">
          <AvatarUpload
            userId={user.id}
            displayName={displayName}
            email={email}
            avatarUrl={avatarUrl}
          />
          <ProfileForm displayName={displayName} />
          {memberSince ? (
            <p className="text-xs text-muted-foreground">
              Member since {memberSince}
            </p>
          ) : null}
        </section>

        <section className="space-y-6 border-t border-border/60 pt-8">
          <div>
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Email and password for your account.
            </p>
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-medium">Email</span>
            <span className="text-sm text-muted-foreground">
              {email}
              {isGoogle ? " · Signed in with Google" : ""}
            </span>
          </div>
          <ChangeEmailForm currentEmail={email} />
          <div className="border-t border-border/60 pt-6">
            <ChangePasswordForm requireCurrent={hasPassword} />
          </div>
        </section>
      </div>
    </div>
  );
}
