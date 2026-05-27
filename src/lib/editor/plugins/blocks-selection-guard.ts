import type { Node, ResolvedPos } from "prosemirror-model";
import { Plugin, type Selection, TextSelection } from "prosemirror-state";

/**
 * Start of the top-level node's content that contains `$pos` (so two positions
 * inside the same top-level block share it), or -1 when `$pos` sits at the doc
 * level (a gap between blocks).
 */
function topStart($pos: ResolvedPos): number {
  return $pos.depth >= 1 ? $pos.start(1) : -1;
}

/** Are both positions inside the SAME top-level block? */
function sameTopBlock($a: ResolvedPos, $b: ResolvedPos): boolean {
  const a = topStart($a);
  return a >= 0 && a === topStart($b);
}

/**
 * A selection clamped to stay within the top-level block of `$keep`: it extends
 * from `$keep` only as far as that block's boundary in the direction of
 * `headPos`. Collapses at `$keep` when it sits at the doc level (a gap).
 */
function clampInto(doc: Node, $keep: ResolvedPos, headPos: number): Selection {
  if ($keep.depth < 1) {
    return TextSelection.near($keep);
  }
  const target = headPos > $keep.pos ? $keep.end(1) : $keep.start(1);
  return TextSelection.between($keep, doc.resolve(target));
}

/**
 * Confines selections in the Study-blocks editor to a single top-level block:
 * you can select/format freely WITHIN one study block (or the notes index), but
 * a selection can never span two blocks (or reach the title/subtitle — already
 * separated by the non-editable header). Added to the BLOCKS editor only.
 *
 * Two layers (⌘A is handled separately by a `selectCurrentBlock` keymap):
 *   - `createSelectionBetween` clamps pointer selections (click-drag, shift-click)
 *     to the block the gesture started in — so a drag stops at the block boundary.
 *   - `appendTransaction` is the catch-all backstop: any other vector that still
 *     leaves a cross-block selection (programmatic, keyboard edge cases) is clamped
 *     back into the `from`-side block. A `CellSelection` inside a table stays within
 *     one block, so it's left untouched; a single-block selection returns null → no
 *     loop.
 */
export function blocksSelectionGuard(): Plugin {
  return new Plugin({
    props: {
      createSelectionBetween(view, $anchor, $head) {
        if (sameTopBlock($anchor, $head)) {
          return null;
        }
        return clampInto(view.state.doc, $anchor, $head.pos);
      },
    },
    appendTransaction(_transactions, _oldState, newState) {
      const sel = newState.selection;
      if (sameTopBlock(sel.$from, sel.$to)) {
        return null;
      }
      return newState.tr.setSelection(
        clampInto(newState.doc, sel.$from, sel.$to.pos),
      );
    },
  });
}
