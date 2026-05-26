"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import {
  BookOpen,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo,
  RotateCcw,
  Strikethrough,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EditorState } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  addScripturePassage,
  appendDocumentSteps,
  createDocumentCheckpoint,
  fetchDocumentHead,
} from "@/app/studies/actions";
import { PresenceAvatars } from "@/components/studies/presence-avatars";
import { VersionHistoryPanel } from "@/components/studies/version-history-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { DocumentHistory, StudyDocument } from "@/lib/db/types";
import { blocksDocFromSpecs, type BlockSpec } from "@/lib/editor/blocks";
import {
  isAncestorActive,
  isBlockActive,
  isMarkActive,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
} from "@/lib/editor/commands";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { marks, nodes, schema } from "@/lib/editor/schema";
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

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  command: Command;
  active: boolean;
}

function Toolbar({
  state,
  onCommand,
}: {
  state: EditorState | null;
  onCommand: (command: Command) => void;
}) {
  if (!state) {
    return null;
  }

  const groups: ToolbarItem[][] = [
    [
      {
        icon: Bold,
        label: "Bold",
        command: toggleBold,
        active: isMarkActive(state, marks.strong),
      },
      {
        icon: Italic,
        label: "Italic",
        command: toggleItalic,
        active: isMarkActive(state, marks.em),
      },
      {
        icon: Strikethrough,
        label: "Strikethrough",
        command: toggleStrike,
        active: isMarkActive(state, marks.strikethrough),
      },
    ],
    [
      {
        icon: Heading1,
        label: "Heading 1",
        command: toggleHeading(1),
        active: isBlockActive(state, nodes.heading, { level: 1 }),
      },
      {
        icon: Heading2,
        label: "Heading 2",
        command: toggleHeading(2),
        active: isBlockActive(state, nodes.heading, { level: 2 }),
      },
      {
        icon: Heading3,
        label: "Heading 3",
        command: toggleHeading(3),
        active: isBlockActive(state, nodes.heading, { level: 3 }),
      },
    ],
    [
      {
        icon: List,
        label: "Bullet list",
        command: toggleBulletList,
        active: isAncestorActive(state, nodes.bulletList),
      },
      {
        icon: ListOrdered,
        label: "Numbered list",
        command: toggleOrderedList,
        active: isAncestorActive(state, nodes.orderedList),
      },
      {
        icon: Quote,
        label: "Quote",
        command: toggleBlockquote,
        active: isAncestorActive(state, nodes.blockquote),
      },
    ],
    [
      { icon: Undo, label: "Undo", command: undo, active: false },
      { icon: Redo, label: "Redo", command: redo, active: false },
    ],
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
      {groups.map((group, index) => (
        <div key={group[0]?.label ?? index} className="flex items-center gap-1">
          {index > 0 ? (
            <Separator orientation="vertical" className="mx-1 h-6" />
          ) : null}
          {group.map((item) => (
            <Button
              key={item.label}
              type="button"
              size="icon"
              variant={item.active ? "secondary" : "ghost"}
              aria-label={item.label}
              aria-pressed={item.active}
              onClick={() => {
                onCommand(item.command);
              }}
            >
              <item.icon className="size-4" />
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
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
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHead, setHistoryHead] = useState(0);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [scriptureOpen, setScriptureOpen] = useState(false);
  const [scriptureRef, setScriptureRef] = useState("");
  const [scriptureBusy, setScriptureBusy] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
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
            setEditorState(fresh);
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
        setEditorState(next);
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
        blur: () => {
          flushNow();
          return false;
        },
      },
    });
    viewRef.current = view;
    setEditorState(view.state);

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
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once per document (remounted via key={document.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runCommand(command: Command) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
  }

  // Append a new (empty, rename-able) study block. If the doc is still just the
  // placeholder paragraph, replace it so the blocks doc holds only blocks.
  function addBlock() {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const block = nodes.studyBlock.createAndFill({
      label: "New block",
      prompt: "",
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

  // Look up a reference's ESV text and insert it as a (non-editable) scripture
  // atom at the cursor. The text + reference persist in the node's attrs.
  async function insertScripture() {
    const view = viewRef.current;
    const reference = scriptureRef.trim();
    if (!view || reference === "") {
      return;
    }
    setScriptureBusy(true);
    const result = await addScripturePassage(doc.section_id, reference);
    setScriptureBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const node = nodes.scripture.create({
      reference: result.reference,
      version: result.version,
      passageId: result.passageId,
      text: result.text,
    });
    view.dispatch(view.state.tr.replaceSelectionWith(node));
    view.focus();
    setScriptureRef("");
    setScriptureOpen(false);
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
    <div className="flex h-full flex-col">
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
      <Toolbar state={editorState} onCommand={runCommand} />
      <div ref={mountRef} className="mt-3 flex-1 overflow-auto" />
      {doc.kind === "notes" ? (
        <div className="mt-2 shrink-0">
          {scriptureOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={scriptureRef}
                onChange={(event) => {
                  setScriptureRef(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void insertScripture();
                  }
                }}
                placeholder="e.g. John 3:1-21"
                aria-label="Scripture reference"
                className="h-8 max-w-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={scriptureBusy}
                onClick={() => {
                  void insertScripture();
                }}
              >
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setScriptureOpen(false);
                  setScriptureRef("");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setScriptureOpen(true);
              }}
            >
              <BookOpen className="size-4" />
              Add scripture
            </Button>
          )}
        </div>
      ) : null}
      {doc.kind === "blocks" ? (
        <div className="mt-2 flex shrink-0 items-center gap-1">
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
