import { BodySkeleton } from "@/components/studies/body-skeleton";
import { ToolbarSkeleton } from "@/components/studies/editor-skeletons";

/**
 * Single persistent loading overlay that covers the toolbar and body regions
 * of the studies chrome during cold load. Rendered as a SIBLING of the
 * layout's Suspense boundary so it never unmounts — when the chrome takes
 * over from `<StudyLayoutSkeleton>`, this overlay stays put. That means the
 * skeleton elements (and their `animate-pulse` keyframes) don't restart on
 * the handoff: previously the user saw a perceptible "animation reset" /
 * "two different skeletons" because the layout-skel's body/toolbar skeletons
 * unmounted and the chrome's mounted fresh, snapping the pulse back to phase 0.
 *
 * Hidden via a CSS rule keyed on `body[data-studies-body-ready="true"]`,
 * which `<WorkspaceInner>` sets once the first editor view registers
 * (`editorContext.activeView != null`). Pointer-events are disabled so
 * click-through to the real toolbar/editor works during the fade-out.
 *
 * Positioning uses CSS calc relative to the chrome's structural heights:
 *   - top-12   (48px) = below the chrome header
 *   - top-21   (84px) = below header (48) + toolbar slot (36, `min-h-9`)
 *   - left-64  (256px) = right of the sidebar
 *
 * Keep these in sync with `study-chrome.tsx`'s header/toolbar/sidebar
 * dimensions and with `study-layout-skeleton.tsx`'s matching structure.
 */
export function StudiesLoadingOverlay() {
  return (
    <div
      data-studies-loading-overlay
      aria-hidden
      className="pointer-events-none fixed inset-0 z-10"
    >
      {/* Toolbar slot cover — same wrapper classes as the chrome's slot so
          the bg + border match exactly when the real toolbar fades in
          behind it. */}
      <div className="absolute top-12 right-0 left-0 border-b border-border/60 bg-background">
        <ToolbarSkeleton />
      </div>
      {/* Body cover — sits below the header + toolbar row, right of the
          sidebar. White bg matches the editor's body in the loaded state.
          `top-21` (84px) = header 48 + toolbar 36; keep in sync with the
          chrome's `min-h-9` toolbar slot. */}
      <div className="absolute top-21 right-0 bottom-0 left-64 bg-white">
        <BodySkeleton />
      </div>
    </div>
  );
}
