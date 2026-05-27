import type { NodeViewConstructor } from "prosemirror-view";

import { CalloutView } from "./plugins/callout-view";
import { CollapsibleView } from "./plugins/collapsible-view";
import { NoteEntryView, NotesIndexView } from "./plugins/notes-index-view";
import { ScriptureView } from "./plugins/scripture-view";
import { StudyBlockView } from "./plugins/study-block-view";
import { TaskItemView } from "./plugins/task-item-view";
import { VerseNumberView } from "./plugins/verse-number-view";

/**
 * Custom NodeViews for the study editor. `editable` is false for the read-only
 * viewer (no remove buttons / read-only titles, no caret-placing click).
 * Registered on the editor, the viewer, and the history preview so
 * `verse_number`, `scripture` (legacy), and `study_block` render consistently
 * everywhere.
 */
export function buildNodeViews(
  editable: boolean,
): Record<string, NodeViewConstructor> {
  return {
    // An inline, non-editable superscript whose label is computed contextually
    // by the verse-label plugin; click places the caret to its right and
    // double-click opens BibleHub. See {@link VerseNumberView}.
    verse_number: (node, view, getPos, decorations) =>
      new VerseNumberView(node, view, getPos, decorations, editable),
    scripture: (node, view, getPos) =>
      new ScriptureView(node, view, getPos, editable),
    study_block: (node, view, getPos) =>
      new StudyBlockView(node, view, getPos, editable),
    task_item: (node, view, getPos) =>
      new TaskItemView(node, view, getPos, editable),
    callout: (node) => new CalloutView(node),
    collapsible: (node, view, getPos) =>
      new CollapsibleView(node, view, getPos, editable),
    notes_index: () => new NotesIndexView(),
    note_entry: (node, view, getPos) =>
      new NoteEntryView(node, view, getPos, editable),
  };
}
