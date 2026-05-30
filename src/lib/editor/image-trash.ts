import { createClient } from "@/lib/supabase/client";

/**
 * Move orphaned image files into the `study-images/_trash/` subpath.
 *
 * Called from the per-document save hook (`flush()`) after the server
 * returns the diff of image srcs removed from this save. Soft-deleted files
 * survive 30 days for version-history restore (`resurrectTrashedImages`)
 * before the daily sweep edge function hard-deletes them.
 *
 * Best-effort: storage errors are logged. The next save's diff will redo
 * any failed moves because the index column still doesn't list those srcs.
 */
export async function trashRemovedImages(srcs: string[]): Promise<void> {
  if (srcs.length === 0) return;
  const supabase = createClient();
  await Promise.all(
    srcs.map(async (src) => {
      const marker = "/study-images/";
      const idx = src.indexOf(marker);
      if (idx === -1) return; // not a bucket URL — nothing to trash
      const livePath = src.slice(idx + marker.length);
      if (livePath.startsWith("_trash/")) return;
      const trashPath = `_trash/${livePath}`;
      const { error } = await supabase.storage
        .from("study-images")
        .move(livePath, trashPath);
      if (error) console.warn("[image-trash]", livePath, error.message);
    }),
  );
}
