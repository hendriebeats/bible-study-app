/**
 * Shared types for the ProseMirror-based study editor.
 *
 * These describe the JSON shapes we serialize to / from the database and the
 * wire. They are deliberately decoupled from any editor library (we build on
 * bare ProseMirror, not Tiptap). More transport types (step batches, cursor
 * payloads, realtime broadcast events) are added alongside their first use in
 * later phases.
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
