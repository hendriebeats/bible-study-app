"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Transform } from "prosemirror-transform";

import { EMPTY_DOC, type DocumentStepMeta } from "@/lib/db/types";
import type { DocumentTimeline } from "@/lib/db/types";
import { specsFromBlocksDoc, type BlockSpec } from "@/lib/editor/blocks";
import { docToJSON, jsonToDoc, jsonToStep } from "@/lib/editor/serialize";
import type { PMDocJSON, PMNodeJSON, SerializedStep } from "@/lib/editor/types";
import { getGenreIdBySlug } from "@/lib/db/genres";
import { listStudyGroupLinks } from "@/lib/db/groups";
import { getScriptureProvider } from "@/lib/scripture";
import { genreSlugForBook } from "@/lib/scripture/books";
import {
  normalizeScriptureOptions,
  type ScriptureOptions,
} from "@/lib/scripture/options";
import { parseReference } from "@/lib/scripture/reference";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Block specs from the section's most recent OTHER section — the source for the
 * editor's "Copy from previous section" action. Empty if there's no prior one.
 */
export async function getPreviousSectionBlockSpecs(
  studyId: string,
  sectionId: string,
): Promise<BlockSpec[]> {
  const { supabase } = await requireUser();
  const { data: prevSections } = await supabase
    .from("sections")
    .select("id")
    .eq("study_id", studyId)
    .is("deleted_at", null)
    .neq("id", sectionId)
    .order("position", { ascending: false })
    .limit(1);
  const prev = prevSections?.[0];
  if (!prev) {
    return [];
  }
  const { data: prevBlocks } = await supabase
    .from("documents")
    .select("content")
    .eq("section_id", prev.id)
    .eq("kind", "blocks")
    .maybeSingle();
  if (!prevBlocks) {
    return [];
  }
  return specsFromBlocksDoc(prevBlocks.content as unknown as PMDocJSON);
}

/**
 * Block specs for the editor's "Use this study's template blocks" action: the
 * study's source template's first-section blocks, else its genre default set.
 */
export async function getStudyTemplateBlockSpecs(
  studyId: string,
): Promise<BlockSpec[]> {
  const { supabase } = await requireUser();
  const { data: study } = await supabase
    .from("studies")
    .select("genre_id, source_template_id")
    .eq("id", studyId)
    .maybeSingle();
  if (!study) {
    return [];
  }

  if (study.source_template_id) {
    const { data: tmpl } = await supabase
      .from("study_templates")
      .select("template_study_id")
      .eq("id", study.source_template_id)
      .maybeSingle();
    if (tmpl) {
      const { data: tmplSection } = await supabase
        .from("sections")
        .select("id")
        .eq("study_id", tmpl.template_study_id)
        .is("deleted_at", null)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (tmplSection) {
        const { data: tmplBlocks } = await supabase
          .from("documents")
          .select("content")
          .eq("section_id", tmplSection.id)
          .eq("kind", "blocks")
          .maybeSingle();
        if (tmplBlocks) {
          const specs = specsFromBlocksDoc(
            tmplBlocks.content as unknown as PMDocJSON,
          );
          if (specs.length > 0) {
            return specs;
          }
        }
      }
    }
  }

  if (study.genre_id) {
    const { data: templates } = await supabase
      .from("genre_block_templates")
      .select("id, title, subtitle, placeholder, default_content, lineage_id")
      .eq("genre_id", study.genre_id)
      .order("position", { ascending: true });
    return (templates ?? []).map((t) => ({
      title: t.title,
      subtitle: t.subtitle,
      placeholder: t.placeholder,
      defaultContent: t.default_content as PMNodeJSON[] | null,
      lineageId: t.lineage_id,
      templateId: t.id,
    }));
  }

  return [];
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

export interface StudySelection {
  kind: "book" | "custom" | "blank";
  title: string;
  /** 1..66, when kind === "book". */
  bookOrdinal?: number;
  /** study_templates.id, when kind === "custom". */
  templateId?: string;
}

/**
 * Create a study from a Book / Custom / Blank selection. Resolution (org
 * override → app default → genre-seeded fallback for books; visibility-gated
 * instantiate for customs; empty for blank) lives in the SECURITY DEFINER
 * `create_study_from_selection` RPC; we just derive the book's genre here.
 */
/** Returns where to navigate; the client pushes there (avoids a NEXT_REDIRECT
 * throw surfacing as a toast when called imperatively). */
export type NavResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export async function createStudyFromSelection(
  input: StudySelection,
): Promise<NavResult> {
  const { supabase } = await requireUser();

  let genreId: string | null = null;
  if (input.kind === "book" && input.bookOrdinal != null) {
    const slug = genreSlugForBook(input.bookOrdinal);
    genreId = slug ? await getGenreIdBySlug(slug) : null;
  }

  const { data, error } = await supabase.rpc("create_study_from_selection", {
    _kind: input.kind,
    _title: input.title,
    _book_ordinal: input.bookOrdinal ?? undefined,
    _template_id: input.templateId ?? undefined,
    _genre_id: genreId ?? undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true, path: `/studies/${data}` };
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
  // New sections start empty; the editor's "Add blocks" button fills them.
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
      /** Parsed location so the client can stamp each verse marker's structured
       * book/chapter/verse (the opening verse's ESV marker omits its chapter). */
      bookOrdinal: number;
      startChapter: number;
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
  options?: ScriptureOptions,
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
    // Options only shape the fetched/formatted text — never the verse-range
    // sidecar below, which is derived from `parsed` so cross-study alignment
    // stays independent of how the passage was formatted.
    passage = await getScriptureProvider().getPassage(
      reference,
      normalizeScriptureOptions(options),
    );
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

  // Auto-suggest the study's genre from the book's fixed genre — but only when
  // the study has none yet, so a user's manual choice is never overridden. The
  // first passage added thus picks the matching block template for new sections.
  const { data: section } = await supabase
    .from("sections")
    .select("study_id")
    .eq("id", sectionId)
    .maybeSingle();
  if (section) {
    const { data: study } = await supabase
      .from("studies")
      .select("id, genre_id")
      .eq("id", section.study_id)
      .maybeSingle();
    if (study?.genre_id === null) {
      const slug = genreSlugForBook(parsed.bookOrdinal);
      const genreId = slug ? await getGenreIdBySlug(slug) : null;
      if (genreId) {
        await supabase
          .from("studies")
          .update({ genre_id: genreId })
          .eq("id", study.id);
        revalidatePath(`/studies/${study.id}`);
      }
    }
  }

  return {
    ok: true,
    passageId: data.id,
    reference: passage.reference,
    version: passage.version,
    text: passage.content,
    bookOrdinal: parsed.bookOrdinal,
    startChapter: parsed.startChapter,
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

/**
 * The document's recent history "moments" — one row per save-batch (version +
 * timestamp, NO step payloads) — for building the history scrubber without
 * transferring the whole step log. Backed by the `document_history_moments` RPC,
 * which groups steps by batch and caps at the most recent 1000 (well under
 * PostgREST's max_rows); older states stay in the DB but aren't scrubbable. The
 * chosen point is materialized on demand by {@link reconstructDocumentVersion}.
 */
export async function fetchDocumentMoments(
  documentId: string,
): Promise<DocumentStepMeta[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("document_history_moments", {
    _document_id: documentId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data.map((r) => ({
    version: r.version,
    created_at: r.created_at,
  }));
}

/**
 * Materialize a document at `version` with a bounded query: the nearest
 * checkpoint at or before it plus only the steps in between (≤ the checkpoint
 * interval), replayed server-side. Avoids loading the full step log just to
 * preview/restore one point.
 */
export async function reconstructDocumentVersion(
  documentId: string,
  version: number,
): Promise<PMDocJSON> {
  const { supabase } = await requireUser();
  const { data: checkpoint, error: cpError } = await supabase
    .from("section_checkpoints")
    .select("version, doc")
    .eq("document_id", documentId)
    .lte("version", version)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cpError) {
    throw new Error(cpError.message);
  }
  const baseVersion = checkpoint?.version ?? 0;
  let baseDoc: PMDocJSON;
  if (checkpoint) {
    baseDoc = checkpoint.doc as unknown as PMDocJSON;
  } else {
    // No checkpoint at/before this version → the document had no committed
    // history then. Fall back to its CURRENT content (not EMPTY_DOC) so a
    // section restore leaves an as-yet-unedited doc untouched instead of wiping
    // it.
    const { data: docRow } = await supabase
      .from("documents")
      .select("content")
      .eq("id", documentId)
      .maybeSingle();
    baseDoc = (docRow?.content as PMDocJSON | undefined) ?? EMPTY_DOC;
  }
  if (version <= baseVersion) {
    return baseDoc;
  }
  const { data: steps, error: stepsError } = await supabase
    .from("section_steps")
    .select("step, version")
    .eq("document_id", documentId)
    .gt("version", baseVersion)
    .lte("version", version)
    .order("version", { ascending: true });
  if (stepsError) {
    throw new Error(stepsError.message);
  }
  const transform = new Transform(jsonToDoc(baseDoc));
  for (const row of steps) {
    transform.step(jsonToStep(row.step as unknown as SerializedStep));
  }
  return docToJSON(transform.doc);
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

/**
 * What happens to the caller's group membership(s) when they trash a study
 * that's attached to one or more groups:
 *   - "keep"   stay a member; keep the link (restoring re-attaches the study)
 *   - "detach" stay a member but unlink this study (become a "loose" member)
 *   - "leave"  also leave the group(s)
 * Studies attached to no group always use "keep" (the link clause is a no-op).
 */
export type DeleteStudyMode = "keep" | "detach" | "leave";

export type DeleteStudyResult = { ok: true } | { ok: false; error: string };

/**
 * Soft-delete a whole study into the Trash (recoverable; archived after 30
 * days), applying the chosen disposition to any group memberships in a single
 * transaction. "leave" can fail if the caller is a group's last owner — the DB
 * rolls back the whole thing (study stays un-trashed) and we surface the error.
 */
export async function deleteStudy(
  studyId: string,
  mode: DeleteStudyMode = "keep",
): Promise<DeleteStudyResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_study_with_disposition", {
    _study_id: studyId,
    _mode: mode,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard");
  revalidatePath("/groups");
  return { ok: true };
}

/**
 * Groups the current user has this study attached to — for the delete prompt
 * that lets them choose what happens to their membership(s). Empty when the
 * study isn't shared anywhere.
 */
export async function getStudyGroupLinks(studyId: string) {
  await requireUser();
  return listStudyGroupLinks(studyId);
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
