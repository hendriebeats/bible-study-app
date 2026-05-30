import { createClient } from "@/lib/supabase/client";
import type { PMDocJSON } from "@/lib/editor/types";

/**
 * Resurrect images referenced by a version-history snapshot.
 *
 * When a user restores an older document version, some image nodes may
 * reference files that the per-save cleanup hook trashed since (the live
 * doc removed them → they were `move`d to `_trash/{userId}/{studyId}/...`).
 * Until the 30-day retention sweep hard-deletes them, we can move them back
 * to the live path so the restored doc renders correctly.
 *
 * Best-effort: any miss (file already swept, RLS denial, network blip) is
 * logged and skipped. The image node still resolves to a URL — the NodeView
 * will render its "image no longer available" placeholder on the resulting
 * 404 if the file genuinely vanished.
 *
 * Call this from the restore code path BEFORE dispatching the restored doc
 * into the editor so the resurrection completes first.
 */
export async function resurrectTrashedImages(docs: PMDocJSON[]): Promise<void> {
  const srcs = new Set<string>();
  for (const doc of docs) collectImageSrcs(doc, srcs);
  if (srcs.size === 0) return;

  const supabase = createClient();
  await Promise.all(Array.from(srcs).map((src) => resurrectOne(supabase, src)));
}

function collectImageSrcs(
  node:
    | PMDocJSON
    | { type?: string; attrs?: Record<string, unknown>; content?: unknown[] },
  out: Set<string>,
): void {
  const anyNode = node;
  if (anyNode.type === "image") {
    const src = anyNode.attrs?.src;
    if (typeof src === "string" && src && !src.startsWith("pending:")) {
      out.add(src);
    }
  }
  if (Array.isArray(anyNode.content)) {
    for (const child of anyNode.content) {
      collectImageSrcs(child as PMDocJSON, out);
    }
  }
}

async function resurrectOne(
  supabase: ReturnType<typeof createClient>,
  src: string,
): Promise<void> {
  // Parse the bucket path out of the public URL. Format:
  //   {origin}/storage/v1/object/public/study-images/{userId}/{studyId}/{file}
  const marker = "/study-images/";
  const idx = src.indexOf(marker);
  if (idx === -1) return; // not a bucket URL — leave alone
  const livePath = src.slice(idx + marker.length);
  if (livePath.startsWith("_trash/")) return; // already a trash URL
  const trashPath = `_trash/${livePath}`;

  // Try the live path first — if it 200s, no resurrect needed.
  // Storage doesn't expose a cheap "exists" check, so we attempt the move
  // and let the API return "object not found at destination" or similar if
  // the live path already has it. The cheapest probe is a `list` on the
  // parent of the live path filtered to the file name.
  const slash = livePath.lastIndexOf("/");
  const parent = slash >= 0 ? livePath.slice(0, slash) : "";
  const name = slash >= 0 ? livePath.slice(slash + 1) : livePath;
  const { data: liveListing } = await supabase.storage
    .from("study-images")
    .list(parent, { search: name, limit: 1 });
  if (liveListing?.some((f) => f.name === name) === true) return;

  const { error } = await supabase.storage
    .from("study-images")
    .move(trashPath, livePath);
  if (error) {
    console.warn("[image-resurrect]", livePath, error.message);
  }
}
