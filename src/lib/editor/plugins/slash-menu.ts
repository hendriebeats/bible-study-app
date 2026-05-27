import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { SlashCommand } from "../slash-commands";

/**
 * Tracks an in-progress slash command: a `/` typed at the start of a block or
 * after whitespace, followed by a (space-free) query up to the cursor. The
 * React `SlashMenu` reads this from the active editor state to render the menu;
 * this plugin only does detection (no UI, no key handling).
 */
export interface SlashState {
  active: boolean;
  /** Doc position of the `/` (start of the range to delete on select). */
  from: number;
  /** Doc position of the cursor (end of the range). */
  to: number;
  /** The text typed after the `/`. */
  query: string;
}

const INACTIVE: SlashState = { active: false, from: 0, to: 0, query: "" };

export const slashMenuKey = new PluginKey<SlashState>("slashMenu");

// A `/` preceded by start-of-text or whitespace, then a space-free query.
const SLASH_RE = /(?:^|\s)\/([^\s/]*)$/;

export function slashMenu(): Plugin<SlashState> {
  return new Plugin<SlashState>({
    key: slashMenuKey,
    state: {
      init: () => INACTIVE,
      apply: (_tr, _value, _oldState, newState) => {
        const { selection } = newState;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return INACTIVE;
        }
        const $cursor = selection.$cursor;
        if (!$cursor) {
          return INACTIVE;
        }
        // leafText "￼" stands in for inline atoms (e.g. verse markers).
        const textBefore = $cursor.parent.textBetween(
          0,
          $cursor.parentOffset,
          "\n",
          "￼",
        );
        const match = SLASH_RE.exec(textBefore);
        if (!match) {
          return INACTIVE;
        }
        const query = match[1] ?? "";
        // The `/` and query are literal chars immediately before the cursor, so
        // their positions are exact regardless of any atoms earlier in the block.
        return {
          active: true,
          from: $cursor.pos - query.length - 1,
          to: $cursor.pos,
          query,
        };
      },
    },
  });
}

export function getSlashState(state: EditorState): SlashState {
  return slashMenuKey.getState(state) ?? INACTIVE;
}

/** Remove the `/query` text, then run the chosen command on the active editor. */
export function runSlashCommand(view: EditorView, entry: SlashCommand): void {
  const slash = getSlashState(view.state);
  if (slash.active && slash.to > slash.from) {
    view.dispatch(view.state.tr.delete(slash.from, slash.to));
  }
  entry.command(view.state, view.dispatch, view);
  view.focus();
}
