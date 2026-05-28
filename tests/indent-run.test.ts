import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { applyIndentRunDrop, indentRunBounds } from "@/lib/editor/indent-run";
import { schema } from "@/lib/editor/schema";

/**
 * Phase 4b pure-transform tests. Constructs synthetic ProseMirror docs from
 * JSON, runs the indent-run helpers, and asserts the resulting state shape.
 *
 * Test docs only use the editor's natural blocks (paragraph, list_row,
 * heading) so the assertions are decoupled from study_block / note_entry
 * chrome — those wrappers don't affect the pure-attr indent model.
 *
 * Every doc starts with `posOf` lookups indexing into the doc's top-level
 * children: `posOf(state, 0)` is the position immediately before the first
 * child, `posOf(state, 1)` immediately before the second, etc. That matches
 * the "block child position" contract `indentRunBounds` expects.
 */

function makeDoc(blocks: object[]): EditorState {
  const doc = schema.nodeFromJSON({ type: "doc", content: blocks });
  return EditorState.create({ doc, schema });
}

/** Position immediately before the doc's `index`-th top-level child. */
function posOf(state: EditorState, index: number): number {
  let offset = 0;
  state.doc.forEach((_child, blockOffset, i) => {
    if (i === index) offset = blockOffset;
  });
  return offset;
}

/** Narrow `tr` to non-null (Vitest's `not.toBeNull()` doesn't refine). */
function assertTr<T>(tr: T | null): T {
  if (tr === null) throw new Error("expected non-null transaction");
  return tr;
}

function p(text: string, indent = 0): object {
  return {
    type: "paragraph",
    attrs: { indent },
    content: text ? [{ type: "text", text }] : undefined,
  };
}

function bullet(text: string, indent = 0): object {
  return {
    type: "list_row",
    attrs: { indent, listType: "bullet", checked: false, listStart: null },
    content: text ? [{ type: "text", text }] : undefined,
  };
}

function h(text: string, indent = 0, level = 1): object {
  return {
    type: "heading",
    attrs: { level, indent },
    content: text ? [{ type: "text", text }] : undefined,
  };
}

describe("indentRunBounds", () => {
  it("captures the single block when no following siblings are deeper", () => {
    const state = makeDoc([p("a", 0), p("b", 0), p("c", 0)]);
    const run = indentRunBounds(state, posOf(state, 1));
    expect(run).not.toBeNull();
    expect(run?.rootIndent).toBe(0);
    expect(run?.start).toBe(posOf(state, 1));
    // The run ends at the start of the next sibling.
    expect(run?.end).toBe(posOf(state, 2));
  });

  it("sweeps deeper siblings into the run", () => {
    // bullet(0) + heading(1) + paragraph(1) is what the user described as
    // "a header or paragraph tabbed in beneath a list item is its child".
    const state = makeDoc([
      bullet("root", 0),
      h("child h", 1),
      p("child p", 1),
    ]);
    const run = indentRunBounds(state, posOf(state, 0));
    expect(run).not.toBeNull();
    expect(run?.rootIndent).toBe(0);
    expect(run?.start).toBe(posOf(state, 0));
    // Ends at the end of the doc (no shallower sibling follows).
    expect(run?.end).toBe(state.doc.content.size);
  });

  it("stops at the first sibling whose indent is <= root", () => {
    const state = makeDoc([
      bullet("a", 0),
      p("a.1", 1),
      bullet("b", 0), // boundary — same indent as root
      p("b.1", 1),
    ]);
    const run = indentRunBounds(state, posOf(state, 0));
    expect(run?.end).toBe(posOf(state, 2));
  });

  it("treats a deeper block grabbed mid-tree as its own root", () => {
    const state = makeDoc([
      bullet("root", 0),
      bullet("child", 1),
      h("grandchild", 2),
      bullet("uncle", 1), // shallower than grandchild — boundary
    ]);
    const run = indentRunBounds(state, posOf(state, 1));
    expect(run?.rootIndent).toBe(1);
    expect(run?.start).toBe(posOf(state, 1));
    expect(run?.end).toBe(posOf(state, 3));
  });

  it("returns null for an out-of-range position", () => {
    const state = makeDoc([p("a")]);
    expect(indentRunBounds(state, -5)).toBeNull();
    expect(indentRunBounds(state, state.doc.content.size + 10)).toBeNull();
  });

  it("defaults a missing indent attr to 0", () => {
    // Build a horizontal_rule (which has no indent attr) followed by an
    // indent-1 paragraph. The hr is the root; the paragraph is at indent
    // 1 > 0 so it's swept in.
    const state = makeDoc([{ type: "horizontal_rule" }, p("after hr", 1)]);
    const run = indentRunBounds(state, posOf(state, 0));
    expect(run?.rootIndent).toBe(0);
    expect(run?.end).toBe(state.doc.content.size);
  });
});

describe("applyIndentRunDrop", () => {
  it("moves a single block to a new sibling slot", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const aStart = posOf(state, 0);
    const aEnd = posOf(state, 1);
    const afterC = state.doc.content.size;
    const tr = applyIndentRunDrop(state, aStart, aEnd, afterC, 0);
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { content?: { text: string }[] }[];
    };
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("rewrites every child's indent so the root lands at targetIndent", () => {
    // Move bullet(0) + child(1) + grandchild(2) to a new position at indent 2.
    // Expected: root becomes 2, child becomes 3, grandchild becomes 4.
    const state = makeDoc([
      bullet("root", 0),
      bullet("child", 1),
      bullet("grandchild", 2),
      p("after"),
    ]);
    const runStart = posOf(state, 0);
    const runEnd = posOf(state, 3);
    const afterAll = state.doc.content.size;
    const tr = applyIndentRunDrop(state, runStart, runEnd, afterAll, 2);
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    // Order: paragraph "after", then the moved run.
    expect(after.content[0]?.attrs?.indent).toBe(0); // the paragraph stays
    expect(after.content[1]?.attrs?.indent).toBe(2);
    expect(after.content[2]?.attrs?.indent).toBe(3);
    expect(after.content[3]?.attrs?.indent).toBe(4);
  });

  it("clamps indent to [0, MAX_INDENT] per child", () => {
    // Grab a block at indent 5; drop at indent 0 → shift -5. Child at
    // indent 7 becomes 2 (7 - 5). Child at indent 5 becomes 0.
    const state = makeDoc([
      p("root", 5),
      p("child a", 7),
      p("child b", 5),
      p("end", 0),
    ]);
    const runStart = posOf(state, 0);
    const runEnd = posOf(state, 3);
    const afterEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, runStart, runEnd, afterEnd, 0);
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    // First child stays: "end". Then the moved trio.
    expect(after.content[1]?.attrs?.indent).toBe(0);
    expect(after.content[2]?.attrs?.indent).toBe(2);
    expect(after.content[3]?.attrs?.indent).toBe(0);
  });

  it("upshifts and clamps at MAX_INDENT", () => {
    // Drop a block at indent 0 onto indent 14 (one less than MAX_INDENT=15).
    // The block's single child at indent 5 should clamp to 15.
    const state = makeDoc([p("root", 0), p("child", 5), p("end", 0)]);
    const runStart = posOf(state, 0);
    const runEnd = posOf(state, 2);
    const afterEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, runStart, runEnd, afterEnd, 14);
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    expect(after.content[1]?.attrs?.indent).toBe(14); // root
    expect(after.content[2]?.attrs?.indent).toBe(15); // clamped from 19
  });

  it("returns null when target sits inside the source", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const tr = applyIndentRunDrop(
      state,
      posOf(state, 0),
      posOf(state, 2),
      posOf(state, 1), // inside [posOf(0), posOf(2)]
      0,
    );
    expect(tr).toBeNull();
  });

  it("returns null when the source range is empty", () => {
    const state = makeDoc([p("a")]);
    const tr = applyIndentRunDrop(state, 0, 0, state.doc.content.size, 0);
    expect(tr).toBeNull();
  });

  it("returns null when the source range straddles a block boundary", () => {
    // Pass an end that lands inside a block, not at its boundary.
    const state = makeDoc([p("aa"), p("bb")]);
    const tr = applyIndentRunDrop(state, 0, 3, state.doc.content.size, 0);
    expect(tr).toBeNull();
  });

  it("targets to the LEFT of the source map straight through", () => {
    // Move the third block to position 0. The target (0) is < sourceStart,
    // so no mapping adjustment is needed.
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const cStart = posOf(state, 2);
    const cEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, cStart, cEnd, 0, 0);
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { content?: { text: string }[] }[];
    };
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
