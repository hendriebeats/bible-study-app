"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DocumentTimeline } from "@/lib/db/types";
import {
  blocksDocFromSpecs,
  specsFromBlocksDoc,
  type BlockSpec,
} from "@/lib/editor/blocks";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
import { getScriptureProvider } from "@/lib/scripture";
import { parseReference } from "@/lib/scripture/reference";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Seed a new section's `blocks` document. Sticky: copy the most recent other
 * section's block setup; otherwise fall back to the study's genre default
 * template; otherwise leave the empty default. Sets content directly (version
 * 0) — the seed is the new baseline, not an edit.
 */
async function seedNewSectionBlocks(
  supabase: ServerClient,
  studyId: string,
  newSectionId: string,
): Promise<void> {
  let specs: BlockSpec[] = [];

  const { data: prevSections } = await supabase
    .from("sections")
    .select("id")
    .eq("study_id", studyId)
    .is("deleted_at", null)
    .neq("id", newSectionId)
    .order("position", { ascending: false })
    .limit(1);
  const prev = prevSections?.[0];
  if (prev) {
    const { data: prevBlocks } = await supabase
      .from("documents")
      .select("content")
      .eq("section_id", prev.id)
      .eq("kind", "blocks")
      .maybeSingle();
    if (prevBlocks) {
      specs = specsFromBlocksDoc(prevBlocks.content as unknown as PMDocJSON);
    }
  }

  if (specs.length === 0) {
    const { data: study } = await supabase
      .from("studies")
      .select("genre_id")
      .eq("id", studyId)
      .maybeSingle();
    if (study?.genre_id) {
      const { data: templates } = await supabase
        .from("genre_block_templates")
        .select("id, label, prompt, lineage_id")
        .eq("genre_id", study.genre_id)
        .order("position", { ascending: true });
      specs = (templates ?? []).map((t) => ({
        label: t.label,
        prompt: t.prompt,
        lineageId: t.lineage_id,
        templateId: t.id,
      }));
    }
  }

  if (specs.length === 0) {
    return;
  }

  await supabase
    .from("documents")
    .update({ content: blocksDocFromSpecs(specs) as unknown as Json })
    .eq("section_id", newSectionId)
    .eq("kind", "blocks");
}

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
  await seedNewSectionBlocks(supabase, studyId, sectionId);
  revalidatePath(`/studies/${studyId}`);
  redirect(`/studies/${studyId}/${sectionId}`);
}

/** Set (or clear) a study's genre — drives default study blocks for new sections. */
export async function setStudyGenre(
  studyId: string,
  genreId: string | null,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("studies")
    .update({ genre_id: genreId })
    .eq("id", studyId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
}

export type AddPassageResult =
  | {
      ok: true;
      passageId: string;
      reference: string;
      version: string;
      text: string;
    }
  | { ok: false; error: string };

/**
 * Resolve a free-text reference to an ESV passage: parse + normalize the
 * reference, fetch the raw text, and record a `scripture_passages` row (the
 * normalized verse-range sidecar used later for cross-study alignment). Returns
 * the canonical reference + raw text so the client can insert a scripture node.
 */
export async function addScripturePassage(
  sectionId: string,
  reference: string,
): Promise<AddPassageResult> {
  const { supabase } = await requireUser();

  const parsed = parseReference(reference);
  if (!parsed) {
    return {
      ok: false,
      error: 'Couldn’t recognize that reference. Try e.g. "John 3:1-21".',
    };
  }

  let passage;
  try {
    passage = await getScriptureProvider().getPassage(reference);
  } catch {
    return { ok: false, error: "Couldn’t fetch that passage from ESV." };
  }

  const { data: last } = await supabase
    .from("scripture_passages")
    .select("position")
    .eq("section_id", sectionId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = last ? last.position + 1 : 0;

  const { data, error } = await supabase
    .from("scripture_passages")
    .insert({
      section_id: sectionId,
      reference: passage.reference,
      version: passage.version,
      book: parsed.book,
      book_ordinal: parsed.bookOrdinal,
      start_chapter: parsed.startChapter,
      start_verse: parsed.startVerse,
      end_chapter: parsed.endChapter,
      end_verse: parsed.endVerse,
      start_verse_id: parsed.startVerseId,
      end_verse_id: parsed.endVerseId,
      position,
    })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    passageId: data.id,
    reference: passage.reference,
    version: passage.version,
    text: passage.content,
  };
}

export type AppendResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; head: number };

/**
 * Append a batch of ProseMirror steps to a document's history (and update its
 * materialized doc) atomically via the `append_document_steps` RPC. Returns the
 * new head version, or a conflict if the client's base is stale.
 */
export async function appendDocumentSteps(
  documentId: string,
  expectedBase: number,
  steps: SerializedStep[],
  newDoc: PMDocJSON,
  clientId: string,
): Promise<AppendResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("append_document_steps", {
    _document_id: documentId,
    _expected_base: expectedBase,
    _steps: steps as unknown as Json,
    _new_doc: newDoc as unknown as Json,
    _client_id: clientId,
  });
  if (error) {
    // The RPC raises SQLSTATE PT409 on a version conflict so the client resyncs.
    if (error.code === "PT409") {
      const { data: head } = await supabase
        .from("documents")
        .select("current_version")
        .eq("id", documentId)
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

/** Fetch a document's full history (checkpoints + steps) for the history panel. */
export async function fetchDocumentTimeline(
  documentId: string,
): Promise<DocumentTimeline> {
  const { supabase } = await requireUser();
  const { data: checkpoints, error: cpError } = await supabase
    .from("section_checkpoints")
    .select("version, label, created_at, doc")
    .eq("document_id", documentId)
    .order("version", { ascending: true });
  if (cpError) {
    throw new Error(cpError.message);
  }
  const { data: steps, error: stepsError } = await supabase
    .from("section_steps")
    .select("version, step, created_at")
    .eq("document_id", documentId)
    .order("version", { ascending: true });
  if (stepsError) {
    throw new Error(stepsError.message);
  }
  return {
    checkpoints: checkpoints.map((c) => ({
      version: c.version,
      label: c.label,
      created_at: c.created_at,
      doc: c.doc as unknown as PMDocJSON,
    })),
    steps: steps.map((s) => ({
      version: s.version,
      step: s.step as unknown as SerializedStep,
      created_at: s.created_at,
    })),
  };
}

/** Fetch a document's current materialized doc + head version (viewer resync). */
export async function fetchDocumentHead(
  documentId: string,
): Promise<{ content: PMDocJSON; version: number } | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("documents")
    .select("content, current_version")
    .eq("id", documentId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }
  return {
    content: data.content as unknown as PMDocJSON,
    version: data.current_version,
  };
}

/** Snapshot a document's current doc as a checkpoint (idempotent per version). */
export async function createDocumentCheckpoint(
  documentId: string,
  label?: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_document_checkpoint", {
    _document_id: documentId,
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

/** Soft-delete a section into the Trash (recoverable; archived after 30 days). */
export async function deleteSection(
  sectionId: string,
  studyId: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("sections")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", sectionId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
  redirect(`/studies/${studyId}`);
}

/** Restore a soft-deleted section from the Trash. */
export async function restoreSection(
  sectionId: string,
  studyId: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("sections")
    .update({ deleted_at: null })
    .eq("id", sectionId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/studies/${studyId}`);
}

/** Soft-delete a whole study into the Trash (recoverable; archived after 30 days). */
export async function deleteStudy(studyId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("studies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", studyId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/dashboard");
}

/** Restore a soft-deleted study from the Trash. */
export async function restoreStudy(studyId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("studies")
    .update({ deleted_at: null })
    .eq("id", studyId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/dashboard");
}
