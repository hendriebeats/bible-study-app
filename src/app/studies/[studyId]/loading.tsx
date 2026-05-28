/**
 * Required by Next 16 + `cacheComponents` for the studyId index page's
 * uncached `await`s to sit behind a Suspense boundary, but renders nothing
 * visible. Users usually never see this — they're redirected to the first
 * section within a single round trip. The dock's `MinePanel` owns the
 * visible body skeleton (same as the per-section loading.tsx).
 */
export default function Loading() {
  return null;
}
