import { ChangeSet } from "prosemirror-changeset";
import { DOMSerializer, type Node } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Compute multi-region red/green decorations for the [[section-history-panel]]
 * showing how a past version of a document differs from the current one. The
 * decorations are anchored in `pastDoc` (the rendered preview):
 *
 *   - `.history-diff-removed` — inline decoration over each region in past
 *     that no longer exists in current. **Red**: this content was DELETED.
 *   - `.history-diff-added` widget — DOM widget at each insertion point
 *     rendering the corresponding current-doc region. **Green**: this
 *     content was ADDED.
 *   - `--inline` / `--block` modifier picks the widget shape: an inline
 *     pill for text-level inserts (mid-paragraph word changes), a block-
 *     level container for whole-paragraph / structural inserts.
 *
 * Implementation: synthesize a `ReplaceStep(0, past.size, currentSlice)` —
 * the "all-at-once" replace from past to current — and feed its step map
 * to `ChangeSet`. The library walks the tokens of both docs and splits
 * that single step into multiple `Change` regions, one per contiguous
 * token-differing range. The previous implementation used
 * `Fragment.findDiffStart` / `findDiffEnd`, which collapses every
 * disjoint edit into a single outer envelope; this version gives us a
 * real per-region diff.
 *
 * **Rendering caveat**: the green inserted-content widget renders via
 * `DOMSerializer.fromSchema`, which walks each node's `toDOM` spec. That
 * does NOT invoke the custom node-views (`src/lib/editor/node-views.ts`),
 * so an inserted `study_block` / `callout` / `collapsible` shows its
 * baseline DOM shape but not the live editor's interactive chrome — fine
 * for a comparison preview. The fallback `try`/`catch` drops to plain
 * text if a node lacks a usable `toDOM`.
 *
 * Returns `DecorationSet.empty` when the two docs are identical (e.g.
 * when the panel is at "Now (latest)") so the preview renders untouched.
 */
export function computeHistoryDiffDecorations(
  pastDoc: Node,
  currentDoc: Node,
): DecorationSet {
  // `slice(0, size, false)` keeps the open-depth at 0 so the slice covers
  // the full doc as a closed fragment — the `false` flag tells `slice` not
  // to allow content that crosses block boundaries to remain "open" at the
  // ends. That gives `ReplaceStep` a well-formed replacement.
  const slice = currentDoc.slice(0, currentDoc.content.size, false);
  let cs = ChangeSet.create(pastDoc);
  try {
    const step = new ReplaceStep(0, pastDoc.content.size, slice);
    cs = cs.addSteps(currentDoc, [step.getMap()], null);
  } catch {
    // ReplaceStep can throw when the slice doesn't fit (e.g. completely
    // different top-level structure under the same schema). Fall back to
    // "no decorations" rather than tearing down the preview.
    return DecorationSet.empty;
  }
  if (cs.changes.length === 0) {
    return DecorationSet.empty;
  }

  const serializer = DOMSerializer.fromSchema(pastDoc.type.schema);
  const decorations: Decoration[] = [];

  for (const change of cs.changes) {
    // RED — content that exists in past but no longer in current.
    if (change.toA > change.fromA) {
      decorations.push(
        Decoration.inline(change.fromA, change.toA, {
          class: "history-diff-removed",
        }),
      );
    }

    // GREEN — content that exists in current but didn't in past, surfaced
    // as a widget at the past-doc position the change anchors to.
    if (change.toB > change.fromB) {
      const insertedSlice = currentDoc.slice(change.fromB, change.toB);
      const firstChild = insertedSlice.content.firstChild;
      const isBlock =
        insertedSlice.openStart === 0 &&
        insertedSlice.openEnd === 0 &&
        firstChild?.isBlock === true;
      // `side: -1` so the widget sits BEFORE any adjacent red range at
      // the same position — added-then-removed reads left-to-right as
      // "+ -" like a unified diff hunk.
      decorations.push(
        Decoration.widget(
          change.fromA,
          () => {
            const el = document.createElement(isBlock ? "div" : "span");
            el.className = isBlock
              ? "history-diff-added history-diff-added--block"
              : "history-diff-added history-diff-added--inline";
            try {
              el.appendChild(
                serializer.serializeFragment(insertedSlice.content),
              );
            } catch {
              // Last-resort fallback: render the inserted text only. Loses
              // formatting but keeps the panel functional on schemas that
              // can't fully round-trip through DOMSerializer.
              el.textContent = insertedSlice.content.textBetween(
                0,
                insertedSlice.content.size,
                "\n",
                " ",
              );
            }
            return el;
          },
          { side: -1 },
        ),
      );
    }
  }

  return decorations.length > 0
    ? DecorationSet.create(pastDoc, decorations)
    : DecorationSet.empty;
}
