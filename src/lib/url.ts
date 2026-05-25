/**
 * The app's public base URL, used to build absolute OAuth/email redirect links.
 * Defaults to localhost for dev; set NEXT_PUBLIC_SITE_URL in production.
 */
export function getSiteURL(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
