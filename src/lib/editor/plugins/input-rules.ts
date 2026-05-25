import {
  ellipsis,
  emDash,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { Plugin } from "prosemirror-state";

import { nodes } from "../schema";

/**
 * Markdown-style shortcuts as you type, matching the old StarterKit behavior:
 * `# ` → headings, `- ` / `1. ` → lists, `> ` → blockquote, ``` ``` ``` → code
 * block, plus smart quotes / ellipsis / em-dash.
 */
export function buildInputRules(): Plugin {
  return inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      emDash,
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^(\d+)\.\s$/, nodes.orderedList),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bulletList),
      textblockTypeInputRule(/^```$/, nodes.codeBlock),
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({
        level: (match[1] ?? "").length,
      })),
    ],
  });
}
