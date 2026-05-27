import { undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Command, EditorState, Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { verseRedo, verseUndo } from "./plugins/verse-guard";

/** Number of undoable groups in a state (prosemirror-history types this `any`). */
function depthOf(state: EditorState): number {
  return undoDepth(state) as number;
}

/**
 * Section-wide undo/redo across a section's two editors (Study Body + Study
 * blocks). ProseMirror's history is per-`EditorState`, so this coordinator
 * tracks the chronological order of undoable groups across both views and routes
 * Cmd-Z / Cmd-Y to the view that produced the most recent one — making the
 * section behave like a single document.
 *
 * Detection rides each view's own history: a transaction that grows a view's
 * `undoDepth` started a new undoable group, so we push that view onto the global
 * stack (and a fresh edit clears the redo stack). When the global stack is empty
 * — e.g. for history replayed on page load, before any edit this session — the
 * keymap commands return false and the per-editor undo (the next keymap) runs.
 * A module singleton: there is one section editing surface at a time.
 */

const undoStack: EditorView[] = [];
const redoStack: EditorView[] = [];
const depth = new Map<EditorView, number>();
// True while we drive an undo/redo, so the resulting transaction's depth change
// isn't mistaken for a fresh edit.
let driving = false;

function dropLast(stack: EditorView[], view: EditorView): void {
  const i = stack.lastIndexOf(view);
  if (i >= 0) {
    stack.splice(i, 1);
  }
}

/** Start tracking a view; its baseline depth is whatever history it loaded with
 * (replayed steps), which stays out of the global stack and falls back to local
 * undo. */
export function registerUndoView(view: EditorView): void {
  depth.set(view, depthOf(view.state));
}

export function unregisterUndoView(view: EditorView): void {
  depth.delete(view);
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i] === view) undoStack.splice(i, 1);
  }
  for (let i = redoStack.length - 1; i >= 0; i--) {
    if (redoStack[i] === view) redoStack.splice(i, 1);
  }
}

/** Record a view's post-transaction state into the global order. */
export function recordUndo(view: EditorView, state: EditorState): void {
  const now = depthOf(state);
  if (driving) {
    depth.set(view, now);
    return;
  }
  const prev = depth.get(view) ?? 0;
  if (now > prev) {
    for (let i = prev; i < now; i++) {
      undoStack.push(view);
    }
    redoStack.length = 0; // a fresh edit invalidates the redo chain
  } else if (now < prev) {
    // History shrank outside our control (rare); keep the stack consistent.
    for (let i = now; i < prev; i++) {
      dropLast(undoStack, view);
    }
  }
  depth.set(view, now);
}

/** Undo the most recent edit across both editors. Returns false when the global
 * stack is empty (so the caller can fall back to per-editor undo). */
export function sectionUndo(): boolean {
  const view = undoStack[undoStack.length - 1];
  if (!view) {
    return false;
  }
  driving = true;
  const ok = verseUndo(view.state, view.dispatch, view);
  driving = false;
  if (!ok) {
    // Stale entry; drop it and stop (avoid looping).
    undoStack.pop();
    depth.set(view, depthOf(view.state));
    return false;
  }
  undoStack.pop();
  depth.set(view, depthOf(view.state));
  redoStack.push(view);
  view.focus();
  return true;
}

/** Redo the most recently undone edit across both editors. */
export function sectionRedo(): boolean {
  const view = redoStack[redoStack.length - 1];
  if (!view) {
    return false;
  }
  driving = true;
  const ok = verseRedo(view.state, view.dispatch, view);
  driving = false;
  if (!ok) {
    redoStack.pop();
    depth.set(view, depthOf(view.state));
    return false;
  }
  redoStack.pop();
  depth.set(view, depthOf(view.state));
  undoStack.push(view);
  view.focus();
  return true;
}

/**
 * Highest-priority keymap for the section editors: Cmd-Z / Cmd-Y drive the
 * section-wide stack, falling through (returning false) to the per-editor undo
 * keymap when there's nothing section-wide to act on.
 */
export function sectionUndoKeymap(): Plugin {
  const undo: Command = () => sectionUndo();
  const redo: Command = () => sectionRedo();
  return keymap({ "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo });
}

/** Toolbar Undo: section-wide first, else per-editor undo of the active view. */
export const sectionUndoCommand: Command = (state, dispatch, view) =>
  sectionUndo() || verseUndo(state, dispatch, view);

/** Toolbar Redo: section-wide first, else per-editor redo of the active view. */
export const sectionRedoCommand: Command = (state, dispatch, view) =>
  sectionRedo() || verseRedo(state, dispatch, view);
