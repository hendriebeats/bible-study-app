import type { Node, NodeType } from "prosemirror-model";

import { nodes } from "./schema";

/**
 * Node types whose FIRST child is conceptually "chrome" — the wrapper's
 * name / title / header — rather than a body block. The drag-handle and
 * drop-target logic treats chrome children specially so the user can't
 * grab a separate handle for the chrome (it belongs to the wrapper) and
 * drops into the wrapper's body don't inherit the chrome's indent.
 *
 * Members:
 *   * `collapsible` — index-0 is the toggle's clickable header.
 *   * `callout` — index-0 is the editable title (post-redesign). Treating
 *     it as chrome keeps callouts uniform with collapsibles for handle and
 *     indent purposes; the title remains text-editable.
 *
 * If a future wrapper type needs the same semantics, add it here and every
 * downstream check picks it up automatically.
 */
export const FIRST_CHILD_IS_CHROME: ReadonlySet<NodeType> = new Set<NodeType>([
  nodes.collapsible,
  nodes.callout,
]);

/** True when the child at `indexInParent` is the chrome of `parent`. */
export function isChromeChild(parent: Node, indexInParent: number): boolean {
  return indexInParent === 0 && FIRST_CHILD_IS_CHROME.has(parent.type);
}
