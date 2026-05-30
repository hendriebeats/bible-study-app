#!/usr/bin/env node
/**
 * One-shot codemod: rewrite Tailwind default font-size classes (`text-xs`,
 * `text-sm`, ...) to the semantic tokens registered in `src/app/globals.css`
 * (`text-caption`, `text-ui`, ...).
 *
 * Touches:
 *   - `src/**\/*.{ts,tsx,jsx}` (className strings, `cn(...)` / `clsx(...)` /
 *     `cva(...)` arg lists, template literals)
 *   - `src/**\/*.css`           (@apply directives use the same class names)
 *
 * Skips:
 *   - `src/components/ui/**`    (shadcn-vendored; gets regenerated)
 *   - `src/lib/supabase/database.types.ts` (generated)
 *
 * Strategy: word-boundary regex. Each replaceable class becomes its semantic
 * sibling. We DO NOT touch:
 *   - `text-foreground`, `text-muted-foreground`, ... (color utilities — the
 *     `\b` boundary keeps `text-xl-something` and color classes safe)
 *   - `text-sm/6`, `text-base/loose`, ... (Tailwind line-height pairing —
 *     these are not in actual use today but the regex preserves them too)
 *   - `text-5xl`, `text-7xl`, `text-8xl`, `text-9xl` — there are no usages of
 *     these today and there's no semantic equivalent; the lint rule errors on
 *     them so a human picks a name when one is needed.
 *
 * Usage:
 *   node scripts/migrate-text-tokens.mjs           # dry-run, prints diff summary
 *   node scripts/migrate-text-tokens.mjs --write   # actually mutate files
 */

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SRC_DIR = resolve(REPO_ROOT, "src");

const WRITE = process.argv.includes("--write");

// Old default → semantic replacement.
const MAP = {
  "text-xs": "text-caption",
  "text-sm": "text-ui",
  "text-base": "text-body",
  "text-lg": "text-subheading",
  "text-xl": "text-heading",
  "text-2xl": "text-title",
  "text-3xl": "text-page-title",
  "text-4xl": "text-display",
  "text-6xl": "text-display-xl",
};

// One regex with all the keys. `\b` opens the match on a word boundary; the
// `(?![-\w])` lookahead forbids continuation into another class fragment so
// `text-sm-foo` and `text-smile` are safe, while CSS terminators (`;`, `}`),
// Tailwind line-height modifiers (`/6`), string delimiters (`"` / `'`), and
// the end of a className string all permit the swap.
const CLASS_RE = new RegExp(
  `\\b(${Object.keys(MAP).join("|")})(?![-\\w])`,
  "g",
);

const SKIP_DIRS = new Set(["node_modules", ".next", "out", "build"]);
const SKIP_PATHS = [
  resolve(SRC_DIR, "components/ui"),
  resolve(SRC_DIR, "lib/supabase/database.types.ts"),
];

function shouldSkip(absPath) {
  return SKIP_PATHS.some((p) => absPath === p || absPath.startsWith(p + "/"));
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (shouldSkip(full)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const full = join(dir, entry.name);
      if (shouldSkip(full)) continue;
      const ext = extname(entry.name);
      if (![".ts", ".tsx", ".jsx", ".css"].includes(ext)) continue;
      yield full;
    }
  }
}

async function main() {
  try {
    await stat(SRC_DIR);
  } catch {
    console.error(`migrate-text-tokens: ${SRC_DIR} does not exist`);
    process.exit(2);
  }

  let filesChanged = 0;
  let totalReplacements = 0;
  const perTokenCount = Object.fromEntries(Object.keys(MAP).map((k) => [k, 0]));

  for await (const path of walk(SRC_DIR)) {
    const src = await readFile(path, "utf8");
    let count = 0;
    const next = src.replace(CLASS_RE, (m) => {
      count += 1;
      perTokenCount[m] += 1;
      return MAP[m];
    });
    if (count === 0) continue;
    filesChanged += 1;
    totalReplacements += count;
    const rel = relative(REPO_ROOT, path);
    console.log(`  ${rel}  (${count} replacement${count === 1 ? "" : "s"})`);
    if (WRITE) await writeFile(path, next);
  }

  console.log("");
  console.log("Per-token counts:");
  for (const [k, n] of Object.entries(perTokenCount)) {
    if (n > 0) console.log(`  ${k.padEnd(10)} → ${MAP[k].padEnd(18)} ${n}`);
  }
  console.log("");
  if (WRITE) {
    console.log(
      `migrate-text-tokens: ✓ rewrote ${totalReplacements} class${totalReplacements === 1 ? "" : "es"} across ${filesChanged} file${filesChanged === 1 ? "" : "s"}`,
    );
  } else {
    console.log(
      `migrate-text-tokens: dry-run — would rewrite ${totalReplacements} class${totalReplacements === 1 ? "" : "es"} across ${filesChanged} file${filesChanged === 1 ? "" : "s"}. Re-run with --write to apply.`,
    );
  }
}

await main();
