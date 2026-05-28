/**
 * `local/no-sequential-db-await`
 *
 * Flag adjacent `await` statements where both expressions resolve to a database
 * call — i.e. a call into Supabase (`supabase.from`, `supabase.rpc`,
 * `supabase.auth.*`, `supabase.storage`, `supabase.functions`) or a function
 * imported from `@/lib/db/*` or any `@/app/**\/actions(.ts)?` module.
 *
 * The pattern this enforces is: independent DB queries should run in parallel
 * via `Promise.all([...])`. Adjacent sequential awaits add a full round-trip
 * each for no benefit.
 *
 * False positives: when the second query *genuinely* depends on the first's
 * resolved value (e.g. the first returns IDs the second needs), parallelization
 * is impossible. Acknowledge the chain with a one-line comment immediately
 * before the second statement:
 *
 *     const sections = await listSections(studyId);
 *     // lint-allow-sequential-db: needs sections.length for lastPosition
 *     const specs = await getPreviousSectionBlockSpecs(studyId, sections.length);
 *
 * Heuristic: only adjacent statements (no intervening statements) are checked.
 * A non-await statement between two DB awaits is treated as a chain-break, so
 * patterns like `notFound()` guards and intermediate computations naturally
 * suppress the rule.
 */

const DB_IMPORT_SOURCE_PATTERNS = [
  /^@\/lib\/db(\/|$)/,
  /^@\/app\/.+\/actions(\.ts)?$/,
];

const SUPABASE_ROOT_NAMES = new Set(["supabase"]);

/** Walk a member-expression chain to its leftmost root. */
function rootOfMember(node) {
  let cur = node;
  while (cur.type === "MemberExpression") {
    cur = cur.object;
  }
  return cur;
}

/** True if the callee chain starts with `supabase.<something>`. */
function isSupabaseChain(callee) {
  if (callee.type !== "MemberExpression") return false;
  const root = rootOfMember(callee);
  if (root.type === "Identifier") {
    return SUPABASE_ROOT_NAMES.has(root.name);
  }
  // Chains like `(await createClient()).from(...)` aren't statically detectable
  // as supabase; we ignore them. The common case is `const supabase = await
  // createClient()` followed by `supabase.from(...)`, which we catch via the
  // Identifier root.
  return false;
}

/** Recurse through chained call expressions to find any underlying DB root. */
function calleeIsDbCall(callee, dbIdentifiers) {
  if (callee.type === "Identifier") {
    return dbIdentifiers.has(callee.name);
  }
  if (callee.type === "MemberExpression") {
    if (isSupabaseChain(callee)) return true;
    // Unwrap chained calls: foo().bar() — the .bar call wraps foo()'s callee.
    if (callee.object.type === "CallExpression") {
      return calleeIsDbCall(callee.object.callee, dbIdentifiers);
    }
  }
  if (callee.type === "CallExpression") {
    return calleeIsDbCall(callee.callee, dbIdentifiers);
  }
  return false;
}

/** Pull a top-level AwaitExpression out of a statement, if any. */
function topLevelAwait(stmt) {
  if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) {
      if (decl.init && decl.init.type === "AwaitExpression") {
        return decl.init;
      }
    }
  }
  if (stmt.type === "ExpressionStatement") {
    if (stmt.expression.type === "AwaitExpression") {
      return stmt.expression;
    }
    // Common assignment pattern: `x = await foo()`.
    if (
      stmt.expression.type === "AssignmentExpression" &&
      stmt.expression.right.type === "AwaitExpression"
    ) {
      return stmt.expression.right;
    }
  }
  if (
    stmt.type === "ReturnStatement" &&
    stmt.argument?.type === "AwaitExpression"
  ) {
    return stmt.argument;
  }
  return null;
}

function awaitArgIsDbCall(awaitExpr, dbIdentifiers) {
  const arg = awaitExpr.argument;
  if (!arg || arg.type !== "CallExpression") return false;
  return calleeIsDbCall(arg.callee, dbIdentifiers);
}

const OPT_OUT = /lint-allow-sequential-db\s*:/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Adjacent `await`s of database calls should run in parallel via Promise.all().",
    },
    schema: [],
    messages: {
      sequential:
        "Adjacent `await` of a database call follows another. Combine them into a single `await Promise.all([...])` so they run in parallel. If this query genuinely depends on the previous one's result, add `// lint-allow-sequential-db: <reason>` on the line above.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** Identifiers known to be DB calls from imports. */
    const dbIdentifiers = new Set();

    function hasOptOutComment(node) {
      const before = sourceCode.getCommentsBefore(node);
      return before.some((c) => OPT_OUT.test(c.value));
    }

    function checkBlock(body) {
      let prevDbAwait = null;
      for (const stmt of body) {
        const awaitExpr = topLevelAwait(stmt);
        if (!awaitExpr) {
          // Any non-await statement breaks the adjacency chain.
          prevDbAwait = null;
          continue;
        }
        const isDb = awaitArgIsDbCall(awaitExpr, dbIdentifiers);
        if (!isDb) {
          prevDbAwait = null;
          continue;
        }
        if (prevDbAwait !== null && !hasOptOutComment(stmt)) {
          context.report({ node: awaitExpr, messageId: "sequential" });
        }
        prevDbAwait = awaitExpr;
      }
    }

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        if (!DB_IMPORT_SOURCE_PATTERNS.some((p) => p.test(src))) return;
        for (const spec of node.specifiers) {
          // Ignore `import type { ... }` — purely type-level, can't be awaited.
          if (node.importKind === "type") continue;
          if (
            spec.type === "ImportSpecifier" ||
            spec.type === "ImportDefaultSpecifier"
          ) {
            // Per-specifier `type` keyword (e.g. `import { type Foo }`) is also
            // type-only at runtime.
            if (spec.importKind === "type") continue;
            dbIdentifiers.add(spec.local.name);
          }
        }
      },
      BlockStatement(node) {
        checkBlock(node.body);
      },
      Program(node) {
        checkBlock(node.body);
      },
    };
  },
};

export default rule;
