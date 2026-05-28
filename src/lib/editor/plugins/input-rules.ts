import {
  ellipsis,
  emDash,
  InputRule,
  inputRules,
  smartQuotes,
} from "prosemirror-inputrules";
import type { Plugin } from "prosemirror-state";

import { buildConvertTransaction, type ConvertTarget } from "../convert-block";
import type { EditorTools } from "../editor-tools";
import { marks, nodes } from "../schema";

/**
 * When a URL (or `www.`-prefixed host) is finished with a space, wrap it in a
 * link mark. The trailing space is the trigger; we mark only the URL run and
 * clear the stored link mark so the space and following text aren't linked.
 * Gated on the `links` opt-in tool — when off, typed URLs stay as plain text.
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

/** Bind a markdown trigger regex to a {@link ConvertTarget}. The actual
 *  transformation lives in `convertCurrentBlock` so the slash menu, the
 *  block-handle "Turn into", and the toolbar all share one pipeline.  */
function makeRule(
  regex: RegExp,
  buildTarget: (match: RegExpMatchArray) => ConvertTarget,
): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    return buildConvertTransaction(state, buildTarget(match), {
      triggerRange: { from: start, to: end },
    });
  });
}

/**
 * Markdown-style shortcuts as you type. Lists (`-`, `1.`, `[ ]`, `[x]`),
 * blockquote (`>>`), and code (`\`\`\``) are always on. Heading (`#`),
 * link (auto-detected URLs), callout (`!!`), and collapsible (`>`) only fire
 * when the user has the matching `editor_tools` flag enabled — same gate the
 * slash menu and the block-handle "Turn into" menu use.
 *
 * Every rule converts in-place via {@link buildConvertTransaction}: when the
 * cursor is inside an existing list item, just that item is changed; when in
 * a collapsible header, the toggle dissolves; otherwise the textblock is
 * replaced.
 */
export function buildInputRules(tools: EditorTools): Plugin {
  const rules: InputRule[] = [...smartQuotes, ellipsis, emDash];
  if (tools.links) {
    rules.push(autoLink);
  }

  // Lists.
  rules.push(
    makeRule(/^\s*([-+*])\s$/, () => ({
      kind: "list",
      listType: nodes.bulletList,
      itemType: nodes.listItem,
    })),
  );
  rules.push(
    makeRule(/^(\d+)\.\s$/, () => ({
      kind: "list",
      listType: nodes.orderedList,
      itemType: nodes.listItem,
    })),
  );
  rules.push(
    makeRule(/^\s*\[ ?\]\s$/, () => ({
      kind: "list",
      listType: nodes.taskList,
      itemType: nodes.taskItem,
      itemAttrs: { checked: false },
    })),
  );
  rules.push(
    makeRule(/^\s*\[[xX]\]\s$/, () => ({
      kind: "list",
      listType: nodes.taskList,
      itemType: nodes.taskItem,
      itemAttrs: { checked: true },
    })),
  );

  // Headings / code block (textblock-type changes). Headings are gated on the
  // `headings` opt-in tool — the toolbar buttons + slash menu entries gate the
  // same way, so all three discovery surfaces stay in lockstep.
  if (tools.headings) {
    rules.push(
      makeRule(/^(#{1,6})\s$/, (match) => ({
        kind: "setblock",
        nodeType: nodes.heading,
        attrs: { level: (match[1] ?? "").length },
      })),
    );
  }
  rules.push(
    makeRule(/^```$/, () => ({
      kind: "setblock",
      nodeType: nodes.codeBlock,
    })),
  );

  // Single `>` opens a toggle (Notion-style); double `>>` makes a blockquote.
  // Both regexes are mutually exclusive at the textblock-prefix level (`> ` is
  // not a prefix of `>> ` once the trailing space is required) so order here
  // is purely for readability.
  if (tools.collapsibles) {
    rules.push(
      makeRule(/^\s*>\s$/, () => ({
        kind: "wrap",
        nodeType: nodes.collapsible,
        attrs: { summary: "", open: true },
      })),
    );
  }
  rules.push(
    makeRule(/^\s*>>\s$/, () => ({
      kind: "wrap",
      nodeType: nodes.blockquote,
    })),
  );
  if (tools.callouts) {
    rules.push(
      makeRule(/^\s*!!\s$/, () => ({
        kind: "wrap",
        nodeType: nodes.callout,
        attrs: { variant: "note" },
      })),
    );
  }

  return inputRules({ rules });
}
