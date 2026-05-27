import {
  ellipsis,
  emDash,
  InputRule,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import type { Plugin } from "prosemirror-state";

import { marks, nodes } from "../schema";

/**
 * When a URL (or `www.`-prefixed host) is finished with a space, wrap it in a
 * link mark. The trailing space is the trigger; we mark only the URL run and
 * clear the stored link mark so the space and following text aren't linked.
 */
const autoLink = new InputRule(
  /(?:^|\s)((?:https?:\/\/|www\.)[^\s]+)\s$/,
  (state, match, _start, end) => {
    const url = match[1];
    if (!url) {
      return null;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const urlEnd = end - 1; // before the trigger space
    const urlStart = urlEnd - url.length;
    return state.tr
      .addMark(urlStart, urlEnd, marks.link.create({ href }))
      .removeStoredMark(marks.link);
  },
);

/**
 * Markdown-style shortcuts as you type, matching the old StarterKit behavior:
 * `# ` → headings, `- ` / `1. ` → lists, `> ` → blockquote, ``` ``` ``` → code
 * block, plus smart quotes / ellipsis / em-dash, and URL auto-linking.
 */
export function buildInputRules(): Plugin {
  return inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      emDash,
      autoLink,
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      wrappingInputRule(/^(\d+)\.\s$/, nodes.orderedList),
      // `[] ` or `[ ] ` → checklist.
      wrappingInputRule(/^\s*\[ ?\]\s$/, nodes.taskList),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bulletList),
      textblockTypeInputRule(/^```$/, nodes.codeBlock),
      textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({
        level: (match[1] ?? "").length,
      })),
    ],
  });
}
