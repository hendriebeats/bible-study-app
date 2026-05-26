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

import { marks, nodes } from "../schema";
import {
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

  const bindings: Record<string, Command> = {
    "Mod-z": verseUndo,
    "Mod-y": verseRedo,
    "Shift-Mod-z": verseRedo,
    "Mod-b": toggleMark(marks.strong),
    "Mod-i": toggleMark(marks.em),
    "Mod-Shift-s": toggleMark(marks.strikethrough),
    "Shift-Enter": insertHardBreak,
    "Mod-Enter": insertHardBreak,
    Enter: splitListItem(nodes.listItem),
    Tab: sinkListItem(nodes.listItem),
    "Shift-Tab": liftListItem(nodes.listItem),
    // Keep protected verse numbers from being backspaced/deleted away.
    Backspace: verseBackspace,
    Delete: verseDelete,
  };

  return [keymap(bindings), keymap(baseKeymap)];
}
