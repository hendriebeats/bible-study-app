/**
 * Per-user opt-in editor tools. Each user turns these on in Account → Editor
 * tools; the editor reads the enabled set and surfaces those tools in their
 * toolbar / slash menu. Stored as a jsonb map on `user_settings.editor_tools`.
 *
 * Framework-free (no "use client"/"use server") so the server normalizer, the
 * account UI, and the editor context can all import it.
 *
 * Two flavours of tool coexist here:
 *   1. **Formatting toggles** (`headings`, `strikethrough`) — gate core
 *      rich-text affordances so users can pare the editor down to what they
 *      actually use. When off: toolbar button hidden, keyboard shortcut
 *      unbound, markdown input-rule disabled, slash menu entry hidden. The
 *      schema still RENDERS the mark/node so pre-existing content and
 *      templated content stay intact.
 *   2. **Insertable blocks / advanced features** (`callouts`, `collapsibles`,
 *      `tables`, `images`, `mediaEmbeds`, `crossRefAutoDetect`, `customColor`)
 *      — same gating contract; the difference is purely categorical for the
 *      account UI's grouping in the future.
 *
 * `available` marks whether a tool is actually wired into the editor yet.
 * Tools land across later Phase 2 sub-phases; until a tool is available its
 * toggle in the account UI is shown as "Coming soon" (the preference still
 * persists, so it's honored the moment the feature ships).
 *
 * Note: `links` was an opt-in here historically. Links are now first-class
 * (always-on) so the toggle was retired. The `normalizeEditorTools` reader
 * silently ignores any leftover `links` key on stored settings rows.
 */

/** The opt-in tool keys. Add a key here + a registry entry below to introduce one. */
export interface EditorTools {
  headings: boolean;
  strikethrough: boolean;
  collapsibles: boolean;
  callouts: boolean;
  tables: boolean;
  images: boolean;
  mediaEmbeds: boolean;
  crossRefAutoDetect: boolean;
  customColor: boolean;
}

export type EditorToolKey = keyof EditorTools;

/** Everything off — what a user who never visits the settings gets. */
export const DEFAULT_EDITOR_TOOLS: EditorTools = {
  headings: false,
  strikethrough: false,
  collapsibles: false,
  callouts: false,
  tables: false,
  images: false,
  mediaEmbeds: false,
  crossRefAutoDetect: false,
  customColor: false,
};

/**
 * Coarse buckets the Account settings UI uses to sub-head the toggle list so
 * it's easier to scan. Purely a display concern — the editor itself doesn't
 * care which group a tool is in.
 */
export type EditorToolGroup = "formatting" | "blocks" | "media-smart";

export const EDITOR_TOOL_GROUP_LABELS: Record<EditorToolGroup, string> = {
  formatting: "Text formatting",
  blocks: "Insertable blocks",
  "media-smart": "Media & smart features",
};

/** Display order for the groups in the settings UI. */
export const EDITOR_TOOL_GROUP_ORDER: readonly EditorToolGroup[] = [
  "formatting",
  "blocks",
  "media-smart",
];

export interface EditorToolMeta {
  key: EditorToolKey;
  label: string;
  description: string;
  /** Which sub-headed section to render the tool under in settings. */
  group: EditorToolGroup;
  /**
   * Keyboard shortcut (e.g. "⌘⇧S"), rendered as a labelled <kbd> chip in the
   * settings row. Kept separate from the description so non-keyboard users
   * aren't confused by parenthetical glyph soup.
   */
  shortcut?: string;
  /**
   * Markdown-style shorthand that creates this tool when typed (e.g.
   * "~~text~~"), rendered as a labelled "Type [code]" chip. Labelled "Type"
   * rather than "Markdown" so the term doesn't trip up readers who've never
   * heard of Markdown — curious users can still infer it's a typing trick.
   */
  markdownSyntax?: string;
  /** Wired into the editor yet? Drives the "Coming soon" state in settings. */
  available: boolean;
}

/** UI metadata for each opt-in tool, in display order. */
export const EDITOR_TOOL_REGISTRY: readonly EditorToolMeta[] = [
  {
    key: "headings",
    group: "formatting",
    label: "Headings",
    description:
      "Heading styles 1, 2, and 3. Pre-existing headings still render even when this is off.",
    markdownSyntax: "# ## ###",
    available: true,
  },
  {
    key: "strikethrough",
    group: "formatting",
    label: "Strikethrough",
    description: "Cross out text.",
    shortcut: "⌘⇧S",
    markdownSyntax: "~~text~~",
    available: true,
  },
  {
    key: "collapsibles",
    group: "blocks",
    label: "Collapsible sections",
    description: "Foldable sections to tuck away longer notes.",
    available: true,
  },
  {
    key: "callouts",
    group: "blocks",
    label: "Callout boxes",
    description: "Note, Key insight, Warning, Prayer, and Application boxes.",
    available: true,
  },
  {
    key: "tables",
    group: "blocks",
    label: "Tables",
    description: "Insert and edit tables for side-by-side comparisons.",
    available: true,
  },
  {
    key: "images",
    group: "media-smart",
    label: "Images",
    description:
      "Add images by upload or URL. Drag to resize, double-click to crop.",
    available: true,
  },
  {
    key: "mediaEmbeds",
    group: "media-smart",
    label: "Video & audio embeds",
    description: "Embed YouTube/video and sermon audio players.",
    available: false,
  },
  {
    key: "crossRefAutoDetect",
    group: "media-smart",
    label: "Auto-detect cross-references",
    description:
      "Turn scripture references you type into links automatically. Single-click for a preview, double-click to open BibleHub.",
    available: true,
  },
  {
    key: "customColor",
    group: "formatting",
    label: "Custom colors",
    description:
      "Pick any highlight/text color beyond the preset palette — picked colors stay readable in light AND dark mode.",
    available: true,
  },
] as const;

/**
 * Coerce an untrusted value (DB jsonb, older/partial shape, or client payload)
 * into a complete tools object: only known keys, only booleans, missing keys
 * default to off. The defensive seam for both read and write.
 */
export function normalizeEditorTools(input: unknown): EditorTools {
  const result = { ...DEFAULT_EDITOR_TOOLS };
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_EDITOR_TOOLS) as EditorToolKey[]) {
      const value = obj[key];
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
  }
  return result;
}
