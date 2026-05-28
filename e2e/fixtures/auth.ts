import { type Page } from "@playwright/test";

/**
 * Test users from CLAUDE.md. test1 is a regular user; test2 is a permanent
 * admin (see playwright-testing-notes.md). Use test2 only when admin power is
 * actually needed by the test.
 */
export const TEST_USERS = {
  test1: { email: "test1@gmail.com", password: "password" },
  test2: { email: "test2@gmail.com", password: "password" },
} as const;

/**
 * Sign in via the app's email/password form. Returns once the post-login
 * redirect has resolved. Tests should treat this as setup, not as an
 * assertion target.
 */
export async function signIn(
  page: Page,
  user: keyof typeof TEST_USERS = "test1",
): Promise<void> {
  const { email, password } = TEST_USERS[user];
  await page.goto("/login");
  // Use type() rather than fill() — controlled React inputs sometimes don't
  // see a `fill()`'s programmatic value (per playwright-testing-notes.md).
  await page.getByLabel(/email/i).click();
  await page.keyboard.type(email);
  await page.getByLabel(/password/i).click();
  await page.keyboard.type(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Wait for the post-login redirect to settle. The app currently lands on
  // /dashboard (which also lists the user's studies); accept either path so
  // the fixture survives a future route move.
  await page.waitForURL(/\/(dashboard|studies)(\/|$|\?)/, { timeout: 30_000 });
}
