import { ChangeSet } from "prosemirror-changeset";
import type { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";

import { EMPTY_DOC } from "@/lib/db/types";
import type { DocumentCheckpointRow, DocumentStepRow } from "@/lib/db/types";

import { jsonToDoc, jsonToStep } from "./serialize";

function nearestCheckpoint(
  version: number,
  checkpoints: DocumentCheckpointRow[],
): DocumentCheckpointRow | null {
  let best: DocumentCheckpointRow | null = null;
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.version <= version &&
      (!best || checkpoint.version > best.version)
    ) {
      best = checkpoint;
    }
  }
  return best;
}

/**
 * Reconstruct the document at an arbitrary `version` by taking the nearest
 * checkpoint at or before it and replaying the steps up to that version. This
 * is what powers time-travel scrubbing in the history panel.
 */
export function reconstructDoc(
  version: number,
  checkpoints: DocumentCheckpointRow[],
  steps: DocumentStepRow[],
): Node {
  const checkpoint = nearestCheckpoint(version, checkpoints);
  const baseVersion = checkpoint?.version ?? 0;
  const transform = new Transform(jsonToDoc(checkpoint?.doc ?? EMPTY_DOC));
  for (const row of steps) {
    if (row.version > baseVersion && row.version <= version) {
      transform.step(jsonToStep(row.step));
    }
  }
  return transform.doc;
}

/**
 * Compute a "changes since this version" view: apply `steps` to `fromDoc` and
 * return the resulting doc plus decorations highlighting insertions (inline)
 * and deletions (struck-through widgets showing the removed text), via
 * prosemirror-changeset.
 */
export function diffSince(
  fromDoc: Node,
  steps: DocumentStepRow[],
): { doc: Node; decorations: DecorationSet } {
  const transform = new Transform(fromDoc);
  for (const row of steps) {
    transform.step(jsonToStep(row.step));
  }
  const changes = ChangeSet.create(fromDoc).addSteps(
    transform.doc,
    transform.mapping.maps,
    0,
  );

  const decorations: Decoration[] = [];
  for (const change of changes.changes) {
    if (change.toB > change.fromB) {
      decorations.push(
        Decoration.inline(change.fromB, change.toB, { class: "diff-insert" }),
      );
    }
    if (change.toA > change.fromA) {
      const removed = fromDoc.textBetween(change.fromA, change.toA, " ", " ");
      if (removed.length > 0) {
        decorations.push(
          Decoration.widget(
            change.fromB,
            () => {
              const span = document.createElement("span");
              span.className = "diff-delete";
              span.textContent = removed;
              return span;
            },
            { side: -1 },
          ),
        );
      }
    }
  }
  return {
    doc: transform.doc,
    decorations: DecorationSet.create(transform.doc, decorations),
  };
}
