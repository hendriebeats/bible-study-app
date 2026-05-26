import type {
  GroupMember,
  GroupStudy,
  Invitation,
  Study,
} from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** Groups the current user created or belongs to (RLS-scoped). */
export async function listMyGroups(): Promise<GroupStudy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_studies")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function getGroup(groupId: string): Promise<GroupStudy | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_studies")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Members of a group, with their profile (co-member profile read is allowed). */
export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("group_study_members")
    .select("user_id, role, study_id, joined_at")
    .eq("group_study_id", groupId)
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
    study_id: m.study_id,
    display_name: profilesById.get(m.user_id)?.display_name ?? null,
    avatar_url: profilesById.get(m.user_id)?.avatar_url ?? null,
  }));
}

/** Pending invitations for a group (owners only, by RLS). */
export async function listInvitations(groupId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, token, role, status, expires_at, created_at")
    .eq("group_study_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Studies the current user personally owns (for "attach an existing study"). */
export async function listMyOwnedStudies(): Promise<Study[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data, error } = await supabase
    .from("studies")
    .select("*")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Groups the current user belongs to with no study attached yet ("loose"). */
export async function listMyLooseGroups(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data, error } = await supabase
    .from("group_study_members")
    .select("group_studies(id, name)")
    .eq("user_id", user.id)
    .is("study_id", null);
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    id: row.group_studies.id,
    name: row.group_studies.name,
  }));
}

/** A pending group invitation addressed to the current user (by email). */
export interface MyInvitation {
  token: string;
  groupName: string;
  role: string;
  expiresAt: string;
}

/** Pending invitations addressed to the current user's email (SECURITY DEFINER RPC). */
export async function listMyInvitations(): Promise<MyInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_invitations");
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    token: row.token,
    groupName: row.group_name,
    role: row.invite_role,
    expiresAt: row.expires_at,
  }));
}

/** Whether the current user is an owner of the group. */
export async function isGroupOwner(groupId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_group_owner", {
    _group_study_id: groupId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
