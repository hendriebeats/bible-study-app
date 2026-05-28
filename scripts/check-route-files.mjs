#!/usr/bin/env node
/**
 * Verifies that every `app/**\/page.tsx` is covered by a `loading.tsx` —
 * either in its own directory or in an ancestor directory under `app/` (the
 * Next.js convention: a parent `loading.tsx` automatically wraps all child
 * page.tsx files in its Suspense boundary).
 *
 * In Next 16 with `cacheComponents: true`, the implicit Suspense around the
 * page is what lets the page's awaits stream behind a fallback. Without it the
 * user sees a blank gap between navigation and the page render — the flicker
 * we're trying to eliminate.
 *
 * To exempt a page that genuinely doesn't need a fallback (a static landing
 * page, a redirect-only shell, etc.), add a top-of-file comment:
 *
 *     // loading-exempt: <one-line reason>
 *
 * Exit codes:
 *   0 — every page is either covered or explicitly exempted
 *   1 — at least one page is missing both a covering loading.tsx and an exemption
 *
 * Wired into `npm run check:routes` and the top-level `npm run check`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const APP_DIR = resolve(REPO_ROOT, "src/app");

const PAGE_NAMES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);
const LOADING_PATTERN = /^loading\.(tsx|ts|jsx|js)$/;
const EXEMPT_PATTERN = /\/\/\s*loading-exempt\s*:/;

/**
 * Walk up from `dir` toward `APP_DIR` looking for a loading.tsx in any
 * directory along the way. Stops once it reaches `APP_DIR`'s parent.
 */
async function ancestorHasLoading(dir) {
  let cur = dir;
  while (cur.startsWith(APP_DIR)) {
    const entries = await readdir(cur, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && LOADING_PATTERN.test(e.name))) {
      return true;
    }
    if (cur === APP_DIR) {
      return false;
    }
    cur = dirname(cur);
  }
  return false;
}

async function walk(dir, missing) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  const pageEntry = entries.find((e) => e.isFile() && PAGE_NAMES.has(e.name));
  if (pageEntry) {
    const covered = await ancestorHasLoading(dir);
    if (!covered) {
      const pagePath = join(dir, pageEntry.name);
      const source = await readFile(pagePath, "utf8");
      // Check only the first ~30 lines for the marker; deeper is suspicious.
      const head = source.split("\n", 30).join("\n");
      if (!EXEMPT_PATTERN.test(head)) {
        missing.push(relative(REPO_ROOT, pagePath));
      }
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await walk(join(dir, entry.name), missing);
    }
  }
}

async function main() {
  try {
    await stat(APP_DIR);
  } catch {
    console.error(`check-route-files: ${APP_DIR} does not exist`);
    process.exit(2);
  }
  const missing = [];
  await walk(APP_DIR, missing);
  if (missing.length === 0) {
    console.log(
      `check-route-files: ✓ every page.tsx has a sibling loading.tsx (or // loading-exempt:)`,
    );
    return;
  }
  console.error(
    `check-route-files: ${missing.length} page(s) missing a sibling loading.tsx:`,
  );
  for (const path of missing.sort()) {
    console.error(`  ${path}`);
  }
  console.error(
    `\nFix: create a sibling loading.tsx exporting a skeleton (see src/components/ui/skeleton.tsx),\n` +
      `or add \`// loading-exempt: <reason>\` to the top of the page if a fallback is genuinely unwanted.`,
  );
  process.exit(1);
}

await main();
