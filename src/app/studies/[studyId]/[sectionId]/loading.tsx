/**
 * Required by Next 16 + `cacheComponents` for the section page's uncached
 * `await`s to sit behind a Suspense boundary, but renders nothing visible.
 *
 * The body's loading skeleton is owned by the dock's `MinePanel` (which gates
 * on `urlSectionId !== active?.section.id || !editorReady` and renders
 * `<BodySkeleton />`). The dock is rendered ALONGSIDE this route's children
 * inside `WorkspaceInner`, so if this file also rendered a `<BodySkeleton />`
 * we'd see two stacked. One source of truth — and it lives where the editor
 * itself eventually mounts.
 */
export default function Loading() {
  return null;
}
