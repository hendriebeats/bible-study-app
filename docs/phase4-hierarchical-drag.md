# Phase 4 — Hierarchical drag/drop

**Status (2026-05-28): SHIPPED.** Phases 4a, 4b, 4c, 4d all complete; 16/16
Playwright suite green; 14/14 vitest pure-function tests green.

## Locked design (from sign-off)

1. **Whole indent-run moves together.** Dragging a row picks up that row PLUS
   every immediately-following row whose indent is strictly greater. The
   group's relative indents are preserved; only the root's indent shifts.
2. **All indentable blocks** participate (`list_row`, `paragraph`, `heading`,
   `code_block`). Wrapper blocks (`blockquote`, `callout`, `collapsible`)
   carry indent too but their _children_ are flat siblings of the wrapper, so
   the drag handle sits on the wrapper itself and grabs the wrapper as one
   atomic block.
3. **Horizontal mouse picks the indent.** Range:
   `[0, above-neighbor.indent + 1]` inclusive. At the top of a container or
   above the first child of a wrapper, only `0` is valid.
4. **Visual feedback:** a horizontal blue insertion line that snaps in
   discrete indent-step increments as the mouse moves horizontally over the
   drop gap.

## Out of scope (deferred)

- Dragging into a wrapper's body (cross-container drop). Phase 4 initial cut
  only handles same-container reorders. Cross-container is a Phase 4.5 if it
  warrants it.
- Multi-select drag (Cmd-click multiple handles, drag them all). Single-row
  (single indent-run) drag only.
- Keyboard-only reorder (Mod-Shift-↑/↓) — already exists via `moveBlockUp`/
  `moveBlockDown`; should be updated to also move the indent run, but that's
  a follow-up to the drag work.

## Components to build

### 1. `src/lib/editor/plugins/block-drag.ts` (new — replaces drag bits of `block-handle.ts`)

Single Plugin owning the drag interaction:

- `state` tracks `{ active: false } | { active: true, runStart, runEnd, originalIndent, dropTarget: {pos, indent} | null }`.
- `props.handleDOMEvents`:
  - `pointerdown` on `[data-block-handle]` → enter `active` state, capture
    the run (start/end positions + original root indent), set
    `view.dom.style.pointerEvents = "none"` on non-handle elements to lock
    out clicks during drag.
  - `pointermove` (on `window`) → recompute `dropTarget`:
    - Vertical: find the block boundary nearest cursor Y.
    - Horizontal: `Math.round((cursorX - editorLeft - indentStartX) / INDENT_STEP_PX)`, clamped to `[0, above.indent + 1]`.
  - `pointerup` → dispatch the drop transaction; clear state.
  - `keydown Escape` → cancel drop.
- `props.decorations`: when `active`, paint:
  - A faded ghost over the source run (`opacity: 0.4`).
  - A horizontal blue line `Decoration.widget(dropTarget.pos)` styled with
    `margin-inline-start` matching the chosen indent.

### 2. Indent-run helpers in `src/lib/editor/commands.ts`

```ts
/** Returns the [start, end] positions of the indent run rooted at `pos`. */
export function indentRunBounds(
  state: EditorState,
  pos: number,
): {
  start: number;
  end: number;
  rootIndent: number;
};

/** Apply the drop: delete the source range, insert the rewritten run at
 *  the target gap with the new root indent (and shifted child indents). */
export function applyIndentRunDrop(
  state: EditorState,
  sourceStart: number,
  sourceEnd: number,
  targetPos: number,
  targetIndent: number,
): Transaction | null;
```

The "rewrite indents" step: for each block in the run,
`newIndent = targetIndent + (block.indent - rootIndent)`, clamped to
`[0, MAX_INDENT]`.

### 3. Block-handle gutter (existing) update

`block-handle.ts` currently positions a draggable `[data-block-handle]`
overlay next to the cursor's block. Update it to position next to EVERY
indentable block (not just the cursor's). Probably switch to a hover-based
spawn: handle appears on the block under the pointer.

Visually: a 6-dot grip icon, `cursor: grab`, becomes `cursor: grabbing` while
dragging.

### 4. CSS additions (`globals.css`)

```css
.ProseMirror .pm-drag-source {
  opacity: 0.4;
  pointer-events: none;
}
.ProseMirror .pm-drop-line {
  height: 2px;
  background: var(--primary);
  border-radius: 1px;
  position: relative;
  margin-block: 2px;
}
.block-handle {
  cursor: grab;
}
body.pm-dragging .block-handle {
  cursor: grabbing;
}
```

### 5. Playwright coverage (`e2e/editor/drag.spec.ts`)

Playwright's `page.mouse.down/move/up` synthesizes pointer events but
_teleports_ to the target — it won't catch hover-bridge or animation bugs
(per `playwright-testing-notes.md`). Still useful for:

- Drag bullet B between A and C with horizontal-0 cursor → B lands as
  sibling of A, all at indent 0.
- Drag indented child D up to indent 0 → it becomes a top-level row.
- Drag a parent with two children to a new position → all three move
  together preserving relative indents.

## Phasing within Phase 4

- **4a — Handle position + grip rendering.** No drag yet; just put the
  handle next to every indentable block. Verify hover doesn't flash and the
  gutter-bridge fix (see `[[blocks-doc-lockdown]]`) still applies.
- **4b — Indent-run capture + drop transaction (no UI).** Implement
  `indentRunBounds` and `applyIndentRunDrop` as pure transforms; unit-test
  them with synthetic docs.
- **4c — Pointer driver + drop indicator.** Wire pointerdown/move/up to the
  pure transforms; render the drop line + ghost source.
- **4d — Playwright matrix.** Lock the behavior down.

Each sub-phase is independently mergeable + verifiable.

## Open questions (decide before 4c)

- When the user drags ABOVE the topmost block in a container, the only valid
  indent is 0. Should the indent-step picker hide itself, or just clamp?
  (Recommend: hide — there's nothing to pick.)
- When dropping ONTO a `study_block` / `note_entry` / `notes_index`
  boundary, refuse the drop or insert as the first child of the
  containment node? (Recommend: refuse — those are isolated containers; the
  user would do that via the existing in-container handles.)
- Drag-cancel UX: Esc cancels; what about dragging back onto the source?
  (Recommend: snap back to original position with no transaction.)
