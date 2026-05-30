import Link from "next/link";

import { siteConfig } from "@/lib/site";

// Captured at module-load time (i.e. build time for the prerendered shell) so
// the footer is a fully-static Server Component. Under `cacheComponents: true`
// any inline `new Date()` reads runtime data and would require `'use cache'`
// or a client-component boundary; baking the year into the bundle avoids both.
// A redeploy each January is the trade-off.
const COPYRIGHT_YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-caption text-muted-foreground sm:flex-row">
        <p>
          © {String(COPYRIGHT_YEAR)} {siteConfig.name}. Built with care.
        </p>
        <nav className="flex items-center gap-4">
          <Link
            href="/login"
            className="transition-colors hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="transition-colors hover:text-foreground"
          >
            Get started
          </Link>
        </nav>
      </div>
    </footer>
  );
}
