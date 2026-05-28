import { lift } from "prosemirror-commands";
import { liftListItem } from "prosemirror-schema-list";
import { type Command } from "prosemirror-state";

import { nodes } from "../schema";

/**
 * Progressive Backspace for empty textblocks: each keystroke peels off one
 * structural layer around the caret, so a deeply-nested empty block dissolves
 * one container at a time and stops cleanly at the document's natural
 * "containment boundaries" (the doc itself, a `note_entry`, a `study_block`,
 * the pinned `notes_index`).
 *
 * Concretely, when the caret sits at the start of an empty textblock:
 *
 *   1. Walk up from the cursor's depth looking for the FIRST ancestor that
 *      is dissolvable (`list_item` / `task_item` / `blockquote` / `callout` /
 *      `collapsible`). Stop the walk early at a containment-boundary node so
 *      we never lift content out of a study block or note entry.
 *   2. If the caret's chain enters that ancestor at index 0 (i.e. the empty
 *      textblock is the FIRST child along the path), peel one layer:
 *        - `list_item`/`task_item` → `liftListItem(itemType)` — which lifts
 *          the item out of its surrounding list and auto-removes the list if
 *          it ends up empty.
 *        - `blockquote`/`callout`/`collapsible` → plain `lift` — which lifts
 *          the cursor's block out of the wrapper, splitting the wrapper when
 *          it had more children after the cursor.
 *
 *   3. If no dissolvable layer is found AND the caret's previous sibling at
 *      the parent level is a structural container (a list, table, callout,
 *      collapsible, blockquote), refuse the Backspace. This is the "don't
 *      teleport the caret into the prior list" guard — left over from the
 *      earlier Backspace work, kept because the alternative ("merge with
 *      end of last task") was confusing in the task→quote→Backspace repro.
 *
 * `chainCommands` runs this BEFORE `collapsibleBackspace` (which handles
 * non-empty collapsibles by dissolving them in one keystroke) and before the
 * baseKeymap's `joinBackward` / `selectNodeBackward` fallbacks.
 */
export const smartBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;
  if (!$from.parent.isTextblock) return false;
  if ($from.parent.content.size !== 0) return false;

  // Walk up the ancestor chain looking for the first dissolvable wrapper. The
  // condition `$from.index(d) === 0` along the way means we're still on the
  // "start of the first child" path — the moment we hit a non-zero index, the
  // caret is past where lifting one layer would be intuitive, so we bail.
  for (let d = $from.depth - 1; d >= 0; d--) {
    const ancestor = $from.node(d);

    // Containment boundaries — never lift past one of these. The user wants
    // their content to stay inside the study block / note entry that owns it.
    if (
      ancestor.type === nodes.doc ||
      ancestor.type === nodes.studyBlock ||
      ancestor.type === nodes.noteEntry ||
      ancestor.type === nodes.notesIndex
    ) {
      break;
    }

    // Must still be on the "first child" path for a single Backspace to peel
    // this layer cleanly. If we entered this ancestor at index > 0, the
    // intent is ambiguous (the user might want to merge with the previous
    // sibling at this level instead); let the default chain handle it.
    if ($from.index(d) !== 0) break;

    if (ancestor.type === nodes.listItem || ancestor.type === nodes.taskItem) {
      return liftListItem(ancestor.type)(state, dispatch);
    }
    if (
      ancestor.type === nodes.blockquote ||
      ancestor.type === nodes.callout ||
      ancestor.type === nodes.collapsible
    ) {
      return lift(state, dispatch);
    }
    // Pure list containers (bullet_list/ordered_list/task_list) aren't
    // dissolvable on their own — they're peeled by liftListItem on the inner
    // item. Same for the table wrappers. Keep walking up.
  }

  // No dissolvable wrapper. Fall through to the default chain — the prior
  // experimental "refuse cross-structure join" guard turned out to be more
  // annoying than helpful: it blocked Backspace on an empty line below a
  // checklist, which the user reasonably expects to dismiss the empty line
  // and put them back in the last task. Now that progressive dissolve (case
  // 1 above) cleanly handles the original task→quote→Backspace repro in a
  // single keystroke, that refusal no longer earns its keep.
  return false;
};
