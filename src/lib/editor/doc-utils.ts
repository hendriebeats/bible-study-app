import type { Node } from "prosemirror-model";

/**
 * True when `doc` is the schema's "blank" state: a lone empty paragraph (the
 * default ProseMirror starting doc). The same shape check is used in a few
 * places — placeholder gating, the notes-doc empty-owner overlay, the lazy
 * "replace with notes_index" branch in createNote — so it lives in one spot.
 */
export function isDocEmpty(doc: Node): boolean {
  const first = doc.firstChild;
  return (
    doc.childCount === 1 &&
    first?.type.name === "paragraph" &&
    first.content.size === 0
  );
}
