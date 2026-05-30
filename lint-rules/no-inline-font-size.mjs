/**
 * `local/no-inline-font-size`
 *
 * Ban inline `style={{ fontSize: ... }}` (and `style={{ "font-size": ... }}`)
 * in TSX / JSX. The semantic type scale lives in `src/app/globals.css` under
 * the `@theme inline` block (`--text-caption`, `--text-ui`, ...) and is
 * surfaced as Tailwind utilities (`text-ui`, `text-caption`, ...). Inline
 * styles bypass that scale entirely — there's no way for an audit script or a
 * dark-mode override to know about a value baked into a render closure.
 *
 * Detection: any JSX `style` attribute whose value is an object expression
 * containing a `fontSize` (or `"font-size"`) property.
 *
 * Dynamic per-element sizing (e.g. a user font-size slider) should write to a
 * CSS custom property on the parent and have the rule's class consume it via
 * `font-size: var(--my-runtime-size)` — never inline.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban inline style={{ fontSize: ... }} — use a semantic text-* utility (or add a --text-* token in globals.css) instead.",
    },
    schema: [],
    messages: {
      noInlineFontSize:
        "Inline `style={{ fontSize: ... }}` bypasses the semantic type scale. Use a Tailwind text-* utility backed by a --text-* token in src/app/globals.css (e.g. `text-ui`, `text-caption`). For runtime-dynamic sizes, write to a CSS custom property and consume it via `font-size: var(--your-var)`.",
    },
  },
  create(context) {
    function propIsFontSize(prop) {
      if (prop.type !== "Property") return false;
      const k = prop.key;
      if (k.type === "Identifier" && k.name === "fontSize") return true;
      if (
        k.type === "Literal" &&
        (k.value === "fontSize" || k.value === "font-size")
      ) {
        return true;
      }
      return false;
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "style") return;
        const value = node.value;
        if (!value || value.type !== "JSXExpressionContainer") return;
        const expr = value.expression;
        if (expr.type !== "ObjectExpression") return;
        const offending = expr.properties.find(propIsFontSize);
        if (!offending) return;
        context.report({ node: offending, messageId: "noInlineFontSize" });
      },
    };
  },
};

export default rule;
