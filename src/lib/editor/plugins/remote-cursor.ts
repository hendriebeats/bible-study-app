import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** A remote selection in document coordinates (the writer's cursor). */
export interface RemoteCursor {
  anchor: number;
  head: number;
}

export const remoteCursorKey = new PluginKey<RemoteCursor | null>(
  "remoteCursor",
);

/**
 * Renders another user's caret/selection as decorations. Set it with
 * `tr.setMeta(remoteCursorKey, cursor | null)`; stored positions are mapped
 * forward through every doc change so the caret tracks edits, and clamped to
 * the current doc bounds.
 */
export function remoteCursor(): Plugin<RemoteCursor | null> {
  return new Plugin<RemoteCursor | null>({
    key: remoteCursorKey,
    state: {
      init() {
        return null;
      },
      apply(tr, value) {
        const meta = tr.getMeta(remoteCursorKey) as
          | RemoteCursor
          | null
          | undefined;
        if (meta !== undefined) {
          return meta;
        }
        if (value && tr.docChanged) {
          return {
            anchor: tr.mapping.map(value.anchor),
            head: tr.mapping.map(value.head),
          };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const cursor = remoteCursorKey.getState(state);
        if (!cursor) {
          return null;
        }
        const size = state.doc.content.size;
        const head = Math.min(Math.max(cursor.head, 0), size);
        const anchor = Math.min(Math.max(cursor.anchor, 0), size);

        const decorations = [
          Decoration.widget(
            head,
            () => {
              const caret = document.createElement("span");
              caret.className = "remote-caret";
              return caret;
            },
            { side: 1 },
          ),
        ];
        if (anchor !== head) {
          decorations.push(
            Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
              class: "remote-selection",
            }),
          );
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
