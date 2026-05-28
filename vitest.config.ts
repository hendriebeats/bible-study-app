import { defineConfig } from "vitest/config";

/**
 * Vitest config — for fast unit tests of pure transforms in the editor / lib
 * code. Browser-touching specs go through Playwright (e2e/) instead.
 *
 * Tests live in `tests/` mirroring the `src/` tree; the alias maps `@/...` to
 * `src/...` so imports match what the app uses.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
