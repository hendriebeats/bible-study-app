import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Editor test fixtures — locator helpers + doc-shape introspection so a test
 * can say "assert the current doc is `bullet_list[list_item[paragraph(\"a\")]]`"
 * without poking at ProseMirror internals each time.
 *
 * The introspection helpers go through `window.__PM_DEBUG__`, which we expose
 * from the editor host (see `e2e/README.md`) — a debug hook that returns the
 * focused EditorView's doc as JSON. This keeps the test surface a small,
 * stable shape.
 */

/**
 * The user's own editable ProseMirror surface — the one the keyboard fixtures
 * type into. In group studies the page renders multiple `.ProseMirror`
 * containers (other members' panes are read-only), so we filter to
 * `contenteditable="true"` to never grab one of those.
 */
export function editor(page: Page): Locator {
  return page.locator('.ProseMirror[contenteditable="true"]').first();
}

/**
 * Focus the editor and land the cursor on a fresh empty line at the bottom of
 * the doc. Most input-rule shortcuts (`- `, `# `, `[ ] `, …) anchor their
 * regex with `^`, so they only fire at the start of an empty textblock — if
 * the cursor lands mid-text from the click, the next keystroke is just typed
 * verbatim and the assertion fails. End → Enter guarantees a clean line.
 */
export async function focusEditor(page: Page): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.press("Enter");
}

/**
 * Open the first study card in the user's index — the entry point most
 * editor specs need. Targets `a[href^="/studies/"]` specifically so the
 * "Group studies" or "Trash" nav links don't accidentally win the selector.
 */
export async function openFirstStudy(page: Page): Promise<void> {
  await page.locator('a[href^="/studies/"]').first().click();
  // Wait for the editor to mount before returning (matches what the prior
  // ad-hoc beforeEach did inline).
  await page.locator(".ProseMirror").first().waitFor({ state: "visible" });
}

/**
 * Read the focused editor's doc as a structured JSON tree. Returns the same
 * shape `Node.toJSON()` produces. Tests can `expect(doc).toMatchObject(...)`
 * to assert structural shape.
 */
export async function readDocJSON(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __PM_DEBUG__?: { getDocJSON(): unknown };
    };
    if (!w.__PM_DEBUG__) {
      throw new Error(
        "__PM_DEBUG__ hook missing — editor host not running in test mode",
      );
    }
    return w.__PM_DEBUG__.getDocJSON();
  });
}

/**
 * Wait until the doc matches `matcher`. Useful right after a keystroke that
 * triggers an input rule, since the resulting tx is async w.r.t. the input.
 */
export async function expectDocEventually(
  page: Page,
  matcher: (doc: unknown) => boolean,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect
    .poll(async () => matcher(await readDocJSON(page)), {
      timeout: options.timeout ?? 5_000,
    })
    .toBeTruthy();
}

/** Type a string into the editor. Uses keyboard.type so React controlled
 *  inputs see every keystroke (per playwright-testing-notes.md). */
export async function type(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** Press a key (or chord). Thin wrapper kept for readability in specs. */
export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}
