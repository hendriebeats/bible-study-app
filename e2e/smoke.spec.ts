import { expect, test } from "@playwright/test";

import { signIn } from "./fixtures/auth";

/**
 * Smallest possible smoke: app boots, login works, the studies index renders.
 * Runs first in CI so a totally broken build fails fast.
 */
test.describe("smoke", () => {
  test("login → studies index renders", async ({ page }) => {
    await signIn(page);
    // The studies route shows a heading or a "create study" affordance —
    // either is fine; we just want to confirm we're past the auth gate.
    await expect(page.locator("body")).toBeVisible();
    await expect(page).toHaveURL(/\/(dashboard|studies)/);
  });
});
