import { Node } from "prosemirror-model";
import { Step } from "prosemirror-transform";

import { schema } from "./schema";
import type { PMDocJSON, SerializedStep } from "./types";

/**
 * Thin (de)serialization helpers bound to the shared {@link schema}. Keeping
 * them in one place guarantees every doc/step crosses the JSON boundary against
 * the same schema. `fromJSON` throws on malformed input — callers that read
 * persisted/legacy data should guard and fall back to the nearest checkpoint.
 *
 * NOTE: ProseMirror builds a node's `attrs` with `Object.create(null)` (a
 * null-prototype object). Those do NOT survive React Server Action argument
 * serialization (the nested `attrs` get silently dropped), which would strip
 * node attributes like a study block's `label` on the way to the server. We
 * round-trip through `JSON.parse(JSON.stringify(...))` here to normalize every
 * serialized doc/step into plain objects before it can cross that boundary.
 */

function toPlainJSON(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function jsonToDoc(json: PMDocJSON): Node {
  return Node.fromJSON(schema, json);
}

export function docToJSON(doc: Node): PMDocJSON {
  return toPlainJSON(doc.toJSON()) as PMDocJSON;
}

export function jsonToStep(json: SerializedStep): Step {
  return Step.fromJSON(schema, json);
}

export function stepToJSON(step: Step): SerializedStep {
  return toPlainJSON(step.toJSON()) as SerializedStep;
}
