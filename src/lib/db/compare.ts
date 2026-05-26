import { createClient } from "@/lib/supabase/server";

/** Another group member whose study can be compared against mine. */
export interface CompareTarget {
  userId: string;
  name: string;
  studyId: string;
  groupName: string;
}

/**
 * Other members (with a contributed study) in any group my study belongs to.
 * These are the people I can open side-by-side in the compare workspace.
 */
export async function listCompareTargets(
  myStudyId: string,
): Promise<CompareTarget[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data: mine } = await supabase
    .from("group_study_members")
    .select("group_study_id")
    .eq("study_id", myStudyId);
  const groupIds = (mine ?? []).map((m) => m.group_study_id);
  if (groupIds.length === 0) {
    return [];
  }

  const { data: others } = await supabase
    .from("group_study_members")
    .select("user_id, study_id, group_study_id")
    .in("group_study_id", groupIds)
    .not("study_id", "is", null)
    .neq("user_id", user.id);
  if (!others || others.length === 0) {
    return [];
  }

  const { data: groups } = await supabase
    .from("group_studies")
    .select("id, name")
    .in("id", groupIds);
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const userIds = [...new Set(others.map((o) => o.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const targets: CompareTarget[] = [];
  for (const o of others) {
    const name = nameById.get(o.user_id)?.trim();
    targets.push({
      userId: o.user_id,
      studyId: o.study_id,
      name: name === undefined || name === "" ? "Member" : name,
      groupName: groupName.get(o.group_study_id) ?? "Group",
    });
  }
  return targets;
}
