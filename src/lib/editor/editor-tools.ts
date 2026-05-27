/**
 * Per-user opt-in editor tools. Each user turns these on in Account → Editor
 * tools; the editor reads the enabled set and surfaces those tools in their
 * toolbar / slash menu. Stored as a jsonb map on `user_settings.editor_tools`.
 *
 * Framework-free (no "use client"/"use server") so the server normalizer, the
 * account UI, and the editor context can all import it.
 *
 * `available` marks whether a tool is actually wired into the editor yet. Tools
 * land across later Phase 2 sub-phases; until a tool is available its toggle in
 * the account UI is shown as "Coming soon" (the preference still persists, so
 * it's honored the moment the feature ships).
 */

/** The opt-in tool keys. Add a key here + a registry entry below to introduce one. */
export interface EditorTools {
  callouts: boolean;
  collapsibles: boolean;
  tables: boolean;
  images: boolean;
  mediaEmbeds: boolean;
  crossRefAutoDetect: boolean;
  customColor: boolean;
}

export type EditorToolKey = keyof EditorTools;

/** Everything off — what a user who never visits the settings gets. */
export const DEFAULT_EDITOR_TOOLS: EditorTools = {
  callouts: false,
  collapsibles: false,
  tables: false,
  images: false,
  mediaEmbeds: false,
  crossRefAutoDetect: false,
  customColor: false,
};

export interface EditorToolMeta {
  key: EditorToolKey;
  label: string;
  description: string;
  /** Wired into the editor yet? Drives the "Coming soon" state in settings. */
  available: boolean;
}

/** UI metadata for each opt-in tool, in display order. */
export const EDITOR_TOOL_REGISTRY: readonly EditorToolMeta[] = [
  {
    key: "callouts",
    label: "Callout boxes",
    description: "Note, Key insight, Warning, Prayer, and Application boxes.",
    available: true,
  },
  {
    key: "collapsibles",
    label: "Collapsible sections",
    description: "Foldable sections to tuck away longer notes.",
    available: true,
  },
  {
    key: "tables",
    label: "Tables",
    description: "Insert and edit tables for side-by-side comparisons.",
    available: false,
  },
  {
    key: "images",
    label: "Images",
    description: "Add images by upload or URL, with an optional caption.",
    available: false,
  },
  {
    key: "mediaEmbeds",
    label: "Video & audio embeds",
    description: "Embed YouTube/video and sermon audio players.",
    available: false,
  },
  {
    key: "crossRefAutoDetect",
    label: "Auto-detect cross-references",
    description: "Turn scripture references you type into links automatically.",
    available: false,
  },
  {
    key: "customColor",
    label: "Custom colors",
    description: "Pick any highlight/text color beyond the preset palette.",
    available: false,
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
