"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
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

export type AppendResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; head: number };

/**
 * Append a batch of ProseMirror steps to a section's history (and update its
 * materialized doc) atomically via the `append_section_steps` RPC. Returns the
 * new head version, or a conflict if the client's base is stale.
 */
export async function appendSectionSteps(
  sectionId: string,
  expectedBase: number,
  steps: SerializedStep[],
  newDoc: PMDocJSON,
  clientId: string,
): Promise<AppendResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("append_section_steps", {
    _section_id: sectionId,
    _expected_base: expectedBase,
    _steps: steps as unknown as Json,
    _new_doc: newDoc as unknown as Json,
    _client_id: clientId,
  });
  if (error) {
    // The RPC raises SQLSTATE PT409 on a version conflict so the client resyncs.
    if (error.code === "PT409") {
      const { data: head } = await supabase
        .from("sections")
        .select("current_version")
        .eq("id", sectionId)
        .maybeSingle();
      return {
        ok: false,
        conflict: true,
        head: head?.current_version ?? expectedBase,
      };
    }
    throw new Error(error.message);
  }
  return { ok: true, version: data };
}

/** Snapshot a section's current doc as a checkpoint (idempotent per version). */
export async function createSectionCheckpoint(
  sectionId: string,
  label?: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_section_checkpoint", {
    _section_id: sectionId,
    _label: label,
  });
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
