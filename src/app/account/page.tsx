import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOutEverywhere } from "@/app/account/actions";
import { AvatarUpload } from "@/components/account/avatar-upload";
import { ChangeEmailForm } from "@/components/account/change-email-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { DangerZone } from "@/components/account/danger-zone";
import { ProfileForm } from "@/components/account/profile-form";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMyProfile } from "@/lib/db/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
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
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Account settings</h1>

        <div className="mt-8 grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your name and photo.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <AvatarUpload
                userId={user.id}
                displayName={displayName}
                email={email}
                avatarUrl={avatarUrl}
              />
              <ProfileForm displayName={displayName} />
              {memberSince ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Member since {memberSince}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Your sign-in details.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>How the app looks.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm">Theme</span>
              <ThemeToggle />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Manage your active sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={signOutEverywhere}>
                <Button type="submit" variant="outline">
                  Sign out of all devices
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Danger zone</CardTitle>
              <CardDescription>
                Permanently delete your account and all its data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DangerZone email={email} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
