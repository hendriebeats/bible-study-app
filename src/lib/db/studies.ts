import type { PMDocJSON } from "@/lib/editor/types";
import type { Section, SectionSummary, Study } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** All studies the current user can see (RLS: own + group co-members'). */
export async function listStudies(): Promise<Study[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("studies")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
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
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
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
