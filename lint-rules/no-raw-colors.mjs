/**
 * `local/no-raw-colors`
 *
 * Bans raw CSS colour literals (`#abc123`, `rgb(...)`, `hsl(...)`, `oklch(...)`,
 * `lab(...)`, `lch(...)`) anywhere outside the small set of "colour authority"
 * files allow-listed below. Every other surface MUST consume colour through
 * the theme system:
 *
 *   - Tailwind utility classes built from semantic / component tokens
 *     (e.g. `bg-surface`, `text-foreground`, `border-border`).
 *   - The `styleColor` / `styleBackgroundColor` helpers in
 *     `src/lib/theme/style-color.ts`, which require a branded `OklchColor`.
 *   - The OKLCH-returning constructors in `src/lib/editor/oklch.ts`
 *     (`parseOklch`, `oklchString`, `hexToOklch`, `hsvToOklch`) for any
 *     value computed at runtime.
 *
 * Why no per-line escape hatch: the allow-list is small (4 files) and stable.
 * Every legitimate exemption marks a "this file owns colour values by
 * construction" surface — preset palette definitions, brand-locked SVG, the
 * picker's canvas math, the token authority. New raw literals anywhere else
 * are a regression of the colour-system architecture (see plan
 * `.claude/plans/i-want-to-moonlit-sutherland.md`). If a genuinely new
 * authority emerges, add it to `EXEMPT_PATHS` below — a deliberate edit
 * forces the conversation upstream instead of accumulating
 * `// lint-disable-next-line` comments.
 *
 * Pairs with the branded `OklchColor` type at the type-checker layer: this
 * rule catches literals, the brand catches plain strings sneaking into
 * inline `style` props.
 */

// File paths (suffix-matched, since ESLint may give absolute or relative).
// Keep the list minimal — each entry is a documented exception to the
// "colours come from the theme system" rule.
const EXEMPT_PATHS = [
  // The preset highlight + text palettes baked into document marks. These
  // ARE the security allow-list of what can land in a mark's inline style.
  "src/lib/editor/format-colors.ts",
  // OKLCH math + parsing. Constructors (`oklchString`, `parseOklch`, …)
  // emit and accept `oklch(...)` strings by construction.
  "src/lib/editor/oklch.ts",
  // Cursor palette source — eight stable hue identities, stored once here
  // so the rest of the realtime / theme system can resolve them.
  "src/lib/theme/cursor-palette.ts",
  // Google brand-locked SVG fills. Required for Google's brand guidelines.
  "src/components/icons.tsx",
  // Canvas-rendered HSV → sRGB output + handle preview. The picker computes
  // colour values; that's its whole job.
  "src/components/studies/custom-color-picker.tsx",
  // The token authority — every theme variable's source of truth.
  "src/app/globals.css",
  // Hardcoded fallback for the note-entry-flash colour values. JS-side
  // inline-style writes can't depend on a CSS variable that might be
  // missing from a stale HMR-cached stylesheet; this file owns those
  // values by construction. See note-flash-colors.ts header.
  "src/lib/editor/note-flash-colors.ts",
];

const COLOR_LITERAL =
  /(?:^|[^a-zA-Z0-9_-])(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\s*\()/;

/**
 * Returns the index of the first colour literal inside `value`, or -1.
 * Walks rather than matching globally so error messages can carry the
 * actual literal text the user wrote.
 */
function findColorLiteral(value) {
  if (typeof value !== "string" || value === "") return null;
  const match = COLOR_LITERAL.exec(value);
  if (!match) return null;
  return match[1] ?? null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Bans raw CSS colour literals outside the small set of allow-listed colour-authority files. Reach for theme tokens (Tailwind utilities driven by globals.css) or the branded OklchColor helpers instead.",
    },
    schema: [],
    messages: {
      rawLiteral:
        "Raw colour literal `{{literal}}` is banned. Use a theme token (Tailwind `bg-…`/`text-…`/`border-…` driven by globals.css) or build the value through `parseOklch` / `hexToOklch` / `hsvToOklch` in src/lib/editor/oklch.ts and apply via the helpers in src/lib/theme/style-color.ts. If this file is a new colour authority, add it to EXEMPT_PATHS in lint-rules/no-raw-colors.mjs.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (EXEMPT_PATHS.some((path) => filename.endsWith(path))) {
      return {};
    }

    /**
     * Report a literal if `value` contains one. Reports at `node` (so the
     * editor highlights the right span).
     */
    const check = (node, value) => {
      const literal = findColorLiteral(value);
      if (literal === null) return;
      context.report({ node, messageId: "rawLiteral", data: { literal } });
    };

    return {
      // Bare string + template literals — covers `const x = "#fff"` /
      // `` `oklch(...)` `` everywhere in TS/TSX.
      Literal(node) {
        if (typeof node.value !== "string") return;
        check(node, node.value);
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          check(quasi, quasi.value.cooked ?? quasi.value.raw ?? "");
        }
      },
    };
  },
};

export default rule;
