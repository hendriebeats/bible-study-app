import { BookOpen, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { AppHeaderNotifications } from "@/components/app-header-notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserMenu } from "@/components/user-menu";
import { getInitials } from "@/lib/avatar";
import {
  listMyInvitations,
  listMyLooseGroups,
  listMyOwnedStudies,
} from "@/lib/db/groups";
import {
  getMyOrgHeader,
  listMyNotifications,
  listPendingOrgReviews,
} from "@/lib/db/organizations";
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

  const isAdmin = profile?.is_admin ?? false;

  const [
    looseGroups,
    invitations,
    myStudies,
    notifications,
    org,
    pendingOrgReviews,
  ] = await Promise.all([
    listMyLooseGroups(),
    listMyInvitations(),
    listMyOwnedStudies(),
    listMyNotifications(),
    getMyOrgHeader(),
    isAdmin
      ? listPendingOrgReviews()
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/60 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold"
        >
          <BookOpen className="size-6 text-primary" />
          <span className="text-lg">{siteConfig.name}</span>
        </Link>
        {org ? (
          <Link
            href="/organizations"
            className="flex min-w-0 items-center gap-2 border-l border-border/60 pl-3 text-sm text-muted-foreground hover:text-foreground"
          >
            <Avatar className="size-6 rounded-sm">
              {org.iconUrl ? (
                <AvatarImage src={org.iconUrl} alt={org.name} />
              ) : null}
              <AvatarFallback className="rounded-sm text-xs">
                {getInitials(org.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{org.name}</span>
            {!org.verified ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                title="Not yet verified"
              >
                <ShieldAlert className="size-3" />
                Unverified
              </span>
            ) : null}
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AppHeaderNotifications
          looseGroups={looseGroups}
          invitations={invitations}
          myStudies={myStudies}
          notifications={notifications}
          pendingOrgReviews={pendingOrgReviews}
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
