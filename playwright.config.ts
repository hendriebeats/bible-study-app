import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the editor regression suite. Tests live in `e2e/`
 * and target the local Next.js dev server (started automatically by Playwright).
 *
 * Test users (per CLAUDE.md):
 *   test1@gmail.com / password
 *   test2@gmail.com / password
 *
 * Run:
 *   npm run test:e2e          headless, all browsers
 *   npm run test:e2e:ui       interactive UI
 *   npm run test:e2e:debug    one browser, headed, breakpoints
 *
 * The webServer block boots `next dev` if no app is already listening on
 * :3000, so contributors don't have to remember to start it. CI gets a longer
 * boot timeout because next dev takes a moment to warm up.
 */
const PORT = Number(process.env.PORT ?? "3000");
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: "./e2e",
  // Trace every retry but keep traces only for failures so local runs aren't
  // disk-heavy.
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Editor tests are sensitive to caret position + DOM mutations; run them
  // sequentially within a file but allow parallel files.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  expect: {
    // Editor renders can be a tick slow on cold mount; give matchers more room.
    timeout: 8_000,
  },
  // Boot Next.js if it's not already running. `reuseExistingServer` keeps the
  // local DX nice — leaving `npm run dev` open speeds up subsequent runs.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180_000,
    env: {
      // The editor host installs `window.__PM_DEBUG__` only when this is set,
      // so e2e introspection helpers (e/fixtures/editor.ts) work.
      NEXT_PUBLIC_PM_DEBUG: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Firefox + WebKit can be added once the suite stabilises; ContentEditable
    // behaviour differs enough across engines that we want Chromium green
    // first.
  ],
});
