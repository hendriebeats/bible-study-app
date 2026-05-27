import {
  baseKeymap,
  chainCommands,
  exitCode,
  toggleMark,
} from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from "prosemirror-schema-list";
import type { Command, Plugin } from "prosemirror-state";

import { indentBlocks, outdentBlocks } from "../commands";
import { marks, nodes } from "../schema";
import {
  deleteSelectionWithVerses,
  stickyVerseEnter,
  verseBackspace,
  verseDelete,
  verseRedo,
  verseUndo,
} from "./verse-guard";

/**
 * Keyboard bindings, highest-priority first. `undo`/`redo` drive the persistent
 * history (Phase 3 rehydrates the stack from the step log). List bindings fall
 * through to `baseKeymap` when the selection isn't in a list.
 */
export function buildKeymaps(): Plugin[] {
  const insertHardBreak: Command = chainCommands(
    exitCode,
    (state, dispatch) => {
      if (dispatch) {
        dispatch(
          state.tr
            .replaceSelectionWith(nodes.hardBreak.create())
            .scrollIntoView(),
        );
      }
      return true;
    },
  );

  // Terminal for the Tab chains: when nothing can nest/indent (a list item at
  // max nesting, or a block already at max indent), swallow the key so the
  // browser never inserts a literal tab character.
  const consumeKey: Command = () => true;

  const bindings: Record<string, Command> = {
    "Mod-z": verseUndo,
    "Mod-y": verseRedo,
    "Shift-Mod-z": verseRedo,
    "Mod-b": toggleMark(marks.strong),
    "Mod-i": toggleMark(marks.em),
    "Mod-u": toggleMark(marks.underline),
    "Mod-Shift-s": toggleMark(marks.strikethrough),
    "Shift-Enter": insertHardBreak,
    "Mod-Enter": insertHardBreak,
    // Keep a verse marker attached to its verse on Enter, then fall through to
    // the list-item split (and `baseKeymap`'s paragraph split) as before.
    Enter: chainCommands(
      stickyVerseEnter,
      splitListItem(nodes.listItem),
      splitListItem(nodes.taskItem),
    ),
    // In a list (bullet/ordered/task), Tab/Shift-Tab nest the item; otherwise
    // they indent/outdent the selected block(s) regardless of cursor position.
    Tab: chainCommands(
      sinkListItem(nodes.listItem),
      sinkListItem(nodes.taskItem),
      indentBlocks,
      consumeKey,
    ),
    "Shift-Tab": chainCommands(
      liftListItem(nodes.listItem),
      liftListItem(nodes.taskItem),
      outdentBlocks,
      consumeKey,
    ),
    // Keep protected verse numbers from being backspaced/deleted away.
    Backspace: verseBackspace,
    Delete: verseDelete,
    // Deliberate escape-hatch: remove a selection including its verse markers.
    "Mod-Shift-Backspace": deleteSelectionWithVerses,
  };

  return [keymap(bindings), keymap(baseKeymap)];
}
