import type {
  AppNotification,
  Organization,
  OrgAnnouncement,
  OrgInvitation,
  OrgJoinRequest,
  OrgMember,
  OrgRole,
} from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** The caller's membership (org id + role), or null if they're in no org. */
export async function getMyMembership(): Promise<{
  organizationId: string;
  role: OrgRole;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return { organizationId: data.organization_id, role: data.role };
}

/** The caller's full org row, or null. */
export async function getMyOrg(): Promise<Organization | null> {
  const membership = await getMyMembership();
  if (!membership) {
    return null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", membership.organizationId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Compact org identity + the caller's role, for the app header. */
export interface MyOrgHeader {
  id: string;
  name: string;
  iconUrl: string | null;
  verified: boolean;
  role: OrgRole;
}

export async function getMyOrgHeader(): Promise<MyOrgHeader | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, icon_url, verification_status)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data?.organizations) {
    return null;
  }
  const org = data.organizations;
  return {
    id: org.id,
    name: org.name,
    iconUrl: org.icon_url,
    verified: org.verification_status === "verified",
    role: data.role,
  };
}

/** Members of an org, with their profile (co-member profile read is allowed). */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id, role, joined_at")
    .eq("organization_id", orgId)
    .order("joined_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const ids = members.map((m) => m.user_id);
  const profilesById = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", ids);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, {
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  return members.map((m) => ({
    user_id: m.user_id,
    role: m.role,
    joined_at: m.joined_at,
    display_name: profilesById.get(m.user_id)?.display_name ?? null,
    avatar_url: profilesById.get(m.user_id)?.avatar_url ?? null,
  }));
}

/** Pending invitations for an org (admins only, by RLS). */
export async function listOrgInvitations(
  orgId: string,
): Promise<OrgInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, token, role, status, expires_at, created_at")
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Pending join requests for an org (admins, by RLS), with requester profiles. */
export async function listJoinRequests(
  orgId: string,
): Promise<OrgJoinRequest[]> {
  const supabase = await createClient();
  const { data: requests, error } = await supabase
    .from("organization_join_requests")
    .select("id, user_id, note, created_at")
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const ids = requests.map((r) => r.user_id);
  const profilesById = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", ids);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, {
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  return requests.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    note: r.note,
    created_at: r.created_at,
    display_name: profilesById.get(r.user_id)?.display_name ?? null,
    avatar_url: profilesById.get(r.user_id)?.avatar_url ?? null,
  }));
}

/** Public, verified orgs for the search page (RLS already limits visibility). */
export async function listDiscoverableOrgs(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("visibility", "public")
    .eq("verification_status", "verified")
    .order("name", { ascending: true })
    .limit(200);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Announcements for an org, newest first. */
export async function listOrgAnnouncements(
  orgId: string,
): Promise<OrgAnnouncement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_announcements")
    .select("id, organization_id, author_id, body, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** A pending org invitation addressed to the current user (by email). */
export interface MyOrgInvitation {
  token: string;
  organizationName: string;
  role: OrgRole;
  expiresAt: string;
}

export async function listMyOrgInvitations(): Promise<MyOrgInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_org_invitations");
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    token: row.token,
    organizationName: row.organization_name,
    role: row.invite_role,
    expiresAt: row.expires_at,
  }));
}

/**
 * Lean pending-verification list ({id, name}) for the app-admin notification
 * bell. Call only for app admins — RLS lets app admins read all orgs, but a
 * regular member could otherwise see their own org's pending row.
 */
export async function listPendingOrgReviews(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("verification_status", "pending")
    .order("updated_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Orgs awaiting verification review (app admins only, by RLS). */
export async function listPendingVerifications(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("verification_status", "pending")
    .order("updated_at", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** A single org by id (app admins can read any; members read their own). */
export async function getOrg(orgId: string): Promise<Organization | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * Recent announcements for the caller's org that they haven't dismissed — for
 * the dashboard banner. RLS already scopes announcements to the member's org.
 */
export async function listActiveAnnouncements(): Promise<OrgAnnouncement[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: announcements, error } = await supabase
    .from("organization_announcements")
    .select("id, organization_id, author_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    throw new Error(error.message);
  }
  if (announcements.length === 0) {
    return [];
  }
  const { data: dismissed } = await supabase
    .from("dismissed_announcements")
    .select("announcement_id")
    .eq("user_id", user.id);
  const dismissedIds = new Set((dismissed ?? []).map((d) => d.announcement_id));
  return announcements.filter((a) => !dismissedIds.has(a.id));
}

/** The current user's bell notifications, newest first. */
export async function listMyNotifications(): Promise<AppNotification[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
