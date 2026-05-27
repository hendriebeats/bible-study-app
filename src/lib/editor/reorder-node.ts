import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

/**
 * Move one child to a new position among its siblings inside the parent that
 * holds the node at `childPos` (a position immediately before some child —
 * e.g. a NodeView's `getPos()`, or a block's `before(1)`). `from`/`to` are
 * array-move indices into that parent's children, in document order.
 *
 * The moved node is deleted and re-inserted (rather than replacing the whole
 * parent), so the other children's NodeViews — and any caret inside them — are
 * left undisturbed. Flagged `allowVerseEdit` so the verse / notes-index guards
 * let a node that contains verse markers travel past them.
 *
 * Returns false (no transaction dispatched) when the indices are out of range,
 * equal, or don't resolve to a real parent.
 */
export function reorderSiblings(
  view: EditorView,
  childPos: number,
  from: number,
  to: number,
): boolean {
  const { state } = view;
  const $pos = state.doc.resolve(childPos);
  const parent = $pos.parent;
  const contentStart = $pos.start();

  const starts: number[] = [];
  const kids: Node[] = [];
  let offset = contentStart;
  parent.forEach((child) => {
    starts.push(offset);
    kids.push(child);
    offset += child.nodeSize;
  });

  const count = kids.length;
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) {
    return false;
  }

  const moving = kids[from];
  const movingStart = starts[from];
  if (!moving || movingStart === undefined) {
    return false;
  }

  const tr = state.tr.delete(movingStart, movingStart + moving.nodeSize);

  let insertAt: number;
  if (to >= count - 1) {
    // Append after the last remaining child (end of the parent's content).
    insertAt = tr.mapping.map(contentStart + parent.content.size);
  } else {
    // Insert before the original child that should follow the moved node.
    const followIndex = to < from ? to : to + 1;
    const followStart = starts[followIndex];
    if (followStart === undefined) {
      return false;
    }
    insertAt = tr.mapping.map(followStart);
  }

  tr.insert(insertAt, moving);
  tr.setMeta("allowVerseEdit", true);
  view.dispatch(tr.scrollIntoView());
  return true;
}
