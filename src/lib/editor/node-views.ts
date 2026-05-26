import type { NodeViewConstructor } from "prosemirror-view";

import { ScriptureView } from "./plugins/scripture-view";
import { StudyBlockView } from "./plugins/study-block-view";

/**
 * Custom NodeViews for the study editor. `editable` is false for the read-only
 * viewer (no remove buttons / read-only titles). Registered on the editor, the
 * viewer, and the history preview so `verse_number`, `scripture` (legacy), and
 * `study_block` render consistently everywhere.
 */
export function buildNodeViews(
  editable: boolean,
): Record<string, NodeViewConstructor> {
  return {
    // An inline, non-editable superscript. Fully managed (no contentDOM) so the
    // browser never lets a caret land inside the marker.
    verse_number: (node) => {
      const dom = document.createElement("sup");
      dom.className = "scripture-verse";
      const attr = (node.attrs as { n: string }).n;
      const n = typeof attr === "string" ? attr : "";
      dom.setAttribute("data-verse", n);
      dom.textContent = n;
      dom.contentEditable = "false";
      return { dom, ignoreMutation: () => true };
    },
    scripture: (node, view, getPos) =>
      new ScriptureView(node, view, getPos, editable),
    study_block: (node, view, getPos) =>
      new StudyBlockView(node, view, getPos, editable),
  };
}
