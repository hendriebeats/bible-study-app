import {
  baseKeymap,
  chainCommands,
  exitCode,
  toggleMark,
} from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from "prosemirror-schema-list";
import type { Command, Plugin } from "prosemirror-state";

import { marks, nodes } from "../schema";

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
    "Mod-z": undo,
    "Mod-y": redo,
    "Shift-Mod-z": redo,
    "Mod-b": toggleMark(marks.strong),
    "Mod-i": toggleMark(marks.em),
    "Mod-Shift-s": toggleMark(marks.strikethrough),
    "Shift-Enter": insertHardBreak,
    "Mod-Enter": insertHardBreak,
    Enter: splitListItem(nodes.listItem),
    Tab: sinkListItem(nodes.listItem),
    "Shift-Tab": liftListItem(nodes.listItem),
  };

  return [keymap(bindings), keymap(baseKeymap)];
}
