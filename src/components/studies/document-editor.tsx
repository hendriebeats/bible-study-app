"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history, undo } from "prosemirror-history";
import { History, Plus, RotateCcw } from "lucide-react";
import { EditorState } from "prosemirror-state";
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
import { VersionHistoryPanel } from "@/components/studies/version-history-panel";
import { Button } from "@/components/ui/button";
import type { DocumentHistory, StudyDocument } from "@/lib/db/types";
import { blocksDocFromSpecs, type BlockSpec } from "@/lib/editor/blocks";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { verseGuard } from "@/lib/editor/plugins/verse-guard";
import { nodes, schema } from "@/lib/editor/schema";
import {
  docToJSON,
  jsonToDoc,
  jsonToStep,
  stepToJSON,
} from "@/lib/editor/serialize";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
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

function createPlugins(placeholderText: string) {
  return [
    buildInputRules(),
    ...buildKeymaps(),
    gapCursor(),
    history(),
    verseGuard(),
    placeholderPlugin(placeholderText),
  ];
}

function initialDoc(content: PMDocJSON) {
  const doc = jsonToDoc(content);
  // Defensive: the schema requires at least one block; fall back to a paragraph.
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
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
) {
  try {
    let state = EditorState.create({
      doc: initialDoc(bundle.baseDoc),
      plugins: createPlugins(placeholderText),
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
      plugins: createPlugins(placeholderText),
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
  placeholder,
  defaultBlocks,
}: {
  document: StudyDocument;
  history: DocumentHistory;
  me: { id: string; name: string } | null;
  label: string;
  placeholder: string;
  defaultBlocks?: BlockSpec[];
}) {
  const editor = useEditorContext();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHead, setHistoryHead] = useState(0);
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
        if (!result.ok) {
          // Another writer (the owner's other tab) advanced the doc. Discard our
          // stale pending edits and rebuild from the server head in place — no
          // jarring full-page reload.
          const head = await fetchDocumentHead(doc.id);
          if (head) {
            pendingStepsRef.current = [];
            lastVersionRef.current = head.version;
            lastCheckpointRef.current = head.version;
            const fresh = EditorState.create({
              doc: initialDoc(head.content),
              plugins: createPlugins(placeholder),
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
      state: buildInitialState(docHistory, doc.content, placeholder),
      nodeViews: buildNodeViews(true),
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        const next = current.state.apply(transaction);
        current.updateState(next);
        // Editing (or moving the cursor in) this editor makes it the toolbar's
        // active target and refreshes the toolbar's active-mark states.
        editorRef.current?.setActive(current, next);
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

    return () => {
      disposed = true;
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
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once per document (remounted via key={document.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Append a new (empty, rename-able) study block. If the doc is still just the
  // placeholder paragraph, replace it so the blocks doc holds only blocks.
  function addBlock() {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const block = nodes.studyBlock.createAndFill({
      title: "New block",
      subtitle: "",
      placeholder: "",
      lineageId: null,
      templateId: null,
    });
    if (!block) {
      return;
    }
    const { doc: current } = view.state;
    const first = current.firstChild;
    const isLonePlaceholder =
      current.childCount === 1 &&
      first?.type === nodes.paragraph &&
      first.content.size === 0;
    const tr = isLonePlaceholder
      ? view.state.tr.replaceWith(0, current.content.size, block)
      : view.state.tr.insert(current.content.size, block);
    view.dispatch(tr);
    view.focus();
  }

  // Replace the blocks doc with the study's genre default set. Flows through the
  // normal step pipeline (persisted, broadcast, undoable).
  function resetToDefault() {
    const view = viewRef.current;
    if (!view || !defaultBlocks || defaultBlocks.length === 0) {
      return;
    }
    const node = jsonToDoc(blocksDocFromSpecs(defaultBlocks));
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      node.content,
    );
    tr.setMeta("allowVerseEdit", true);
    if (tr.docChanged) {
      view.dispatch(tr);
      toast.success("Blocks reset to the study default.");
    }
    view.focus();
  }

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
        <h2 className="text-sm font-semibold text-muted-foreground">{label}</h2>
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
        </div>
      </div>
      <div ref={mountRef} className="min-h-32" />
      {doc.kind === "blocks" ? (
        <div className="mt-2 flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={addBlock}>
            <Plus className="size-4" />
            Add block
          </Button>
          {defaultBlocks && defaultBlocks.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetToDefault}
            >
              <RotateCcw className="size-4" />
              Reset to default
            </Button>
          ) : null}
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
