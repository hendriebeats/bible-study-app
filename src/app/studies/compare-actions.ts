"use server";

import { redirect } from "next/navigation";

import type { StudyDocument } from "@/lib/db/types";
import { WORKSPACE_LAYOUT_VERSION } from "@/lib/db/workspace";
import type { PMDocJSON } from "@/lib/editor/types";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

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

export interface AlignCandidate {
  sectionId: string;
  title: string;
  /** The section's order within its study (for natural-order browsing). */
  position: number;
  score: number;
  lineageMatch: boolean;
  overlap: number;
}

export interface AlignResult {
  candidates: AlignCandidate[];
  /** Auto-picked top match, or a remembered manual override. */
  selectedId: string | null;
}

/** Rank a target study's sections against my section, applying any saved override. */
export async function alignSections(
  mySectionId: string,
  targetStudyId: string,
): Promise<AlignResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("align_sections", {
    _my_section_id: mySectionId,
    _target_study_id: targetStudyId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const candidates: AlignCandidate[] = data.map((row) => ({
    sectionId: row.section_id,
    title: row.title,
    position: row.section_position,
    score: row.score,
    lineageMatch: row.lineage_match,
    overlap: row.overlap,
  }));

  const { data: saved } = await supabase
    .from("section_alignments")
    .select("target_section_id")
    .eq("my_section_id", mySectionId)
    .eq("target_study_id", targetStudyId)
    .maybeSingle();

  const selectedId =
    saved?.target_section_id ?? candidates[0]?.sectionId ?? null;
  return { candidates, selectedId };
}

/** Remember which of a target study's sections lines up with mine. */
export async function setAlignment(
  mySectionId: string,
  targetStudyId: string,
  targetSectionId: string,
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("section_alignments").upsert(
    {
      user_id: userId,
      my_section_id: mySectionId,
      target_study_id: targetStudyId,
      target_section_id: targetSectionId,
      is_manual: true,
    },
    { onConflict: "user_id,my_section_id,target_study_id" },
  );
  if (error) {
    throw new Error(error.message);
  }
}

/** Persist the dockview compare-workspace layout for (me, this study). */
export async function saveWorkspaceLayout(
  studyId: string,
  layout: unknown,
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("workspace_states").upsert(
    {
      user_id: userId,
      study_id: studyId,
      layout: layout as Json,
      layout_version: WORKSPACE_LAYOUT_VERSION,
    },
    { onConflict: "user_id,study_id" },
  );
  if (error) {
    throw new Error(error.message);
  }
}

/** A section's notes document, for read-along rendering in a compare pane. */
export async function fetchSectionForCompare(
  sectionId: string,
): Promise<{ title: string; notes: StudyDocument } | null> {
  const { supabase } = await requireUser();
  const { data: section } = await supabase
    .from("sections")
    .select("id, study_id, title")
    .eq("id", sectionId)
    .maybeSingle();
  if (!section) {
    return null;
  }
  const { data: doc } = await supabase
    .from("documents")
    .select("id, section_id, kind, content, current_version")
    .eq("section_id", sectionId)
    .eq("kind", "notes")
    .maybeSingle();
  if (!doc) {
    return null;
  }
  return {
    title: section.title,
    notes: {
      id: doc.id,
      section_id: doc.section_id,
      kind: doc.kind,
      content: doc.content as unknown as PMDocJSON,
      current_version: doc.current_version,
    },
  };
}
