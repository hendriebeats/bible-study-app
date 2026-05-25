import type { PMDocJSON } from "@/lib/editor/types";
import type { Section, SectionSummary, Study, TrashItem } from "@/lib/db/types";
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

export async function getStudy(studyId: string): Promise<Study | null> {
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
}

export async function listSections(studyId: string): Promise<SectionSummary[]> {
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
}

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
