import { AppHeaderNotifications } from "@/components/app-header-notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import {
  listMyInvitations,
  listMyLooseGroups,
  listMyOwnedStudies,
} from "@/lib/db/groups";
import {
  listMyNotifications,
  listPendingOrgReviews,
} from "@/lib/db/organizations";
import { createClient } from "@/lib/supabase/server";

/**
 * The shared top-bar right cluster: theme toggle, notifications, and the
 * account menu. Fetches its own data so any header (the app-wide `AppHeader`
 * and the studies `StudyChrome`) can drop it in as a slot without duplicating
 * the queries.
 */
export async function HeaderActions() {
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
    pendingOrgReviews,
  ] = await Promise.all([
    listMyLooseGroups(),
    listMyInvitations(),
    listMyOwnedStudies(),
    listMyNotifications(),
    isAdmin
      ? listPendingOrgReviews()
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <>
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
        isAdmin={isAdmin}
      />
    </>
  );
}
