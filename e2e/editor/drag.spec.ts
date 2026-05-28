import { expect, type Page, test } from "@playwright/test";

import { signIn } from "../fixtures/auth";
import {
  focusEditor,
  openFirstStudy,
  press,
  readDocJSON,
  type,
} from "../fixtures/editor";

/**
 * Phase 4d — hierarchical drag regression suite. Locks down the integration
 * between the editor's live state and the {@link applyIndentRunDrop} pure
 * transform that the pointer driver dispatches on pointerup.
 *
 * These tests deliberately bypass the DOM pointer events. Playwright's
 * `mouse.down/move/up` synthesizes pointer events but teleports to the
 * target — it can't traverse the gutter-hover bridge that surfaces the
 * block handle, so a "fully realistic" drag would be flaky AND would test
 * the bridge rather than the structural drop. Instead we drive the drop
 * through `window.__PM_DEBUG__.simulateBlockDrop(...)`, which runs the same
 * `applyIndentRunDrop` call the pointer driver dispatches on pointerup —
 * giving us deterministic coverage of the drop's structural outcome while
 * leaving pointer-event integration to manual QA.
 *
 * The pure-function behaviour itself (indent-run capture + rewrite +
 * clamp) is exhaustively covered by `tests/indent-run.test.ts` under
 * vitest — these specs only verify the wiring lands in a live editor.
 */

interface DropResult {
  ok: boolean;
}

async function simulateBlockDrop(
  page: Page,
  sourceStart: number,
  sourceEnd: number,
  targetPos: number,
  targetIndent: number,
): Promise<DropResult> {
  return page.evaluate(
    ({ sourceStart, sourceEnd, targetPos, targetIndent }) => {
      const w = window as unknown as {
        __PM_DEBUG__?: {
          simulateBlockDrop: (
            a: number,
            b: number,
            c: number,
            d: number,
          ) => boolean;
        };
      };
      if (!w.__PM_DEBUG__) return { ok: false };
      return {
        ok: w.__PM_DEBUG__.simulateBlockDrop(
          sourceStart,
          sourceEnd,
          targetPos,
          targetIndent,
        ),
      };
    },
    { sourceStart, sourceEnd, targetPos, targetIndent },
  );
}

/** Locate a top-level block by its first text content, returning its [pos, end). */
async function findBlock(
  page: Page,
  needle: string,
): Promise<{ start: number; end: number } | null> {
  return page.evaluate((needle) => {
    const w = window as unknown as {
      __PM_DEBUG__?: { getView: () => { state: { doc: unknown } } | null };
    };
    const view = w.__PM_DEBUG__?.getView();
    if (!view) return null;
    const state = view.state as {
      doc: {
        descendants: (
          cb: (node: unknown, pos: number) => boolean | undefined,
        ) => void;
      };
    };
    let hit: { start: number; end: number } | null = null;
    state.doc.descendants((node, pos) => {
      if (hit) return false;
      const n = node as {
        isTextblock?: boolean;
        nodeSize: number;
        textContent: string;
      };
      if (n.isTextblock && n.textContent.includes(needle)) {
        hit = { start: pos, end: pos + n.nodeSize };
        return false;
      }
      return undefined;
    });
    return hit;
  }, needle);
}

test.describe("hierarchical block drag", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openFirstStudy(page);
    await focusEditor(page);
  });

  test("simulateBlockDrop helper is wired into the focused editor", async ({
    page,
  }) => {
    // Type two paragraphs, look them up, swap them via simulateBlockDrop,
    // assert the visible text order flipped. Smoke test for the wiring.
    await type(page, "PWDRAG_alpha");
    await press(page, "Enter");
    await type(page, "PWDRAG_beta");

    const alpha = await findBlock(page, "PWDRAG_alpha");
    const beta = await findBlock(page, "PWDRAG_beta");
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    if (!alpha || !beta) throw new Error("expected both paragraphs to exist");

    // Drop alpha after beta. Target is beta's end position.
    const result = await simulateBlockDrop(
      page,
      alpha.start,
      alpha.end,
      beta.end,
      0,
    );
    expect(result.ok).toBe(true);
    const json = JSON.stringify(await readDocJSON(page));
    const alphaIdx = json.indexOf("PWDRAG_alpha");
    const betaIdx = json.indexOf("PWDRAG_beta");
    expect(alphaIdx).toBeGreaterThan(betaIdx);
  });

  test("drag a bullet with its indented child moves both together", async ({
    page,
  }) => {
    // Build: bullet "ROOT_pwdrag", new line, Tab, bullet "CHILD_pwdrag",
    // new line, paragraph "ANCHOR_pwdrag" at indent 0 (so the run stops).
    await type(page, "- ROOT_pwdrag");
    await press(page, "Enter");
    await press(page, "Tab");
    await type(page, "child_pwdrag");
    await press(page, "Enter");
    await press(page, "Shift+Tab");
    await type(page, "ANCHOR_pwdrag");

    const root = await findBlock(page, "ROOT_pwdrag");
    const anchor = await findBlock(page, "ANCHOR_pwdrag");
    expect(root).not.toBeNull();
    expect(anchor).not.toBeNull();
    if (!root || !anchor) throw new Error("expected blocks to exist");

    // The run starts at the root and ends at the anchor (anchor stops it
    // because it's at the same indent as ROOT). Drop the whole run AFTER
    // the anchor at indent 0.
    const runEnd = anchor.start; // anchor itself is NOT in the run
    const result = await simulateBlockDrop(
      page,
      root.start,
      runEnd,
      anchor.end,
      0,
    );
    expect(result.ok).toBe(true);
    const json = JSON.stringify(await readDocJSON(page));
    // After the drop, anchor comes BEFORE root, and root still has child
    // following it as a child (indent 1). We assert relative order by
    // looking at indexOf positions in the serialized doc.
    const anchorIdx = json.indexOf("ANCHOR_pwdrag");
    const rootIdx = json.indexOf("ROOT_pwdrag");
    const childIdx = json.indexOf("child_pwdrag");
    expect(anchorIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeGreaterThan(anchorIdx);
    expect(childIdx).toBeGreaterThan(rootIdx);
    // Child should still carry indent 1 (relative depth preserved). PMDoc
    // serializes attrs BEFORE content, so the regex looks for indent:1
    // followed within the same list_row by the text.
    expect(json).toMatch(/"indent":1[\s\S]{0,200}"text":"child_pwdrag"/);
  });

  test("simulateBlockDrop returns false for an invalid range", async ({
    page,
  }) => {
    await type(page, "PWDRAG_solo");
    // Target sits inside source — invalid, should noop.
    const block = await findBlock(page, "PWDRAG_solo");
    expect(block).not.toBeNull();
    if (!block) throw new Error("expected block to exist");
    const targetInsideSource = (block.start + block.end) >> 1;
    const result = await simulateBlockDrop(
      page,
      block.start,
      block.end,
      targetInsideSource,
      0,
    );
    expect(result.ok).toBe(false);
  });
});
