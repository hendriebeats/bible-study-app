// sweep-trashed-images: daily holistic janitor for the study-images bucket.
//
// Two passes:
//   1. Archived-study trash: list studies that have been archived (deleted
//      then auto-archived 30 days later by the section-history pg_cron job)
//      and `move` their entire `{userId}/{studyId}/` prefix into `_trash/`.
//      Edits to a live study can't reach an archived study, so the
//      reference-counted cleanup hook never sees those files — without this
//      pass they'd orphan forever.
//   2. Trash retention: hard-delete anything under `_trash/` older than
//      RETENTION_DAYS. Soft-deleted files get there via the editor's
//      per-save reference-counted cleanup (orphans `move`'d to
//      `_trash/{userId}/{studyId}/...`), which gives version-history restore
//      a 30-day window to bring them back.
//
// Invoked by Supabase's scheduled functions (cron 0 3 * * *). Uses the
// service-role key so it can list + delete + query studies without per-user
// RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const RETENTION_DAYS = 30;
const PAGE_SIZE = 1000; // Storage list cap per page
const DELETE_BATCH = 100; // Storage remove cap per call

interface StorageObject {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  id?: string | null;
}

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", {
      status: 500,
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toDelete: string[] = [];

  // ---- Pass 1: trash archived studies' live bucket prefixes ---------------
  // Studies move through active → trashed (`deleted_at`) → archived
  // (`archived_at`) via pg_cron in 20260526000000_section_history.sql. Once
  // archived they're effectively dead; reclaim their bucket space by moving
  // every object under `{owner_id}/{study_id}/` to `_trash/...` so pass 2
  // can hard-delete after retention.
  interface ArchivedStudy {
    id: string;
    owner_id: string;
  }
  let archivedMoved = 0;
  const { data: archived, error: archivedErr } = await supabase
    .from("studies")
    .select("id, owner_id")
    .not("archived_at", "is", null)
    .limit(500)
    .overrideTypes<ArchivedStudy[], { merge: false }>();
  if (archivedErr) {
    console.error("studies select error", archivedErr.message);
  } else {
    for (const row of archived) {
      const prefix = `${row.owner_id}/${row.id}`;
      const { data: files, error: listErr } = await supabase.storage
        .from("study-images")
        .list(prefix, { limit: PAGE_SIZE });
      if (listErr) {
        console.error("list error at", prefix, listErr.message);
        continue;
      }
      if (files.length === 0) continue;
      for (const file of files as StorageObject[]) {
        if (!file.id) continue; // skip subfolders
        const from = `${prefix}/${file.name}`;
        const to = `_trash/${from}`;
        const { error: mvErr } = await supabase.storage
          .from("study-images")
          .move(from, to);
        if (mvErr) {
          console.error("move error", from, mvErr.message);
          continue;
        }
        archivedMoved++;
      }
    }
  }

  // ---- Pass 2: hard-delete trashed files past retention -------------------

  // Walk every user folder under `_trash/` → every study folder → every file.
  // The storage list API is hierarchical, so we recurse one level at a time.
  // Limited to ~3 levels by our path convention, so this stays bounded.
  async function walk(prefix: string, depth: number): Promise<void> {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from("study-images")
        .list(prefix, { limit: PAGE_SIZE, offset });
      if (error) {
        console.error("list error at", prefix, error.message);
        return;
      }
      if (data.length === 0) return;

      for (const item of data as StorageObject[]) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        // A folder shows up as a name with no id. Recurse.
        if (!item.id && depth < 3) {
          await walk(path, depth + 1);
          continue;
        }
        // File. Check its age.
        const stamp = item.created_at ?? item.updated_at;
        if (!stamp) continue;
        const t = Date.parse(stamp);
        if (Number.isFinite(t) && t < cutoff) {
          toDelete.push(path);
        }
      }

      if (data.length < PAGE_SIZE) return;
      offset += PAGE_SIZE;
    }
  }

  await walk("_trash", 0);

  let removed = 0;
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const batch = toDelete.slice(i, i + DELETE_BATCH);
    const { error } = await supabase.storage.from("study-images").remove(batch);
    if (error) {
      console.error("remove error batch", i, error.message);
      continue;
    }
    removed += batch.length;
  }

  return new Response(
    JSON.stringify({
      archivedMoved,
      scanned: toDelete.length,
      removed,
      cutoff: new Date(cutoff).toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
