import type { NextConfig } from "next";

/**
 * Next.js config.
 *
 * Tweaks are intentionally conservative — anything `experimental.*` is verified
 * against `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/`
 * before going in. The `cacheComponents` migration (task #14) is deliberately
 * NOT enabled here yet; it needs its own dedicated pass with `<Suspense>`
 * boundaries audited across the app.
 */
const nextConfig: NextConfig = {
  // Cache Components: data fetching is dynamic by default, and the build/dev
  // overlay flags any uncached access that isn't wrapped in `<Suspense>` or
  // tagged with `'use cache'`. The payoff is:
  //   - layouts can stay dynamic without blocking child `loading.tsx`
  //   - <Activity> preserves component state across client navigation, which
  //     extends the read-along's keep-old-while-loading pattern app-wide
  //   - `unstable_instant` exports can validate per-route that navigation
  //     produces an instant static shell
  //
  // See node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md
  // for the migration guide that the rest of this codebase was audited against.
  cacheComponents: true,
  experimental: {
    // Tree-shake heavy barrel imports. `lucide-react` is already in Next's
    // built-in default list (see package-bundling.md), so it doesn't need to
    // be listed. `radix-ui` exports a large set of named subcomponents that
    // the app imports from selectively (Dialog, DropdownMenu, AlertDialog…),
    // so it benefits clearly from the same treatment.
    optimizePackageImports: ["radix-ui"],
    // Dev-only: surfaces the "Instant Navs" toggle in the Next.js DevTools so
    // we can freeze the UI at each route's static shell and verify the
    // skeleton it produces.
    instantNavigationDevToolsToggle: true,
  },
};

export default nextConfig;
