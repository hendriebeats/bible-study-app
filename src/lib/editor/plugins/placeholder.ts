import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Shows placeholder text while the document is a single empty paragraph. Marks
 * the empty `<p>` with the `is-editor-empty` class + `data-placeholder` attr,
 * which the existing `.ProseMirror p.is-editor-empty:first-child::before` rule
 * in globals.css renders.
 */
export function placeholder(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const first = doc.firstChild;
        if (
          doc.childCount !== 1 ||
          first?.type.name !== "paragraph" ||
          first.content.size !== 0
        ) {
          return null;
        }
        return DecorationSet.create(doc, [
          Decoration.node(0, first.nodeSize, {
            class: "is-editor-empty",
            "data-placeholder": text,
          }),
        ]);
      },
    },
  });
}
