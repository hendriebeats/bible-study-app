import {
  baseKeymap,
  chainCommands,
  exitCode,
  toggleMark,
} from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { splitListItem } from "prosemirror-schema-list";
import type { Command, Plugin } from "prosemirror-state";
import { goToNextCell } from "prosemirror-tables";

import { indentSelected, outdentSelected } from "../commands";
import type { EditorTools } from "../editor-tools";
import { marks, nodes } from "../schema";
import { collapsibleBackspace, collapsibleEnter } from "./collapsible-keys";
import { smartBackspace } from "./smart-backspace";
import {
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
 *
 * Some bindings are gated on `editor_tools` so opting out of a feature in the
 * account UI also unbinds its shortcut — at the moment that's Mod-Shift-S for
 * strikethrough (the toolbar button + slash menu + markdown rule are gated
 * the same way).
 */
export function buildKeymaps(tools: EditorTools): Plugin[] {
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
    "Shift-Enter": insertHardBreak,
    "Mod-Enter": insertHardBreak,
    // Keep a verse marker attached to its verse on Enter, then handle the
    // closed-collapsible "Enter on header → new sibling" special-case, then
    // fall through to the list-item split (and `baseKeymap`'s paragraph
    // split) as before. `collapsibleEnter` yields when the toggle is open so
    // Enter inside an open toggle just adds a body paragraph.
    Enter: chainCommands(
      stickyVerseEnter,
      collapsibleEnter,
      splitListItem(nodes.listItem),
      splitListItem(nodes.taskItem),
    ),
    // Inside a table, Tab/Shift-Tab move between cells. Otherwise,
    // `indentSelected`/`outdentSelected` owns the hybrid behaviour: it
    // structurally sinks/lifts list items when ProseMirror allows, falls back
    // to bumping the item's `indent` attribute for first items and other cases
    // sink/lift refuses, and edits the paragraph/heading indent attribute when
    // not in a list. `goToNextCell` no-ops outside a table so it falls through
    // cleanly.
    Tab: chainCommands(goToNextCell(1), indentSelected, consumeKey),
    "Shift-Tab": chainCommands(goToNextCell(-1), outdentSelected, consumeKey),
    // Backspace chain, highest precedence first:
    //   * verseBackspace      — preserve verse markers near the caret.
    //   * smartBackspace      — single-keystroke wrapper dissolve when the
    //                           caret is in an empty-only-child blockquote/
    //                           callout/collapsible; refuse cross-structure
    //                           joins into a prior list/container.
    //   * collapsibleBackspace — dissolve a non-empty collapsible from its
    //                            header (peels header + body into siblings).
    //   * baseKeymap (later) — joinBackward / liftEmptyBlock / deleteSelection.
    Backspace: chainCommands(
      verseBackspace,
      smartBackspace,
      collapsibleBackspace,
    ),
    Delete: verseDelete,
  };

  if (tools.strikethrough) {
    bindings["Mod-Shift-s"] = toggleMark(marks.strikethrough);
  }

  return [keymap(bindings), keymap(baseKeymap)];
}
