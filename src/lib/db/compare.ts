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

  // Drop members whose contributed study is trashed — a soft-deleted study is
  // hidden by RLS, so it would open as a blank pane. (RLS already withholds the
  // row for co-members; this also covers any locally-readable edge cases.)
  //
  // Fetch the three follow-up lookups in parallel. Profiles are fetched for the
  // union of candidate user ids (before filtering by liveStudies) — slightly more
  // rows than strictly needed when a co-member's study is trashed, but trashed
  // studies are rare and one fewer round trip is the better trade.
  const candidateStudyIds = [...new Set(others.map((o) => o.study_id))];
  const candidateUserIds = [...new Set(others.map((o) => o.user_id))];
  const [{ data: liveStudies }, { data: groups }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("studies")
        .select("id")
        .in("id", candidateStudyIds)
        .is("deleted_at", null),
      supabase.from("group_studies").select("id, name").in("id", groupIds),
      supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", candidateUserIds),
    ]);

  const liveStudyIds = new Set((liveStudies ?? []).map((s) => s.id));
  const liveOthers = others.filter((o) => liveStudyIds.has(o.study_id));
  if (liveOthers.length === 0) {
    return [];
  }
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const targets: CompareTarget[] = [];
  for (const o of liveOthers) {
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

/**
 * The target study most recently aligned for one of my sections in `myStudyId`
 * — a stand-in for "the last person I looked at", used to seed the compare
 * workspace's first-time / reset default (mine + that person). Returns null when
 * there's no remembered alignment yet. Re-entry restores the full saved layout
 * separately, so this only matters before any layout has been saved.
 */
export async function getLastViewedCompareTarget(
  myStudyId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: sections } = await supabase
    .from("sections")
    .select("id")
    .eq("study_id", myStudyId)
    .is("deleted_at", null);
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) {
    return null;
  }

  const { data: recent } = await supabase
    .from("section_alignments")
    .select("target_study_id")
    .eq("user_id", user.id)
    .in("my_section_id", sectionIds)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return recent?.target_study_id ?? null;
}
