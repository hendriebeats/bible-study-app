import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import { nodes } from "../schema";

/** Does this doc contain the (pinned) notes index at the top level? */
function hasNotesIndex(doc: Node): boolean {
  let found = false;
  doc.forEach((child) => {
    if (child.type === nodes.notesIndex) {
      found = true;
    }
  });
  return found;
}

/**
 * Keeps the notes index non-removable: vetoes any user transaction that would
 * delete an existing `notes_index` (e.g. select-all + delete, or the block
 * menu's Delete). Programmatic transactions flagged `allowVerseEdit` — version
 * restore, block re-inserts — are allowed through (matching the verse guard's
 * escape hatch), so restoring an older version that predates the index still
 * works. A no-op in the Study-Body editor, whose doc never holds an index.
 */
export function notesIndexGuard(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta("allowVerseEdit") === true) {
        return true;
      }
      if (!hasNotesIndex(state.doc)) {
        return true;
      }
      return hasNotesIndex(tr.doc);
    },
  });
}
