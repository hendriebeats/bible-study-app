import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Selection-shadow plugin. Standard contentEditable surfaces visually clear
 * the text selection the instant the editor loses focus — a reasonable OS
 * default, but disorienting in a study editor where the user often clicks the
 * toolbar to apply formatting to "what I just had selected." This plugin
 * paints a fallback highlight on the persisted ProseMirror selection while
 * the view is blurred, so the user can see what their next toolbar action
 * will affect even after focus moves to a popover / dropdown / button.
 *
 * Implementation:
 *   * Plugin state tracks `focused` (boolean). `handleDOMEvents.focus` and
 *     `.blur` flip it via meta — we don't dispatch a tr from the DOM event
 *     handler directly because PM's blur fires on view-internal focus moves
 *     too (e.g. a NodeView's checkbox briefly stealing focus); the focus
 *     event firing in the same microtask flips us right back.
 *   * `decorations`: when `!focused` AND the selection is a non-empty
 *     TextSelection, emit one inline `Decoration.inline` carrying the
 *     `pm-blur-selection` class. CSS in globals.css paints the highlight.
 *   * Empty selections (cursor) emit nothing — there's nothing to persist.
 *   * NodeSelections / AllSelections emit nothing — those use their own
 *     visual indication already.
 */
const selectionShadowKey = new PluginKey<{ focused: boolean }>(
  "selection-shadow",
);

export function selectionShadowPlugin(): Plugin<{ focused: boolean }> {
  return new Plugin<{ focused: boolean }>({
    key: selectionShadowKey,
    state: {
      init: () => ({ focused: true }),
      apply(tr, prev) {
        const meta = tr.getMeta(selectionShadowKey) as
          | { focused: boolean }
          | undefined;
        if (meta) return meta;
        return prev;
      },
    },
    props: {
      handleDOMEvents: {
        focus(view) {
          view.dispatch(
            view.state.tr.setMeta(selectionShadowKey, { focused: true }),
          );
          return false;
        },
        blur(view) {
          view.dispatch(
            view.state.tr.setMeta(selectionShadowKey, { focused: false }),
          );
          return false;
        },
      },
      decorations(state) {
        const pluginState = selectionShadowKey.getState(state);
        if (!pluginState || pluginState.focused) return null;
        const sel = state.selection;
        if (!(sel instanceof TextSelection)) return null;
        if (sel.from === sel.to) return null;
        return DecorationSet.create(state.doc, [
          Decoration.inline(sel.from, sel.to, {
            class: "pm-blur-selection",
          }),
        ]);
      },
    },
  });
}
