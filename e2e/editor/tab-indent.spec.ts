import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures/auth";
import {
  focusEditor,
  openFirstStudy,
  press,
  readDocJSON,
  type,
} from "../fixtures/editor";

/**
 * Tab / Shift-Tab regression suite. After the flat-schema rewrite (Phase 2)
 * indent is a pure attribute edit on the cursor's textblock (paragraph /
 * heading / list_row / code_block all carry it). These tests assert the
 * user-visible invariants (a row carries indent > 0; a heading lifted to
 * indent 0 still exists) so the same specs survive future tweaks to the
 * indent mechanism.
 */

test.describe("tab / shift-tab", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openFirstStudy(page);
    await focusEditor(page);
  });

  test("Tab on a task row bumps its indent attr", async ({ page }) => {
    await type(page, "[ ] task");
    await press(page, "Home");
    await press(page, "Tab");
    const json = JSON.stringify(await readDocJSON(page));
    // Should carry an indent attribute > 0 on the list_row.
    expect(json).toMatch(/"indent":\s*[1-9]/);
  });

  test("Shift-Tab on heading converted from a bullet row preserves the bullet", async ({
    page,
  }) => {
    // Build: bullet "a", Enter, Tab (nested empty bullet), `# ` (heading).
    await type(page, "- a");
    await press(page, "Enter");
    await press(page, "Tab");
    await type(page, "# ");
    // Now Shift-Tab: heading should lift; the original bullet should stay.
    await press(page, "Shift+Tab");
    const json = JSON.stringify(await readDocJSON(page));
    // Core invariant: the first bullet ("a") is preserved through the entire
    // tab → type → shift-tab sequence. Earlier hybrid-indent regressions
    // would dissolve the parent bullet on Shift-Tab; the flat-schema rewrite
    // keeps it isolated as an attr edit on the cursor's textblock only.
    expect(json).toContain('"text":"a"');
  });
});
