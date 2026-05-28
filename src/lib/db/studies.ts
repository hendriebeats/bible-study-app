import { cache } from "react";

import { listGenres } from "@/lib/db/genres";
import type {
  Section,
  SectionDocuments,
  SectionSummary,
  Study,
  StudyDocument,
  TrashItem,
} from "@/lib/db/types";
import type { PMDocJSON } from "@/lib/editor/types";
import { createClient } from "@/lib/supabase/server";

/** All active studies the current user can see (RLS: own + group co-members'). */
export async function listStudies(): Promise<Study[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("studies")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** A co-member shown as an avatar on a group-attached study row. */
export interface StudyCoMember {
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * A study enriched for the "Your studies" list: the study-type (genre) name,
 * the group it's attached to (if any), and that group's co-members.
 */
export interface StudyListItem extends Study {
  genreName: string | null;
  group: { id: string; name: string } | null;
  coMembers: StudyCoMember[];
}

/**
 * The current user's OWN active studies, enriched with study-type name, group
 * attachment, and co-member avatars. Batched to avoid N+1 (a fixed number of
 * round-trips regardless of how many studies/groups are involved).
 */
export async function listMyStudiesEnriched(): Promise<StudyListItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  // 1+2. My own active studies (group templates have owner_id null, so excluded)
  // and genre id -> name (for the study-type badge), fetched in parallel — genres
  // are independent of the studies query so there's no reason to wait. The cost
  // when a user has no studies is one extra cheap query.
  const [studiesResult, genres] = await Promise.all([
    supabase
      .from("studies")
      .select("*")
      .eq("owner_id", user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    listGenres(),
  ]);
  const { data: studies, error } = studiesResult;
  if (error) {
    throw new Error(error.message);
  }
  if (studies.length === 0) {
    return [];
  }
  const genreNameById = new Map(genres.map((g) => [g.id, g.name]));

  // 3. Which of my studies are attached to a group (my own membership rows).
  const studyIds = studies.map((s) => s.id);
  const { data: myMemberships, error: membershipError } = await supabase
    .from("group_study_members")
    .select("study_id, group_studies(id, name)")
    .in("study_id", studyIds);
  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const groupByStudyId = new Map<string, { id: string; name: string }>();
  const groupIds = new Set<string>();
  for (const row of myMemberships) {
    if (row.study_id) {
      groupByStudyId.set(row.study_id, {
        id: row.group_studies.id,
        name: row.group_studies.name,
      });
      groupIds.add(row.group_studies.id);
    }
  }

  // 4. Co-members of those groups (everyone but me), in two batched queries.
  const coMembersByGroupId = new Map<string, StudyCoMember[]>();
  if (groupIds.size > 0) {
    const { data: groupMembers, error: groupMembersError } = await supabase
      .from("group_study_members")
      .select("group_study_id, user_id")
      .in("group_study_id", [...groupIds]);
    if (groupMembersError) {
      throw new Error(groupMembersError.message);
    }

    const otherIds = [
      ...new Set(
        groupMembers.map((m) => m.user_id).filter((id) => id !== user.id),
      ),
    ];
    const profileById = new Map<string, StudyCoMember>();
    if (otherIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", otherIds);
      if (profilesError) {
        throw new Error(profilesError.message);
      }
      for (const p of profiles) {
        profileById.set(p.id, {
          display_name: p.display_name,
          avatar_url: p.avatar_url,
        });
      }
    }

    for (const m of groupMembers) {
      if (m.user_id === user.id) {
        continue;
      }
      const profile = profileById.get(m.user_id);
      if (!profile) {
        continue;
      }
      const list = coMembersByGroupId.get(m.group_study_id) ?? [];
      list.push(profile);
      coMembersByGroupId.set(m.group_study_id, list);
    }
  }

  return studies.map((study) => {
    const group = groupByStudyId.get(study.id) ?? null;
    return {
      ...study,
      genreName: study.genre_id
        ? (genreNameById.get(study.genre_id) ?? null)
        : null,
      group,
      coMembers: group ? (coMembersByGroupId.get(group.id) ?? []) : [],
    };
  });
}

/** The current user's trashed (soft-deleted, recoverable) studies. */
export async function listTrashedStudies(): Promise<TrashItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("studies")
    .select("id, title, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    deleted_at: row.deleted_at,
  }));
}

/**
 * Wrapped in `cache()` so the layout and the per-section page (which both
 * need the study row, for chrome metadata and `isTemplate` respectively) share
 * a single DB call per request instead of duplicating the round trip. The
 * dedupe key is `studyId`.
 */
export const getStudy = cache(
  async (studyId: string): Promise<Study | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("studies")
      .select("*")
      .eq("id", studyId)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return data;
  },
);

/**
 * Per-request memoized ownership check. Layout uses it to gate the sidebar's
 * "Add section" button; the per-section page uses it to decide whether to
 * fetch undo history and the empty-state precheck. Sharing the same `cache()`
 * entry means section navigation only spends ONE round trip on the RPC even
 * though both the layout and the page need the answer.
 */
export const isStudyOwner = cache(async (studyId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_study_owner", {
    _study_id: studyId,
  });
  return data ?? false;
});

/**
 * Cached so layout + sidebar + studyId-index redirect all share one DB call.
 * Section-mutation actions still revalidate the path; the cache only lives
 * within a single request, not across them.
 */
export const listSections = cache(
  async (studyId: string): Promise<SectionSummary[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sections")
      .select("id, study_id, title, position")
      .eq("study_id", studyId)
      .is("deleted_at", null)
      .order("position", { ascending: true });
    if (error) {
      throw new Error(error.message);
    }
    return data;
  },
);

/** Trashed (soft-deleted, recoverable) sections within a study. */
export async function listTrashedSections(
  studyId: string,
): Promise<TrashItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("id, title, deleted_at")
    .eq("study_id", studyId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    deleted_at: row.deleted_at,
  }));
}

export async function getSection(sectionId: string): Promise<Section | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("*")
    .eq("id", sectionId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  // `content` is stored as jsonb (Json); narrow it to the editor's doc type.
  return {
    ...data,
    content: data.content as unknown as PMDocJSON,
    current_version: data.current_version,
  };
}

/**
 * A section's `notes` + `blocks` documents (the live content streams). Returns
 * null if the section is missing either document (shouldn't happen — both are
 * created with the section).
 */
export async function getSectionDocuments(
  sectionId: string,
): Promise<SectionDocuments | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, section_id, kind, content, current_version")
    .eq("section_id", sectionId);
  if (error) {
    throw new Error(error.message);
  }

  let notes: StudyDocument | undefined;
  let blocks: StudyDocument | undefined;
  for (const row of data) {
    const doc: StudyDocument = {
      id: row.id,
      section_id: row.section_id,
      kind: row.kind,
      content: row.content as unknown as PMDocJSON,
      current_version: row.current_version,
    };
    if (row.kind === "notes") {
      notes = doc;
    } else {
      blocks = doc;
    }
  }

  if (!notes || !blocks) {
    return null;
  }
  return { notes, blocks };
}
