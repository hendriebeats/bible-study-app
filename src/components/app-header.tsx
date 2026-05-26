import { BookOpen } from "lucide-react";
import Link from "next/link";

import { AppHeaderNotifications } from "@/components/app-header-notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import {
  listMyInvitations,
  listMyLooseGroups,
  listMyOwnedStudies,
} from "@/lib/db/groups";
import { siteConfig } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

/** Top bar for authenticated pages: logo + theme toggle + account menu. */
export async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  const [looseGroups, invitations, myStudies] = await Promise.all([
    listMyLooseGroups(),
    listMyInvitations(),
    listMyOwnedStudies(),
  ]);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/60 px-4">
      <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
        <BookOpen className="size-6 text-primary" />
        <span className="text-lg">{siteConfig.name}</span>
      </Link>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AppHeaderNotifications
          looseGroups={looseGroups}
          invitations={invitations}
          myStudies={myStudies}
        />
        <UserMenu
          displayName={profile?.display_name ?? ""}
          email={user.email ?? ""}
          avatarUrl={profile?.avatar_url ?? null}
          isAdmin={profile?.is_admin ?? false}
        />
      </div>
    </header>
  );
}
