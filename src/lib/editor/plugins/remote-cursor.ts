import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** A remote selection in document coordinates (the writer's cursor). */
export interface RemoteCursor {
  anchor: number;
  head: number;
  /** Optional label + color for the writer's caret (read-along). */
  name?: string;
  color?: string;
}

export const remoteCursorKey = new PluginKey<RemoteCursor | null>(
  "remoteCursor",
);

/**
 * Renders another user's caret/selection as decorations. Set it with
 * `tr.setMeta(remoteCursorKey, cursor | null)`; stored positions are mapped
 * forward through every doc change so the caret tracks edits, and clamped to
 * the current doc bounds. When the cursor carries a `name`/`color`, the caret
 * shows a small colored name tag (Google-Docs style).
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
            ...value,
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
        const color = cursor.color;

        const decorations = [
          Decoration.widget(
            head,
            () => {
              const caret = document.createElement("span");
              caret.className = "remote-caret";
              if (color) {
                caret.style.setProperty("--remote-color", color);
              }
              if (cursor.name) {
                const label = document.createElement("span");
                label.className = "remote-caret-label";
                label.textContent = cursor.name;
                caret.appendChild(label);
              }
              return caret;
            },
            { side: 1 },
          ),
        ];
        if (anchor !== head) {
          const attrs: { class: string; style?: string } = {
            class: "remote-selection",
          };
          if (color) {
            attrs.style = `--remote-color: ${color}`;
          }
          decorations.push(
            Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
              ...attrs,
            }),
          );
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
