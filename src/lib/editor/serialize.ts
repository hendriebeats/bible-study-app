import { Node } from "prosemirror-model";
import { Step } from "prosemirror-transform";

import { schema } from "./schema";
import type { PMDocJSON, SerializedStep } from "./types";

/**
 * Thin (de)serialization helpers bound to the shared {@link schema}. Keeping
 * them in one place guarantees every doc/step crosses the JSON boundary against
 * the same schema. `fromJSON` throws on malformed input — callers that read
 * persisted/legacy data should guard and fall back to the nearest checkpoint.
 */

export function jsonToDoc(json: PMDocJSON): Node {
  return Node.fromJSON(schema, json);
}

export function docToJSON(doc: Node): PMDocJSON {
  return doc.toJSON() as PMDocJSON;
}

export function jsonToStep(json: SerializedStep): Step {
  return Step.fromJSON(schema, json);
}

export function stepToJSON(step: Step): SerializedStep {
  return step.toJSON() as SerializedStep;
}
