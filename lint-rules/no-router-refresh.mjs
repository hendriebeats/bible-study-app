/**
 * `local/no-router-refresh`
 *
 * Ban `router.refresh()` calls. The pattern causes a visible blank-then-fill
 * flash on the current page because Next must re-fetch the entire RSC payload
 * before any update is visible.
 *
 * Preferred replacements:
 *   - For mutations that update a list/row: have the server action return the
 *     updated data and apply it locally with `useOptimistic` or `setState`.
 *     Keep `revalidatePath(...)` inside the action so the next navigation has
 *     fresh data; just don't force a refresh on the current view.
 *   - For navigation after a mutation: `router.push(...)` / `router.replace(...)`.
 *
 * If you have an unavoidable case (auth state change after login is the usual
 * one), add `// lint-allow-router-refresh: <reason>` on the line above.
 *
 * Detection: any `.refresh()` member-call where the receiver is an identifier
 * containing "router" (case-insensitive) — `router`, `appRouter`, `useRouter()`
 * return value bound to anything Router-ish.
 */

const OPT_OUT = /lint-allow-router-refresh\s*:/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban router.refresh() — it causes a full-page blank-then-fill flash. Use useOptimistic / returned data instead.",
    },
    schema: [],
    messages: {
      noRefresh:
        "`router.refresh()` causes a visible blank-then-fill flash because Next must re-fetch the entire RSC payload before any update is visible. Return updated data from the server action and apply it with `useOptimistic` (or local `setState`); keep `revalidatePath(...)` inside the action for the next navigation. If unavoidable, add `// lint-allow-router-refresh: <reason>` on the line above.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function hasOptOutComment(node) {
      // Walk up to the enclosing statement.
      let cur = node;
      while (cur && cur.parent) {
        if (
          cur.parent.type === "ExpressionStatement" ||
          cur.parent.type === "VariableDeclaration" ||
          cur.parent.type === "ReturnStatement"
        ) {
          const before = sourceCode.getCommentsBefore(cur.parent);
          return before.some((c) => OPT_OUT.test(c.value));
        }
        cur = cur.parent;
      }
      return false;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier") return;
        if (callee.property.name !== "refresh") return;
        // The receiver must look router-ish. Identifier name match is the
        // pragmatic heuristic; chained receivers (e.g. `useRouter().refresh()`)
        // are covered too.
        const obj = callee.object;
        let looksRouter = false;
        if (obj.type === "Identifier" && /router/i.test(obj.name)) {
          looksRouter = true;
        } else if (
          obj.type === "CallExpression" &&
          obj.callee.type === "Identifier" &&
          obj.callee.name === "useRouter"
        ) {
          looksRouter = true;
        }
        if (!looksRouter) return;
        if (hasOptOutComment(node)) return;
        context.report({ node, messageId: "noRefresh" });
      },
    };
  },
};

export default rule;
