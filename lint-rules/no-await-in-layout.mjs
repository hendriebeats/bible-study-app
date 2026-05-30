/**
 * `local/no-await-in-layout`
 *
 * In Next 16, uncached data accessed in a `layout.tsx` blocks the sibling
 * `loading.tsx` from rendering and prevents `<Suspense>` boundaries inside the
 * page from streaming until the layout finishes. Pages should fetch their own
 * data; layouts should only resolve what's needed for the shell.
 *
 * This rule flags any `await` of a DB call (Supabase or `@/lib/db/*` or
 * `@/app/**\/actions(.ts)?`) at the top level of an `app/**\/layout.tsx` file.
 *
 * Allowed without complaint:
 *   - `await params` / `await searchParams` (Next.js convention, the route's
 *     own params Promise — not a data fetch).
 *   - `await createClient()` (Supabase client construction, not a query).
 *
 * Anything that genuinely needs to await data in a layout should move into a
 * separate inner file rendered under a `<Suspense fallback={…}>` boundary
 * (e.g. `study-layout-inner.tsx`, `admin-gate.tsx`).
 *
 * The rule applies to files matching `**\/app\/**\/layout.{ts,tsx,js,jsx}`.
 */

const DB_IMPORT_SOURCE_PATTERNS = [
  /^@\/lib\/db(\/|$)/,
  /^@\/app\/.+\/actions(\.ts)?$/,
];

const SUPABASE_ROOT_NAMES = new Set(["supabase"]);
const PARAM_ALLOWLIST = new Set(["params", "searchParams"]);
const CALL_ALLOWLIST = new Set(["createClient"]);

const LAYOUT_FILE = /\/app\/.*\/layout\.(tsx|ts|jsx|js)$/;

function rootOfMember(node) {
  let cur = node;
  while (cur.type === "MemberExpression") cur = cur.object;
  return cur;
}

function isSupabaseChain(callee) {
  if (callee.type !== "MemberExpression") return false;
  const root = rootOfMember(callee);
  return root.type === "Identifier" && SUPABASE_ROOT_NAMES.has(root.name);
}

function calleeIsDbCall(callee, dbIdentifiers) {
  if (callee.type === "Identifier") {
    if (CALL_ALLOWLIST.has(callee.name)) return false;
    return dbIdentifiers.has(callee.name);
  }
  if (callee.type === "MemberExpression") {
    if (isSupabaseChain(callee)) return true;
    if (callee.object.type === "CallExpression") {
      return calleeIsDbCall(callee.object.callee, dbIdentifiers);
    }
  }
  if (callee.type === "CallExpression") {
    return calleeIsDbCall(callee.callee, dbIdentifiers);
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Layout files should not await uncached data — it blocks loading.tsx and page-level <Suspense> streaming.",
    },
    schema: [],
    messages: {
      blockingAwait:
        "`await` of a database call in a layout.tsx blocks `loading.tsx` and page-level `<Suspense>` from streaming. With `cacheComponents: true` it also produces a build error. Move the async work into a separate file (e.g. `study-layout-inner.tsx` / `admin-gate.tsx`) and render it under a `<Suspense fallback={…}>` boundary inside the layout.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (!LAYOUT_FILE.test(filename)) return {};

    const dbIdentifiers = new Set();

    function isAllowedAwait(awaitExpr) {
      const arg = awaitExpr.argument;
      if (!arg) return true;
      // `await params` / `await searchParams` — Next 16 convention.
      if (arg.type === "Identifier" && PARAM_ALLOWLIST.has(arg.name))
        return true;
      // `await someObject.params` — not an idiom but cover identifier-checks just in case.
      if (
        arg.type === "MemberExpression" &&
        arg.property.type === "Identifier" &&
        PARAM_ALLOWLIST.has(arg.property.name)
      ) {
        return true;
      }
      if (arg.type !== "CallExpression") return true;
      // `await createClient()` and friends.
      if (
        arg.callee.type === "Identifier" &&
        CALL_ALLOWLIST.has(arg.callee.name)
      ) {
        return true;
      }
      return !calleeIsDbCall(arg.callee, dbIdentifiers);
    }

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        if (!DB_IMPORT_SOURCE_PATTERNS.some((p) => p.test(src))) return;
        if (node.importKind === "type") return;
        for (const spec of node.specifiers) {
          if (
            (spec.type === "ImportSpecifier" ||
              spec.type === "ImportDefaultSpecifier") &&
            spec.importKind !== "type"
          ) {
            dbIdentifiers.add(spec.local.name);
          }
        }
      },
      AwaitExpression(node) {
        if (isAllowedAwait(node)) return;
        context.report({ node, messageId: "blockingAwait" });
      },
    };
  },
};

export default rule;
