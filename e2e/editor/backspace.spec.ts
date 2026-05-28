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
 * Smart-Backspace regression suite. Locks down progressive single-keystroke
 * dissolution of empty wrapped textblocks, so the schema rewrite has to
 * preserve this user-facing behavior even if the underlying nodes change.
 */

test.describe("smart backspace", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openFirstStudy(page);
    await focusEditor(page);
  });

  test("Backspace in empty bullet row → exits to plain paragraph (one step)", async ({
    page,
  }) => {
    await type(page, "- ");
    await press(page, "Backspace");
    const json = JSON.stringify(await readDocJSON(page));
    // Flat schema: an empty bullet row at indent 0 dissolves into a paragraph.
    expect(json).not.toContain('"type":"list_row"');
  });

  test("Backspace inside `> - ` empty bullet row → lifts one layer per press", async ({
    page,
  }) => {
    // Build a collapsible-wrapped bullet row, then empty it. Multi-layer
    // dissolve case the user explicitly described.
    await type(page, "> ");
    await type(page, "- ");
    // First Backspace removes the bullet listType (paragraph at indent 0).
    await press(page, "Backspace");
    let json = JSON.stringify(await readDocJSON(page));
    expect(json).not.toContain('"type":"list_row"');
    // Second Backspace removes the collapsible.
    await press(page, "Backspace");
    json = JSON.stringify(await readDocJSON(page));
    expect(json).not.toContain("collapsible");
  });

  test("Backspace on empty paragraph after a task list does NOT block forever", async ({
    page,
  }) => {
    // The earlier "refuse cross-structure join" guard would consume the key
    // and the user would be stuck. Verify Backspace makes SOMETHING happen
    // (cursor moves into the prior task, or doc shrinks).
    await type(page, "[ ] task");
    await press(page, "Enter"); // new task line
    await press(page, "Enter"); // exit list into empty paragraph at parent
    const before = JSON.stringify(await readDocJSON(page));
    await press(page, "Backspace");
    const after = JSON.stringify(await readDocJSON(page));
    expect(after).not.toBe(before);
  });
});
