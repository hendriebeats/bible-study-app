import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Renders suggested placeholder text into empty editable areas:
 *   - the whole document while it's a single empty paragraph (e.g. empty notes),
 *     using `text`; and
 *   - each `study_block` whose body is a single empty paragraph, using that
 *     block's own `placeholder` attr.
 * Each target gets the `is-editor-empty` class + a `data-placeholder` attr,
 * which the `.ProseMirror p.is-editor-empty:first-child::before` rule in
 * globals.css renders. The decoration recomputes as the user types, so the
 * placeholder disappears the moment the area is no longer empty.
 */
export function placeholder(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const decorations: Decoration[] = [];

        const first = doc.firstChild;
        if (
          doc.childCount === 1 &&
          first?.type.name === "paragraph" &&
          first.content.size === 0
        ) {
          decorations.push(
            Decoration.node(0, first.nodeSize, {
              class: "is-editor-empty",
              "data-placeholder": text,
            }),
          );
        }

        doc.descendants((node, pos) => {
          if (node.type.name === "study_block") {
            // Action-variant blocks have no visible body, so the placeholder
            // hint would never be seen — and we'd be decorating a structural
            // empty paragraph the user can't interact with. Skip them.
            if (node.attrs.variant === "action") {
              return false;
            }
            const ph: unknown = node.attrs.placeholder;
            if (typeof ph === "string" && ph !== "" && node.childCount === 1) {
              const body = node.child(0);
              if (body.type.name === "paragraph" && body.content.size === 0) {
                const bodyPos = pos + 1; // step inside the study_block
                decorations.push(
                  Decoration.node(bodyPos, bodyPos + body.nodeSize, {
                    class: "is-editor-empty",
                    "data-placeholder": ph,
                  }),
                );
              }
            }
            return false; // a study_block never nests another
          }

          // Toggle header placeholder (Notion-style "Toggle" ghost text). Only
          // when the first child IS an empty paragraph — a header the user
          // already converted to a heading or list silently opts out. Walk
          // into the collapsible to find any nested ones too.
          if (node.type.name === "collapsible") {
            const first = node.firstChild;
            if (first?.type.name === "paragraph" && first.content.size === 0) {
              const firstPos = pos + 1; // step inside the collapsible
              decorations.push(
                Decoration.node(firstPos, firstPos + first.nodeSize, {
                  class: "is-editor-empty",
                  "data-placeholder": "Toggle",
                }),
              );
            }
          }
          // Note-entry body placeholder. A freshly-anchored note starts with
          // one empty paragraph as its body — show a Notion-style "Add note
          // here…" hint so it doesn't read as a dead row in the index. The
          // hint disappears the moment the user types or pastes in.
          if (node.type.name === "note_entry") {
            if (node.childCount === 1) {
              const first = node.firstChild;
              if (
                first?.type.name === "paragraph" &&
                first.content.size === 0
              ) {
                const firstPos = pos + 1;
                decorations.push(
                  Decoration.node(firstPos, firstPos + first.nodeSize, {
                    class: "is-editor-empty",
                    "data-placeholder": "Add note here…",
                  }),
                );
              }
            }
          }
          return true;
        });

        return decorations.length > 0
          ? DecorationSet.create(doc, decorations)
          : null;
      },
    },
  });
}
