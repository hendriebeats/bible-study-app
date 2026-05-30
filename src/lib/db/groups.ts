import type {
  GroupMember,
  GroupStudy,
  Invitation,
  Study,
  StudyGroupInfo,
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

  // Which contributed studies are still live? A trashed/archived study is
  // hidden by RLS (the owner can still see their OWN trashed study, but the
  // `deleted_at is null` filter excludes it), so anything not returned here is
  // inactive — including a member who trashed their study.
  const studyIds = members
    .map((m) => m.study_id)
    .filter((id): id is string => id !== null);
  const activeStudyIds = new Set<string>();
  if (studyIds.length > 0) {
    const { data: liveStudies } = await supabase
      .from("studies")
      .select("id")
      .in("id", studyIds)
      .is("deleted_at", null);
    for (const s of liveStudies ?? []) {
      activeStudyIds.add(s.id);
    }
  }

  return members.map((m) => ({
    user_id: m.user_id,
    role: m.role,
    study_id: m.study_id,
    study_active: m.study_id !== null && activeStudyIds.has(m.study_id),
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

/**
 * Groups the caller could attach `studyId` to: ones where they're a member but
 * haven't attached any personal study yet (a member row carries one `study_id`
 * slot, so it's one-per-group) and that `studyId` isn't already in. Feeds the
 * "Add to a group" submenu on the in-study Share button.
 */
export async function listAttachableGroupsForUser(
  studyId: string,
): Promise<{ id: string; name: string }[]> {
  const loose = await listMyLooseGroups();
  if (loose.length === 0) {
    return [];
  }
  // Subtract groups this study is already attached to (rare — a single study
  // row can belong to multiple groups via different membership rows, but the
  // user only has one membership per group, so they could "re-attach" the
  // same study; the UI should hide that no-op).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  const { data: already } = await supabase
    .from("group_study_members")
    .select("group_study_id")
    .eq("user_id", user.id)
    .eq("study_id", studyId);
  const exclude = new Set((already ?? []).map((r) => r.group_study_id));
  return loose.filter((g) => !exclude.has(g.id));
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

/** A group the current user has a given study attached to (for the delete prompt). */
export interface StudyGroupLink {
  groupId: string;
  groupName: string;
  /** The caller's role in that group. */
  role: string;
  /** True when the caller is that group's ONLY owner (so they can't leave it). */
  soleOwner: boolean;
}

/**
 * Groups the current user has attached `studyId` to, with enough context to
 * drive the "you're deleting a shared study" prompt: the group name, the
 * caller's role, and whether they're the group's last owner (the
 * enforce_group_has_owner trigger would block them from leaving).
 */
export async function listStudyGroupLinks(
  studyId: string,
): Promise<StudyGroupLink[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data: mine, error } = await supabase
    .from("group_study_members")
    .select("group_study_id, role, group_studies(id, name)")
    .eq("study_id", studyId)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(error.message);
  }
  if (mine.length === 0) {
    return [];
  }

  const groupIds = mine.map((m) => m.group_study_id);
  const { data: owners, error: ownersError } = await supabase
    .from("group_study_members")
    .select("group_study_id")
    .in("group_study_id", groupIds)
    .eq("role", "owner");
  if (ownersError) {
    throw new Error(ownersError.message);
  }
  const ownerCount = new Map<string, number>();
  for (const o of owners) {
    ownerCount.set(
      o.group_study_id,
      (ownerCount.get(o.group_study_id) ?? 0) + 1,
    );
  }

  return mine.map((m) => ({
    groupId: m.group_studies.id,
    groupName: m.group_studies.name,
    role: m.role,
    soleOwner:
      m.role === "owner" && (ownerCount.get(m.group_study_id) ?? 0) <= 1,
  }));
}

/**
 * The current user's view of a single group: their role, the editable template,
 * the roster, and (owners only) pending invitations. Returns null when the user
 * isn't a member. The reusable unit behind the group-info popup — used both from
 * a study and from the groups list.
 */
export async function getGroupInfo(
  groupId: string,
): Promise<StudyGroupInfo | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data: membership } = await supabase
    .from("group_study_members")
    .select("role")
    .eq("group_study_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return null;
  }
  const group = await getGroup(groupId);
  if (!group) {
    return null;
  }
  const [members, invitations] = await Promise.all([
    listMembers(groupId),
    membership.role === "owner"
      ? listInvitations(groupId)
      : Promise.resolve<Invitation[]>([]),
  ]);

  // The caller's own contributed study + its first section, so the popup can
  // surface "Open/Start my study" and anchor roster→compare links.
  const myMember = members.find((m) => m.user_id === user.id) ?? null;
  const myStudyId = myMember?.study_id ?? null;
  const myStudyActive = myMember?.study_active ?? false;
  let myFirstSectionId: string | null = null;
  if (myStudyId && myStudyActive) {
    const { data: firstSection } = await supabase
      .from("sections")
      .select("id")
      .eq("study_id", myStudyId)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    myFirstSectionId = firstSection?.id ?? null;
  }

  return {
    groupId,
    groupName: group.name,
    role: membership.role,
    templateStudyId: group.template_study_id,
    members,
    invitations,
    myStudyId,
    myStudyActive,
    myFirstSectionId,
  };
}

/**
 * The group context for a study, from the current user's perspective: the
 * group(s) it belongs to (see {@link getGroupInfo}). Feeds the in-study members
 * dropdown and group-info popup.
 *
 * Resolves groups two ways so it works on both a member's personal study (it's
 * their contributed `study_id` in a group) and the group's template study
 * (`owner_group_id` points back at the group).
 */
export async function getStudyGroupContext(
  studyId: string,
): Promise<StudyGroupInfo[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const groupIds = new Set<string>();

  // Groups where this study is the caller's own contributed study.
  const { data: mine, error } = await supabase
    .from("group_study_members")
    .select("group_study_id")
    .eq("study_id", studyId)
    .eq("user_id", user.id);
  if (error) {
    throw new Error(error.message);
  }
  for (const m of mine) {
    groupIds.add(m.group_study_id);
  }

  // The study may itself be a group's template; surface that group too.
  const { data: study } = await supabase
    .from("studies")
    .select("owner_group_id")
    .eq("id", studyId)
    .maybeSingle();
  if (study?.owner_group_id) {
    groupIds.add(study.owner_group_id);
  }

  const groups: StudyGroupInfo[] = [];
  for (const groupId of groupIds) {
    const info = await getGroupInfo(groupId);
    if (info) {
      groups.push(info);
    }
  }
  return groups;
}
