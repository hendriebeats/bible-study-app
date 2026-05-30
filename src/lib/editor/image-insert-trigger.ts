import type { Command } from "prosemirror-state";

/**
 * Opens the image insert dialog by dispatching `image:open-insert` on the
 * editor's DOM. A React-side `<ImageInsertDialog>` mounted next to the editor
 * picks up the event and renders the chooser. Used by both the slash-menu
 * `/image` entry and the rich-text toolbar's Image button so they share the
 * exact same dialog instance and surface behaviour.
 */
export const openImageInsertDialog: Command = (_state, dispatch, view) => {
  if (!view) return false;
  if (dispatch) {
    view.dom.dispatchEvent(
      new CustomEvent("image:open-insert", {
        bubbles: true,
        detail: { view },
      }),
    );
  }
  return true;
};
