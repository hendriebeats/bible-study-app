import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  applyIndentRunDrop,
  applyIndentRunDropAtPosition,
  indentRunBounds,
} from "@/lib/editor/indent-run";
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
 *
 * `applyIndentRunDrop` now takes a `DropInstruction` (reorder-above,
 * reorder-below, make-child, reparent) instead of a `(targetPos, indent)`
 * tuple. The legacy tuple form survives as `applyIndentRunDropAtPosition`
 * (covered separately at the bottom).
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

function task(text: string, indent = 0, checked = false): object {
  return {
    type: "list_row",
    attrs: { indent, listType: "task", checked, listStart: null },
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

function callout(text: string, indent = 0): object {
  return {
    type: "callout",
    attrs: { variant: "note", indent },
    content: [
      {
        type: "paragraph",
        attrs: { indent: 0 },
        content: text ? [{ type: "text", text }] : undefined,
      },
    ],
  };
}

function collapsible(text: string, indent = 0): object {
  return {
    type: "collapsible",
    attrs: { open: true, indent },
    content: [
      {
        type: "paragraph",
        attrs: { indent: 0 },
        content: text ? [{ type: "text", text }] : undefined,
      },
    ],
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

describe("applyIndentRunDrop — reorder-above", () => {
  it("moves a single block before another sibling", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const aStart = posOf(state, 0);
    const aEnd = posOf(state, 1);
    const tr = applyIndentRunDrop(state, aStart, aEnd, {
      kind: "reorder-above",
      siblingPos: posOf(state, 2),
      indent: 0,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { content?: { text: string }[] }[];
    };
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("targets to the LEFT of the source map straight through", () => {
    // Move the third block to before the first. The target (0) is < sourceStart,
    // so no mapping adjustment is needed.
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const cStart = posOf(state, 2);
    const cEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, cStart, cEnd, {
      kind: "reorder-above",
      siblingPos: posOf(state, 0),
      indent: 0,
    });
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

  it("returns null when siblingPos sits strictly inside the source", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const tr = applyIndentRunDrop(state, posOf(state, 0), posOf(state, 2), {
      kind: "reorder-above",
      siblingPos: posOf(state, 1), // inside [posOf(0), posOf(2))
      indent: 0,
    });
    expect(tr).toBeNull();
  });

  it("returns null when reordering above oneself (no-op)", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const tr = applyIndentRunDrop(state, posOf(state, 1), posOf(state, 2), {
      kind: "reorder-above",
      siblingPos: posOf(state, 1),
      indent: 0,
    });
    expect(tr).toBeNull();
  });
});

describe("applyIndentRunDrop — reorder-below", () => {
  it("inserts the run after a sibling block", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const aStart = posOf(state, 0);
    const aEnd = posOf(state, 1);
    const tr = applyIndentRunDrop(state, aStart, aEnd, {
      kind: "reorder-below",
      siblingPos: posOf(state, 2),
      indent: 0,
    });
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

  it("rewrites every child's indent so the root lands at indent", () => {
    // Move bullet(0) + child(1) + grandchild(2) to after the trailing paragraph.
    // At indent 2 the root becomes 2, child 3, grandchild 4.
    const state = makeDoc([
      bullet("root", 0),
      bullet("child", 1),
      bullet("grandchild", 2),
      p("after"),
    ]);
    const runStart = posOf(state, 0);
    const runEnd = posOf(state, 3);
    const tr = applyIndentRunDrop(state, runStart, runEnd, {
      kind: "reorder-below",
      siblingPos: posOf(state, 3),
      indent: 2,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    expect(after.content[0]?.attrs?.indent).toBe(0); // the paragraph stays
    expect(after.content[1]?.attrs?.indent).toBe(2);
    expect(after.content[2]?.attrs?.indent).toBe(3);
    expect(after.content[3]?.attrs?.indent).toBe(4);
  });

  it("clamps each child to [0, MAX_INDENT] under negative shift", () => {
    // Grab a block at indent 5; drop at indent 0 → shift -5. Child at indent
    // 7 becomes 2 (7 - 5). Child at indent 5 becomes 0.
    const state = makeDoc([
      p("root", 5),
      p("child a", 7),
      p("child b", 5),
      p("end", 0),
    ]);
    const runStart = posOf(state, 0);
    const runEnd = posOf(state, 3);
    const tr = applyIndentRunDrop(state, runStart, runEnd, {
      kind: "reorder-below",
      siblingPos: posOf(state, 3),
      indent: 0,
    });
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
    const tr = applyIndentRunDrop(state, runStart, runEnd, {
      kind: "reorder-below",
      siblingPos: posOf(state, 2),
      indent: 14,
    });
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    expect(after.content[1]?.attrs?.indent).toBe(14); // root
    expect(after.content[2]?.attrs?.indent).toBe(15); // clamped from 19
  });

  it("returns null when the source range is empty", () => {
    const state = makeDoc([p("a")]);
    const tr = applyIndentRunDrop(state, 0, 0, {
      kind: "reorder-below",
      siblingPos: 0,
      indent: 0,
    });
    expect(tr).toBeNull();
  });

  it("returns null when the source range straddles a block boundary", () => {
    // Pass an end that lands inside a block, not at its boundary.
    const state = makeDoc([p("aa"), p("bb")]);
    const tr = applyIndentRunDrop(state, 0, 3, {
      kind: "reorder-below",
      siblingPos: posOf(state, 1),
      indent: 0,
    });
    expect(tr).toBeNull();
  });
});

describe("applyIndentRunDrop — make-child", () => {
  it("inserts the run as the first child of the parent block", () => {
    // a(0) / b(0) / c(0). Make c a child of a.
    const state = makeDoc([p("a", 0), p("b", 0), p("c", 0)]);
    const cStart = posOf(state, 2);
    const cEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, cStart, cEnd, {
      kind: "make-child",
      parentPos: posOf(state, 0),
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: {
        attrs?: { indent?: number };
        content?: { text: string }[];
      }[];
    };
    // Order: a (indent 0), c-as-child (indent 1), b (indent 0).
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(after.content[1]?.attrs?.indent).toBe(1);
  });

  it("clamps the new indent at MAX_INDENT when the parent is at the cap", () => {
    // Parent at indent 15; making a child of it should leave the child at 15.
    const state = makeDoc([p("parent", 15), p("dangler", 0)]);
    const danglerStart = posOf(state, 1);
    const danglerEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, danglerStart, danglerEnd, {
      kind: "make-child",
      parentPos: posOf(state, 0),
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    expect(after.content[1]?.attrs?.indent).toBe(15);
  });

  it("returns null when parentPos doesn't resolve to a block", () => {
    const state = makeDoc([p("solo")]);
    const tr = applyIndentRunDrop(
      state,
      posOf(state, 0),
      state.doc.content.size,
      { kind: "make-child", parentPos: state.doc.content.size + 5 },
    );
    expect(tr).toBeNull();
  });
});

describe("applyIndentRunDrop — reparent", () => {
  it("updates the root's indent in place without moving any block", () => {
    // a(0) / b(0) / c(1: child of b) / d(2: child of c).
    // Drop C as a sibling of B (indent 0). Run = [c, d]; d shifts with c.
    const state = makeDoc([p("a", 0), p("b", 0), p("c", 1), p("d", 2)]);
    const runStart = posOf(state, 2);
    const runEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, runStart, runEnd, {
      kind: "reparent",
      indent: 0,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: {
        attrs?: { indent?: number };
        content?: { text: string }[];
      }[];
    };
    // Order preserved.
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    // C at 0; D at 1 (was 2, shift -1).
    expect(after.content[2]?.attrs?.indent).toBe(0);
    expect(after.content[3]?.attrs?.indent).toBe(1);
  });

  it("clamps children at 0 under deep negative shift", () => {
    const state = makeDoc([p("root", 3), p("child", 4)]);
    const runStart = posOf(state, 0);
    const runEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, runStart, runEnd, {
      kind: "reparent",
      indent: 0,
    });
    const after = assertTr(tr).doc.toJSON() as {
      content: { attrs?: { indent?: number } }[];
    };
    expect(after.content[0]?.attrs?.indent).toBe(0);
    expect(after.content[1]?.attrs?.indent).toBe(1); // shift -3 from 4
  });

  it("returns null when the indent is unchanged (identity)", () => {
    const state = makeDoc([p("a", 2), p("b", 3)]);
    const tr = applyIndentRunDrop(
      state,
      posOf(state, 0),
      state.doc.content.size,
      { kind: "reparent", indent: 2 },
    );
    expect(tr).toBeNull();
  });

  it("preserves task list_row attrs across reparent", () => {
    // Make sure setNodeMarkup copies non-indent attrs (listType, checked).
    const state = makeDoc([task("alpha", 2, true), task("beta", 3, false)]);
    const tr = applyIndentRunDrop(
      state,
      posOf(state, 0),
      state.doc.content.size,
      { kind: "reparent", indent: 0 },
    );
    const after = assertTr(tr).doc.toJSON() as {
      content: {
        attrs?: { indent?: number; listType?: string; checked?: boolean };
      }[];
    };
    expect(after.content[0]?.attrs?.indent).toBe(0);
    expect(after.content[0]?.attrs?.listType).toBe("task");
    expect(after.content[0]?.attrs?.checked).toBe(true);
    expect(after.content[1]?.attrs?.indent).toBe(1);
    expect(after.content[1]?.attrs?.listType).toBe("task");
  });
});

describe("applyIndentRunDropAtPosition — legacy tuple shim", () => {
  it("maps targetPos == anchor of a block to reorder-above", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const aStart = posOf(state, 0);
    const aEnd = posOf(state, 1);
    const tr = applyIndentRunDropAtPosition(
      state,
      aStart,
      aEnd,
      posOf(state, 2), // target == start of c → reorder-above c
      0,
    );
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { content?: { text: string }[] }[];
    };
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("maps end-of-container targetPos to reorder-below the last block", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const aStart = posOf(state, 0);
    const aEnd = posOf(state, 1);
    const tr = applyIndentRunDropAtPosition(
      state,
      aStart,
      aEnd,
      state.doc.content.size,
      0,
    );
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

  it("returns null when target sits inside the source", () => {
    const state = makeDoc([p("a"), p("b"), p("c")]);
    const tr = applyIndentRunDropAtPosition(
      state,
      posOf(state, 0),
      posOf(state, 2),
      posOf(state, 1),
      0,
    );
    expect(tr).toBeNull();
  });
});

describe("applyIndentRunDrop — single-snap-per-gap equivalence", () => {
  // The driver redirects "lower half of R" → `reorder-above N` (the next
  // non-source sibling) instead of `reorder-below R`. The two instructions
  // must produce the SAME doc; this test locks that down so a future tweak
  // to the apply math can't silently diverge.
  it("reorder-below R and reorder-above N (= R's next sibling) yield identical docs", () => {
    const stateA = makeDoc([p("src"), p("a"), p("b"), p("c")]);
    const stateB = makeDoc([p("src"), p("a"), p("b"), p("c")]);
    const srcStartA = posOf(stateA, 0);
    const srcEndA = posOf(stateA, 1);
    const srcStartB = posOf(stateB, 0);
    const srcEndB = posOf(stateB, 1);

    // Variant A: reorder-below R where R = block "a".
    const trA = applyIndentRunDrop(stateA, srcStartA, srcEndA, {
      kind: "reorder-below",
      siblingPos: posOf(stateA, 1),
      indent: 0,
    });
    // Variant B: reorder-above N where N = block "b" (R's next sibling).
    const trB = applyIndentRunDrop(stateB, srcStartB, srcEndB, {
      kind: "reorder-above",
      siblingPos: posOf(stateB, 2),
      indent: 0,
    });
    expect(trA).not.toBeNull();
    expect(trB).not.toBeNull();
    expect(JSON.stringify(assertTr(trA).doc.toJSON())).toEqual(
      JSON.stringify(assertTr(trB).doc.toJSON()),
    );
    // Sanity: the moved order is a, src, b, c (src landed between a and b).
    const after = assertTr(trA).doc.toJSON() as {
      content: { content?: { text: string }[] }[];
    };
    expect(after.content.map((c) => c.content?.[0]?.text)).toEqual([
      "a",
      "src",
      "b",
      "c",
    ]);
  });
});

describe("applyIndentRunDrop — wrapper indent policy", () => {
  it("clamps a callout's indent to 0 on reorder, even when target asks for higher", () => {
    // Callouts' NodeView ignores indent, so the apply function pins them to
    // 0 regardless of what the driver requested — keeps visual + structural
    // in sync so the drag handle lands on the right column.
    const state = makeDoc([p("a"), p("b"), callout("warning", 0)]);
    const calloutStart = posOf(state, 2);
    const calloutEnd = state.doc.content.size;
    const tr = applyIndentRunDrop(state, calloutStart, calloutEnd, {
      kind: "reorder-above",
      siblingPos: posOf(state, 0),
      indent: 2,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { type: string; attrs?: { indent?: number } }[];
    };
    // New order: callout, a, b. Callout's indent forced to 0.
    expect(after.content[0]?.type).toBe("callout");
    expect(after.content[0]?.attrs?.indent).toBe(0);
    expect(after.content[1]?.type).toBe("paragraph");
    expect(after.content[2]?.type).toBe("paragraph");
  });

  it("reparent normalizes an existing non-zero callout indent back to 0", () => {
    // Pre-existing doc with a stored callout indent (cleanup-on-drop path).
    const state = makeDoc([callout("note", 3), p("trailing")]);
    const start = posOf(state, 0);
    const end = posOf(state, 1);
    const tr = applyIndentRunDrop(state, start, end, {
      kind: "reparent",
      indent: 0,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { type: string; attrs?: { indent?: number } }[];
    };
    expect(after.content[0]?.type).toBe("callout");
    expect(after.content[0]?.attrs?.indent).toBe(0);
  });

  it("collapsible CAN take a non-zero indent (its NodeView renders it)", () => {
    const state = makeDoc([p("host", 1), collapsible("toggle", 0)]);
    const start = posOf(state, 1);
    const end = state.doc.content.size;
    const tr = applyIndentRunDrop(state, start, end, {
      kind: "reorder-below",
      siblingPos: posOf(state, 0),
      indent: 2,
    });
    expect(tr).not.toBeNull();
    const after = assertTr(tr).doc.toJSON() as {
      content: { type: string; attrs?: { indent?: number } }[];
    };
    expect(after.content[1]?.type).toBe("collapsible");
    expect(after.content[1]?.attrs?.indent).toBe(2);
  });
});
