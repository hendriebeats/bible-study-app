/**
 * Single source of truth for top-level brand/site metadata.
 *
 * NOTE: `name` is a working placeholder ("Threshold") — change it here once
 * and it updates everywhere (page titles, nav, footer, auth screens).
 */
export const siteConfig = {
  name: "Threshold",
  tagline: "Step into Scripture — together.",
  description:
    "A warm, welcoming place to read and study the Bible at your own pace, on your own or alongside a group.",
  url: "http://localhost:3000",
} as const;

export type SiteConfig = typeof siteConfig;
