#!/usr/bin/env node
/**
 * Verifies that every raw `font-size:` declaration in `src/**\/*.css` is
 * either:
 *
 *   - inside the `@theme inline { ... }` block (where the `--text-*` tokens
 *     themselves are defined),
 *   - a `var(--text-*)` reference, or
 *   - an `em`-relative value (proportional sizing — e.g. verse superscripts,
 *     bullet markers that should track the surrounding prose).
 *
 * Anything else (raw `px` / `rem` / `pt` / vw, references to a non-`--text-*`
 * custom property) gets flagged.
 *
 * This is the CSS counterpart to the ESLint rules
 *   `local/no-inline-font-size`   (bans inline style={{ fontSize }})
 *   `local/no-default-text-size`  (bans Tailwind default text-xs / text-sm / ...)
 * The three together cover every surface a font-size can hide on.
 *
 * Exit codes:
 *   0 — every declaration is allowed (token, em-relative, or inside @theme)
 *   1 — at least one raw declaration is unaccounted for
 *
 * Wired into `npm run check:fonts` and the top-level `npm run check`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SRC_DIR = resolve(REPO_ROOT, "src");

const SKIP_DIRS = new Set(["node_modules", ".next", "out", "build"]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && extname(entry.name) === ".css") {
      yield join(dir, entry.name);
    }
  }
}

/**
 * Decide if a single `font-size: <value>;` declaration is allowed. The caller
 * tracks `@theme` block boundaries via brace depth and passes `inTheme`.
 */
function declarationIsAllowed(value, inTheme) {
  if (inTheme) return true;
  const v = value.trim().replace(/;.*$/, "").trim();
  // `font-size: var(--text-foo)` or `var(--text-foo, fallback)`.
  if (/^var\(\s*--text-[\w-]+\s*(,[^)]*)?\)\s*$/.test(v)) return true;
  // `font-size: 0.68em` / `1.5em` / `1.25em` — proportional, scales with parent.
  if (/^[\d.]+em\s*$/.test(v)) return true;
  return false;
}

async function checkFile(path) {
  const src = await readFile(path, "utf8");
  const lines = src.split("\n");

  const offenders = [];

  // Track `@theme` block depth so we can permit raw values inside it (where
  // the --text-* tokens themselves are defined, e.g. `--text-display: clamp(...)`
  // — though those use `--text-*:` syntax, not `font-size:`. Even so, anyone
  // adding `font-size: 1rem` inside @theme is fine; it never escapes the
  // block).
  let braceDepth = 0;
  let themeOpenDepth = -1; // -1 means "not currently inside an @theme block"
  let inTheme = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect `@theme` opener (with or without `inline` keyword).
    if (/@theme\b/.test(line)) {
      // The `{` may be on this line or the next; mark the depth at which it
      // opens. Since we count braces below, snapshot depth + 1 when we see the
      // opening `{`. Simplest: if the line contains both `@theme` and `{`, the
      // theme block opens at depth+1 of current.
      if (line.includes("{")) {
        themeOpenDepth = braceDepth + 1;
      } else {
        // Opener will be on a subsequent line — defer; we'll set it when we
        // see the first `{` after this point.
        themeOpenDepth = -2; // sentinel: "@theme seen, awaiting {"
      }
    }

    // Update brace depth from this line.
    for (const ch of line) {
      if (ch === "{") {
        braceDepth += 1;
        if (themeOpenDepth === -2) themeOpenDepth = braceDepth;
      } else if (ch === "}") {
        braceDepth -= 1;
        if (themeOpenDepth >= 0 && braceDepth < themeOpenDepth) {
          themeOpenDepth = -1;
        }
      }
    }
    inTheme = themeOpenDepth >= 0 && braceDepth >= themeOpenDepth;

    // Scan for font-size declarations on this line.
    const m = line.match(/font-size\s*:\s*([^;]+);?/);
    if (!m) continue;

    if (declarationIsAllowed(m[1], inTheme)) continue;

    offenders.push({
      line: i + 1,
      value: m[1].trim().replace(/;.*$/, "").trim(),
      raw: line.trim(),
    });
  }

  return offenders;
}

async function main() {
  try {
    await stat(SRC_DIR);
  } catch {
    console.error(`check-css-font-size: ${SRC_DIR} does not exist`);
    process.exit(2);
  }
  let total = 0;
  const byFile = [];
  for await (const path of walk(SRC_DIR)) {
    const offenders = await checkFile(path);
    if (offenders.length === 0) continue;
    total += offenders.length;
    byFile.push({ path, offenders });
  }
  if (total === 0) {
    console.log(
      `check-css-font-size: ✓ every raw font-size declaration references a --text-* token, is em-relative, or lives inside @theme`,
    );
    return;
  }
  console.error(
    `check-css-font-size: ${total} raw font-size declaration${total === 1 ? "" : "s"} not covered by the semantic scale:`,
  );
  for (const { path, offenders } of byFile) {
    const rel = relative(REPO_ROOT, path);
    for (const o of offenders) {
      console.error(`  ${rel}:${o.line}  font-size: ${o.value}`);
    }
  }
  console.error(
    `\nFix: replace with \`font-size: var(--text-<token>)\` from src/app/globals.css\n` +
      `      (or use an \`em\`-relative value if the size should track parent prose).\n` +
      `      If a new size is genuinely needed, add a \`--text-*\` token to the\n` +
      `      @theme inline block in globals.css.`,
  );
  process.exit(1);
}

await main();
