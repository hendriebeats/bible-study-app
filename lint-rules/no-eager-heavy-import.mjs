/**
 * `local/no-eager-heavy-import`
 *
 * Some modules ship enough JS that loading them eagerly bloats every page
 * that imports anything from their tree. They should only be imported via
 * `next/dynamic`. See `lint-rules/heavy-modules.mjs` for the registry.
 *
 * This rule flags static `ImportDeclaration`s whose source matches a registry
 * entry, unless:
 *
 *   - The import is `import type { ... }` (the entire declaration is type-only),
 *     or every specifier carries the per-specifier `type` keyword.
 *   - The file is on the EAGER_EXEMPT_FILES list (usually the single canonical
 *     `next/dynamic` boundary for that module).
 *
 * `next/dynamic` uses a dynamic `import()` expression, not a static
 * `ImportDeclaration`, so it's allowed without further configuration.
 */

import { HEAVY_MODULES, EAGER_EXEMPT_FILES } from "./heavy-modules.mjs";

function importIsTypeOnly(node) {
  if (node.importKind === "type") return true;
  // All-specifier `type` keyword is also pure-type. Side-effect imports
  // (`import "x"`) have no specifiers and are runtime.
  if (node.specifiers.length === 0) return false;
  return node.specifiers.every(
    (spec) =>
      (spec.type === "ImportSpecifier" ||
        spec.type === "ImportDefaultSpecifier") &&
      spec.importKind === "type",
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Heavy modules registered in lint-rules/heavy-modules.mjs must be imported via next/dynamic, not statically.",
    },
    schema: [],
    messages: {
      heavyImport:
        '`{{source}}` is on the heavy-modules registry and must be loaded via `next/dynamic`, not a static import. Replace with:\n  const X = dynamic(() => import("{{source}}").then(m => m.X), { ssr: false, loading: () => <Skeleton ... /> });\nIf this file is the single canonical boundary, add it to EAGER_EXEMPT_FILES in lint-rules/heavy-modules.mjs.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    // Match relative path suffix (eslint may give absolute or relative).
    if (EAGER_EXEMPT_FILES.some((path) => filename.endsWith(path))) {
      return {};
    }
    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        if (!HEAVY_MODULES.includes(src)) return;
        if (importIsTypeOnly(node)) return;
        context.report({
          node,
          messageId: "heavyImport",
          data: { source: src },
        });
      },
    };
  },
};

export default rule;
