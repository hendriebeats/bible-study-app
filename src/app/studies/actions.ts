"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PMDocJSON } from "@/lib/editor/types";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/** Resolves the current user id, redirecting to login if unauthenticated. */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, userId: user.id };
}

export async function createStudy(): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data, error } = await supabase
    .from("studies")
    .insert({ owner_id: userId, title: "Untitled study" })
    .select("id")
    .single();
  if (error) {
    throw new Error(error.message);
  }

  const studyId = data.id;

  // Seed the study with a first section so there's somewhere to write.
  const { error: sectionError } = await supabase
    .from("sections")
    .insert({ study_id: studyId, title: "Introduction", position: 0 });
  if (sectionError) {
    throw new Error(sectionError.message);
  }

  revalidatePath("/dashboard");
  redirect(`/studies/${studyId}`);
}

export async function createSection(studyId: string): Promise<void> {
  const { supabase } = await requireUser();

  const { data: last } = await supabase
    .from("sections")
    .select("position")
    .eq("study_id", studyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = last ? last.position + 1 : 0;

  const { data, error } = await supabase
    .from("sections")
    .insert({ study_id: studyId, title: "New section", position: nextPosition })
    .select("id")
    .single();
  if (error) {
    throw new Error(error.message);
  }

  const sectionId = data.id;
  revalidatePath(`/studies/${studyId}`);
  redirect(`/studies/${studyId}/${sectionId}`);
}

/** Debounced autosave of a section's ProseMirror document. */
export async function saveSection(
  sectionId: string,
  content: PMDocJSON,
): Promise<void> {
  const { supabase } = await requireUser();
  // `content` is our PM doc type; the jsonb column is typed as `Json`.
  const { error } = await supabase
    .from("sections")
    .update({ content: content as unknown as Json })
    .eq("id", sectionId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function renameSection(
  sectionId: string,
  studyId: string,
  title: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("sections")
    .update({ title })
    .eq("id", sectionId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
}

export async function renameStudy(
  studyId: string,
  title: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("studies")
    .update({ title })
    .eq("id", studyId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
  revalidatePath("/dashboard");
}

export async function deleteSection(
  sectionId: string,
  studyId: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("sections")
    .delete()
    .eq("id", sectionId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
  redirect(`/studies/${studyId}`);
}
