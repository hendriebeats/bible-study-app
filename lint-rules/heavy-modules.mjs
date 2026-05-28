/**
 * Modules that must NOT be statically imported except via `next/dynamic`.
 *
 * These ship large amounts of JS (ProseMirror plugins, dockview, the editor
 * itself) and only need to load once a user has reached the study route — so
 * eager imports anywhere else inflate the route's initial chunk for no benefit.
 *
 * Lint rule: `local/no-eager-heavy-import` flags any static `ImportDeclaration`
 * whose source matches one of these paths. Loading them via:
 *
 *   const X = dynamic(() => import("@/..."), { ssr: false });
 *
 * is a dynamic `import()` expression and is allowed.
 *
 * `import type { ... } from "@/..."` is also allowed — type imports are erased.
 *
 * To exempt a specific file, add it to EAGER_EXEMPT_FILES. Use sparingly; the
 * point of this list is that there's a single canonical place each heavy module
 * is allowed to be loaded.
 */
export const HEAVY_MODULES = [
  "@/components/studies/document-editor",
  "@/components/studies/section-history-panel",
];

/**
 * Files allowed to eagerly import HEAVY_MODULES. These are typically the
 * `next/dynamic` boundary itself, where the static import is exactly what the
 * dynamic import resolves to (and the file is, in turn, only loaded lazily).
 *
 * Paths are matched as suffixes against the relative path from repo root.
 *
 * Currently empty — every heavy module on the registry is imported via
 * `next/dynamic`'s dynamic `import()` (not a static `ImportDeclaration`), so
 * no file needs to be exempted from the rule.
 */
export const EAGER_EXEMPT_FILES = [];
