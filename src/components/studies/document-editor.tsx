"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history, undo } from "prosemirror-history";
import { History } from "lucide-react";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  appendDocumentSteps,
  createDocumentCheckpoint,
  fetchDocumentHead,
} from "@/app/studies/actions";
import { useEditorContext } from "@/components/studies/editor-context";
import { PresenceAvatars } from "@/components/studies/presence-avatars";
import { StudyBlocksDialog } from "@/components/studies/study-blocks-dialog";
import { VersionHistoryPanel } from "@/components/studies/version-history-panel";
import { Button } from "@/components/ui/button";
import type { DocumentHistory, StudyDocument } from "@/lib/db/types";
import { selectCurrentBlock } from "@/lib/editor/commands";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { blockHandle } from "@/lib/editor/plugins/block-handle";
import { blocksSelectionGuard } from "@/lib/editor/plugins/blocks-selection-guard";
import { blocksStructureGuard } from "@/lib/editor/plugins/blocks-structure-guard";
import { noteAnchors } from "@/lib/editor/plugins/note-anchors";
import { notesIndexGuard } from "@/lib/editor/plugins/notes-index-guard";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { slashMenu } from "@/lib/editor/plugins/slash-menu";
import { verseGuard } from "@/lib/editor/plugins/verse-guard";
import { verseLabel } from "@/lib/editor/plugins/verse-label";
import { nodes, schema } from "@/lib/editor/schema";
import {
  recordUndo,
  registerUndoView,
  sectionUndoKeymap,
  unregisterUndoView,
} from "@/lib/editor/section-undo";
import {
  docToJSON,
  jsonToDoc,
  jsonToStep,
  stepToJSON,
} from "@/lib/editor/serialize";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
import { UNDO_GROUP_DELAY_MS, withUndoBoundary } from "@/lib/editor/word-undo";
import {
  broadcastCursor,
  broadcastSteps,
  colorForId,
  openDocumentChannel,
} from "@/lib/realtime/document-channel";
import type { PresenceMember } from "@/lib/realtime/document-channel";

const AUTOSAVE_DELAY_MS = 1200;
/** Snapshot a checkpoint after this many new steps, to bound replay length. */
const CHECKPOINT_EVERY = 50;

type SaveStatus = "idle" | "saving" | "saved";

type EditorRole = "notes" | "blocks";

function createPlugins(placeholderText: string, role: EditorRole) {
  const plugins = [
    // Highest priority: section-wide Cmd-Z/Cmd-Y across both editors, falling
    // through to the per-editor undo in buildKeymaps when nothing is tracked.
    sectionUndoKeymap(),
    buildInputRules(),
    ...buildKeymaps(),
    gapCursor(),
    history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
    verseGuard(),
    verseLabel(),
    slashMenu(),
    blockHandle(),
    // Cell selection + structural editing for tables (harmless when none exist).
    tableEditing(),
    // Inline clickable icon at the end of each note-anchored range.
    noteAnchors(),
    // Keep the pinned notes index from being deleted (no-op in the body editor).
    notesIndexGuard(),
    placeholderPlugin(placeholderText),
  ];
  // The blocks doc is locked to study blocks + the pinned notes index (no
  // freeform text, no bulk-deleting blocks); the Study Body stays freeform.
  if (role === "blocks") {
    // Prepend so ⌘A selects the current block, beating baseKeymap's selectAll.
    plugins.unshift(keymap({ "Mod-a": selectCurrentBlock }));
    plugins.push(blocksStructureGuard(), blocksSelectionGuard());
  }
  return plugins;
}

function initialDoc(content: PMDocJSON) {
  const doc = jsonToDoc(content);
  // Defensive: the schema requires at least one block; fall back to a paragraph.
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
}

/**
 * Does the blocks doc hold real structure (a study block or the pinned notes
 * index), vs. just the empty placeholder paragraph? Drives both the editor's
 * editability and the empty-state prompt so the blocks area never accepts
 * freeform text when there's nothing in it.
 */
function hasBlocksStructure(doc: Node): boolean {
  for (let i = 0; i < doc.childCount; i++) {
    const type = doc.child(i).type;
    if (type === nodes.studyBlock || type === nodes.notesIndex) {
      return true;
    }
  }
  return false;
}

/**
 * Rebuild the editor state with a usable undo stack: start from the base doc
 * (latest checkpoint) and replay the persisted steps as history-tracked
 * transactions, so Cmd-Z survives a page refresh back to that checkpoint.
 * `closeHistory` between persisted batches (different `created_at`) keeps undo
 * groups roughly at the granularity the edits were made. Any replay failure
 * falls back to the materialized head doc with no history (doc stays correct).
 */
function buildInitialState(
  bundle: DocumentHistory,
  headContent: PMDocJSON,
  placeholderText: string,
  role: EditorRole,
) {
  try {
    let state = EditorState.create({
      doc: initialDoc(bundle.baseDoc),
      plugins: createPlugins(placeholderText, role),
    });
    let prevCreatedAt: string | null = null;
    for (const row of bundle.steps) {
      let tr = state.tr;
      if (prevCreatedAt !== null && row.created_at !== prevCreatedAt) {
        tr = closeHistory(tr);
      }
      tr.step(jsonToStep(row.step));
      // Replaying persisted history may legitimately remove verse numbers (e.g.
      // undoing a scripture insert); let it through the verse guard.
      tr.setMeta("allowVerseEdit", true);
      state = state.apply(tr);
      prevCreatedAt = row.created_at;
    }
    return state;
  } catch {
    return EditorState.create({
      doc: initialDoc(headContent),
      plugins: createPlugins(placeholderText, role),
    });
  }
}

/**
 * Editable, autosaving editor for ONE document (notes or blocks) the user owns.
 * Persists ProseMirror steps via the document RPCs with optimistic concurrency,
 * broadcasts them + the cursor to read-along viewers, snapshots checkpoints,
 * and offers per-document version history. The section title lives one level up.
 */
export function DocumentEditor({
  document: doc,
  history: docHistory,
  me,
  label,
  hideLabel = false,
  hideHistory = false,
  placeholder,
  studyId,
  isTemplate = false,
}: {
  document: StudyDocument;
  history: DocumentHistory;
  me: { id: string; name: string } | null;
  label: string;
  /** Keep the label for screen readers but hide it visually (still shows the controls row). */
  hideLabel?: boolean;
  /** Hide this editor's own History button (a section-level history is used instead). */
  hideHistory?: boolean;
  placeholder: string;
  /** Set on the blocks editor to enable the study-blocks dialog. */
  studyId?: string;
  /** Template study — the blocks dialog's Template tab edits the default. */
  isTemplate?: boolean;
}) {
  const editor = useEditorContext();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHead, setHistoryHead] = useState(0);
  // The blocks editor shows a non-editable prompt (instead of an editable
  // surface) until it holds a study block or the notes index — so a fresh
  // section never has freeform text. Always false for the Study Body.
  const [blocksEmpty, setBlocksEmpty] = useState(
    () => doc.kind === "blocks" && !hasBlocksStructure(initialDoc(doc.content)),
  );
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // The shared toolbar acts on whichever editor is focused; keep a stable handle
  // to the context callbacks for the view's (once-created) imperative lifecycle.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const role = doc.kind === "notes" ? "notes" : "blocks";
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persistence state (refs so the editor view's callbacks always see current
  // values without re-creating the view).
  const lastVersionRef = useRef(docHistory.headVersion);
  const lastCheckpointRef = useRef(docHistory.baseVersion);
  const pendingStepsRef = useRef<SerializedStep[]>([]);
  const flushingRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const clientId = crypto.randomUUID();
    const myName = me?.name;
    const myColor = me ? colorForId(me.id) : undefined;
    // Broadcast this writer's steps + cursor to read-only viewers (read-along),
    // and join presence so the owner can see who's reading along.
    let channel: RealtimeChannel | undefined;
    let disposed = false;
    // Read through a function in the async `flush` below: a call's result is
    // never value-narrowed by control-flow analysis, so the post-`await` guards
    // aren't flagged "always false" (the cleanup flips `disposed` from a
    // separate closure, which CFA can't see).
    const isDisposed = () => disposed;
    void openDocumentChannel(
      doc.id,
      {
        onPresence: (next) => {
          if (!disposed) {
            setMembers(next);
          }
        },
      },
      me ? { userId: me.id, name: me.name, isOwner: true } : undefined,
    ).then((ch) => {
      if (disposed) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
    });

    async function flush() {
      if (flushingRef.current || pendingStepsRef.current.length === 0) {
        return;
      }
      const view = viewRef.current;
      if (!view) {
        return;
      }
      flushingRef.current = true;
      const batch = pendingStepsRef.current;
      pendingStepsRef.current = [];
      const base = lastVersionRef.current;
      const newDoc = docToJSON(view.state.doc);
      try {
        const result = await appendDocumentSteps(
          doc.id,
          base,
          batch,
          newDoc,
          clientId,
        );
        // The view may have been torn down (section swap) while the save was in
        // flight — the steps are persisted, so just stop before touching it.
        if (isDisposed()) {
          return;
        }
        if (!result.ok) {
          // Another writer (the owner's other tab) advanced the doc. Discard our
          // stale pending edits and rebuild from the server head in place — no
          // jarring full-page reload.
          const head = await fetchDocumentHead(doc.id);
          if (isDisposed()) {
            return;
          }
          if (head) {
            pendingStepsRef.current = [];
            lastVersionRef.current = head.version;
            lastCheckpointRef.current = head.version;
            const fresh = EditorState.create({
              doc: initialDoc(head.content),
              plugins: createPlugins(placeholder, role),
            });
            view.updateState(fresh);
            editorRef.current?.setActive(view, fresh);
            setStatus("saved");
            toast.info("Synced with your latest edits from another tab.");
          }
          return;
        }
        lastVersionRef.current = result.version;
        setStatus("saved");
        // A retry/transient error may have surfaced an error toast earlier; clear it.
        toast.dismiss("section-save-error");
        // Push the persisted steps + the cursor's new position to viewers.
        if (channel) {
          broadcastSteps(channel, {
            base,
            steps: batch,
            version: result.version,
          });
          broadcastCursor(channel, {
            anchor: view.state.selection.anchor,
            head: view.state.selection.head,
            version: result.version,
            name: myName,
            color: myColor,
          });
        }
        if (result.version - lastCheckpointRef.current >= CHECKPOINT_EVERY) {
          lastCheckpointRef.current = result.version;
          void createDocumentCheckpoint(doc.id).catch(() => undefined);
        }
      } catch {
        // Keep the steps and let the next change (or blur) retry. Surface a
        // single, deduped error toast (cleared on the next successful save).
        pendingStepsRef.current = [...batch, ...pendingStepsRef.current];
        setStatus("idle");
        toast.error("Couldn't save your changes. Retrying…", {
          id: "section-save-error",
        });
      } finally {
        flushingRef.current = false;
        if (pendingStepsRef.current.length > 0) {
          scheduleFlush();
        }
      }
    }

    function scheduleFlush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DELAY_MS);
    }

    function flushNow() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void flush();
    }

    // Throttle cursor broadcasts (trailing) so rapid selection changes — e.g.
    // dragging a selection — don't flood viewers with messages.
    const CURSOR_THROTTLE_MS = 80;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCursor: { anchor: number; head: number } | null = null;
    function scheduleCursorBroadcast(anchor: number, head: number) {
      pendingCursor = { anchor, head };
      if (cursorTimer) {
        return;
      }
      cursorTimer = setTimeout(() => {
        cursorTimer = null;
        if (channel && pendingCursor) {
          broadcastCursor(channel, {
            anchor: pendingCursor.anchor,
            head: pendingCursor.head,
            version: lastVersionRef.current,
            name: myName,
            color: myColor,
          });
        }
      }, CURSOR_THROTTLE_MS);
    }

    const view = new EditorView(mount, {
      state: buildInitialState(docHistory, doc.content, placeholder, role),
      nodeViews: buildNodeViews(true),
      editable: (state) => role !== "blocks" || hasBlocksStructure(state.doc),
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        // Open a fresh undo group at word/action boundaries (Google-Docs-style).
        // `withUndoBoundary` returns the same transaction (possibly meta-tagged),
        // so the autosave step loop below is unaffected.
        const tr = withUndoBoundary(current, transaction);
        const next = current.state.apply(tr);
        current.updateState(next);
        // Editing (or moving the cursor in) this editor makes it the toolbar's
        // active target and refreshes the toolbar's active-mark states.
        editorRef.current?.setActive(current, next);
        // Track this edit in the section-wide undo order.
        recordUndo(current, next);
        if (transaction.docChanged && role === "blocks") {
          // Toggle the empty-state prompt / editability as blocks come and go.
          const empty = !hasBlocksStructure(next.doc);
          setBlocksEmpty((prev) => (prev === empty ? prev : empty));
        }
        if (transaction.docChanged) {
          for (const step of transaction.steps) {
            pendingStepsRef.current.push(stepToJSON(step));
          }
          setStatus("saving");
          scheduleFlush();
        } else if (
          transaction.selectionSet &&
          pendingStepsRef.current.length === 0
        ) {
          // Cursor moved with no unsaved edits — its position is valid at the
          // confirmed head, so viewers can place it directly (throttled).
          scheduleCursorBroadcast(next.selection.anchor, next.selection.head);
        }
      },
      handleDOMEvents: {
        focus: () => {
          const current = viewRef.current;
          if (current) {
            editorRef.current?.setActive(current, current.state);
          }
          return false;
        },
        blur: () => {
          flushNow();
          return false;
        },
      },
    });
    viewRef.current = view;
    editorRef.current?.registerView(view, role);
    registerUndoView(view);

    return () => {
      disposed = true;
      // Persist any pending edits before tearing down — otherwise a fast section
      // swap (the mine editor remounts on the new section) drops the last
      // unsaved <1.2s of typing. `flush` snapshots the doc synchronously and the
      // post-await `disposed` guards keep it from touching the destroyed view.
      flushNow();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      if (cursorTimer) {
        clearTimeout(cursorTimer);
      }
      if (channel) {
        void channel.unsubscribe();
      }
      editorRef.current?.unregisterView(view);
      unregisterUndoView(view);
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once per document (remounted via key={document.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore by replacing the whole doc with a past version — flows through the
  // normal step pipeline, so it's persisted, broadcast, and itself undoable.
  function applyRestore(targetDoc: PMDocJSON) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const node = jsonToDoc(targetDoc);
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      node.content,
    );
    tr.setMeta("allowVerseEdit", true);
    if (tr.docChanged) {
      view.dispatch(tr);
      // The restore is a single undoable transaction — offer a one-click revert.
      toast.success("Version restored.", {
        action: {
          label: "Undo",
          onClick: () => {
            const current = viewRef.current;
            if (current) {
              undo(current.state, current.dispatch);
              current.focus();
            }
          },
        },
      });
    }
    setHistoryOpen(false);
    view.focus();
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2
          className={
            hideLabel
              ? "sr-only"
              : "text-sm font-semibold text-muted-foreground"
          }
        >
          {label}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PresenceAvatars
            members={members.filter((member) => member.userId !== me?.id)}
          />
          <span
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {statusLabel}
          </span>
          {doc.kind === "blocks" && studyId ? (
            <StudyBlocksDialog studyId={studyId} isTemplate={isTemplate} />
          ) : null}
          {hideHistory ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setHistoryHead(lastVersionRef.current);
                setHistoryOpen(true);
              }}
            >
              <History className="size-4" />
              History
            </Button>
          )}
        </div>
      </div>
      <div ref={mountRef} className={blocksEmpty ? "hidden" : "min-h-32"} />
      {doc.kind === "blocks" && blocksEmpty ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No study blocks yet. Use “Edit blocks” above to add them.
        </div>
      ) : null}
      {historyOpen ? (
        <VersionHistoryPanel
          documentId={doc.id}
          headVersion={historyHead}
          onRestore={applyRestore}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
