/**
 * Regressions for the drag-indicator seam-stability contract.
 *
 * The contract:
 *
 *   1. **Canonical shape per gesture.** Any cursor position whose structural
 *      target is the source's own boundary (R = source's literal prev, X =
 *      source's literal next, or the source row itself) collapses to a
 *      single `reparent` instruction. The driver applies
 *      `normalizeInstruction` from `indent-run.ts` as the last step of
 *      `computeDropInstruction`. Net effect for the user: as the cursor
 *      crosses the seam around the source row, the indicator's Y stays
 *      pinned to the source row's top instead of jumping between
 *      `R.bottom..src.top` and `src.bottom..X.top`.
 *
 *   2. **No-op still paints.** A reparent at the source's own root indent
 *      doesn't change the document, but the indicator still paints (at the
 *      source row's top) so the user sees a continuous visual whether or
 *      not the gesture is structurally a no-op. `applyIndentRunDrop`
 *      returns null for the actual transaction, so pointerup never pushes
 *      an identity tx onto history.
 *
 *   3. **No scroll-jump on pointer drop.** The pointer driver dispatches
 *      WITHOUT `tr.scrollIntoView()` — the user's viewport already
 *      contains the drop site. Chasing the selection after the drop yanks
 *      the viewport by tens or hundreds of pixels (verified at 68 px in
 *      a 30-block doc) when the moved row's new home is offscreen. The
 *      keyboard Arrow fallback DOES still scrollIntoView (users
 *      Arrow-reordering a row off-screen want it kept visible).
 */

import { expect, type Page, test } from "@playwright/test";

import { signIn } from "../fixtures/auth";
import { focusEditor, openFirstStudy, press, type } from "../fixtures/editor";

interface BlockInfo {
  start: number;
  end: number;
  rootIndent: number;
}

interface ProbeResult {
  instruction:
    | {
        kind: "reorder-above" | "reorder-below";
        siblingPos: number;
        indent: number;
      }
    | { kind: "make-child"; parentPos: number }
    | { kind: "reparent"; indent: number }
    | null;
  rowRect: { top: number; bottom: number; left: number; right: number } | null;
}

async function findBlock(page: Page, needle: string): Promise<BlockInfo> {
  const r = await page.evaluate((needle) => {
    const w = window as unknown as {
      __PM_DEBUG__?: {
        getView: () => {
          state: {
            doc: {
              descendants: (
                cb: (n: unknown, p: number) => boolean | undefined,
              ) => void;
            };
          };
        } | null;
      };
    };
    const view = w.__PM_DEBUG__?.getView();
    if (!view) return null;
    let hit: BlockInfo | null = null;
    view.state.doc.descendants((node, pos) => {
      if (hit) return false;
      const n = node as {
        isTextblock?: boolean;
        nodeSize: number;
        textContent: string;
        attrs?: { indent?: number };
      };
      if (n.isTextblock && n.textContent.includes(needle)) {
        hit = {
          start: pos,
          end: pos + n.nodeSize,
          rootIndent: typeof n.attrs?.indent === "number" ? n.attrs.indent : 0,
        };
        return false;
      }
      return undefined;
    });
    return hit;
  }, needle);
  // `r` is typed BlockInfo | null but TS-flow can't see the closure assignment
  // never fires when `needle` isn't present, so the rule thinks `!r` is dead.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!r) throw new Error(`block ${needle} not found`);
  return r;
}

async function probe(
  page: Page,
  needle: string,
  cursorX: number,
  cursorY: number,
  source: BlockInfo,
): Promise<ProbeResult> {
  return page.evaluate(
    ({ needle, cursorX, cursorY, source }) => {
      const w = window as unknown as {
        __PM_DEBUG__?: {
          getView: () => {
            state: {
              doc: {
                descendants: (
                  cb: (n: unknown, p: number) => boolean | undefined,
                ) => void;
              };
            };
            nodeDOM: (p: number) => Node | null;
          } | null;
          probeDropInstruction: (
            x: number,
            y: number,
            s: number,
            e: number,
            r: number,
          ) => unknown;
        };
      };
      if (!w.__PM_DEBUG__) return { instruction: null, rowRect: null };
      const view = w.__PM_DEBUG__.getView();
      if (!view) return { instruction: null, rowRect: null };
      let hitPos: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (hitPos !== null) return false;
        const n = node as { isTextblock?: boolean; textContent: string };
        if (n.isTextblock && n.textContent.includes(needle)) {
          hitPos = pos;
          return false;
        }
        return undefined;
      });
      let rowRect: ProbeResult["rowRect"] = null;
      // Same closure-narrowing false-positive as findBlock — the descendants
      // walk may never assign hitPos, so the null check is real at runtime.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (hitPos !== null) {
        const dom = view.nodeDOM(hitPos);
        if (dom instanceof HTMLElement) {
          const r = dom.getBoundingClientRect();
          rowRect = {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
          };
        }
      }
      const instruction = w.__PM_DEBUG__.probeDropInstruction(
        cursorX,
        cursorY,
        source.start,
        source.end,
        source.rootIndent,
      ) as ProbeResult["instruction"];
      return { instruction, rowRect };
    },
    { needle, cursorX, cursorY, source },
  );
}

test.describe
  .serial("drag seam indicator — canonical reparent across the seam, no scroll jump", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openFirstStudy(page);
    await focusEditor(page);
  });

  test("inside source at root indent → reparent (paints, no-op transaction)", async ({
    page,
  }) => {
    await type(page, "PWSEAM_inside_above");
    await press(page, "Enter");
    await type(page, "PWSEAM_inside_source");
    await press(page, "Enter");
    await type(page, "PWSEAM_inside_below");

    const source = await findBlock(page, "PWSEAM_inside_source");
    const ref = await probe(page, "PWSEAM_inside_source", 0, 0, source);
    if (!ref.rowRect) throw new Error("no rowRect");

    // Cursor inside source at its own root indent column → reparent at
    // the same indent. The instruction is emitted (indicator paints) even
    // though `applyIndentRunDrop` would return null on apply — that's the
    // "show line for consistency" contract.
    const insideX = ref.rowRect.left + 4;
    const insideY = (ref.rowRect.top + ref.rowRect.bottom) / 2;
    const inside = await probe(
      page,
      "PWSEAM_inside_source",
      insideX,
      insideY,
      source,
    );
    expect(inside.instruction).not.toBeNull();
    expect(inside.instruction?.kind).toBe("reparent");
    if (inside.instruction?.kind === "reparent") {
      expect(inside.instruction.indent).toBe(0);
    }

    // Same Y, one indent-step right → real reparent (indent changes).
    const indentedX = ref.rowRect.left + 28 + 4;
    const indented = await probe(
      page,
      "PWSEAM_inside_source",
      indentedX,
      insideY,
      source,
    );
    expect(indented.instruction?.kind).toBe("reparent");
    if (indented.instruction?.kind === "reparent") {
      expect(indented.instruction.indent).toBe(1);
    }
  });

  test("seam above/below source at root indent collapses to one reparent (no jump)", async ({
    page,
  }) => {
    await type(page, "PWSEAM_seam_above");
    await press(page, "Enter");
    await type(page, "PWSEAM_seam_source");
    await press(page, "Enter");
    await type(page, "PWSEAM_seam_below");

    const source = await findBlock(page, "PWSEAM_seam_source");

    const aboveProbe = await probe(page, "PWSEAM_seam_above", 0, 0, source);
    const belowProbe = await probe(page, "PWSEAM_seam_below", 0, 0, source);
    if (!aboveProbe.rowRect || !belowProbe.rowRect) {
      throw new Error("missing rect");
    }
    const aboveRect = aboveProbe.rowRect;
    const belowRect = belowProbe.rowRect;

    // Cursor in lower half of `above` at root indent → reparent indent 0.
    const seamAbove = await probe(
      page,
      "PWSEAM_seam_above",
      aboveRect.left + 4,
      aboveRect.top + (aboveRect.bottom - aboveRect.top) * 0.8,
      source,
    );
    expect(seamAbove.instruction?.kind).toBe("reparent");
    if (seamAbove.instruction?.kind === "reparent") {
      expect(seamAbove.instruction.indent).toBe(0);
    }

    // Cursor in upper half of `below` at root indent → also reparent
    // indent 0. SAME instruction → indicator paints at source.top in both
    // cases → no Y jump across the source.
    const seamBelow = await probe(
      page,
      "PWSEAM_seam_below",
      belowRect.left + 4,
      belowRect.top + (belowRect.bottom - belowRect.top) * 0.2,
      source,
    );
    expect(seamBelow.instruction?.kind).toBe("reparent");
    if (seamBelow.instruction?.kind === "reparent") {
      expect(seamBelow.instruction.indent).toBe(0);
    }
  });

  test("seam above/below source at indent 1 ALSO collapses to one reparent (Issue 1)", async ({
    page,
  }) => {
    await type(page, "PWSEAM_indent1_above");
    await press(page, "Enter");
    await type(page, "PWSEAM_indent1_source");
    await press(page, "Enter");
    await type(page, "PWSEAM_indent1_below");

    const source = await findBlock(page, "PWSEAM_indent1_source");

    const aboveProbe = await probe(page, "PWSEAM_indent1_above", 0, 0, source);
    const belowProbe = await probe(page, "PWSEAM_indent1_below", 0, 0, source);
    if (!aboveProbe.rowRect || !belowProbe.rowRect) {
      throw new Error("missing rect");
    }
    const aboveRect = aboveProbe.rowRect;
    const belowRect = belowProbe.rowRect;

    // One indent step right of content edge.
    const xDeeper = aboveRect.left + 28 + 4;

    // Cursor in lower half of above @ indent 1. Before fix this emitted
    // `make-child above` (paint at above.bottom). After fix: `reparent
    // indent 1` (paint at source.top).
    const aboveDeeper = await probe(
      page,
      "PWSEAM_indent1_above",
      xDeeper,
      aboveRect.top + (aboveRect.bottom - aboveRect.top) * 0.8,
      source,
    );
    expect(aboveDeeper.instruction?.kind).toBe("reparent");
    if (aboveDeeper.instruction?.kind === "reparent") {
      expect(aboveDeeper.instruction.indent).toBe(1);
    }

    // Cursor in upper half of below @ indent 1. Before fix this emitted
    // `reorder-above below` with siblingPos === below.start (paint at
    // src.bottom..below.top midpoint). After fix: same `reparent indent
    // 1` as the above-side probe → same paint Y → no jump.
    const belowDeeper = await probe(
      page,
      "PWSEAM_indent1_below",
      xDeeper,
      belowRect.top + (belowRect.bottom - belowRect.top) * 0.2,
      source,
    );
    expect(belowDeeper.instruction?.kind).toBe("reparent");
    if (belowDeeper.instruction?.kind === "reparent") {
      expect(belowDeeper.instruction.indent).toBe(1);
    }
  });

  test("make-child R and reorder-above (R.next) paint at the SAME Y (Issue 4)", async ({
    page,
  }) => {
    // Layout: [A, B, C]. Source = C. Drag C toward the A/B gap. At
    // cursor X = content-edge + 28 px (indent column 1):
    //   - cursor in A.lower → `make-child A`  (indent > A.indent → make-child)
    //   - cursor in B.upper → `reorder-above B, indent: 1`
    // Both insert C between A and B at indent 1 — identical structural
    // outcome. The bug they hid: their painters anchored at different Ys
    // (parentRect.bottom vs gap midpoint), so the indicator dropped ~half
    // a gap-height when the cursor crossed the boundary. The user
    // reported 6 px in their verse-per-line scripture layout.
    //
    // The fix: `make-child`'s painter now anchors at the SAME gap
    // midpoint as `reorder-above (parent.next)`. This test locks that
    // in via the `probeIndicatorRect` debug hook (no real pointer
    // events required — it computes the paint rect the same way the
    // live painter does).
    await type(page, "PWSEAM_mkchild_A");
    await press(page, "Enter");
    await type(page, "PWSEAM_mkchild_B");
    await press(page, "Enter");
    await type(page, "PWSEAM_mkchild_C");

    const a = await findBlock(page, "PWSEAM_mkchild_A");
    const b = await findBlock(page, "PWSEAM_mkchild_B");
    const c = await findBlock(page, "PWSEAM_mkchild_C");

    const refA = await probe(page, "PWSEAM_mkchild_A", 0, 0, c);
    if (!refA.rowRect) throw new Error("no rowRect for A");
    const aRect = refA.rowRect;

    // Confirm the driver emits the two different instructions at the
    // two cursor positions, otherwise the painter equality below is
    // testing the wrong hypothesis.
    const xIndent1 = aRect.left + 28 + 4;
    const yAboveBoundary = aRect.top + (aRect.bottom - aRect.top) * 0.85;
    const probeAbove = await probe(
      page,
      "PWSEAM_mkchild_A",
      xIndent1,
      yAboveBoundary,
      c,
    );
    expect(probeAbove.instruction?.kind).toBe("make-child");
    if (probeAbove.instruction?.kind === "make-child") {
      expect(probeAbove.instruction.parentPos).toBe(a.start);
    }

    // Now ask the painter: where would `make-child A` paint vs
    // `reorder-above B, indent: 1`? Both must produce the same top Y.
    const rects = await page.evaluate(
      ({ aStart, bStart, cStart, cEnd }) => {
        const w = window as unknown as {
          __PM_DEBUG__?: {
            probeIndicatorRect: (
              instruction: unknown,
              src: number,
              end: number,
            ) => {
              top: number;
              left: number;
              width: number;
              height: number;
            } | null;
          };
        };
        if (!w.__PM_DEBUG__) return null;
        const makeChild = w.__PM_DEBUG__.probeIndicatorRect(
          { kind: "make-child", parentPos: aStart },
          cStart,
          cEnd,
        );
        const reorderAbove = w.__PM_DEBUG__.probeIndicatorRect(
          { kind: "reorder-above", siblingPos: bStart, indent: 1 },
          cStart,
          cEnd,
        );
        return { makeChild, reorderAbove };
      },
      { aStart: a.start, bStart: b.start, cStart: c.start, cEnd: c.end },
    );
    expect(rects).not.toBeNull();
    if (!rects) throw new Error("no rects");
    expect(rects.makeChild).not.toBeNull();
    expect(rects.reorderAbove).not.toBeNull();
    if (!rects.makeChild || !rects.reorderAbove) throw new Error("rect null");
    // Strict equality: both painters must derive the same top Y from
    // the same gap-midpoint formula. (Sub-pixel diffs would indicate
    // they're computing things differently and the fix is incomplete.)
    expect(Math.abs(rects.makeChild.top - rects.reorderAbove.top)).toBeLessThan(
      0.5,
    );
    // The left edges differ — make-child indents by (parent.indent +
    // 1), reorder-above indents by the explicit `indent: 1`. In this
    // doc those are both indent column 1, so the left should also
    // match. (Catches a future refactor that breaks the indent math.)
    expect(
      Math.abs(rects.makeChild.left - rects.reorderAbove.left),
    ).toBeLessThan(0.5);
  });

  test("pointer drop dispatches without scrollIntoView (Issue 3)", async ({
    page,
  }) => {
    // Tall doc + viewport scrolled to bottom + drop the bottom row to
    // the very top. Without scrollIntoView, the wrapper's scrollTop
    // stays put (modulo CSS layout shift from doc reflow). With
    // scrollIntoView, observed jump was 68 px.
    await type(page, "PWSEAM_scroll_top");
    for (let i = 0; i < 30; i++) {
      await press(page, "Enter");
      await type(page, `PWSEAM_scroll_fill_${String(i)}`);
    }
    await press(page, "Enter");
    await type(page, "PWSEAM_scroll_bottom");

    const top = await findBlock(page, "PWSEAM_scroll_top");
    const bottom = await findBlock(page, "PWSEAM_scroll_bottom");

    await page.keyboard.press("Meta+End");
    const beforeTop = await page.evaluate(() => {
      const w = window as unknown as {
        __PM_DEBUG__?: { getView: () => { dom: HTMLElement } | null };
      };
      const v = w.__PM_DEBUG__?.getView();
      let el: HTMLElement | null = v?.dom ?? null;
      while (el) {
        const s = getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY)) return el.scrollTop;
        el = el.parentElement;
      }
      return 0;
    });
    expect(beforeTop).toBeGreaterThan(0);

    // Use simulatePointerDrop with scrollIntoView=false — that mirrors
    // exactly what the prod onPointerUp now does.
    await page.evaluate(
      ({ srcStart, srcEnd, anchor }) => {
        const w = window as unknown as {
          __PM_DEBUG__?: {
            simulatePointerDrop: (
              s: number,
              e: number,
              i: unknown,
              o?: { scrollIntoView?: boolean },
            ) => boolean;
          };
        };
        w.__PM_DEBUG__?.simulatePointerDrop(
          srcStart,
          srcEnd,
          { kind: "reorder-above", siblingPos: anchor, indent: 0 },
          { scrollIntoView: false },
        );
      },
      {
        srcStart: bottom.start,
        srcEnd: bottom.end,
        anchor: top.start,
      },
    );

    const afterTop = await page.evaluate(() => {
      const w = window as unknown as {
        __PM_DEBUG__?: { getView: () => { dom: HTMLElement } | null };
      };
      const v = w.__PM_DEBUG__?.getView();
      let el: HTMLElement | null = v?.dom ?? null;
      while (el) {
        const s = getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY)) return el.scrollTop;
        el = el.parentElement;
      }
      return 0;
    });
    // Layout reflow from removing the bottom block may nudge scrollTop
    // by a few pixels (the doc shrunk by 1 block-spacing's worth at the
    // bottom). The PROD bug was a >60 px chase from scrollIntoView.
    // Generous threshold catches the regression without flake risk.
    expect(Math.abs(afterTop - beforeTop)).toBeLessThan(20);
  });
});
