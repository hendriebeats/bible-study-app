const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A short, human relative time like "2 days ago" for the studies list. Coarse
 * by design (minute → hour → day → week → month → year). Because it reads
 * `Date.now()`, render it with `suppressHydrationWarning` to avoid SSR/CSR
 * boundary mismatches.
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < HOUR) {
    const mins = Math.max(1, Math.round(diff / MINUTE));
    return mins === 1 ? "1 minute ago" : `${String(mins)} minutes ago`;
  }
  if (diff < DAY) {
    const hrs = Math.round(diff / HOUR);
    return hrs === 1 ? "1 hour ago" : `${String(hrs)} hours ago`;
  }
  const days = Math.round(diff / DAY);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${String(days)} days ago`;
  }
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "1 week ago" : `${String(weeks)} weeks ago`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? "1 month ago" : `${String(months)} months ago`;
  }
  const years = Math.round(days / 365);
  return years === 1 ? "1 year ago" : `${String(years)} years ago`;
}
