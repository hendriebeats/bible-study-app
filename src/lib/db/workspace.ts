import { createClient } from "@/lib/supabase/server";

/**
 * Bump when the persisted dockview layout shape changes incompatibly. A saved
 * layout with a different version is ignored (we rebuild the default) rather
 * than risking a crash on `fromJSON`.
 */
export const WORKSPACE_LAYOUT_VERSION = 2;

export interface SavedWorkspace {
  layout: unknown;
  layoutVersion: number;
}

/**
 * The current user's saved compare-workspace layout for a study (which person
 * panels are open + how they're split). Keyed per (user, my study) — the
 * per-section alignment lives separately in `section_alignments`.
 */
export async function getWorkspaceLayout(
  studyId: string,
): Promise<SavedWorkspace | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const { data } = await supabase
    .from("workspace_states")
    .select("layout, layout_version")
    .eq("study_id", studyId)
    .maybeSingle();
  if (!data) {
    return null;
  }
  return { layout: data.layout, layoutVersion: data.layout_version };
}
