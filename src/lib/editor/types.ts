/**
 * Shared types for the ProseMirror-based study editor.
 *
 * These describe the JSON shapes we serialize to / from the database and the
 * wire. They are deliberately decoupled from any editor library (we build on
 * bare ProseMirror). More transport types (step batches, cursor payloads,
 * realtime broadcast events) are added alongside their first use in later
 * phases.
 */

/** A serialized ProseMirror mark (the shape of `Mark.toJSON()`). */
export interface PMMarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A serialized ProseMirror node (the shape of `Node.toJSON()`). */
export interface PMNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodeJSON[];
  marks?: PMMarkJSON[];
  text?: string;
}

/** A serialized ProseMirror document — a root node with `type: "doc"`. */
export type PMDocJSON = PMNodeJSON;

/** A serialized ProseMirror `Step` (the shape of `Step.toJSON()`). */
export interface SerializedStep {
  stepType: string;
  [key: string]: unknown;
}

/**
 * A batch of steps the writer broadcasts for live read-along. `base` is the
 * version the steps build on; `version` is the resulting head. Viewers apply
 * only when `base` matches their current version, else they resync.
 */
export interface StepsPayload {
  base: number;
  steps: SerializedStep[];
  version: number;
}

/** The writer's live cursor/selection (document positions valid at `version`). */
export interface CursorPayload {
  anchor: number;
  head: number;
  version: number;
  /** Writer's display name + color, for a labeled remote caret on viewers. */
  name?: string;
  color?: string;
}
