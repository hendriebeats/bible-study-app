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
  experimental: {
    // Tree-shake heavy barrel imports. `lucide-react` is already in Next's
    // built-in default list (see package-bundling.md), so it doesn't need to
    // be listed. `radix-ui` exports a large set of named subcomponents that
    // the app imports from selectively (Dialog, DropdownMenu, AlertDialog…),
    // so it benefits clearly from the same treatment.
    optimizePackageImports: ["radix-ui"],
  },
};

export default nextConfig;
