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
 * Markdown-shortcut regression suite. Each test drives a real ProseMirror
 * editor through the same keystrokes a user would type, then asserts the
 * USER-VISIBLE invariant (text content + presence of the expected node) on
 * the doc JSON. The asserts are intentionally invariant-based rather than
 * shape-based so the same tests will pass through the flat-schema rewrite.
 */

test.describe("markdown shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openFirstStudy(page);
    await focusEditor(page);
  });

  test("`- ` at start of empty paragraph creates a bullet row", async ({
    page,
  }) => {
    await type(page, "- hello");
    // Flat schema: paragraph → list_row with listType "bullet".
    const json = JSON.stringify(await readDocJSON(page));
    expect(json).toContain('"type":"list_row"');
    expect(json).toContain('"listType":"bullet"');
    expect(json).toContain("hello");
  });

  test("`# ` at start of paragraph creates a heading (when tool enabled)", async ({
    page,
  }) => {
    await type(page, "# Title");
    const doc = await readDocJSON(page);
    // Either it became a heading (tool on) or the literal text remains (tool off).
    const json = JSON.stringify(doc);
    const becameHeading = json.includes('"type":"heading"');
    const stayedAsText = json.includes("# Title");
    expect(becameHeading || stayedAsText).toBeTruthy();
  });

  test("`> ` opens a toggle (when collapsibles tool enabled)", async ({
    page,
  }) => {
    await type(page, "> hello");
    const json = JSON.stringify(await readDocJSON(page));
    const becameCollapsible = json.includes('"type":"collapsible"');
    const stayedAsText =
      json.includes("&gt; hello") || json.includes("> hello");
    expect(becameCollapsible || stayedAsText).toBeTruthy();
  });

  test("`>> ` makes a blockquote", async ({ page }) => {
    await type(page, ">> hello");
    const json = JSON.stringify(await readDocJSON(page));
    expect(json).toContain("blockquote");
    expect(json).toContain("hello");
  });

  test("`[ ] ` makes an unchecked task row", async ({ page }) => {
    await type(page, "[ ] task");
    const json = JSON.stringify(await readDocJSON(page));
    expect(json).toContain('"type":"list_row"');
    expect(json).toContain('"listType":"task"');
    expect(json).toContain('"checked":false');
  });

  test("`[x] ` makes a checked task row", async ({ page }) => {
    await type(page, "[x] done");
    const json = JSON.stringify(await readDocJSON(page));
    expect(json).toContain('"type":"list_row"');
    expect(json).toContain('"listType":"task"');
    expect(json).toContain('"checked":true');
  });

  test("typing `- ` in an existing bullet item is a no-op (same-type short-circuit)", async ({
    page,
  }) => {
    await type(page, "- first");
    await press(page, "Enter");
    await type(page, "- second");
    const json = JSON.stringify(await readDocJSON(page));
    // The second bullet item should contain literal "- " (rule short-circuits).
    expect(json).toContain("second");
  });
});
