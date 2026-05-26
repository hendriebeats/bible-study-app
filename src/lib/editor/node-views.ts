import type { NodeViewConstructor } from "prosemirror-view";

import { ScriptureView } from "./plugins/scripture-view";
import { StudyBlockView } from "./plugins/study-block-view";

/**
 * Custom NodeViews for the study editor. `editable` is false for the read-only
 * viewer (no remove buttons / read-only labels). Registered on the editor, the
 * viewer, and the history preview so `scripture` + `study_block` render
 * consistently everywhere.
 */
export function buildNodeViews(
  editable: boolean,
): Record<string, NodeViewConstructor> {
  return {
    scripture: (node, view, getPos) =>
      new ScriptureView(node, view, getPos, editable),
    study_block: (node, view, getPos) =>
      new StudyBlockView(node, view, getPos, editable),
  };
}
