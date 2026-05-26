import { EMPTY_DOC } from "@/lib/db/types";
import type { DocumentHistory, DocumentStepRow } from "@/lib/db/types";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Build the data the editor needs to mount a document with persistent undo:
 * the latest checkpoint at or before the head (the base to replay from) plus
 * the steps from there to the head. When the document has no step history yet,
 * the materialized `content` is the doc and there's nothing to replay.
 */
export async function getDocumentHistory(
  documentId: string,
  headVersion: number,
  content: PMDocJSON,
): Promise<DocumentHistory> {
  if (headVersion === 0) {
    return { baseDoc: content, baseVersion: 0, headVersion: 0, steps: [] };
  }

  const supabase = await createClient();

  const { data: checkpoint, error: cpError } = await supabase
    .from("section_checkpoints")
    .select("version, doc")
    .eq("document_id", documentId)
    .lte("version", headVersion)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cpError) {
    throw new Error(cpError.message);
  }

  const baseVersion = checkpoint?.version ?? 0;
  const baseDoc = checkpoint
    ? (checkpoint.doc as unknown as PMDocJSON)
    : EMPTY_DOC;

  const { data: steps, error: stepsError } = await supabase
    .from("section_steps")
    .select("version, step, created_at")
    .eq("document_id", documentId)
    .gt("version", baseVersion)
    .lte("version", headVersion)
    .order("version", { ascending: true });
  if (stepsError) {
    throw new Error(stepsError.message);
  }

  const rows: DocumentStepRow[] = steps.map((row) => ({
    version: row.version,
    step: row.step as unknown as SerializedStep,
    created_at: row.created_at,
  }));

  return { baseDoc, baseVersion, headVersion, steps: rows };
}
