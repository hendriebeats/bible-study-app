// One-off data repair: remove the deleted `scripture_text` ProseMirror mark from
// every stored document JSON so the editor (whose schema no longer defines it)
// can deserialize existing studies without crashing.
//
// Strips the mark from any `marks: [...]` array at any depth in these columns:
//   documents.content, section_checkpoints.doc, sections.content,
//   section_steps.step, genre_block_templates.default_content
// For section_steps that are addMark/removeMark steps whose top-level `mark` is
// scripture_text (a no-op now), the whole step row is deleted instead.
//
// DRY RUN by default — prints what it WOULD change. Pass `--apply` to write.
//   node scripts/strip-scripture-text.mjs            # audit only
//   node scripts/strip-scripture-text.mjs --apply     # perform the cleanup

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const MARK = "scripture_text";
const APPLY = process.argv.includes("--apply");
const PAGE = 1000;

// --- load URL + service-role key from .env.local (not auto-loaded by node) ---
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Recursively remove {type:"scripture_text"} from every `marks` array. Returns
 *  { value, removed } where removed counts how many mark entries were dropped. */
function strip(node) {
  if (Array.isArray(node)) {
    let removed = 0;
    const value = node.map((v) => {
      const r = strip(v);
      removed += r.removed;
      return r.value;
    });
    return { value, removed };
  }
  if (node && typeof node === "object") {
    let removed = 0;
    const value = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "marks" && Array.isArray(v)) {
        const kept = v.filter(
          (m) => !(m && typeof m === "object" && m.type === MARK),
        );
        removed += v.length - kept.length;
        if (kept.length > 0) value[k] = kept; // drop an emptied marks array entirely
      } else {
        const r = strip(v);
        value[k] = r.value;
        removed += r.removed;
      }
    }
    return { value, removed };
  }
  return { value: node, removed: 0 };
}

/** An addMark/removeMark step whose mark is scripture_text — a no-op now; the
 *  top-level `mark` field can't be repaired by stripping, so the row is removed. */
function isPureMarkStep(step) {
  return (
    step &&
    (step.stepType === "addMark" || step.stepType === "removeMark") &&
    step.mark &&
    step.mark.type === MARK
  );
}

async function fetchAll(table, col) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${col}`)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function cleanColumn(table, col, { isStep = false } = {}) {
  let rows;
  try {
    rows = await fetchAll(table, col);
  } catch (e) {
    console.log(`  ⚠️  ${table}.${col}: skipped (${e.message})`);
    return;
  }
  let updated = 0;
  let deleted = 0;
  let marksRemoved = 0;
  for (const row of rows) {
    const json = row[col];
    if (json == null) continue;
    const hasMark = JSON.stringify(json).includes(`"${MARK}"`);
    if (!hasMark) continue;

    if (isStep && isPureMarkStep(json)) {
      deleted += 1;
      console.log(`  - ${table} ${row.id}: delete no-op ${json.stepType} step`);
      if (APPLY) {
        const { error } = await supabase.from(table).delete().eq("id", row.id);
        if (error) console.log(`      ✗ delete failed: ${error.message}`);
      }
      continue;
    }

    const { value, removed } = strip(json);
    if (removed === 0) {
      // mark string present but not in a `marks` array — surface it for review.
      console.log(
        `  ? ${table} ${row.id}: contains "${MARK}" outside a marks[] array (not auto-stripped)`,
      );
      continue;
    }
    updated += 1;
    marksRemoved += removed;
    if (APPLY) {
      const { error } = await supabase
        .from(table)
        .update({ [col]: value })
        .eq("id", row.id);
      if (error)
        console.log(`      ✗ update ${row.id} failed: ${error.message}`);
    }
  }
  const verb = APPLY ? "" : "would ";
  console.log(
    `  ${table}.${col}: ${rows.length} rows scanned — ${verb}update ${updated} (${marksRemoved} marks)` +
      (isStep ? `, ${verb}delete ${deleted} step rows` : ""),
  );
}

console.log(
  `\n${APPLY ? "APPLYING cleanup" : "DRY RUN (no writes)"} on ${url}\n`,
);
await cleanColumn("documents", "content");
await cleanColumn("section_checkpoints", "doc");
await cleanColumn("sections", "content");
await cleanColumn("section_steps", "step", { isStep: true });
await cleanColumn("genre_block_templates", "default_content");
console.log(
  `\nDone.${APPLY ? "" : " Re-run with --apply to perform the cleanup."}\n`,
);
