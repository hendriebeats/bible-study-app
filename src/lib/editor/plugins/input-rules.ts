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
 * Markdown-style `[text](url)` shortcut: collapse the bracket + paren syntax
 * into a link mark whose visible text is the bracketed label. Always-on.
 * Triggers when the closing paren is typed; we trim trailing whitespace from
 * the URL so a stray space inside the parens doesn't poison the href.
 */
const markdownLink = new InputRule(
  /\[([^\]]+)\]\(([^()\s]+)\)$/,
  (state, match, start, end) => {
    const text = match[1];
    const url = match[2];
    if (!text || !url) {
      return null;
    }
    const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    const tr = state.tr.insertText(text, start, end);
    return tr
      .addMark(start, start + text.length, marks.link.create({ href }))
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
  // Link rules are always on — `links` is no longer a per-user opt-in.
  rules.push(autoLink, markdownLink);

  // Lists (flat schema — every list shortcut turns the cursor's textblock
  // into a `list_row` with the appropriate listType attribute).
  rules.push(
    makeRule(/^\s*([-+*])\s$/, () => ({
      kind: "list_row",
      listType: "bullet",
    })),
  );
  rules.push(
    makeRule(/^(\d+)\.\s$/, (match) => {
      const startNum = Number.parseInt(match[1] ?? "1", 10);
      return {
        kind: "list_row",
        listType: "ordered",
        // listStart === null means "continue the previous run's implicit
        // numbering" — typing `1. ` is the common case and acts as a
        // continuation; typing `5. ` explicitly restarts the run at 5.
        attrs: { listStart: startNum === 1 ? null : startNum },
      };
    }),
  );
  rules.push(
    makeRule(/^\s*\[ ?\]\s$/, () => ({
      kind: "list_row",
      listType: "task",
      attrs: { checked: false },
    })),
  );
  rules.push(
    makeRule(/^\s*\[[xX]\]\s$/, () => ({
      kind: "list_row",
      listType: "task",
      attrs: { checked: true },
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
